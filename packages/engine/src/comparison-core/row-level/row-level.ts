// T-14: row-level parity.
//
// compareRows(sourceRows, targetRows, keys, mapping, rules?, options?)
// classifies every row from a source and target record set into one of the
// eight categories Idea Prompt.md section 2 ("Layer 6: Row-Level Parity")
// names verbatim: "Matching, Missing from source, Missing from target,
// Duplicate in source, Duplicate in target, Matched key with differing
// values, Unable to compare, Ignored by rule."
//
// Key-based matching, per that section's `keys:` YAML example -- a single
// key column, or a composite key (multiple key columns, concatenated/tupled
// for matching rather than matched on the first column only).
//
// For matched (non-duplicate) key pairs, each mapped column is compared
// using T-12's `applyNormalization`/`valuesEqualWithinTolerance`
// (packages/engine/src/comparison-core/normalization/normalization.ts,
// consumed read-only per TASK-BRIEF.md), plus this file's own local
// `coerceNumericString` helper (T-14-01, REVIEW-REPORT.md -- applied only
// when a numeric tolerance is configured for the column, so it never
// changes behavior for exact/normalized-string comparisons), reproducing
// Idea Prompt.md's ORDER_ID = 1008924 worked example: STATUS "Shipped" vs
// "SHIPPED" matches after case-insensitive normalization; ORDER_AMOUNT
// "125.3700" vs "125.37" (the doc's own literal decimal-string forms)
// matches via numeric-string coercion + numeric tolerance; SHIP_DATE
// "2026-07-20 00:00:00" vs "2026-07-20" matches after day-truncation;
// CUSTOMER_NAME "Acme Inc." vs "Acme, Inc." has no normalization rule
// configured for it and correctly reports a difference.
//
// Interface shape, per TASK-BRIEF.md's Interfaces table ("RecordBatch ...
// T-14 does not call a connector directly; it operates on already-fetched
// source/target row sets ... your choice, document which"): this module
// accepts `RecordBatch | unknown[][]` for both sides. `RecordBatch` is the
// primary/preferred shape (it carries `columns`, so a caller does not need
// to separately track column order); a bare `unknown[][]` is also accepted
// for convenience in tests/callers that already know column order some
// other way, in which case column names are resolved positionally from
// `keys` followed by each mapping entry's source/target name, in that
// order (see `resolveColumns` below) -- both fixture arrays in a bare-array
// call must therefore list their key column(s) first, then their mapped
// columns in `mapping` order, matching every test in `row-level.test.ts`.
// Streaming/pagination for very large row sets is explicitly out of scope
// (TASK-BRIEF.md: "assume both sides fit in memory for now").
import type { NormalizationRule, ColumnMappingEntry } from "../../orchestration/definition/definition.js";
import type { RecordBatch } from "@paritylens/shared";
import type { RowDifference, RowColumnDifference } from "@paritylens/shared";
import { applyNormalization, valuesEqualWithinTolerance } from "../normalization/normalization.js";

/**
 * Options controlling column-level exclusion and numeric tolerance.
 *
 * `numericTolerance` is declared locally (not sourced exclusively from
 * `NormalizationRule.numericTolerance`) because `valuesEqualWithinTolerance`'s
 * tolerance argument (`{ absolute?: number; percentage?: number }`) is a
 * two-value comparison concern distinct from `NormalizationRule`'s
 * single-value transforms -- `normalization.ts`'s header comment documents
 * this same separation for why `applyNormalization` never applies
 * `numericTolerance` itself. Keying by target column name lets a caller
 * supply per-column tolerance without this task needing to touch T-08's
 * `definition.ts` or T-12's `normalization.ts`.
 *
 * T-14-02 (REVIEW-REPORT.md, Minor): `compareMatchedRow` now falls back to
 * `rules[targetColumnName]?.numericTolerance` when this map has no entry
 * for a column, so a caller who already configured tolerance via the
 * standard `NormalizationRule.numericTolerance` field (the mechanism
 * Idea Prompt.md section 4 and `definition.ts` document) is not forced to
 * duplicate it here as well -- this field remains available for a caller
 * that wants a tolerance used only for row-level comparison, distinct from
 * whatever `rules` configures.
 */
