// T-13: volume parity.
//
// compareVolume(source, target, sourceInput, targetInput, tolerance)
// computes a single-metric `AggregateDifference` reporting total row count
// parity between a source and target `DataPlatformConnector`, per Idea
// Prompt.md section 2 ("Layer 3: Volume Parity") and section 12 ("Severity
// and Tolerance Model").
//
// Scope, per TASK-BRIEF.md's Prohibited Changes section: row count with
// tolerance evaluation only. Idea Prompt.md section 2 also lists distinct
// row count, distinct/duplicate/null key counts, count-by-partition/date/
// segment, and min/max-key as part of "Layer 3: Volume Parity" more
// broadly, but IMPLEMENTATION-PLAN.md's T-13 row scopes this task to total
// row count + tolerance evaluation; those additional metrics are
// deliberately NOT implemented here and are left for a future task.
//
// Query-execution pattern: mirrors T-07's `profileColumn`
// (packages/engine/src/comparison-core/profiling/profiling.ts) exactly, per
// TASK-BRIEF.md's Interfaces table -- there is no dedicated row-count
// method on `DataPlatformConnector`, so this module builds its own
// `SELECT COUNT(*) ...` SQL string, resolves the query object reference the
// same way profiling.ts's `resolveObjectReference` does, and executes via
// `connector.executeQuery`, consuming the single-row `AsyncIterable<RecordBatch>`
// result. No new method is added to the shared `DataPlatformConnector`
// interface (that would be an unowned change to packages/shared/src/connector.ts
// outside this task's file ownership).
import type { AggregateDifference, DataPlatformConnector, ExecutionOptions, QueryInput } from "@paritylens/shared";

/** Tolerance shape T-13 evaluates against, matching
 * `ParityChecks.rowCount.tolerance` (packages/engine/src/orchestration/definition/definition.ts:85-91)
 * field-for-field. Declared locally rather than imported from
 * `definition.ts` so this module has no dependency on
 * `packages/engine/src/orchestration/**` (T-09's/T-15's owned files, per
 * TASK-BRIEF.md's Files owned section) -- the two shapes are kept in sync
 * structurally, and T-15 (which does depend on both modules when it wires
 * `compareVolume` into the planner) is responsible for passing
 * `ParityChecks.rowCount.tolerance` straight through, since the shapes are
 * structurally assignable. */
export interface VolumeTolerance {
  percentage?: number;
  absolute?: number;
}

/**
 * `AggregateDifference` produced by `compareVolume` -- currently identical
 * to the shared `AggregateDifference` shape (packages/shared/src/result.ts),
 * aliased here so call sites in this module read naturally and so a future
 * volume-specific field (e.g. distinct-count, once a later task adds it)
 * has an obvious place to be added without touching every call site's
 * import.
 */
export type VolumeDifference = AggregateDifference;

