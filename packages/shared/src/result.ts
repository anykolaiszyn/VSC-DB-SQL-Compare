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

/**
 * The specific kind of structural mismatch a `SchemaDifference` finding
 * reports, per `Idea Prompt.md` section 2 ("Layer 2: Structural Parity")
 * and section 12's severity-model example (`missing_target_column`, etc.).
 */
export type SchemaDifferenceKind =
  | "missing-in-target"
  | "missing-in-source"
  | "type-mismatch"
  | "length-mismatch"
  | "precision-mismatch"
  | "scale-mismatch"
  | "nullability-mismatch"
  | "order-mismatch";

/**
 * Refined shape for `ComparisonResult.schemaDifferences`, owned by T-06 (see
 * `DifferenceItem`'s doc comment above: T-06 is the designated task that
 * refines this specific placeholder). Extends `DifferenceItem` so the
 * `severity`/`message` fields every difference-array item carries are
 * preserved, and adds the column-level detail a schema diff finding needs
 * to be independently useful (e.g. rendered as a table row in the results
 * webview per `DESIGN-SPEC.md`'s Layer 2 worked example) without requiring
 * the consumer to re-parse `message`.
 *
 * Judgment call: `columnName` is always populated (a schema-diff finding is
 * always about exactly one column, even for order/count-shaped findings —
 * a missing column, an out-of-order column, etc. are all reported per
 * affected column, not as one run-level item), while `sourceType`/
 * `targetType` are optional because a `missing-in-target`/`missing-in-source`
 * finding only has a native type on the side where the column exists.
 */
export interface SchemaDifference extends DifferenceItem {
  /** Name of the affected column (source-side name, or target-side name for a missing-in-source finding). */
  columnName: string;
  /** The specific category of structural mismatch this finding reports. */
  kind: SchemaDifferenceKind;
  /** Source-side platform-native type string (e.g. "MONEY"), where the column exists on the source. */
  sourceType?: string;
  /** Target-side platform-native type string (e.g. "FLOAT"), where the column exists on the target. */
  targetType?: string;
}
/**
 * The specific profiling metric a `ProfileDifference` finding reports a
 * meaningful change in, per `Idea Prompt.md`'s "Layer 4: Data Profiling"
 * STATUS worked example (distinct-value-count change, null-percentage
 * change, most-common-value change) plus the boolean/categorical
 * new-value/missing-value cases the same section calls out ("New or missing
 * categories").
 */
export type ProfileDifferenceMetric =
  | "distinctCount"
  | "nullPercentage"
  | "mostCommonValue"
  | "newTargetValue"
  | "missingTargetValue";

/**
 * Refined shape for `ComparisonResult.profileDifferences`, owned by T-07 (see
 * `DifferenceItem`'s doc comment above `SchemaDifference`: T-07 is the
 * designated task that refines this specific placeholder, same pattern T-06
 * used for `SchemaDifference`). Extends `DifferenceItem` so the
 * `severity`/`message` fields every difference-array item carries are
 * preserved, and adds the column/metric-level detail a profile-comparison
 * finding needs to be independently useful (e.g. rendered as a table row
 * mirroring the idea doc's STATUS worked example) without requiring the
 * consumer to re-parse `message`.
 *
 * Judgment call: `compareProfiles` (packages/engine/src/comparison-core/
 * profiling/profiling.ts) deliberately does NOT emit one `ProfileDifference`
 * per raw metric field the way a blind side-by-side dump would -- only
 * metrics classified as a meaningful change per that module's documented
 * thresholds produce a finding here, per this task's "highlight meaningful
 * changes rather than merely display two profiles side by side" contract.
 * `sourceValue`/`targetValue` are typed `unknown` because the value shape
 * varies by `metric` (numbers for distinctCount/nullPercentage, strings for
 * mostCommonValue/newTargetValue/missingTargetValue) -- a discriminated
 * union keyed on `metric` was considered but rejected as over-engineering
 * for a value pair only ever rendered, never programmatically branched on,
 * by this task's consumers (T-09's planner, T-11's webview).
 */
export interface ProfileDifference extends DifferenceItem {
  /** Name of the column this profiling finding is about. */
  columnName: string;
  /** Which profiling metric changed meaningfully between source and target. */
  metric: ProfileDifferenceMetric;
  /** Source-side value for this metric, where applicable (absent for a newTargetValue finding, which has no source-side counterpart). */
  sourceValue?: unknown;
  /** Target-side value for this metric, where applicable (absent for a missingTargetValue finding, which has no target-side counterpart). */
  targetValue?: unknown;
}
/**
 * Refined shape for `ComparisonResult.aggregateDifferences`, owned by T-13
 * (see `DifferenceItem`'s doc comment above `SchemaDifference`: T-13 is the
 * designated task that refines this specific placeholder, same additive,
 * non-breaking pattern T-06 used for `SchemaDifference` and T-07 used for
 * `ProfileDifference` -- extends `DifferenceItem` so `severity`/`message`
 * are preserved, adds the row-count-comparison detail a volume-parity
 * finding needs to be independently useful without requiring the consumer
 * to re-parse `message`).
 *
 * T-13's `IMPLEMENTATION-PLAN.md` row scopes this task to "row count ...
 * tolerance evaluation" -- this shape reports exactly that (total row
 * count difference and rate against a configured tolerance), per `Idea
 * Prompt.md` section 2's Layer 3 "Volume Parity" worked example. It does
 * NOT cover distinct-key-count, duplicate-key-count, null-key-count,
 * count-by-partition/date/segment, or min/max-key comparisons -- those
 * remain out of scope for T-13 per `TASK-BRIEF.md`'s Prohibited Changes
 * section and are left for a future task to add as additional optional
 * fields or additional `AggregateDifference` items, without needing to
 * change the fields defined here.
 */
