// T-20: hash-based comparison ("Strategy C"), per Idea Prompt.md's "Strategy
// C: Hash comparison" section, quoted verbatim in TASK-BRIEF.md:
//
//   Compute deterministic hashes over normalized values.
//   HASH(normalized_column_1, normalized_column_2, ...)
//   Possible levels: Entire table hash, Partition hash, Key-range hash, Row
//   hash, Column hash.
//   Whole-table hashes alone are limited: they prove something differs but
//   do not explain what differs. The useful pattern is progressive
//   narrowing: Table hash differs -> Compare monthly partition hashes ->
//   June differs -> Compare key-range hashes -> IDs 5,000,000-5,100,000
//   differ -> Run row-level comparison.
//
// Scope decision (TASK-BRIEF.md Objective, authoritative over the doc's
// narrative framing): "IMPLEMENTATION-PLAN.md's literal Interfaces column
// for T-20 is `compareByHash(source, target, level): HashComparisonResult`
// -- a single comparison at a given level, not an auto-escalating
// pipeline." This module implements exactly that: `compareByHash` performs
// ONE comparison at the caller-supplied `level` and returns enough
// structured mismatch information (which partition/key-range/row/column
// differs) for a caller to invoke `compareByHash` again at a narrower level
// themselves. No automatic table -> partition -> key-range -> row
// escalation loop is implemented. Judgment call on triviality: chaining
// levels automatically would require deciding, per level, what the "next
// narrower" comparison should target (which partition to descend into,
// which key sub-range, etc.) and how to aggregate multiple narrower results
// back into one payload -- that is a real orchestration decision (the same
// kind of decision the doc's own narrative treats as a multi-step workflow
// spanning four distinct comparisons), not a trivial mechanical wrapper.
// Stopping at a single-level `compareByHash` per the literal Interfaces
// signature was judged the correct, disclosed boundary.
//
// Round 2 (REVIEW-REPORT.md Critical finding T-20-01): compareByHash
// previously called only applyNormalization before hashing, which
// deliberately never applies `numericTolerance` (normalization.ts's own
// header comment: "numericTolerance is documented on NormalizationRule but
// is inherently a two-value comparison, not a single-value transform...
// intentionally NOT applied here"). A SHA-256 digest has no native concept
// of "equal within tolerance" -- two byte strings either hash identically
// or they don't -- so `row-level.ts`'s comparison-based approach
// (`coerceNumericString` + `valuesEqualWithinTolerance`, T-14-01) cannot be
// reused as-is for hashing; hashing needs a canonical *value*, not a
// pairwise comparison. `canonicalizeForHash` (below) closes this gap: for
// any column with `options.rules[columnName].numericTolerance` configured,
// a numeric-looking string is coerced to a number (reusing the same
// non-numeric-text guard as `row-level.ts`'s `coerceNumericString` -- see
// that function's comment for why) and then rounded to a canonical bucket
// derived from the configured tolerance, so within-tolerance values
// collapse to the same pre-hash representation and hash identically. This
// reproduces Idea Prompt.md's own ORDER_AMOUNT "125.3700" vs "125.37"
// example (also `row-level.ts`'s T-14-01 worked case) agreeing between
// compareByHash and compareRows, per TASK-BRIEF.md's Interfaces-table
// requirement that normalization run "before hashing, matching the doc's
// `normalized_column_1` framing."
//
// Judgment call -- absolute tolerance: `{ absolute: X }` canonicalizes by
// rounding to the nearest multiple of X (e.g. X = 0.01 rounds 125.3700 and
// 125.37 both to 125.37), matching the doc's own worked example exactly.
//
// Judgment call -- percentage tolerance: there is no natural "round to
// nearest bucket" for a percentage tolerance the way there is for an
// absolute one, because the bucket width itself depends on the value being
// bucketed (a percentage tolerance widens as the magnitude grows). This
// module canonicalizes `{ percentage: P }` by rounding to a fixed number of
// significant figures derived from P: sigFigs = clamp(round(2 -
// log10(P/100)), 1, 15) -- e.g. P = 1 (1%) rounds to roughly 3-4 significant
// figures, P = 0.1 (0.1%) rounds to roughly 5. This is a disclosed
// approximation, not an exact reproduction of valuesEqualWithinTolerance's
// percentage formula (`|a-b| / max(|a|,|b|) * 100 <= percentage`);
// significant-figure rounding and relative-tolerance bucketing agree in the
// common case but are not mathematically identical, so compareByHash and
// compareRows can disagree near a percentage-tolerance boundary in a way
// they cannot for absolute tolerance (see the boundary-risk disclosure
// below and in IMPLEMENTATION-REPORT.md's round-2 section).
//
// Boundary-risk disclosure (inherent to any bucketing approach; every claim
// below was verified by direct computation, not asserted from theory alone
// -- see IMPLEMENTATION-REPORT.md's round-2 section for the exact
// commands/output):
//
// - Absolute tolerance -- false DISAGREEMENT is possible, false agreement
//   is NOT: `roundToStep`'s bucket width equals `tolerance.absolute`
//   exactly, so two values within tolerance of each other can still
//   straddle a bucket edge and land in different buckets. Verified example:
//   with `{ absolute: 0.01 }`, 125.364 and 125.370 differ by 0.006 (within
//   the 0.01 tolerance -- `valuesEqualWithinTolerance` calls this pair
//   equal) but round to buckets 125.36 and 125.37 respectively -- different
//   buckets, so `compareByHash` would report a mismatch `compareRows` does
//   not. Because no bucket can ever be wider than `tolerance.absolute`
//   itself, the converse -- two values MORE than `absolute` apart landing
//   in the same bucket, a false hash-level *agreement* -- cannot occur for
//   absolute tolerance: any two values in the same bucket are, by
//   construction, strictly less than one bucket-width (i.e. less than
//   `tolerance.absolute`) apart.
// - Percentage tolerance -- checked directly, false agreement was NOT
//   found within a wide search, and a closed-form bound explains why: for
//   a value of magnitude 10^(k-1) or larger, `roundToSignificantFigures`
//   with `sigFigs` significant figures gives a bucket width of
//   10^(k-sigFigs), so two values in the same bucket differ by strictly
//   less than 10^(2-sigFigs) percent of the larger value's magnitude class.
//   `percentageToSignificantFigures`'s formula (`sigFigs = round(2 -
//   log10(P/100))`) is constructed so `10^(2-sigFigs)` stays at or below
//   the configured `P` for every tolerance value tried (1, 5, 10, 25, 50,
//   100 -- see IMPLEMENTATION-REPORT.md), meaning the same
//   never-wider-than-tolerance property the absolute case has empirically
//   held for percentage tolerance too, for these bounds. This is NOT a
//   mathematical proof for every possible P/value combination (rounding's
//   `round()` in the sigFigs formula and magnitude-boundary edge effects
//   near powers of ten were not exhaustively proven) -- only empirically
//   checked -- so percentage-tolerance canonicalization is disclosed as
//   *unproven*, not guaranteed safe, even though no false-agreement
//   counterexample was found.
//
// This is a real, disclosed limitation of canonicalize-then-hash: it cannot
// be made to agree with `valuesEqualWithinTolerance`'s exact pairwise
// comparison for every possible pair, only for the common/typical case the
// doc's own example represents. A caller needing exact tolerance-boundary
// fidelity should use `compareRows` (T-14) directly rather than
// `compareByHash`.
//
// Design tradeoff disclosed per TASK-BRIEF.md's explicit instruction ("if a
// truly platform-neutral hash expression isn't achievable without
// per-dialect branching, disclose that explicitly... rather than silently
// shipping a DuckDB-only implementation under a general-sounding name"):
// hashing is computed in this module, in JS, over already-normalized
// values -- NOT pushed into a SQL `HASH(...)` expression run inside the
// connector's own engine (DuckDB's hash(), SQL Server's HASHBYTES(),
// Postgres' md5(), etc., are three different, non-portable SQL surfaces).
// The reason is stronger than portability alone: T-12's `applyNormalization`
// (this task's required normalization step, consumed read-only per
// TASK-BRIEF.md) is a pure JS function with no SQL equivalent -- there is no
// way to express "trim, case-fold, collapse whitespace, truncate a
// timestamp to day precision" as a portable SQL expression across three
// dialects without either reimplementing per-dialect SQL normalization
// (T-12's owned responsibility, out of this task's scope) or normalizing
// client-side. This module therefore always: (1) fetches raw column values
// via `executeQuery` (matching T-13/T-14/T-15's established
// "SELECT ... FROM <object>" pattern, built with `quoteIdentifier`), (2)
// applies `applyNormalization` to every column value in JS, per column
// (using any rule supplied in `options.rules`), (3) computes a SHA-256
// digest (Node's built-in `crypto` module -- no new dependency) over the
// normalized, JSON-serialized value tuple. This is genuinely
// platform-neutral (it works identically regardless of which connector
// produced the raw rows) but is NOT the doc's literal
// `HASH(normalized_column_1, ...)` SQL pushdown -- it is a functionally
// equivalent hash computed after normalization instead of a SQL hash
// function invoked inside the source/target engine. Flagged here as the
// disclosed tradeoff: a future task that wants genuine SQL-side hash
// pushdown (for datasets too large to pull row values across the wire at
// all) would need per-dialect hash SQL AND a per-dialect SQL translation of
// every `NormalizationRule` field, neither of which exists today.
import type { DataPlatformConnector, ExecutionOptions, QueryInput, RecordBatch } from "@paritylens/shared";
import type { NormalizationRule } from "../../orchestration/definition/definition.js";
import { applyNormalization } from "../normalization/normalization.js";
import { createHash } from "node:crypto";