export interface RowCompareOptions {
  /** Target-side column names (matching `ColumnMappingEntry.target`) to exclude from comparison entirely -- Idea Prompt.md's "Ignored by rule" category, scoped per TASK-BRIEF.md to this minimal parameter rather than a full expression-based ignore-rule engine. */
  ignoreColumns?: string[];
  /** Per-column numeric tolerance, keyed by target column name, passed through to `valuesEqualWithinTolerance`. Takes precedence over `rules[column].numericTolerance` when both are set; falls back to `rules[column].numericTolerance` when absent for a column -- see this interface's header comment (T-14-02). */
  numericTolerance?: Record<string, { absolute?: number; percentage?: number }>;
}

/** A row set accepted by `compareRows`: either a `RecordBatch` or a bare row-tuple array (see this file's header comment). */
export type RowSet = RecordBatch | unknown[][];

const DEFAULT_SEVERITY_FOR_CATEGORY: Record<RowDifference["category"], RowDifference["severity"]> = {
  matching: "Pass",
  "missing-from-source": "Failure",
  "missing-from-target": "Failure",
  "duplicate-in-source": "Warning",
  "duplicate-in-target": "Warning",
  "matched-key-differing-values": "Failure",
  "unable-to-compare": "Error",
  "ignored-by-rule": "Skipped",
};

/** A single row paired with its resolved key tuple and a lookup from column name to value, computed once per row up front so column resolution never needs to re-scan a `columns` array per mapped column. */
interface IndexedRow {
  keyValues: unknown[];
  valuesByColumn: Map<string, unknown>;
}

/**
 * Classifies every row from `sourceRows`/`targetRows` into one of the eight
 * `RowDifference` categories, matching source-to-target by `keys` (composite
 * keys supported -- all key columns are concatenated into one tuple key,
 * not matched on the first column only).
 *
 * Duplicate detection: if a key value appears more than once on one side,
 * every row sharing that key on that side is classified as
 * `"duplicate-in-source"`/`"duplicate-in-target"` rather than attempting a
 * 1:1 match -- this applies independently per side, so a key duplicated on
 * BOTH sides produces duplicate-in-source findings for every source-side
 * row AND duplicate-in-target findings for every target-side row (no
 * "matching" or "matched-key-differing-values" finding is produced for that
 * key at all, since a reliable 1:1 pairing cannot be established).
 *
 * For a matched (unique-on-both-sides) key pair, each column in `mapping`
 * (excluding anything in `options.ignoreColumns`) is normalized via
 * `applyNormalization` (using the rule in `rules[targetColumnName]`, if
 * any) and compared via `valuesEqualWithinTolerance` (using
 * `options.numericTolerance[targetColumnName]`, falling back to
 * `rules[targetColumnName]?.numericTolerance` if absent -- T-14-02). When a
 * numeric tolerance applies to a column, both sides' normalized values are
 * additionally coerced from numeric-looking strings to numbers before the
 * tolerance comparison (T-14-01) -- this reproduces Idea Prompt.md section
 * 2's ORDER_ID = 1008924 example, where ORDER_AMOUNT is shown as decimal-
 * string literals ("125.3700" vs "125.37") that must resolve to "Match" via
 * tolerance, not merely two already-`===`-equal parsed numbers. If
 * normalizing or comparing a column throws, or a row is missing a value for
 * a mapped column entirely (column name not found for that side), the whole
 * row is classified `"unable-to-compare"` rather than letting the error
 * propagate -- this function never throws for row-shape or normalization-
 * function errors.
 */