export interface AggregateDifference extends DifferenceItem {
  /** Row count observed on the source side. */
  sourceCount: number;
  /** Row count observed on the target side. */
  targetCount: number;
  /** `targetCount - sourceCount`. */
  difference: number;
  /** `(difference / sourceCount) * 100`, as a percentage (0 when `sourceCount` is 0 to avoid division by zero). */
  differenceRate: number;
  /** The tolerance this finding was evaluated against. `undefined` when no tolerance was supplied, meaning exact equality was required (see `compareVolume`'s doc comment in packages/engine/src/comparison-core/volume/volume.ts for this judgment call). */
  tolerance?: {
    percentage?: number;
    absolute?: number;
  };
}
/**
 * The classification category a `RowDifference` finding reports, per `Idea
 * Prompt.md` section 2 ("Layer 6: Row-Level Parity")'s exact eight-item
 * list: "Matching, Missing from source, Missing from target, Duplicate in
 * source, Duplicate in target, Matched key with differing values, Unable to
 * compare, Ignored by rule."
 */
export type RowDifferenceCategory =
  | "matching"
  | "missing-from-source"
  | "missing-from-target"
  | "duplicate-in-source"
  | "duplicate-in-target"
  | "matched-key-differing-values"
  | "unable-to-compare"
  | "ignored-by-rule";

/**
 * Per-column detail for a `RowDifference` whose `category` is
 * `"matched-key-differing-values"`, mirroring `Idea Prompt.md` section 2's
 * `ORDER_ID = 1008924` worked example table (`Column | Source | Target |
 * Result`).
 */
export interface RowColumnDifference {
  /** Target-side column name this mapped column difference is about. */
  columnName: string;
  /** Source-side value, after normalization (if any rule applied). */
  sourceValue: unknown;
  /** Target-side value, after normalization (if any rule applied). */
  targetValue: unknown;
}

/**
 * Refined shape for `ComparisonResult.rowDifferences`, owned by T-14 (see
 * `DifferenceItem`'s doc comment above `SchemaDifference`: T-14 is the
 * designated task that refines this specific placeholder, same additive,
 * non-breaking pattern T-06/T-07/T-13 already established for their own
 * difference shapes -- extends `DifferenceItem` so `severity`/`message` are
 * preserved, and adds the row-classification detail a row-level parity
 * finding needs to be independently useful (e.g. rendered as a table row in
 * the results webview) without requiring the consumer to re-parse
 * `message`).
 *
 * Judgment call: `keyValues` is always populated with the matching key
 * column value(s) for every category, including "missing-from-source" (the
 * key only exists on the target side) and "missing-from-target" (the key
 * only exists on the source side) -- the key value itself is still known
 * and reportable in both cases, since it came from whichever side the row
 * was found on. `columnDifferences` is only populated (non-empty) for the
 * `"matched-key-differing-values"` category, per `Idea Prompt.md`'s worked
 * example reporting which column(s) differed with their source/target
 * values; every other category leaves it `undefined` rather than an empty
 * array, so a consumer can branch on presence rather than length.
 */
export interface RowDifference extends DifferenceItem {
  /** Classification category this row was placed into (one of the eight named in Idea Prompt.md section 2). */
  category: RowDifferenceCategory;
  /** The row's matching key value(s), in `keys` order (a single-element array for a simple key, multiple for a composite key). */
  keyValues: unknown[];
  /** Which mapped column(s) differed and their normalized source/target values. Only present when `category` is `"matched-key-differing-values"`. */
  columnDifferences?: RowColumnDifference[];
}

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
  /**
   * T-16b: the SQL strings actually issued for this run's schema/profile/
   * volume/row-level checks (source and target, per check type run), for the
   * results webview's SQL preview panel to display. Populated by
   * `runComparison` (packages/engine/src/orchestration/planner/planner.ts)
   * from the same builder functions (`buildRowCountSql`, `buildProfileQueries`,
   * `buildFetchAllRowsSql`) the execution code paths themselves call, so the
   * previewed SQL and the executed SQL can never independently drift apart
   * -- the specific risk the original T-16 SQL-preview deferral decision was
   * written to avoid. Optional and omitted (not an empty array) when no
   * check that issues SQL ran (e.g. a Layer-1 connectivity failure short-
   * circuits before any check runs), so a consumer can branch on presence
   * rather than length to distinguish "no checks ran" from "checks ran but
   * issued no SQL" (which does not currently happen, but the optionality
   * keeps that distinction available without a breaking change later).
   */
  queriesUsed?: string[];
}
