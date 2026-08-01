// T-09: Orchestration API run planner (Phase 1: connectivity, schema,
// profile checks). Extended by T-15 (Phase 2: volume + row-level checks).
//
// runComparison(definition, connectors) is the first task that wires the
// engine's pieces together end-to-end:
//   1. Resolve `definition.source.connection` / `.target.connection` (named
//      string references, per T-08) to actual `DataPlatformConnector`
//      instances via an injectable `ConnectorRegistry` -- this module
//      depends ONLY on the `DataPlatformConnector` interface
//      (@paritylens/shared), never on `FixtureConnector` specifically, so a
//      real connector (T-17/T-18/T-19) can be registered later without any
//      change to this file. The Fixture connector is wired in only at the
//      test/call-site level (see planner.test.ts), matching
//      TASK-BRIEF.md's "Connection resolution scope for this task" section.
//   2. Test connectivity on both sides (Idea Prompt.md's "Layer 1:
//      Connectivity and Execution"). A connectivity failure on either side
//      short-circuits the run with a "failed"-status ComparisonResult
//      *before* any schema/profile/volume/row-level work runs.
//   3. If `checks.schema.enabled`, fetch both sides' schemas and run T-06's
//      `compareSchemas`.
//   4. If `checks.profile.enabled`, fetch both sides' schemas (reused from
//      step 3 when schema checking also ran), profile every column present
//      on both sides via T-07's `profileColumn`, and diff each pair via
//      `compareProfiles`.
//   5. (T-15) If `checks.rowCount?.enabled`, run T-13's `compareVolume` once
//      for the whole comparison and populate `rowCounts` /
//      `aggregateDifferences` from its result.
//   6. (T-15) If `checks.rowLevel?.enabled`, fetch both sides' full row data
//      via `executeQuery` and run T-14's `compareRows`, populating
//      `rowDifferences`.
//   7. Assemble the final `ComparisonResult` matching Idea Prompt.md section
//      11's shape exactly, with `summary.{passed,warnings,failed}` computed
//      from the actual collected findings' severities (now including
//      volume/row-level findings, per T-15) and `status` derived from the
//      same collected findings.
//
// Each of steps 5/6 is independently gated on its own `checks.*.enabled`
// flag -- disabling a check leaves its corresponding result field(s) at
// T-09's original Phase-1 empty/default values, with no query issued to
// either connector for that check (see planner.test.ts's "no silent
// execution" tests).
import type {
  AggregateDifference,
  ColumnDefinition,
  ComparisonResult,
  ComparisonStatus,
  ComparisonSummary,
  DataPlatformConnector,
  ProfileDifference,
  RecordBatch,
  RowDifference,
  Severity,
  SchemaDifference,
} from "@paritylens/shared";
import type { ParityDefinition } from "../definition/definition.js";
import { compareSchemas } from "../../comparison-core/schema-diff/schema-diff.js";
import { compareProfiles, profileColumn, buildProfileQueries } from "../../comparison-core/profiling/profiling.js";
import { compareVolume, buildRowCountSql } from "../../comparison-core/volume/volume.js";
import { compareRows } from "../../comparison-core/row-level/row-level.js";

/**
 * Injectable/pluggable map from a `ParityDefinition` connection name (the
 * bare string in `source.connection` / `target.connection`) to an actual
 * `DataPlatformConnector` instance. Callers construct and populate this --
 * for this task's tests, with `FixtureConnector` instances (T-04); a real
 * deployment will populate it with `SqlServerConnector`/`SnowflakeConnector`/
 * `PostgresConnector` instances (T-17/T-18/T-19) once they exist, with zero
 * change required to `runComparison` itself.
 */
export type ConnectorRegistry = Map<string, DataPlatformConnector>;

/** Thrown only for a genuine programming/wiring error (never for a normal
 * connectivity failure, which is reported via `ComparisonResult.status`
 * instead -- see this module's header comment on Layer 1 short-circuiting). */
export class UnresolvedConnectionError extends Error {
  constructor(connectionName: string, side: "source" | "target") {
    super(`No connector registered for ${side} connection "${connectionName}".`);
    this.name = "UnresolvedConnectionError";
  }
}