/** The five hash-comparison levels named verbatim in Idea Prompt.md's
 * "Strategy C" section ("Entire table hash, Partition hash, Key-range
 * hash, Row hash, Column hash"). String literals chosen to read naturally
 * as a `level` argument/discriminant. */
export type HashComparisonLevel = "table" | "partition" | "key-range" | "row" | "column";

/**
 * Input describing what to hash. All fields are read against the *source*
 * connector's object naming; `targetTable` lets the target side be named
 * differently (mirroring every seeded fixture pair, none of which share a
 * table name between source and target -- e.g. `orders_source` vs
 * `orders_target`), defaulting to `table` when omitted (same-name source
 * and target, the common case for a same-platform dev-vs-prod comparison).
 */
export interface HashComparisonOptions {
  /** Source-side table/object name. */
  table: string;
  /** Target-side table/object name, if different from `table`. Defaults to `table`. */
  targetTable?: string;
  /** Column(s) forming the row's matching key -- required for `"row"`, `"key-range"`, and `"column"` levels (to identify *which* row/range/column a mismatch belongs to); unused for `"table"` and `"partition"`. */
  keyColumns?: string[];
  /** Columns to hash (the doc's `normalized_column_1, normalized_column_2, ...`), excluding key columns. Required for every level. */
  columns: string[];
  /** Per-column normalization rules, keyed by column name, applied before hashing -- matching the doc's `HASH(normalized_column_1, ...)` framing. Optional; a column with no rule is hashed on its raw fetched value. */
  rules?: Record<string, NormalizationRule>;
  /** Required for `"partition"` level: the column whose distinct values define each partition (e.g. a status or date-bucket column). */
  partitionColumn?: string;
  /** Key-range bucket size for `"key-range"` level (number of consecutive sorted key values per range). Required for `"key-range"` level. Ranges are formed by sorting all observed key values (source union target) and grouping them into fixed-size buckets -- this only supports a single numeric or naturally-sortable key column; composite keys are out of scope (see `resolveSingleKeyColumn`'s error for the explicit rejection). */
  rangeSize?: number;
  /** Row cap passed through to `executeQuery`. Defaults to 10,000 -- generous for fixture-scale data, matching this task's fixture-only scope; a real large-dataset use of this module would need explicit paging, which is out of scope here (mirrors T-14's own "assume both sides fit in memory for now" scope boundary). */
  maxRows?: number;
}