const DEFAULT_MAX_ROWS = 1;
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Computes total row counts for `sourceInput` against `source` and
 * `targetInput` against `target`, then evaluates the difference against
 * `tolerance` per Idea Prompt.md section 2's worked example:
 *
 *   Source rows:      12,405,128
 *   Target rows:      12,402,991
 *   Difference:           -2,137
 *   Difference rate:      -0.0172%
 *   Tolerance:             0.0100%
 *   Result:                FAIL
 *
 * `difference = targetCount - sourceCount` (matching the worked example's
 * sign convention: target below source produces a negative difference).
 * `differenceRate = (difference / sourceCount) * 100` (0 when `sourceCount`
 * is 0, to avoid division by zero -- an empty source table with a
 * non-empty target is instead caught by `difference` alone being nonzero).
 *
 * Tolerance evaluation, per `ParityChecks.rowCount.tolerance`
 * (`{ percentage?: number; absolute?: number }`):
 *   - If `tolerance.percentage` is set, FAIL when `abs(differenceRate) >
 *     tolerance.percentage`.
 *   - Else if `tolerance.absolute` is set, FAIL when `abs(difference) >
 *     tolerance.absolute`.
 *   - Else (tolerance omitted entirely) -- JUDGMENT CALL, documented here
 *     per TASK-BRIEF.md's explicit instruction not to guess silently:
 *     treated as exact-equality, i.e. FAIL on any nonzero difference. Idea
 *     Prompt.md section 2 lists "Informational comparison only" as a
 *     fourth distinct tolerance mode alongside exact equality/absolute/
 *     percentage, but `ParityChecks.rowCount.tolerance`
 *     (packages/engine/src/orchestration/definition/definition.ts:85-91)
 *     has no field expressing "informational only" as distinct from
 *     "no tolerance configured" -- the type only has optional
 *     `percentage`/`absolute` numbers, nothing else. Rather than invent an
 *     out-of-band sentinel value or edit T-08's owned `definition.ts` to
 *     add a new field (both out of this task's scope), an omitted
 *     `tolerance` argument is treated as the strictest mode (exact
 *     equality) rather than the loosest (informational-only, meaning
 *     "always Pass/never Fail") -- silently downgrading every unconfigured
 *     row-count check to "never fails" seemed like the more dangerous
 *     default for a parity tool. If "informational comparison only" needs
 *     its own explicit mode, that requires a `definition.ts` change,
 *     which is outside this task's file ownership; flagged here as a
 *     residual gap for whichever task (or a revised T-08 brief) adds it.
 *
 * When `difference === 0`, `severity` is `"Pass"` regardless of tolerance
 * (an exact match trivially satisfies any tolerance, including no
 * tolerance / exact-equality mode). When nonzero but within tolerance,
 * `severity` is `"Informational"` (a nonzero but tolerated difference is
 * still worth surfacing, per the same "surface meaningful signal, not just
 * a blind Pass/Fail" pattern `compareProfiles` (T-07) established) rather
 * than `"Warning"`, since a within-tolerance difference is, by definition,
 * within the range the user configured as acceptable.
 */
export async function compareVolume(
  source: DataPlatformConnector,
  target: DataPlatformConnector,
  sourceInput: QueryInput,
  targetInput: QueryInput,
  tolerance?: VolumeTolerance
): Promise<VolumeDifference> {
  const executionOptions: ExecutionOptions = {
    maxRows: DEFAULT_MAX_ROWS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  const [sourceCount, targetCount] = await Promise.all([
    countRows(source, sourceInput, executionOptions),
    countRows(target, targetInput, executionOptions),
  ]);

  const difference = targetCount - sourceCount;
  const differenceRate = sourceCount === 0 ? 0 : (difference / sourceCount) * 100;

  const failed = evaluateTolerance(difference, differenceRate, tolerance);
  const severity = difference === 0 ? "Pass" : failed ? "Failure" : "Informational";

  const message = buildMessage(sourceCount, targetCount, difference, differenceRate, tolerance, failed);

  return {
    severity,
    message,
    sourceCount,
    targetCount,
    difference,
    differenceRate,
    ...(tolerance !== undefined ? { tolerance } : {}),
  };
}

/** Returns true when the observed difference exceeds the supplied tolerance (FAIL), per `compareVolume`'s doc comment. */
function evaluateTolerance(difference: number, differenceRate: number, tolerance: VolumeTolerance | undefined): boolean {
  if (tolerance?.percentage !== undefined) {
    return Math.abs(differenceRate) > tolerance.percentage;
  }
  if (tolerance?.absolute !== undefined) {
    return Math.abs(difference) > tolerance.absolute;
  }
  // No tolerance configured: exact-equality judgment call (see doc comment above).
  return difference !== 0;
}

function buildMessage(
  sourceCount: number,
  targetCount: number,
  difference: number,
  differenceRate: number,
  tolerance: VolumeTolerance | undefined,
  failed: boolean
): string {
  const toleranceText =
    tolerance?.percentage !== undefined
      ? `${tolerance.percentage.toFixed(4)}% tolerance`
      : tolerance?.absolute !== undefined
        ? `${tolerance.absolute} row absolute tolerance`
        : "exact equality (no tolerance configured)";
  const outcomeText = failed ? "FAIL" : "PASS";
  return (
    `Row count: source ${sourceCount.toLocaleString("en-US")}, target ${targetCount.toLocaleString("en-US")}, ` +
    `difference ${difference.toLocaleString("en-US")} (${differenceRate.toFixed(4)}%), ` +
    `evaluated against ${toleranceText}: ${outcomeText}.`
  );
}

/**
 * T-16b: pure, string-returning builder returning exactly the SQL string
 * `countRows` below builds and executes -- `countRows` calls this function
 * directly rather than re-building the string, so the previewed and
 * executed SQL can never drift apart (per TASK-BRIEF.md's central
 * correctness property for this task).
 */
export function buildRowCountSql(connector: DataPlatformConnector, input: QueryInput): string {
  const objectRef = resolveObjectReference(connector, input);
  return `SELECT COUNT(*) AS row_count FROM ${objectRef}`;
}

/** Executes `SELECT COUNT(*) FROM <objectRef>` against `connector` for `input` and returns the single scalar row count. */
async function countRows(
  connector: DataPlatformConnector,
  input: QueryInput,
  executionOptions: ExecutionOptions
): Promise<number> {
  const sql = buildRowCountSql(connector, input);

  for await (const batch of connector.executeQuery({ kind: "query", sql }, executionOptions)) {
    const columnIndex = batch.columns.indexOf("row_count");
    const firstRow = batch.rows[0];
    if (firstRow !== undefined) {
      return toNumber(columnIndex >= 0 ? firstRow[columnIndex] : firstRow[0]);
    }
  }

  throw new Error(`compareVolume row-count query returned no rows: ${sql}`);
}

/** Resolves a `QueryInput` to a bare object reference usable after `FROM`. Mirrors T-07's `profileColumn`'s private `resolveObjectReference` in packages/engine/src/comparison-core/profiling/profiling.ts, reimplemented here since volume comparison only has access to the public `DataPlatformConnector` surface (`quoteIdentifier`, not the connector's private query-building internals), and this task may not import from profiling.ts (T-07's owned file) per TASK-BRIEF.md. */
function resolveObjectReference(connector: DataPlatformConnector, input: QueryInput): string {
  if (input.kind === "table") {
    return connector.quoteIdentifier(input.object);
  }
  if (input.kind === "query") {
    return `(${input.sql.trim().replace(/;\s*$/, "")}) AS volume_subquery`;
  }
  throw new Error(
    `compareVolume does not support { kind: "sqlFile" } input directly; supply { kind: "query" } with the file's contents instead.`
  );
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