/** Runs a Phase-1 comparison (connectivity, schema, profile) for the given
 * parsed `ParityDefinition`, resolving its named connections through
 * `connectors`, and returns a `ComparisonResult` matching Idea Prompt.md
 * section 11's shape. Never throws for a connectivity failure -- that is
 * reported as a `"failed"`-status result instead, per Layer 1's contract.
 */
export async function runComparison(
  definition: ParityDefinition,
  connectors: ConnectorRegistry
): Promise<ComparisonResult> {
  const runId = new Date().toISOString();

  // --- Step 1: resolve connections (Phase 1 boundary: registry lookup only,
  // no Fixture-specific behavior here). A missing registration is treated as
  // a connectivity failure, not a thrown error, since "the named connection
  // could not be resolved to a working connector" is itself a Layer 1
  // execution-status fact the result object should carry.
  const source = connectors.get(definition.source.connection);
  const target = connectors.get(definition.target.connection);

  if (!source || !target) {
    const missing: string[] = [];
    if (!source) missing.push(`source connection "${definition.source.connection}"`);
    if (!target) missing.push(`target connection "${definition.target.connection}"`);
    return buildFailedResult(
      definition,
      runId,
      `Connectivity check failed: no connector registered for ${missing.join(" and ")}.`
    );
  }

  // --- Step 2: Layer 1 connectivity check. Short-circuits before any
  // schema/profile work per Idea Prompt.md's "Layer 1: Connectivity and
  // Execution" -- "This produces a basic execution status before any parity
  // work begins."
  const sourceConnectStart = Date.now();
  const sourceConnectResult = await source.testConnection();
  const sourceDurationMs = Date.now() - sourceConnectStart;

  const targetConnectStart = Date.now();
  const targetConnectResult = await target.testConnection();
  const targetDurationMs = Date.now() - targetConnectStart;

  if (!sourceConnectResult.success || !targetConnectResult.success) {
    const reasons: string[] = [];
    if (!sourceConnectResult.success) {
      reasons.push(`source: ${sourceConnectResult.message ?? "connection test failed"}`);
    }
    if (!targetConnectResult.success) {
      reasons.push(`target: ${targetConnectResult.message ?? "connection test failed"}`);
    }
    return buildFailedResult(
      definition,
      runId,
      `Connectivity check failed (${reasons.join("; ")}).`,
      { sourceDurationMs, targetDurationMs, comparisonDurationMs: 0 }
    );
  }

  // --- Steps 3/4: schema + profile checks, timed together as the
  // "comparison" phase distinct from the connectivity phase above.
  const comparisonStart = Date.now();

  let schemaDifferences: SchemaDifference[] = [];
  let profileDifferences: ProfileDifference[] = [];
  // T-16b: SQL strings actually issued for this run's checks, collected from
  // the same builder functions the execution code paths themselves call
  // (buildRowCountSql, buildProfileQueries, buildFetchAllRowsSql) -- never
  // reconstructed independently, so preview and execution can never drift
  // apart.
  const queriesUsed: string[] = [];

  const schemaEnabled = definition.checks.schema?.enabled === true;
  const profileEnabled = definition.checks.profile?.enabled === true;

  if (schemaEnabled || profileEnabled) {
    const sourceColumns = await source.getSchema({ kind: "table", object: definition.source.object });
    const targetColumns = await target.getSchema({ kind: "table", object: definition.target.object });

    if (schemaEnabled) {
      schemaDifferences = compareSchemas(sourceColumns, targetColumns);
    }

    if (profileEnabled) {
      const profileResult = await runProfileChecks(
        source,
        target,
        sourceColumns,
        targetColumns,
        definition
      );
      profileDifferences = profileResult.findings;
      queriesUsed.push(...profileResult.queriesUsed);
    }
  }

  // --- Steps 5/6: Phase 2 checks -- volume (row-count) and row-level parity.
  // Timed together with schema/profile as part of the same "comparison"
  // phase (comparisonDurationMs covers steps 3-6 collectively, matching how
  // T-09 already timed schema+profile as one phase rather than splitting
  // per-check timings the shared ComparisonResult shape has no field for).
  let rowCounts: ComparisonResult["rowCounts"] = { source: 0, target: 0, difference: 0 };
  let aggregateDifferences: AggregateDifference[] = [];
  let rowDifferences: RowDifference[] = [];

  const rowCountEnabled = definition.checks.rowCount?.enabled === true;
  const rowLevelEnabled = definition.checks.rowLevel?.enabled === true;

  if (rowCountEnabled) {
    // Judgment call (documented per TASK-BRIEF.md's instruction not to leave
    // this unspecified-and-silent): compareVolume is awaited directly and
    // allowed to propagate/reject the whole runComparison call on failure,
    // the same way any other unexpected exception in this function already
    // would (schema/profile checks above have the same behavior -- neither
    // is wrapped in a try/catch). This differs deliberately from the Layer-1
    // connectivity short-circuit (step 2 above), which converts a
    // *connectivity* failure into a "failed"-status result because
    // Idea Prompt.md's Layer 1 contract explicitly frames connectivity as
    // "a basic execution status" fact to report, not an exception. A
    // compareVolume/compareRows failure past that point (e.g. the query
    // itself erroring) is a genuine run failure, not a parity finding, so
    // letting it throw (rather than silently downgrading it to an empty
    // result) keeps failures loud, consistent with how this file already
    // treats every other unexpected error.
    const rowCountSourceInput = { kind: "table" as const, object: definition.source.object };
    const rowCountTargetInput = { kind: "table" as const, object: definition.target.object };
    queriesUsed.push(buildRowCountSql(source, rowCountSourceInput), buildRowCountSql(target, rowCountTargetInput));

    const volumeDifference = await compareVolume(
      source,
      target,
      rowCountSourceInput,
      rowCountTargetInput,
      definition.checks.rowCount?.tolerance
      // T-13-01 (PROGRESS-LEDGER.md, Minor, carried forward to this task):
      // when a definition supplies both `tolerance.percentage` and
      // `tolerance.absolute`, precedence is resolved entirely inside
      // compareVolume's own `evaluateTolerance` (volume.ts) -- percentage
      // wins whenever both are set (checked first, absolute only consulted
      // when percentage is undefined). This task passes
      // `definition.checks.rowCount.tolerance` straight through unchanged
      // (the shapes are structurally assignable, per volume.ts's own header
      // comment), so that precedence rule applies as-is; this task does not
      // reinterpret or override it, and does not modify volume.ts (T-13's
      // owned file) to make the precedence any more explicit than it already
      // is there. Documented here, at the call site, so the ambiguity T-13-01
      // flagged is now resolved rather than left open.
    );
    rowCounts = {
      source: volumeDifference.sourceCount,
      target: volumeDifference.targetCount,
      difference: volumeDifference.difference,
    };
    aggregateDifferences = [volumeDifference];
  }

  if (rowLevelEnabled) {
    queriesUsed.push(
      buildFetchAllRowsSql(source, definition.source),
      buildFetchAllRowsSql(target, definition.target)
    );

    const [sourceRows, targetRows] = await Promise.all([
      fetchAllRows(source, definition.source),
      fetchAllRows(target, definition.target),
    ]);

    rowDifferences = compareRows(
      sourceRows,
      targetRows,
      definition.keys,
      definition.columnMapping,
      definition.rules
    );
  }

  const comparisonDurationMs = Date.now() - comparisonStart;

  // --- Step 7: assemble the final ComparisonResult.
  const allFindings: Array<{ severity: Severity }> = [
    ...schemaDifferences,
    ...profileDifferences,
    ...aggregateDifferences,
    ...rowDifferences,
  ];
  const summary = summarizeFindings(allFindings);
  const status = deriveStatus(allFindings);

  return {
    comparison: definition.name,
    runId,
    status,
    summary,
    rowCounts,
    schemaDifferences,
    profileDifferences,
    aggregateDifferences,
    rowDifferences,
    execution: {
      sourceDurationMs,
      targetDurationMs,
      comparisonDurationMs,
    },
    ...(queriesUsed.length > 0 ? { queriesUsed } : {}),
  };
}

