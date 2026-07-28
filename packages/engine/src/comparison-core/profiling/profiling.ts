// T-07: column profiling.
//
// profileColumn(connector, column, options) computes a single column's
// ColumnProfile by generating straightforward, read-only SQL (COUNT,
// COUNT(DISTINCT), MIN, MAX, AVG, CASE WHEN pattern counts) and executing it
// via `DataPlatformConnector.executeQuery` -- which for FixtureConnector (and
// every real connector per T-03/T-17-19) routes through T-03's
// `assertReadOnlyStatement` safety gate automatically, so profiling never
// needs its own separate safety check. General metrics (row count, populated
// count, null count/percentage, distinct count, duplicate count) are always
// computed; a second family of metrics is computed depending on the column's
// canonical type category (via T-05's `mapNativeType`):
//   - String: empty-string/whitespace-only counts, min/max/avg length, case
//     distribution.
//   - Integer/Decimal/FloatingPoint: min/max/mean/median/stddev,
//     zero/negative/positive counts (see the doc comment on `NumericMetrics`
//     below for the DuckDB aggregate functions used).
//   - Date/Time/Timestamp/TimestampWithTimezone: earliest/latest value,
//     future-date count (relative to `options.now`, defaulting to the
//     current wall-clock time, so tests can supply a fixed reference date).
//   - Boolean: count/percentage by distinct value, cardinality.
//   - Unknown/every other canonical category: general metrics only.
//
// compareProfiles(source, target) compares two ColumnProfiles and returns
// ProfileDifference[] findings for only the changes Idea Prompt.md's Layer 4
// STATUS worked example calls "meaningful" (distinct-value-count change,
// null-percentage change beyond a documented threshold, most-common-value
// change, and -- for boolean/categorical profiles -- new/missing target
// values) rather than a blind field-by-field dump of both profiles.
import type { ColumnDefinition, DataPlatformConnector, QueryInput } from "@paritylens/shared";
import type { ProfileDifference } from "@paritylens/shared";
import { mapNativeType } from "../type-mapping/type-mapping.js";

/** String-category-specific metrics, per Idea Prompt.md's "String-specific metrics". */
export interface StringMetrics {
  emptyStringCount: number;
  whitespaceOnlyCount: number;
  minLength: number;
  maxLength: number;
  avgLength: number;
  uppercaseCount: number;
  lowercaseCount: number;
  mixedCaseCount: number;
}

/**
 * Numeric-category-specific metrics (Integer/Decimal/FloatingPoint), per
 * Idea Prompt.md's "Numeric-specific metrics" and TASK-BRIEF.md line 44's
 * `profileColumn` interface contract, which explicitly names both `median`
 * and `stddev` as required output: "numeric metrics (min/max/mean/
 * median/stddev, zero/negative/positive counts) for Integer/Decimal/
 * FloatingPoint-category columns". `median` and `stddev` are computed via
 * DuckDB's native `MEDIAN(col)` (quantile-continuous at p=0.5) and
 * `STDDEV_SAMP(col)` (sample standard deviation, n-1 denominator) aggregate
 * functions -- both single-pass, read-only aggregates on the same query as
 * the other numeric metrics, requiring no percentile/window-function
 * workaround and no per-platform availability assumption beyond what this
 * task's Fixture/DuckDB connector already targets.
 */
export interface NumericMetrics {
  min: number;
  max: number;
  mean: number;
  median: number;
  stddev: number;
  zeroCount: number;
  negativeCount: number;
  positiveCount: number;
}

/** Date/Time/Timestamp-category-specific metrics, per Idea Prompt.md's "Date and timestamp metrics". */
export interface DateMetrics {
  earliest: string;
  latest: string;
  futureDateCount: number;
}

/** Boolean/categorical-category-specific metrics, per Idea Prompt.md's "Boolean or categorical metrics". */
export interface BooleanMetrics {
  /** Count of populated (non-null) rows per distinct value, keyed by the value's string representation. */
  countByValue: Record<string, number>;
  /** Percentage (0-100) of populated rows per distinct value, keyed the same way as `countByValue`. */
  percentageByValue: Record<string, number>;
  /** Number of distinct values observed (Idea Prompt.md's "Cardinality"). */
  cardinality: number;
}

