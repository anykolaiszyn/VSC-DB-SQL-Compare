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
      valuesByColumn.set(columnName, rule ? applyNormalization(raw, rule) : raw);
    }

    return {
      keyValues,
      keyText: JSON.stringify(keyValues),
      valuesByColumn,
      partitionValue: options.partitionColumn ? rawByColumn.get(options.partitionColumn) : undefined,
    };
  });
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