/**
 * A single narrower unit that differed, per the level being compared.
 * Optional fields are populated according to `level` (see each field's
 * comment) -- a discriminated union keyed on level was considered and
 * rejected as over-engineering for a shape only ever consumed by a caller
 * choosing which narrower `compareByHash` call to make next, not
 * programmatically branched on by field presence in this codebase yet.
 */
export interface HashMismatch {
  /** Populated for `"partition"` level: the partition column's value this mismatch belongs to. */
  partitionValue?: unknown;
  /** Populated for `"partition"` level: row count observed for this partition on the source side. */
  sourceRowCount?: number;
  /** Populated for `"partition"` level: row count observed for this partition on the target side. */
  targetRowCount?: number;
  /** Populated for `"key-range"` level: the inclusive lower bound of this range. */
  rangeStart?: unknown;
  /** Populated for `"key-range"` level: the inclusive upper bound of this range. */
  rangeEnd?: unknown;
  /** Populated for `"row"` level: the mismatched row's key column value(s), in `keyColumns` order. */
  keyValues?: unknown[];
  /** Populated for `"column"` level: the mismatched column's name. */
  columnName?: string;
  /** This unit's source-side hash, hex-encoded. `undefined` when the unit has no source-side rows (e.g. a row/partition/range present only in target). */
  sourceHash?: string;
  /** This unit's target-side hash, hex-encoded. `undefined` when the unit has no target-side rows (e.g. a row/partition/range present only in source). */
  targetHash?: string;
}