/**
 * A single column's computed profile: general metrics always populated, plus
 * exactly one of the type-family-specific metric groups depending on the
 * column's canonical type category (or none, for Unknown/unsupported
 * categories). `mostCommonValue` is populated whenever at least one
 * non-null value exists, independent of type family, since `compareProfiles`
 * needs it uniformly (per the idea doc's STATUS worked example, which is a
 * String/categorical column) -- it is computed as part of general metrics,
 * not gated behind a specific `*Metrics` family.
 */
export interface ColumnProfile {
  columnName: string;
  rowCount: number;
  populatedCount: number;
  nullCount: number;
  /** 0-100. */
  nullPercentage: number;
  distinctCount: number;
  duplicateCount: number;
  /** The single most frequently occurring non-null value, as its string representation, where at least one non-null value exists. */
  mostCommonValue?: string;
  /** All distinct non-null values observed, as their string representations -- populated only for Boolean-category columns (small, bounded cardinality), used by `compareProfiles` to detect new/missing categorical values. */
  distinctValues?: string[];
  stringMetrics?: StringMetrics;
  numericMetrics?: NumericMetrics;
  dateMetrics?: DateMetrics;
  booleanMetrics?: BooleanMetrics;
}

/** Options controlling `profileColumn`'s query generation and execution. */
export interface ProfileOptions {
  /** Which table/query/file to profile the column against. */
  input: QueryInput;
  /** Row cap passed to `executeQuery`'s `ExecutionOptions`. Defaults to 1,000,000 -- generous for the aggregate queries this module issues (each query returns a single summary row, not per-row data), while still bounding a runaway query per DESIGN-SPEC.md's safety limits. */
  maxRows?: number;
  /** Query timeout in milliseconds passed to `executeQuery`'s `ExecutionOptions`. Defaults to 30,000. */
  timeoutMs?: number;
  /** Reference "now" for future-date-count computation on Date/Time/Timestamp columns. Defaults to `new Date()`; overridable so tests are deterministic. */
  now?: Date;
}

const DEFAULT_MAX_ROWS = 1_000_000;
const DEFAULT_TIMEOUT_MS = 30_000;

/** Null percentage change (in percentage points) at or above this threshold is treated as a meaningful change by `compareProfiles`. Documented judgment call: half a percentage point is small enough to catch the idea doc's own worked examples (e.g. a handful of newly-null rows in a modest table) while ignoring floating-point noise from repeated identical computations. */
const NULL_PERCENTAGE_CHANGE_THRESHOLD = 0.5;

/**
 * Computes a `ColumnProfile` for one column by querying `connector` with
 * straightforward, read-only aggregate SQL. General metrics are always
 * computed; a second query computes the type-family-specific metric group
 * selected by `mapNativeType(column.nativeType, ...)`'s canonical category.
 */
export async function profileColumn(
  connector: DataPlatformConnector,
  column: ColumnDefinition,
  options: ProfileOptions
): Promise<ColumnProfile> {
  const executionOptions = {
    maxRows: options.maxRows ?? DEFAULT_MAX_ROWS,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };

  const objectRef = resolveObjectReference(connector, options.input);
  const quotedColumn = connector.quoteIdentifier(column.name);

  const generalRow = await runSingleRowQuery(
    connector,
    `SELECT ` +
      `COUNT(*) AS row_count, ` +
      `COUNT(${quotedColumn}) AS populated_count, ` +
      `COUNT(DISTINCT ${quotedColumn}) AS distinct_count ` +
      `FROM ${objectRef}`,
    executionOptions
  );

  const rowCount = toNumber(generalRow.row_count);
  const populatedCount = toNumber(generalRow.populated_count);
  const nullCount = rowCount - populatedCount;
  const nullPercentage = rowCount === 0 ? 0 : (nullCount / rowCount) * 100;
  const distinctCount = toNumber(generalRow.distinct_count);
  const duplicateCount = Math.max(0, populatedCount - distinctCount);

  const mostCommonValue = await computeMostCommonValue(connector, objectRef, quotedColumn, executionOptions);

  const profile: ColumnProfile = {
    columnName: column.name,
    rowCount,
    populatedCount,
    nullCount,
    nullPercentage,
    distinctCount,
    duplicateCount,
    ...(mostCommonValue !== undefined ? { mostCommonValue } : {}),
  };

  // canonicalType is trusted directly off the ColumnDefinition (as produced
  // by getSchema()/T-05's mapNativeType), consistent with how T-06's
  // schema-diff consumes it -- mapNativeType is called here defensively only
  // as a fallback for callers that construct a ColumnDefinition without a
  // populated canonicalType (e.g. hand-built test fixtures).
  const category = column.canonicalType ?? mapNativeType(column.nativeType, "duckdb");

  if (category === "String") {
    profile.stringMetrics = await computeStringMetrics(connector, objectRef, quotedColumn, executionOptions);
  } else if (category === "Integer" || category === "Decimal" || category === "FloatingPoint") {
    profile.numericMetrics = await computeNumericMetrics(connector, objectRef, quotedColumn, executionOptions);
  } else if (
    category === "Date" ||
    category === "Time" ||
    category === "Timestamp" ||
    category === "TimestampWithTimezone"
  ) {
    profile.dateMetrics = await computeDateMetrics(
      connector,
      objectRef,
      quotedColumn,
      executionOptions,
      options.now ?? new Date()
    );
  } else if (category === "Boolean") {
    const boolResult = await computeBooleanMetrics(connector, objectRef, quotedColumn, executionOptions);
    profile.booleanMetrics = boolResult.metrics;
    profile.distinctValues = boolResult.distinctValues;
  }

  return profile;
}