/**
 * T-16b: pure, string-returning builder returning exactly the SQL string
 * `fetchAllRows` below builds and executes for `side` -- `fetchAllRows`
 * calls this function directly rather than re-building the string, so the
 * previewed and executed SQL can never drift apart (per TASK-BRIEF.md's
 * central correctness property for this task).
 */
export function buildFetchAllRowsSql(connector: DataPlatformConnector, side: ParityDefinition["source"]): string {
  const objectRef = connector.quoteIdentifier(side.object);
  return side.where ? `SELECT * FROM ${objectRef} WHERE ${side.where}` : `SELECT * FROM ${objectRef}`;
}

/** Fetches a `ParitySide`'s full row data (all mapped/key columns are
 * naturally included since this issues a bare `SELECT *`) via
 * `executeQuery`, consuming the resulting `AsyncIterable<RecordBatch>` fully
 * into a single in-memory `RecordBatch`, per TASK-BRIEF.md's Interfaces
 * table ("fetch full row data for both sides via `executeQuery` ... consume
 * the resulting `AsyncIterable<RecordBatch>` fully into row sets"). Applies
 * `ParitySide.where` when present, matching the exact pattern this file
 * already documents for `ParitySide` fields elsewhere. Row-set size is
 * bounded by `DEFAULT_ROW_LEVEL_MAX_ROWS` -- row-level comparison assumes
 * both sides fit in memory (T-14's own file header comment: "assume both
 * sides fit in memory for now"), and this planner does not add pagination
 * beyond what `compareRows` itself already assumes. */