/**
 * Result of a single `compareByHash` call at a given `level`. Per
 * TASK-BRIEF.md's Interfaces table: "Returns whether the hashes matched at
 * that level and, when they didn't, enough structured information to
 * identify *what* narrower unit to compare next."
 *
 * `mismatches` is always `[]` at `"row"`/`"column"` granularity's finest
 * form and at `"table"` level (a whole-table hash has no narrower unit
 * within itself to report -- per the doc's own "prove something differs
 * but do not explain what differs" framing for table level); it is
 * populated for `"partition"`, `"key-range"`, `"row"`, and `"column"`
 * levels wherever a narrower unit's hash differs.
 */
export interface HashComparisonResult {
  level: HashComparisonLevel;
  /** Whether the source and target hashes matched at this level. For `"table"` level this is the single table-hash comparison; for every other level this is `true` only when `mismatches` is empty (every narrower unit matched). */
  matched: boolean;
  /** Table-level hash for the whole compared object, always populated (every level fetches and hashes the full row set to compute this, even when the level itself is narrower -- so `sourceHash`/`targetHash` here are always meaningful summary values, not just a `"table"`-level artifact). */
  sourceHash: string;
  targetHash: string;
  /** Narrower units that differed, per the level (see `HashMismatch`'s field comments for which fields are populated at which level). Empty when `matched` is `true`, and always empty at `"table"` level. */
  mismatches: HashMismatch[];
}

const DEFAULT_MAX_ROWS = 10_000;
const DEFAULT_TIMEOUT_MS = 30_000;
/** Deterministic sentinel hash for an empty row set (a partition/range with zero rows on one side), so an empty set has a stable, well-defined hash rather than `undefined` -- computed the same way as any other value: SHA-256 of the empty tuple list's JSON serialization. */
const EMPTY_SET_HASH = sha256Hex(JSON.stringify([]));

/**
 * Performs a single hash comparison between `source` and `target` at
 * `level`. See this file's header comment for the full design rationale
 * (levels, normalization-before-hash, and the JS-side-hash-computation
 * tradeoff).
 */