async function computeStringMetrics(
  connector: DataPlatformConnector,
  objectRef: string,
  quotedColumn: string,
  executionOptions: { maxRows: number; timeoutMs: number }
): Promise<StringMetrics> {
  const row = await runSingleRowQuery(
    connector,
    `SELECT ` +
      `SUM(CASE WHEN ${quotedColumn} = '' THEN 1 ELSE 0 END) AS empty_count, ` +
      `SUM(CASE WHEN ${quotedColumn} IS NOT NULL AND TRIM(${quotedColumn}) = '' AND ${quotedColumn} <> '' THEN 1 ELSE 0 END) AS whitespace_only_count, ` +
      `MIN(LENGTH(${quotedColumn})) AS min_length, ` +
      `MAX(LENGTH(${quotedColumn})) AS max_length, ` +
      `AVG(LENGTH(${quotedColumn})) AS avg_length, ` +
      `SUM(CASE WHEN ${quotedColumn} IS NOT NULL AND ${quotedColumn} = UPPER(${quotedColumn}) AND ${quotedColumn} <> LOWER(${quotedColumn}) THEN 1 ELSE 0 END) AS uppercase_count, ` +
      `SUM(CASE WHEN ${quotedColumn} IS NOT NULL AND ${quotedColumn} = LOWER(${quotedColumn}) AND ${quotedColumn} <> UPPER(${quotedColumn}) THEN 1 ELSE 0 END) AS lowercase_count ` +
      `FROM ${objectRef}`,
    executionOptions
  );

  const populatedCountRow = await runSingleRowQuery(
    connector,
    `SELECT COUNT(${quotedColumn}) AS populated_count FROM ${objectRef}`,
    executionOptions
  );
  const populatedCount = toNumber(populatedCountRow.populated_count);
  const uppercaseCount = toNumber(row.uppercase_count);
  const lowercaseCount = toNumber(row.lowercase_count);
  const mixedCaseCount = Math.max(0, populatedCount - uppercaseCount - lowercaseCount);

  return {
    emptyStringCount: toNumber(row.empty_count),
    whitespaceOnlyCount: toNumber(row.whitespace_only_count),
    minLength: toNumber(row.min_length),
    maxLength: toNumber(row.max_length),
    avgLength: toNumber(row.avg_length),
    uppercaseCount,
    lowercaseCount,
    mixedCaseCount,
  };
}

async function computeNumericMetrics(
  connector: DataPlatformConnector,
  objectRef: string,
  quotedColumn: string,
  executionOptions: { maxRows: number; timeoutMs: number }
): Promise<NumericMetrics> {
  const row = await runSingleRowQuery(
    connector,
    `SELECT ` +
      `MIN(${quotedColumn}) AS min_value, ` +
      `MAX(${quotedColumn}) AS max_value, ` +
      `AVG(${quotedColumn}) AS mean_value, ` +
      `MEDIAN(${quotedColumn}) AS median_value, ` +
      `STDDEV_SAMP(${quotedColumn}) AS stddev_value, ` +
      `SUM(CASE WHEN ${quotedColumn} = 0 THEN 1 ELSE 0 END) AS zero_count, ` +
      `SUM(CASE WHEN ${quotedColumn} < 0 THEN 1 ELSE 0 END) AS negative_count, ` +
      `SUM(CASE WHEN ${quotedColumn} > 0 THEN 1 ELSE 0 END) AS positive_count ` +
      `FROM ${objectRef}`,
    executionOptions
  );

  return {
    min: toNumber(row.min_value),
    max: toNumber(row.max_value),
    mean: toNumber(row.mean_value),
    median: toNumber(row.median_value),
    stddev: toNumber(row.stddev_value),
    zeroCount: toNumber(row.zero_count),
    negativeCount: toNumber(row.negative_count),
    positiveCount: toNumber(row.positive_count),
  };
}

