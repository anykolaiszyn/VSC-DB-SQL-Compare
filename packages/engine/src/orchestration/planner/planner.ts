// T-09: Orchestration API run planner (Phase 1: connectivity, schema,
// profile checks only).
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
//      *before* any schema/profile work runs.
//   3. If `checks.schema.enabled`, fetch both sides' schemas and run T-06's
//      `compareSchemas`.
//   4. If `checks.profile.enabled`, fetch both sides' schemas (reused from
//      step 3 when schema checking also ran), profile every column present
//      on both sides via T-07's `profileColumn`, and diff each pair via
//      `compareProfiles`.
//   5. Assemble the final `ComparisonResult` matching Idea Prompt.md section
//      11's shape exactly, with `summary.{passed,warnings,failed}` computed
//      from the actual collected findings' severities and `status` derived
//      from the same collected findings.
//
// PHASE 1 SCOPE BOUNDARY: `checks.rowCount` / `checks.rowLevel` are valid,
// already-parsed fields on `ParityDefinition` (T-08's job), but this
// planner does not act on them -- `rowCounts`, `aggregateDifferences`, and
// `rowDifferences` are left at their empty/default values regardless of
// those flags. Executing volume/row-level checks is T-15's job, once
// T-13/T-14 exist (see TASK-BRIEF.md / IMPLEMENTATION-PLAN.md's T-09 row).
import type {
  ColumnDefinition,
  ComparisonResult,
  ComparisonStatus,
  ComparisonSummary,
  DataPlatformConnector,
  ProfileDifference,
  Severity,
  SchemaDifference,
} from "@paritylens/shared";
import type { ParityDefinition } from "../definition/definition.js";
import { compareSchemas } from "../../comparison-core/schema-diff/schema-diff.js";
import { compareProfiles, profileColumn } from "../../comparison-core/profiling/profiling.js";

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

  const schemaEnabled = definition.checks.schema?.enabled === true;
  const profileEnabled = definition.checks.profile?.enabled === true;

  if (schemaEnabled || profileEnabled) {
    const sourceColumns = await source.getSchema({ kind: "table", object: definition.source.object });
    const targetColumns = await target.getSchema({ kind: "table", object: definition.target.object });

    if (schemaEnabled) {
      schemaDifferences = compareSchemas(sourceColumns, targetColumns);
    }

    if (profileEnabled) {
      profileDifferences = await runProfileChecks(
        source,
        target,
        sourceColumns,
        targetColumns,
        definition
      );
    }
  }

  const comparisonDurationMs = Date.now() - comparisonStart;

  // --- Step 5: assemble the final ComparisonResult.
  const allFindings: Array<{ severity: Severity }> = [...schemaDifferences, ...profileDifferences];
  const summary = summarizeFindings(allFindings);
  const status = deriveStatus(allFindings);

  return {
    comparison: definition.name,
    runId,
    status,
    summary,
    // Phase 2/3 scope boundary: rowCounts/aggregateDifferences/rowDifferences
    // stay at their empty/default values regardless of
    // checks.rowCount/checks.rowLevel -- volume and row-level execution is
    // T-15's job, not this task's. See this file's header comment.
    rowCounts: { source: 0, target: 0, difference: 0 },
    schemaDifferences,
    profileDifferences,
    aggregateDifferences: [],
    rowDifferences: [],
    execution: {
      sourceDurationMs,
      targetDurationMs,
      comparisonDurationMs,
    },
  };
}

/** Profiles every column present on both sides (by name) and diffs each
 * pair via T-07's `compareProfiles`, collecting all resulting findings. */
async function runProfileChecks(
  source: DataPlatformConnector,
  target: DataPlatformConnector,
  sourceColumns: ColumnDefinition[],
  targetColumns: ColumnDefinition[],
  definition: ParityDefinition
): Promise<ProfileDifference[]> {
  const targetByName = new Map(targetColumns.map((c) => [c.name, c]));
  const findings: ProfileDifference[] = [];

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

    const sourceProfile = await profileColumn(source, sourceColumn, {
      input: { kind: "table", object: definition.source.object },
    });
    const targetProfile = await profileColumn(target, targetColumn, {
      input: { kind: "table", object: definition.target.object },
    });

    findings.push(...compareProfiles(sourceProfile, targetProfile));
  }

  return findings;
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