export async function compareByHash(
  source: DataPlatformConnector,
  target: DataPlatformConnector,
  level: HashComparisonLevel,
  options: HashComparisonOptions
): Promise<HashComparisonResult> {
  const targetTable = options.targetTable ?? options.table;
  const rules = options.rules ?? {};
  const keyColumns = options.keyColumns ?? [];

  const fetchColumns = [...new Set([...keyColumns, ...options.columns, ...partitionColumnList(options)])];

  const [sourceRows, targetRows] = await Promise.all([
    fetchNormalizedRows(source, options.table, fetchColumns, options, rules),
    fetchNormalizedRows(target, targetTable, fetchColumns, options, rules),
  ]);

  const sourceHash = hashRowSet(sourceRows, options.columns);
  const targetHash = hashRowSet(targetRows, options.columns);

  if (level === "table") {
    return {
      level,
      matched: sourceHash === targetHash,
      sourceHash,
      targetHash,
      mismatches: [],
    };
  }

  if (level === "partition") {
    const mismatches = comparePartitions(sourceRows, targetRows, options);
    return { level, matched: mismatches.length === 0, sourceHash, targetHash, mismatches };
  }

  if (level === "key-range") {
    const mismatches = compareKeyRanges(sourceRows, targetRows, options);
    return { level, matched: mismatches.length === 0, sourceHash, targetHash, mismatches };
  }

  if (level === "row") {
    const mismatches = compareRowsByHash(sourceRows, targetRows, options);
    return { level, matched: mismatches.length === 0, sourceHash, targetHash, mismatches };
  }

  // level === "column"
  const mismatches = compareColumnsByHash(sourceRows, targetRows, options);
  return { level, matched: mismatches.length === 0, sourceHash, targetHash, mismatches };
}

/** A row already normalized column-by-column, plus its resolved key tuple (JSON-stringified for use as a lookup key) and raw partition-column value, if any. */
interface NormalizedRow {
  keyValues: unknown[];
  keyText: string;
  valuesByColumn: Map<string, unknown>;
  partitionValue?: unknown;
}

function partitionColumnList(options: HashComparisonOptions): string[] {
  return options.partitionColumn ? [options.partitionColumn] : [];
}