async function computeDateMetrics(
  connector: DataPlatformConnector,
  objectRef: string,
  quotedColumn: string,
  executionOptions: { maxRows: number; timeoutMs: number },
  now: Date
): Promise<DateMetrics> {
  const row = await runSingleRowQuery(
    connector,
    `SELECT MIN(${quotedColumn}) AS earliest_value, MAX(${quotedColumn}) AS latest_value FROM ${objectRef}`,
    executionOptions
  );

  const nowLiteral = now.toISOString().replace("T", " ").replace("Z", "");
  const futureRow = await runSingleRowQuery(
    connector,
    `SELECT SUM(CASE WHEN ${quotedColumn} > TIMESTAMP '${nowLiteral}' THEN 1 ELSE 0 END) AS future_count FROM ${objectRef}`,
    executionOptions
  );

  return {
    earliest: formatDateValue(row.earliest_value),
    latest: formatDateValue(row.latest_value),
    futureDateCount: toNumber(futureRow.future_count),
  };
}

async function computeBooleanMetrics(
  connector: DataPlatformConnector,
  objectRef: string,
  quotedColumn: string,
  executionOptions: { maxRows: number; timeoutMs: number }
): Promise<{ metrics: BooleanMetrics; distinctValues: string[] }> {
  const sql = `SELECT ${quotedColumn} AS value, COUNT(*) AS value_count FROM ${objectRef} WHERE ${quotedColumn} IS NOT NULL GROUP BY ${quotedColumn}`;
  const rows = await runQuery(connector, sql, executionOptions);

  let populatedCount = 0;
  const countByValue: Record<string, number> = {};
  for (const row of rows) {
    const key = formatValueKey(row.value);
    const count = toNumber(row.value_count);
    countByValue[key] = count;
    populatedCount += count;
  }

  const percentageByValue: Record<string, number> = {};
  for (const [key, count] of Object.entries(countByValue)) {
    percentageByValue[key] = populatedCount === 0 ? 0 : (count / populatedCount) * 100;
  }

  return {
    metrics: {
      countByValue,
      percentageByValue,
      cardinality: Object.keys(countByValue).length,
    },
    distinctValues: Object.keys(countByValue),
  };
}

async function computeMostCommonValue(
  connector: DataPlatformConnector,
  objectRef: string,
  quotedColumn: string,
  executionOptions: { maxRows: number; timeoutMs: number }
): Promise<string | undefined> {
  const sql =
    `SELECT ${quotedColumn} AS value, COUNT(*) AS value_count FROM ${objectRef} ` +
    `WHERE ${quotedColumn} IS NOT NULL GROUP BY ${quotedColumn} ORDER BY value_count DESC, value ASC LIMIT 1`;
  const rows = await runQuery(connector, sql, executionOptions);
  const first = rows[0];
  if (!first) {
    return undefined;
  }
  return formatValueKey(first.value);
}

/** Resolves a `QueryInput` to a bare object reference usable after `FROM`. Mirrors FixtureConnector's own private `resolveObjectReference` (T-04), reimplemented here since profiling only has access to the public `DataPlatformConnector` surface (`quoteIdentifier`, not the connector's private query-building internals). */
function resolveObjectReference(connector: DataPlatformConnector, input: QueryInput): string {
  if (input.kind === "table") {
    return connector.quoteIdentifier(input.object);
  }
  if (input.kind === "query") {
    return `(${input.sql.trim().replace(/;\s*$/, "")}) AS profiling_subquery`;
  }
  throw new Error(
    `profileColumn does not support { kind: "sqlFile" } input directly; supply { kind: "query" } with the file's contents instead.`
  );
}

async function runSingleRowQuery(
  connector: DataPlatformConnector,
  sql: string,
  executionOptions: { maxRows: number; timeoutMs: number }
): Promise<Record<string, unknown>> {
  const rows = await runQuery(connector, sql, executionOptions);
  const first = rows[0];
  if (!first) {
    throw new Error(`Profiling aggregate query returned no rows: ${sql}`);
  }
  return first;
}