export function compareRows(
  sourceRows: RowSet,
  targetRows: RowSet,
  keys: string[],
  mapping: ColumnMappingEntry[],
  rules: Record<string, NormalizationRule> = {},
  options: RowCompareOptions = {}
): RowDifference[] {
  const sourceColumns = resolveColumns(sourceRows, keys, mapping, "source");
  const targetColumns = resolveColumns(targetRows, keys, mapping, "target");

  const ignoreColumns = new Set(options.ignoreColumns ?? []);
  const activeMapping = mapping.filter((entry) => !ignoreColumns.has(entry.target));

  const sourceIndex = indexByKey(resolveRows(sourceRows), sourceColumns, keys);
  const targetIndex = indexByKey(resolveRows(targetRows), targetColumns, keys);

  const results: RowDifference[] = [];
  const allKeys = new Set<string>([...sourceIndex.keys(), ...targetIndex.keys()]);

  for (const keyText of allKeys) {
    const sourceMatches = sourceIndex.get(keyText) ?? [];
    const targetMatches = targetIndex.get(keyText) ?? [];

    if (sourceMatches.length > 1 || targetMatches.length > 1) {
      // A reliable 1:1 pairing cannot be established for a key duplicated
      // on either side -- see doc comment above. Report every row on each
      // duplicated side; a side with exactly one row for this key is left
      // unreported for this key (it has no unique counterpart to pair
      // against, but it isn't itself a duplicate).
      for (const row of sourceMatches.length > 1 ? sourceMatches : []) {
        results.push(buildRow("duplicate-in-source", row.keyValues, "Key appears more than once in the source record set."));
      }
      for (const row of targetMatches.length > 1 ? targetMatches : []) {
        results.push(buildRow("duplicate-in-target", row.keyValues, "Key appears more than once in the target record set."));
      }
      continue;
    }

    if (sourceMatches.length === 1 && targetMatches.length === 0) {
      results.push(buildRow("missing-from-target", sourceMatches[0]!.keyValues, "Key present in source but not found in target."));
      continue;
    }
    if (sourceMatches.length === 0 && targetMatches.length === 1) {
      results.push(buildRow("missing-from-source", targetMatches[0]!.keyValues, "Key present in target but not found in source."));
      continue;
    }

    // Exactly one row on each side: compare mapped columns.
    const sourceRow = sourceMatches[0]!;
    const targetRow = targetMatches[0]!;
    results.push(compareMatchedRow(sourceRow, targetRow, activeMapping, rules, options));
  }

  return results;
}

/** Groups rows by their key tuple (JSON-stringified for use as a Map key -- key values are expected to be primitives per Idea Prompt.md's examples, e.g. order_id/customer_id, so JSON.stringify produces a stable, collision-safe text key for tupled composite keys). */
function indexByKey(rows: unknown[][], columns: string[], keys: string[]): Map<string, IndexedRow[]> {
  const keyIndexes = keys.map((keyName) => columns.indexOf(keyName));
  const index = new Map<string, IndexedRow[]>();

  for (const row of rows) {
    const keyValues = keyIndexes.map((columnIndex) => (columnIndex >= 0 ? row[columnIndex] : undefined));
    const keyText = JSON.stringify(keyValues);

    const valuesByColumn = new Map<string, unknown>();
    columns.forEach((columnName, columnIndex) => {
      valuesByColumn.set(columnName, row[columnIndex]);
    });

    const indexedRow: IndexedRow = { keyValues, valuesByColumn };
    const bucket = index.get(keyText);
    if (bucket) {
      bucket.push(indexedRow);
    } else {
      index.set(keyText, [indexedRow]);
    }
  }

  return index;
}