/** Fetches every row of `table` via `executeQuery` (matching T-13/T-14/T-15's SQL-building pattern: `quoteIdentifier` + a bare `SELECT <columns> FROM <object>`), then applies `applyNormalization` to every non-key column value per `rules`, per this file's header-comment design rationale. Key columns and the partition column are fetched but never normalized -- a key/partition value is a lookup discriminator, not compared for equality-with-tolerance, matching `row-level.ts`'s own precedent of resolving key values directly off the fetched row rather than through `applyNormalization`. */
async function fetchNormalizedRows(
  connector: DataPlatformConnector,
  table: string,
  fetchColumns: string[],
  options: HashComparisonOptions,
  rules: Record<string, NormalizationRule>
): Promise<NormalizedRow[]> {
  const keyColumns = options.keyColumns ?? [];
  const objectRef = connector.quoteIdentifier(table);
  const quotedColumns = fetchColumns.map((c) => connector.quoteIdentifier(c)).join(", ");
  const sql = `SELECT ${quotedColumns} FROM ${objectRef}`;

  const executionOptions: ExecutionOptions = {
    maxRows: options.maxRows ?? DEFAULT_MAX_ROWS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  const batch = await consumeQuery(connector, { kind: "query", sql }, executionOptions);

  return batch.rows.map((row) => {
    const rawByColumn = new Map<string, unknown>();
    batch.columns.forEach((columnName, index) => rawByColumn.set(columnName, row[index]));

    const keyValues = keyColumns.map((keyName) => rawByColumn.get(keyName));
    const valuesByColumn = new Map<string, unknown>();
    for (const columnName of options.columns) {
      const raw = rawByColumn.get(columnName);
      const rule = rules[columnName];
      const normalized = rule ? applyNormalization(raw, rule) : raw;
      // T-20-01 fix: canonicalize under the column's configured
      // numericTolerance (if any) so within-tolerance values collapse to
      // the same pre-hash representation -- see this file's header comment
      // for the full rationale and disclosed limitations.
      valuesByColumn.set(columnName, rule?.numericTolerance ? canonicalizeForHash(normalized, rule.numericTolerance) : normalized);
    }

    return {
      keyValues,
      keyText: JSON.stringify(keyValues),
      valuesByColumn,
      partitionValue: options.partitionColumn ? rawByColumn.get(options.partitionColumn) : undefined,
    };
  });
}

/**
 * Canonicalizes a value under a numeric tolerance so within-tolerance
 * values collapse to the same pre-hash representation (T-20-01 fix -- see
 * this file's header comment for the full rationale, the absolute- vs
 * percentage-tolerance judgment calls, and the disclosed
 * false-agreement-near-boundary risk). Non-string, non-numeric, or
 * non-numeric-looking-string values pass through unchanged (mirrors
 * `row-level.ts`'s `coerceNumericString` guard: never coerce genuinely
 * non-numeric text, so a column with a numericTolerance rule but a
 * non-numeric value still hashes on its normalized value as-is rather than
 * being corrupted into `NaN`).
 */
function canonicalizeForHash(value: unknown, tolerance: { absolute?: number; percentage?: number }): unknown {
  const numeric = coerceNumericForHash(value);
  if (numeric === undefined) {
    return value;
  }

  if (tolerance.absolute !== undefined && tolerance.absolute > 0) {
    return roundToStep(numeric, tolerance.absolute);
  }

  if (tolerance.percentage !== undefined && tolerance.percentage > 0) {
    return roundToSignificantFigures(numeric, percentageToSignificantFigures(tolerance.percentage));
  }

  // Tolerance object present but both fields empty/zero -- no bucketing
  // possible; fall through to the normalized value unchanged (equivalent
  // to no tolerance being configured for canonicalization purposes).
  return value;
}

/** Coerces a numeric-looking value to a JS number for canonicalization
 * purposes, or returns `undefined` when the value is not numeric-looking
 * (mirrors `row-level.ts`'s `coerceNumericString`, generalized to also
 * accept an already-numeric value unchanged). */
function coerceNumericForHash(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Rounds `value` to the nearest multiple of `step` (e.g. step 0.01 rounds
 * 125.3700 and 125.37 both to 125.37), then re-rounds to a fixed number of
 * decimal places derived from `step` to avoid floating-point representation
 * artifacts (e.g. 0.1 + 0.2 !== 0.3) reintroducing spurious differences
 * between two values that rounded to the mathematically same bucket. */
function roundToStep(value: number, step: number): number {
  const rounded = Math.round(value / step) * step;
  const decimals = Math.min(12, Math.max(0, Math.ceil(-Math.log10(step)) + 2));
  return Number(rounded.toFixed(decimals));
}

/** Rounds `value` to `sigFigs` significant figures (e.g. 3 sigFigs: 125.37
 * -> 125). `0` is a fixed point with no meaningful significant-figure
 * rounding and is returned unchanged. */
function roundToSignificantFigures(value: number, sigFigs: number): number {
  if (value === 0) {
    return 0;
  }
  const magnitude = Math.floor(Math.log10(Math.abs(value))) + 1;
  const decimals = Math.min(12, Math.max(0, sigFigs - magnitude));
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/** Derives a significant-figure count from a percentage tolerance for
 * canonicalization purposes -- see this file's header comment's
 * percentage-tolerance judgment call for the formula's rationale and its
 * disclosed inexactness relative to `valuesEqualWithinTolerance`'s exact
 * relative-difference formula. Clamped to [1, 15] (15 being the practical
 * limit of IEEE-754 double precision). */
function percentageToSignificantFigures(percentage: number): number {
  const sigFigs = Math.round(2 - Math.log10(percentage / 100));
  return Math.min(15, Math.max(1, sigFigs));
}

async function consumeQuery(
  connector: DataPlatformConnector,
  input: QueryInput,
  executionOptions: ExecutionOptions
): Promise<RecordBatch> {
  const rows: unknown[][] = [];
  let columns: string[] = [];
  for await (const chunk of connector.executeQuery(input, executionOptions)) {
    columns = chunk.columns;
    rows.push(...chunk.rows);
  }
  return { columns, rows, rowCount: rows.length };
}

/** Hashes an entire row set: sorts rows by their normalized-value tuple's JSON text (so row order from the connector, which is not guaranteed, cannot change the resulting hash), then SHA-256s the JSON of the sorted list of per-row normalized-value tuples. */
function hashRowSet(rows: NormalizedRow[], columns: string[]): string {
  const tuples = rows
    .map((row) => columns.map((c) => row.valuesByColumn.get(c)))
    .map((tuple) => JSON.stringify(tuple))
    .sort();
  return sha256Hex(JSON.stringify(tuples));
}

function hashSingleRow(row: NormalizedRow | undefined, columns: string[]): string | undefined {
  if (!row) {
    return undefined;
  }
  const tuple = columns.map((c) => row.valuesByColumn.get(c));
  return sha256Hex(JSON.stringify(tuple));
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Groups rows by their (already-fetched, unnormalized) partition-column value and compares each partition's row-set hash between source and target -- an empty partition on one side hashes to `EMPTY_SET_HASH` rather than being treated as "no data to compare". */
function comparePartitions(
  sourceRows: NormalizedRow[],
  targetRows: NormalizedRow[],
  options: HashComparisonOptions
): HashMismatch[] {
  if (!options.partitionColumn) {
    throw new Error(`compareByHash: "partition" level requires options.partitionColumn.`);
  }

  const sourceByPartition = groupBy(sourceRows, (r) => r.partitionValue);
  const targetByPartition = groupBy(targetRows, (r) => r.partitionValue);
  const allPartitionValues = new Set([...sourceByPartition.keys(), ...targetByPartition.keys()]);

  const mismatches: HashMismatch[] = [];
  for (const partitionValue of allPartitionValues) {
    const sourceBucket = sourceByPartition.get(partitionValue) ?? [];
    const targetBucket = targetByPartition.get(partitionValue) ?? [];

    const sourceHash = sourceBucket.length > 0 ? hashRowSet(sourceBucket, options.columns) : EMPTY_SET_HASH;
    const targetHash = targetBucket.length > 0 ? hashRowSet(targetBucket, options.columns) : EMPTY_SET_HASH;

    if (sourceHash !== targetHash) {
      mismatches.push({
        partitionValue,
        sourceRowCount: sourceBucket.length,
        targetRowCount: targetBucket.length,
        ...(sourceBucket.length > 0 ? { sourceHash } : {}),
        ...(targetBucket.length > 0 ? { targetHash } : {}),
      });
    }
  }

  return mismatches;
}

/** Groups rows into fixed-size, sorted key-value buckets (`options.rangeSize` consecutive sorted key values per bucket) and compares each range's row-set hash between source and target. Only supports a single key column -- a composite key has no single well-ordered scalar to bucket on without an arbitrary combination rule this task does not attempt to invent. */
function compareKeyRanges(
  sourceRows: NormalizedRow[],
  targetRows: NormalizedRow[],
  options: HashComparisonOptions
): HashMismatch[] {
  const keyColumn = resolveSingleKeyColumn(options);
  if (!options.rangeSize || options.rangeSize <= 0) {
    throw new Error(`compareByHash: "key-range" level requires options.rangeSize > 0.`);
  }
  void keyColumn;

  const allKeyValues = [...new Set([...sourceRows, ...targetRows].map((r) => r.keyValues[0]))]
    .filter((v): v is number => typeof v === "number")
    .sort((a, b) => a - b);

  const mismatches: HashMismatch[] = [];
  for (let i = 0; i < allKeyValues.length; i += options.rangeSize) {
    const bucketKeys = allKeyValues.slice(i, i + options.rangeSize);
    const rangeStart = bucketKeys[0];
    const rangeEnd = bucketKeys[bucketKeys.length - 1];
    const bucketKeySet = new Set(bucketKeys);

    const sourceBucket = sourceRows.filter((r) => bucketKeySet.has(r.keyValues[0] as number));
    const targetBucket = targetRows.filter((r) => bucketKeySet.has(r.keyValues[0] as number));

    const sourceHash = sourceBucket.length > 0 ? hashRowSet(sourceBucket, options.columns) : EMPTY_SET_HASH;
    const targetHash = targetBucket.length > 0 ? hashRowSet(targetBucket, options.columns) : EMPTY_SET_HASH;

    if (sourceHash !== targetHash) {
      mismatches.push({
        ...(rangeStart !== undefined ? { rangeStart } : {}),
        ...(rangeEnd !== undefined ? { rangeEnd } : {}),
        ...(sourceBucket.length > 0 ? { sourceHash } : {}),
        ...(targetBucket.length > 0 ? { targetHash } : {}),
      });
    }
  }

  return mismatches;
}

/** Compares each row individually by key, hashing its normalized column tuple. A row present on only one side is reported with the other side's hash left `undefined` (mirrors `row-level.ts`'s "missing-from-source"/"missing-from-target" categories, though this module does not itself classify into those eight categories -- see this file's header comment on scope). Duplicate keys on one side are compared positionally against the same key's row(s) on the other side (first-vs-first, etc.); this module does not replicate `compareRows`'s dedicated duplicate-key classification, since T-14's `compareRows` already owns that and this task's cross-check test proves the two modules agree on the fixtures that matter. */
function compareRowsByHash(
  sourceRows: NormalizedRow[],
  targetRows: NormalizedRow[],
  options: HashComparisonOptions
): HashMismatch[] {
  requireKeyColumns(options);

  const sourceByKey = groupBy(sourceRows, (r) => r.keyText);
  const targetByKey = groupBy(targetRows, (r) => r.keyText);
  const allKeys = new Set([...sourceByKey.keys(), ...targetByKey.keys()]);

  const mismatches: HashMismatch[] = [];
  for (const keyText of allKeys) {
    const sourceMatches = sourceByKey.get(keyText) ?? [];
    const targetMatches = targetByKey.get(keyText) ?? [];
    const maxLen = Math.max(sourceMatches.length, targetMatches.length);

    for (let i = 0; i < maxLen; i++) {
      const sourceRow = sourceMatches[i];
      const targetRow = targetMatches[i];
      const sourceHash = hashSingleRow(sourceRow, options.columns);
      const targetHash = hashSingleRow(targetRow, options.columns);

      if (sourceHash !== targetHash) {
        mismatches.push({
          keyValues: (sourceRow ?? targetRow)!.keyValues,
          ...(sourceHash !== undefined ? { sourceHash } : {}),
          ...(targetHash !== undefined ? { targetHash } : {}),
        });
      }
    }
  }

  return mismatches;
}

/** Compares each configured column independently, hashing that single column's normalized value across every row (source-side rows ordered/joined by key, matching only rows whose key exists on both sides -- a column-level hash is only meaningful for the row population both sides actually share). */
function compareColumnsByHash(
  sourceRows: NormalizedRow[],
  targetRows: NormalizedRow[],
  options: HashComparisonOptions
): HashMismatch[] {
  requireKeyColumns(options);

  const sourceByKey = new Map(sourceRows.map((r) => [r.keyText, r]));
  const targetByKey = new Map(targetRows.map((r) => [r.keyText, r]));
  const sharedKeys = [...sourceByKey.keys()].filter((k) => targetByKey.has(k)).sort();

  const mismatches: HashMismatch[] = [];
  for (const columnName of options.columns) {
    const sourceValues = sharedKeys.map((k) => sourceByKey.get(k)!.valuesByColumn.get(columnName));
    const targetValues = sharedKeys.map((k) => targetByKey.get(k)!.valuesByColumn.get(columnName));

    const sourceHash = sha256Hex(JSON.stringify(sourceValues));
    const targetHash = sha256Hex(JSON.stringify(targetValues));

    if (sourceHash !== targetHash) {
      mismatches.push({ columnName, sourceHash, targetHash });
    }
  }

  return mismatches;
}

function requireKeyColumns(options: HashComparisonOptions): void {
  if (!options.keyColumns || options.keyColumns.length === 0) {
    throw new Error(`compareByHash: this level requires options.keyColumns.`);
  }
}

function resolveSingleKeyColumn(options: HashComparisonOptions): string {
  requireKeyColumns(options);
  if (options.keyColumns!.length !== 1) {
    throw new Error(
      `compareByHash: "key-range" level only supports a single key column; got ${options.keyColumns!.length}.`
    );
  }
  return options.keyColumns![0]!;
}

function groupBy<T>(items: T[], keyFn: (item: T) => unknown): Map<unknown, T[]> {
  const map = new Map<unknown, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = map.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      map.set(key, [item]);
    }
  }
  return map;
}