async function runQuery(
  connector: DataPlatformConnector,
  sql: string,
  executionOptions: { maxRows: number; timeoutMs: number }
): Promise<Record<string, unknown>[]> {
  const results: Record<string, unknown>[] = [];
  for await (const batch of connector.executeQuery({ kind: "query", sql }, executionOptions)) {
    for (const row of batch.rows) {
      const record: Record<string, unknown> = {};
      batch.columns.forEach((columnName, index) => {
        record[columnName] = row[index];
      });
      results.push(record);
    }
  }
  return results;
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

function formatValueKey(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

function formatDateValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return String(value);
}

/**
 * Compares two `ColumnProfile`s and returns `ProfileDifference[]` findings
 * for only the changes classified as meaningful, per Idea Prompt.md's Layer
 * 4 STATUS worked example:
 *
 *   - distinctCount: any change is reported (Informational; a distinct-value
 *     count change is a signal worth surfacing but is not inherently a
 *     failure -- e.g. a legitimately new categorical value appearing is
 *     often expected, not a defect).
 *   - nullPercentage: reported only when the absolute change is >=
 *     NULL_PERCENTAGE_CHANGE_THRESHOLD (0.5 percentage points) -- Warning,
 *     since a materially higher/lower null rate on the target is a real
 *     data-quality signal worth a human's attention. A no-op or
 *     floating-point-noise-level change does not produce a finding.
 *   - mostCommonValue: reported whenever it differs (Warning; the dominant
 *     value in a column changing is a strong signal something shifted).
 *   - newTargetValue / missingTargetValue: reported for every value present
 *     in `distinctValues` on one side but not the other -- populated
 *     currently only for Boolean-category profiles (small, bounded
 *     cardinality; see `ColumnProfile.distinctValues`'s doc comment).
 *     newTargetValue is Warning (a previously-unseen category on the target
 *     needs review); missingTargetValue is Warning as well (a category that
 *     existed on the source and vanished from the target is equally worth
 *     flagging).
 */
export function compareProfiles(source: ColumnProfile, target: ColumnProfile): ProfileDifference[] {
  const findings: ProfileDifference[] = [];
  const columnName = source.columnName;

  if (source.distinctCount !== target.distinctCount) {
    findings.push({
      columnName,
      metric: "distinctCount",
      severity: "Informational",
      message: `Column "${columnName}": distinct value count changed from ${source.distinctCount} (source) to ${target.distinctCount} (target).`,
      sourceValue: source.distinctCount,
      targetValue: target.distinctCount,
    });
  }

  const nullPercentageDelta = Math.abs(source.nullPercentage - target.nullPercentage);
  if (nullPercentageDelta >= NULL_PERCENTAGE_CHANGE_THRESHOLD) {
    findings.push({
      columnName,
      metric: "nullPercentage",
      severity: "Warning",
      message: `Column "${columnName}": null percentage changed from ${source.nullPercentage.toFixed(2)}% (source) to ${target.nullPercentage.toFixed(2)}% (target).`,
      sourceValue: source.nullPercentage,
      targetValue: target.nullPercentage,
    });
  }

  if (source.mostCommonValue !== target.mostCommonValue) {
    findings.push({
      columnName,
      metric: "mostCommonValue",
      severity: "Warning",
      message: `Column "${columnName}": most common value changed from ${formatMostCommon(source.mostCommonValue)} (source) to ${formatMostCommon(target.mostCommonValue)} (target).`,
      sourceValue: source.mostCommonValue,
      targetValue: target.mostCommonValue,
    });
  }

  const sourceValues = new Set(source.distinctValues ?? []);
  const targetValues = new Set(target.distinctValues ?? []);

  for (const value of targetValues) {
    if (!sourceValues.has(value)) {
      findings.push({
        columnName,
        metric: "newTargetValue",
        severity: "Warning",
        message: `Column "${columnName}": value "${value}" is present on the target but was not observed on the source.`,
        targetValue: value,
      });
    }
  }

  for (const value of sourceValues) {
    if (!targetValues.has(value)) {
      findings.push({
        columnName,
        metric: "missingTargetValue",
        severity: "Warning",
        message: `Column "${columnName}": value "${value}" was observed on the source but is missing on the target.`,
        sourceValue: value,
      });
    }
  }

  return findings;
}

function formatMostCommon(value: string | undefined): string {
  return value === undefined ? "(none)" : `"${value}"`;
}