/** Compares every active mapped column between a matched source/target row pair, returning either a "matching" or "matched-key-differing-values" finding, or "unable-to-compare" if a column's value can't be normalized/compared. */
function compareMatchedRow(
  sourceRow: IndexedRow,
  targetRow: IndexedRow,
  activeMapping: ColumnMappingEntry[],
  rules: Record<string, NormalizationRule>,
  options: RowCompareOptions
): RowDifference {
  const columnDifferences: RowColumnDifference[] = [];

  for (const entry of activeMapping) {
    const sourceColumnName = mappingSourceColumnName(entry);
    const targetColumnName = entry.target;

    try {
      const sourceRawValue = lookupMappedValue(sourceRow, sourceColumnName);
      const targetRawValue = lookupMappedValue(targetRow, targetColumnName);

      const rule = rules[targetColumnName];
      const sourceNormalized = rule ? applyNormalization(sourceRawValue, rule) : sourceRawValue;
      const targetNormalized = rule ? applyNormalization(targetRawValue, rule) : targetRawValue;

      // T-14-01 (REVIEW-REPORT.md): coerce numeric-looking strings to
      // numbers here, at the comparison step, before tolerance evaluation.
      // Idea Prompt.md section 2's own ORDER_ID = 1008924 example represents
      // ORDER_AMOUNT as decimal-string literals ("125.3700" vs "125.37"),
      // not identical parsed JS numbers -- and `applyNormalization`
      // (T-12's owned normalization.ts, not editable by this task per
      // TASK-BRIEF.md) deliberately never coerces strings to numbers; its
      // header comment documents numericTolerance as intentionally excluded
      // from that function's responsibility, leaving tolerance evaluation
      // (including any type coercion tolerance evaluation needs) to the
      // caller. Coercing only when a numeric tolerance is actually
      // configured for this column keeps this narrow and behavior-preserving
      // for every other column: a column with no configured tolerance still
      // falls through to `valuesEqualWithinTolerance`'s existing strict/
      // exact-match semantics for strings.
      const tolerance = options.numericTolerance?.[targetColumnName] ?? rule?.numericTolerance;
      const sourceForComparison = tolerance ? coerceNumericString(sourceNormalized) : sourceNormalized;
      const targetForComparison = tolerance ? coerceNumericString(targetNormalized) : targetNormalized;
      const equal = valuesEqualWithinTolerance(sourceForComparison, targetForComparison, tolerance);

      if (!equal) {
        columnDifferences.push({
          columnName: targetColumnName,
          sourceValue: sourceNormalized,
          targetValue: targetNormalized,
        });
      }
    } catch {
      // Per TASK-BRIEF.md: "Unable to compare" is for a row where a mapped
      // column's value cannot be normalized/compared (e.g. a normalization
      // function throws) -- caught here so a single bad column can't crash
      // compareRows for the whole run.
      return buildRow(
        "unable-to-compare",
        sourceRow.keyValues,
        `Column "${targetColumnName}" could not be normalized or compared.`
      );
    }
  }

  if (columnDifferences.length === 0) {
    return buildRow("matching", sourceRow.keyValues, "All mapped columns match after normalization.");
  }

  const columnList = columnDifferences.map((diff) => diff.columnName).join(", ");
  return {
    ...buildRow("matched-key-differing-values", sourceRow.keyValues, `Column(s) differ after normalization: ${columnList}.`),
    columnDifferences,
  };
}

/** Resolves a `ColumnMappingEntry`'s source-side column name -- either the plain `source` field, or (for a derived mapping) the `name` field, per definition.ts's documented union shape. */
function mappingSourceColumnName(entry: ColumnMappingEntry): string {
  return "source" in entry ? entry.source : entry.name;
}

/** Looks up `columnName`'s value on a pre-indexed row. Throws if the column name isn't present for this row's side -- caught by `compareMatchedRow`'s try/catch and classified "unable-to-compare", per TASK-BRIEF.md ("a type is fundamentally incomparable"/missing-value case). */
function lookupMappedValue(row: IndexedRow, columnName: string): unknown {
  if (!row.valuesByColumn.has(columnName)) {
    throw new Error(`Column "${columnName}" not found in row.`);
  }
  return row.valuesByColumn.get(columnName);
}

function buildRow(category: RowDifference["category"], keyValues: unknown[], message: string): RowDifference {
  return {
    severity: DEFAULT_SEVERITY_FOR_CATEGORY[category],
    message,
    category,
    keyValues,
  };
}

/** Resolves the effective column-name list for a `RowSet`: a `RecordBatch`'s own `columns`, or (for a bare `unknown[][]`) `keys` followed by every mapping name for the given `side`, in that order -- see this file's header comment for why a bare array needs this and the ordering contract it implies. */
function resolveColumns(rowSet: RowSet, keys: string[], mapping: ColumnMappingEntry[], side: "source" | "target"): string[] {
  if (!Array.isArray(rowSet)) {
    return rowSet.columns;
  }
  const mappingNames = mapping.map((entry) => (side === "source" ? mappingSourceColumnName(entry) : entry.target));
  return [...keys, ...mappingNames];
}

function resolveRows(rowSet: RowSet): unknown[][] {
  return Array.isArray(rowSet) ? rowSet : rowSet.rows;
}

/**
 * Coerces a numeric-looking string (e.g. "125.3700") to a JS number for
 * tolerance comparison purposes only -- see the T-14-01 comment at this
 * function's call site in `compareMatchedRow`. Only called when a numeric
 * tolerance is configured for the column being compared, so this never
 * changes behavior for columns compared by exact/normalized-string
 * equality. Non-string values and strings that don't parse as a finite
 * number pass through unchanged (letting `valuesEqualWithinTolerance`'s
 * existing non-numeric-input handling apply, e.g. `null`/`undefined`/
 * genuinely non-numeric text still fall through to `===` semantics rather
 * than being silently coerced to `NaN` and always compared unequal).
 */
function coerceNumericString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return value;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : value;
}