async function fetchAllRows(
  connector: DataPlatformConnector,
  side: ParityDefinition["source"]
): Promise<RecordBatch> {
  const sql = buildFetchAllRowsSql(connector, side);

  const executionOptions = {
    maxRows: DEFAULT_ROW_LEVEL_MAX_ROWS,
    timeoutMs: DEFAULT_ROW_LEVEL_TIMEOUT_MS,
  };

  let columns: string[] = [];
  const rows: unknown[][] = [];

  for await (const batch of connector.executeQuery({ kind: "query", sql }, executionOptions)) {
    if (columns.length === 0) {
      columns = batch.columns;
    }
    rows.push(...batch.rows);
  }

  return { columns, rows, rowCount: rows.length };
}

/** Row cap passed to `executeQuery`'s `ExecutionOptions` when fetching full
 * row data for row-level comparison. Generous but bounded, matching
 * DESIGN-SPEC.md's safety-limit pattern already used elsewhere in this
 * codebase (e.g. profiling.ts's own `DEFAULT_MAX_ROWS` for aggregate
 * queries) -- row-level comparison is explicitly scoped to in-memory row
 * sets (T-14's own documented assumption), not true streaming, so this is a
 * safety bound rather than a claim of unlimited scale. */
const DEFAULT_ROW_LEVEL_MAX_ROWS = 1_000_000;
const DEFAULT_ROW_LEVEL_TIMEOUT_MS = 30_000;

/** Profiles every column present on both sides (by name) and diffs each
 * pair via T-07's `compareProfiles`, collecting all resulting findings.
 * Also collects (via T-16b's `buildProfileQueries`, the same pure builder
 * `profileColumn` itself sources its SQL from) the SQL strings issued for
 * every profiled column, for `ComparisonResult.queriesUsed`. */
async function runProfileChecks(
  source: DataPlatformConnector,
  target: DataPlatformConnector,
  sourceColumns: ColumnDefinition[],
  targetColumns: ColumnDefinition[],
  definition: ParityDefinition
): Promise<{ findings: ProfileDifference[]; queriesUsed: string[] }> {
  const targetByName = new Map(targetColumns.map((c) => [c.name, c]));
  const findings: ProfileDifference[] = [];
  const queriesUsed: string[] = [];

  // Resolve each source column's target-side counterpart via the
  // definition's explicit column_mapping (T-08) where present, falling back
  // to an identical-name match otherwise (Idea Prompt.md section 3's
  // "plain source -> target name" case, or no mapping configured at all).
  // Column-mapping *suggestion* (fuzzy/case-insensitive matching) is T-12's
  // job, not this task's -- only the mapping already recorded on the parsed
  // definition is consulted here.
  const mappedTargetName = new Map<string, string>();
  for (const entry of definition.columnMapping) {
    if ("source" in entry) {
      mappedTargetName.set(entry.source, entry.target);
    }
  }

  for (const sourceColumn of sourceColumns) {
    const targetName = mappedTargetName.get(sourceColumn.name) ?? sourceColumn.name;
    const targetColumn = targetByName.get(targetName);
    if (!targetColumn) {
      // No target-side counterpart to profile against -- already reported
      // as a schema finding when schema checking is enabled; profiling has
      // nothing to compare here.
      continue;
    }

    // `now` is pinned once per column pair and passed explicitly to both the
    // buildProfileQueries preview call and the profileColumn execution call
    // below -- both would otherwise independently default to `new Date()`
    // (profiling.ts's own documented default), which could evaluate a
    // millisecond apart and produce a non-byte-identical `TIMESTAMP '...'`
    // literal for Date-family columns specifically, undermining this task's
    // core "previewed SQL === executed SQL" guarantee for that one case.
    const now = new Date();
    const sourceProfileOptions = { input: { kind: "table" as const, object: definition.source.object }, now };
    const targetProfileOptions = { input: { kind: "table" as const, object: definition.target.object }, now };

    queriesUsed.push(
      ...buildProfileQueries(source, sourceColumn, sourceProfileOptions),
      ...buildProfileQueries(target, targetColumn, targetProfileOptions)
    );

    const sourceProfile = await profileColumn(source, sourceColumn, sourceProfileOptions);
    const targetProfile = await profileColumn(target, targetColumn, targetProfileOptions);

    findings.push(...compareProfiles(sourceProfile, targetProfile));
  }

  return { findings, queriesUsed };
}

