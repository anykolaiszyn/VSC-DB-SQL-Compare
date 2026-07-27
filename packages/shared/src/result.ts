// ComparisonResult and sub-shapes, translated from the JSON example in
// Idea Prompt.md section 11 ("Results Model").
//
// Judgment call: the four difference arrays (schemaDifferences,
// profileDifferences, aggregateDifferences, rowDifferences) are typed here
// as arrays of a shared, deliberately minimal `DifferenceItem` placeholder
// shape rather than fully modeled per-check shapes. Idea Prompt.md's JSON
// example shows them as empty arrays (`"schemaDifferences": []`), and their
// full field-level shape is explicitly the responsibility of later tasks:
// T-06 (schema diff), T-07 (profiling), T-13 (volume/aggregate), and T-14
// (row-level). Over-specifying those shapes now would require this task to
// guess at fields those tasks own. `DifferenceItem` includes a `severity`
// field because DESIGN-SPEC.md's severity model (Pass / Informational /
// Warning / Failure / Error / Skipped) is stated to apply uniformly across
// all difference categories, plus a `message` field so the placeholder is
// immediately usable (e.g. by a webview) without further changes. Later
// tasks are expected to extend/replace this with richer per-category
// shapes (e.g. `SchemaDifference extends DifferenceItem`) — that is an
// additive, non-breaking change from this task's perspective.

/** Severity model per DESIGN-SPEC.md section "Severity and Tolerance Model". */
export type Severity = "Pass" | "Informational" | "Warning" | "Failure" | "Error" | "Skipped";

/**
 * Minimal, intentionally under-specified shape shared by all four
 * difference-array item kinds until their owning tasks (T-06, T-07, T-13,
 * T-14) refine them further.
 */
export interface DifferenceItem {
  severity: Severity;
  message: string;
}

/** Placeholder item shape for `ComparisonResult.schemaDifferences`; refined by T-06. */
export type SchemaDifference = DifferenceItem;
/** Placeholder item shape for `ComparisonResult.profileDifferences`; refined by T-07. */
export type ProfileDifference = DifferenceItem;
/** Placeholder item shape for `ComparisonResult.aggregateDifferences`; refined by T-13. */
export type AggregateDifference = DifferenceItem;
/** Placeholder item shape for `ComparisonResult.rowDifferences`; refined by T-14. */
export type RowDifference = DifferenceItem;

/** Overall run status, per the `status` field in Idea Prompt.md's example. */
export type ComparisonStatus = "passed" | "warning" | "failed" | "error";

/** Counts of checks by outcome across the whole run. */
export interface ComparisonSummary {
  passed: number;
  warnings: number;
  failed: number;
}

/** Row-count comparison at the top level of the result (Layer 3: Volume Parity). */
export interface RowCounts {
  source: number;
  target: number;
  difference: number;
}

/** Wall-clock timing for the run's major phases. */
export interface ExecutionTiming {
  sourceDurationMs: number;
  targetDurationMs: number;
  comparisonDurationMs: number;
}

/**
 * The standardized result object every comparison run produces, matching
 * Idea Prompt.md section 11's JSON example field-for-field.
 */
export interface ComparisonResult {
  comparison: string;
  runId: string;
  status: ComparisonStatus;
  summary: ComparisonSummary;
  rowCounts: RowCounts;
  schemaDifferences: SchemaDifference[];
  profileDifferences: ProfileDifference[];
  aggregateDifferences: AggregateDifference[];
  rowDifferences: RowDifference[];
  execution: ExecutionTiming;
}