/** Builds a `"failed"`-status `ComparisonResult` for a Layer 1 connectivity
 * failure -- schema/profile checks were never attempted, so
 * `schemaDifferences`/`profileDifferences` (and every other difference
 * array) stay genuinely empty rather than being used to smuggle the
 * connectivity-failure reason as a fabricated finding. The failure reason
 * is only reflected in `summary.failed` (1) and `status` ("failed");
 * TASK-BRIEF.md's interface contract does not name a dedicated
 * result-level error-message field, so surfacing the reason beyond that is
 * left to the caller's own logging of `testConnection()`'s result -- adding
 * one would be a shape change beyond this task's "assemble the final
 * ComparisonResult ... matching Idea Prompt.md section 11's shape exactly"
 * contract. */
function buildFailedResult(
  definition: ParityDefinition,
  runId: string,
  message: string,
  execution?: { sourceDurationMs: number; targetDurationMs: number; comparisonDurationMs: number }
): ComparisonResult {
  void message;
  return {
    comparison: definition.name,
    runId,
    status: "failed",
    summary: { passed: 0, warnings: 0, failed: 1 },
    rowCounts: { source: 0, target: 0, difference: 0 },
    schemaDifferences: [],
    profileDifferences: [],
    aggregateDifferences: [],
    rowDifferences: [],
    execution: execution ?? { sourceDurationMs: 0, targetDurationMs: 0, comparisonDurationMs: 0 },
  };
}

/** Computes `ComparisonSummary.{passed,warnings,failed}` from the actual
 * collected findings' severities. `Pass`/`Informational`/`Skipped`
 * severities count as passed (they are not a problem worth failing a run
 * over); `Warning` counts as a warning; `Failure`/`Error` count as failed --
 * mirroring DESIGN-SPEC.md's Pass/Informational/Warning/Failure/Error/
 * Skipped severity model collapsed onto the three-bucket summary shape from
 * Idea Prompt.md section 11.
 */
function summarizeFindings(findings: Array<{ severity: Severity }>): ComparisonSummary {
  let passed = 0;
  let warnings = 0;
  let failed = 0;

  for (const finding of findings) {
    switch (finding.severity) {
      case "Pass":
      case "Informational":
      case "Skipped":
        passed += 1;
        break;
      case "Warning":
        warnings += 1;
        break;
      case "Failure":
      case "Error":
        failed += 1;
        break;
    }
  }

  return { passed, warnings, failed };
}

/** Derives the overall `ComparisonStatus` from the collected findings:
 * `"failed"` if any Failure/Error-severity finding exists, `"warning"` if
 * any Warning-severity finding exists (and no failures), `"passed"`
 * otherwise. `"error"` is reserved for a run-level execution problem (see
 * `buildFailedResult`, which uses `"failed"` for a Layer 1 connectivity
 * failure specifically, per TASK-BRIEF.md's contract). */
function deriveStatus(findings: Array<{ severity: Severity }>): ComparisonStatus {
  let hasFailure = false;
  let hasWarning = false;

  for (const finding of findings) {
    if (finding.severity === "Failure" || finding.severity === "Error") {
      hasFailure = true;
    } else if (finding.severity === "Warning") {
      hasWarning = true;
    }
  }

  if (hasFailure) return "failed";
  if (hasWarning) return "warning";
  return "passed";
}
