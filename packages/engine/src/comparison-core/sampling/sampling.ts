// T-21: sampling-query generation ("Strategy A: Sample comparison"), per
// Idea Prompt.md's "Strategy A" section, quoted verbatim in TASK-BRIEF.md:
//
//   Best for quick development checks.
//   First N rows
//   Random sample
//   Deterministic hash sample
//   Stratified sample
//   Date-window sample
//   Key-range sample
//
// Scope, per TASK-BRIEF.md's Objective section (authoritative): "This task
// builds query generation only: given a sampling strategy and a
// `QueryInput`, produce the SQL text that would select the requested
// sample. It does not itself execute the query, does not wire sampling into
// the planner/`runComparison`, and does not modify any check (row-level/
// profile) to consume a sample automatically" -- matching T-13's
// `buildRowCountSql` and T-20's `compareByHash` precedent of a
// comparison-core capability landing before its planner integration. This
// module therefore never calls `connector.executeQuery` itself.
//
// *** Central correctness property (the review gate, quoted verbatim from
// TASK-BRIEF.md, itself quoting IMPLEMENTATION-PLAN.md's T-21 row):
// "Independent reviewer confirms sampling never bypasses the row-cap/
// timeout safety limits from DESIGN-SPEC.md." ***
//
// Concretely: `buildSampleQuery` returns SQL text only. When a caller
// eventually executes that text via `connector.executeQuery(input, options)`,
// `ExecutionOptions.maxRows`/`timeoutMs` are enforced exactly as for any
// other query (DESIGN-SPEC.md: default 100,000-row cap, 60s timeout, both
// overridable) -- see `FixtureConnector.executeQuery`
// (packages/engine/src/connector-sdk/fixture/fixture-connector.ts:180-214),
// which wraps EVERY executed SQL string (whether caller-supplied or
// connector-generated) in `SELECT * FROM (<sql>) AS fixture_query LIMIT
// <options.maxRows>` unconditionally, regardless of what LIMIT/TOP/SAMPLE
// clause (if any) the inner SQL text already contains. A strategy's own
// `LIMIT`/`TOP`/`TABLESAMPLE`/modulus-based-WHERE clause (first-N's LIMIT,
// stratified's per-stratum LIMIT, random's TABLESAMPLE-or-ORDER-BY-random
// fallback) is therefore always ADDITIVE to, never a replacement for, the
// caller's own `maxRows`/`timeoutMs` enforcement -- this module never
// constructs SQL that claims the row cap is unnecessary, and this file's
// tests (sampling.test.ts) prove the property empirically by executing
// generated SQL through the real `FixtureConnector` with a deliberately
// small `maxRows` and confirming the cap -- not the sample's own clause --
// determines the final row count. This module never accepts or threads an
// `ExecutionOptions` value at all (see `GeneratedQuery` below) precisely so
// there is no code path by which a sample strategy could suppress or
// override the caller's execution-time limits.
//
// `GeneratedQuery` is not defined elsewhere in this codebase for this
// purpose (packages/shared/src/connector.ts does declare an unrelated
// `GeneratedQuery` interface for `buildProfileQuery`'s preview shape --
// `{ sql: string; parameters: unknown[] }` -- but per TASK-BRIEF.md's
// explicit instruction this task defines its own local type rather than
// reusing or editing that one, following T-20's `HashComparisonResult`
// precedent of a locally-scoped result shape when no external consumer
// requires packages/shared placement yet). This module's own
// `SampleGeneratedQuery` is named distinctly from the shared `GeneratedQuery`
// to avoid import-shadowing confusion for a future caller that imports both.
//
// `supportsTableSampling`-branching judgment call (TASK-BRIEF.md Objective
// section, "if you take this branching approach, disclose the exact
// fallback SQL shape used for each case"): the "random" strategy branches on
// `connector.getCapabilities().supportsTableSampling`. When `true`, it
// generates a `TABLESAMPLE SYSTEM (<percent> PERCENT)`-shaped clause --
// generic ANSI-adjacent `TABLESAMPLE` syntax supported by DuckDB, SQL
// Server, PostgreSQL, and Snowflake alike (each accepts `TABLESAMPLE
// SYSTEM (n PERCENT)` or a close syntactic variant; this is the one native
// sampling clause that is genuinely close enough to portable across all
// four platforms this project targets that hardcoding it here does not
// violate the "do not hardcode a single dialect's sampling syntax" rule --
// unlike deterministic-hash, where DuckDB/SQL-Server/Postgres hash
// functions have no common syntax at all, see below). Percent is computed
// from `options.sampleSize` divided by an estimated table size the caller
// does not supply -- rather than invent an unrequested row-count query
// (which would require this module to call `executeQuery` itself, explicitly
// prohibited), a fixed conservative default of 100 PERCENT is used as the
// TABLESAMPLE percentage argument is not reliably derivable from `sampleSize`
// alone without knowing total row count; TABLESAMPLE is therefore combined
// with an outer `LIMIT sampleSize` so the actual returned sample size is still
// governed by a concrete, disclosed LIMIT clause (itself still additive to,
// never a replacement for, the caller's maxRows) rather than left to an
// unverifiable percentage. When `supportsTableSampling` is `false`, this
// module falls back to `ORDER BY RANDOM() LIMIT <sampleSize>` (DuckDB's
// `RANDOM()`; documented per-dialect equivalents: SQL Server `NEWID()`,
// PostgreSQL/Snowflake `RANDOM()`) -- non-deterministic by design (the doc
// explicitly separates "Random sample" from "Deterministic hash sample" as
// two distinct strategies), so no reproducibility claim is made for this
// strategy, unlike deterministic-hash.
//
// Deterministic-hash SQL-side dialect disclosure (TASK-BRIEF.md: "If a truly
// platform-neutral deterministic-hash SQL expression isn't achievable
// without per-dialect branching, disclose that explicitly"): DuckDB's
// `hash(col)`, SQL Server's `HASHBYTES('MD5', ...)` (returns VARBINARY,
// needing a CONVERT to an integer-comparable form), and PostgreSQL's
// `md5(...)` (returns a hex text string, needing a hash-to-integer
// conversion for a modulus predicate) are three genuinely different,
// non-interchangeable SQL surfaces -- there is no single expression that
// runs unmodified on all three. This module is DISCLOSED as DuckDB-only for
// its literal hash-function call (`hash(<col>) % modulus = bucket`,
// DuckDB's `hash()` returns a signed 64-bit integer so `%` is a direct,
// well-defined modulus operation); a real SQL Server/PostgreSQL connector
// integration would need per-dialect hash-expression generation this module
// does not attempt (out of scope: this task is fixture-only per
// TASK-BRIEF.md's Dependencies section, "this task is fixture-only
// (FixtureConnector/DuckDB in-process). It does not need the WSL/Docker
// live-database containers"). This is the same category of disclosed
// per-dialect gap T-20's header comment makes for its own hashing approach
// -- flagged here rather than silently shipping a DuckDB-only expression
// under a general "deterministic-hash" name with no caveat.
import type { DataPlatformConnector, QueryInput } from "@paritylens/shared";

/** The six named sampling strategies from Idea Prompt.md's "Strategy A"
 * section, as a discriminated union keyed on `kind`. String literals chosen
 * to read naturally as a strategy discriminant, mirroring T-20's
 * `HashComparisonLevel` string-literal-union precedent. */
export type SamplingStrategy =
  | FirstNStrategy
  | RandomStrategy
  | DeterministicHashStrategy
  | StratifiedStrategy
  | DateWindowStrategy
  | KeyRangeStrategy;

/** "First N rows": the simplest strategy -- an ORDER-BY-free (or
 * caller-ordered) `LIMIT n`. */
export interface FirstNStrategy {
  kind: "first-n";
  /** Number of rows to select. Must be a positive integer. */
  n: number;
  /** Optional column to ORDER BY before limiting (e.g. a primary key) so
   * "first N" is deterministic across runs against an unordered table.
   * When omitted, row order is whatever the source connector/engine
   * returns unordered (DuckDB's default scan order, which is stable for a
   * static in-memory table but is NOT guaranteed by SQL semantics in
   * general -- disclosed here since first-N without an orderByColumn is
   * only as reproducible as the underlying engine's default scan order). */
  orderByColumn?: string;
}

/** "Random sample": non-deterministic sample of approximately `sampleSize`
 * rows. See this file's header comment for the `supportsTableSampling`
 * branching judgment call and the exact fallback SQL shape used for each
 * case. */
export interface RandomStrategy {
  kind: "random";
  /** Target number of rows to select. Must be a positive integer. */
  sampleSize: number;
}

/** "Deterministic hash sample": selects rows whose `keyColumn` hashes into
 * `bucket` under `modulus` (`hash(keyColumn) % modulus = bucket`),
 * reproducible across runs because the hash function and inputs are pure.
 * See this file's header comment for the disclosed DuckDB-only dialect
 * limitation. */
export interface DeterministicHashStrategy {
  kind: "deterministic-hash";
  /** Column whose value is hashed to decide sample membership. */
  keyColumn: string;
  /** Number of buckets the hash space is divided into. Must be a positive integer >= 1. */
  modulus: number;
  /** Which bucket (0-indexed, `< modulus`) selects a row into the sample. */
  bucket: number;
}

/** "Stratified sample": up to `perStratumLimit` rows per distinct value of
 * `stratifyColumn`, so every stratum is represented in the sample rather
 * than a single dominant stratum crowding out the rest. Implemented with a
 * window-function row-numbering predicate (`ROW_NUMBER() OVER (PARTITION BY
 * ... ORDER BY ...) <= perStratumLimit`), supported by DuckDB and every
 * real target dialect (SQL Server, PostgreSQL, Snowflake) alike. */
export interface StratifiedStrategy {
  kind: "stratified";
  /** Column whose distinct values define each stratum. */
  stratifyColumn: string;
  /** Maximum rows to select per distinct stratum value. Must be a positive integer. */
  perStratumLimit: number;
  /** Optional column to ORDER BY within each stratum before taking the
   * per-stratum limit (e.g. a primary key, for a deterministic "first N per
   * stratum"). Defaults to `stratifyColumn` itself when omitted, so the
   * ROW_NUMBER() window has a well-defined (if arbitrary) order rather than
   * an unspecified one. */
  orderByColumn?: string;
}

/** "Date-window sample": rows whose `dateColumn` value falls within
 * `[startDate, endDate]` inclusive. Bounds are ISO-8601 date/timestamp
 * strings (e.g. `"2024-02-01"` or `"2024-02-01 00:00:00"`), matching every
 * seeded fixture's `TIMESTAMP '...'` literal format. */
export interface DateWindowStrategy {
  kind: "date-window";
  /** Column to filter on (a date/timestamp-typed column). */
  dateColumn: string;
  /** Inclusive lower bound, ISO-8601 date or timestamp text. */
  startDate: string;
  /** Inclusive upper bound, ISO-8601 date or timestamp text. */
  endDate: string;
}

/** "Key-range sample": rows whose `keyColumn` value falls within
 * `[startKey, endKey]` inclusive. Bounds may be numeric or string
 * (string bounds are safely escaped, not interpolated raw). */
export interface KeyRangeStrategy {
  kind: "key-range";
  /** Column to filter on (typically a sortable primary/surrogate key). */
  keyColumn: string;
  /** Inclusive lower bound. */
  startKey: number | string;
  /** Inclusive upper bound. */
  endKey: number | string;
}

/** Extra, non-execution-affecting knobs a caller may supply. Deliberately
 * does NOT include anything resembling `ExecutionOptions` (`maxRows`/
 * `timeoutMs`/`signal`) -- see this file's header comment's central
 * correctness property: execution-time limits remain entirely the caller's
 * responsibility via the existing `executeQuery` contract, never something
 * this module accepts, threads, or could suppress. */
export interface SampleQueryOptions {
  /** Reserved for future use (e.g. a caller-supplied random seed for the
   * "random" strategy's non-deterministic fallback). Currently unused by
   * every strategy; included so this shape can grow without a breaking
   * signature change. Never a substitute for `ExecutionOptions`. */
  seed?: number;
}

/**
 * A generated sample query and enough metadata for a caller to understand
 * what was sampled -- per TASK-BRIEF.md's Interfaces table: "`GeneratedQuery`
 * must carry at minimum the generated SQL text (as a `QueryInput`-compatible
 * `{ kind: "query"; sql: string }` or equivalent) and enough metadata for a
 * caller to understand what was sampled (strategy used, any parameters
 * applied) -- it does NOT carry or override `ExecutionOptions`."
 *
 * Named `SampleGeneratedQuery` (not `GeneratedQuery`) to avoid colliding
 * with the unrelated `GeneratedQuery` interface already declared in
 * `packages/shared/src/connector.ts` for `buildProfileQuery`'s preview
 * shape -- a distinct, disclosed naming choice so a future caller importing
 * both is never confused about which `GeneratedQuery` it has in scope.
 */
export interface SampleGeneratedQuery {
  /** The strategy kind that produced this query, echoing `strategy.kind`. */
  strategy: SamplingStrategy["kind"];
  /** The generated SQL, in `QueryInput`-compatible `{ kind: "query"; sql }`
   * shape -- a future caller can pass `sql` directly to
   * `connector.executeQuery(sql, executionOptions)` unchanged. */
  sql: { kind: "query"; sql: string };
  /** The exact strategy parameters that were applied, echoed back for
   * caller/audit visibility (e.g. which column, which bounds, which
   * modulus/bucket). Shape varies by strategy; always a plain object of the
   * strategy's own parameter fields minus `kind`. */
  parameters: Record<string, unknown>;
}

const DEFAULT_RANDOM_TABLESAMPLE_PERCENT = 100;

/**
 * Generates SQL text implementing `strategy` against `input`, using
 * `connector.quoteIdentifier` (never a raw dialect assumption) to reference
 * columns/objects, per this file's header comment and TASK-BRIEF.md's
 * Objective section ("this module works against the connector's public
 * surface... the same pattern T-13/T-14/T-15/T-20 already established").
 *
 * Pure and synchronous: never calls `connector.executeQuery`, never touches
 * a driver, never accepts or threads `ExecutionOptions`. See this file's
 * header comment for the central correctness property this enforces.
 */
export function buildSampleQuery(
  strategy: SamplingStrategy,
  input: QueryInput,
  connector: DataPlatformConnector,
  options: SampleQueryOptions
): SampleGeneratedQuery {
  void options; // reserved, currently unused -- see `SampleQueryOptions` doc comment.
  const objectRef = resolveObjectReference(connector, input);

  switch (strategy.kind) {
    case "first-n":
      return buildFirstN(strategy, objectRef, connector);
    case "random":
      return buildRandom(strategy, objectRef, connector);
    case "deterministic-hash":
      return buildDeterministicHash(strategy, objectRef, connector);
    case "stratified":
      return buildStratified(strategy, objectRef, connector);
    case "date-window":
      return buildDateWindow(strategy, objectRef, connector);
    case "key-range":
      return buildKeyRange(strategy, objectRef, connector);
  }
}

function buildFirstN(strategy: FirstNStrategy, objectRef: string, connector: DataPlatformConnector): SampleGeneratedQuery {
  requirePositiveInteger(strategy.n, "n");
  const orderBy = strategy.orderByColumn ? ` ORDER BY ${connector.quoteIdentifier(strategy.orderByColumn)}` : "";
  const sql = `SELECT * FROM ${objectRef}${orderBy} LIMIT ${strategy.n}`;
  return {
    strategy: "first-n",
    sql: { kind: "query", sql },
    parameters: { n: strategy.n, ...(strategy.orderByColumn ? { orderByColumn: strategy.orderByColumn } : {}) },
  };
}

/**
 * `supportsTableSampling` branch: see this file's header comment for the
 * exact fallback SQL shapes.
 *   - `true`: `SELECT * FROM (<objectRef> TABLESAMPLE SYSTEM (100 PERCENT)) LIMIT <sampleSize>`
 *   - `false`: `SELECT * FROM <objectRef> ORDER BY RANDOM() LIMIT <sampleSize>`
 * Both are non-deterministic by design (this is the "Random sample"
 * strategy, distinct from "Deterministic hash sample" below).
 */
function buildRandom(strategy: RandomStrategy, objectRef: string, connector: DataPlatformConnector): SampleGeneratedQuery {
  requirePositiveInteger(strategy.sampleSize, "sampleSize");
  const capabilities = connector.getCapabilities();
  const sql = capabilities.supportsTableSampling
    ? `SELECT * FROM ${objectRef} TABLESAMPLE SYSTEM (${DEFAULT_RANDOM_TABLESAMPLE_PERCENT} PERCENT) LIMIT ${strategy.sampleSize}`
    : `SELECT * FROM ${objectRef} ORDER BY RANDOM() LIMIT ${strategy.sampleSize}`;
  return {
    strategy: "random",
    sql: { kind: "query", sql },
    parameters: { sampleSize: strategy.sampleSize, usedTableSampling: capabilities.supportsTableSampling },
  };
}

/** DuckDB-only (`hash()`); see this file's header comment's disclosed dialect limitation. */
function buildDeterministicHash(
  strategy: DeterministicHashStrategy,
  objectRef: string,
  connector: DataPlatformConnector
): SampleGeneratedQuery {
  requirePositiveInteger(strategy.modulus, "modulus");
  if (!Number.isInteger(strategy.bucket) || strategy.bucket < 0 || strategy.bucket >= strategy.modulus) {
    throw new Error(
      `buildSampleQuery: "deterministic-hash" strategy's bucket must be an integer in [0, modulus); got bucket=${strategy.bucket}, modulus=${strategy.modulus}.`
    );
  }
  const keyColumn = connector.quoteIdentifier(strategy.keyColumn);
  // DuckDB hash() returns a signed BIGINT; abs(...) before % so the bucket
  // predicate is always compared against a non-negative modulus result
  // regardless of the sign DuckDB's hash() happens to produce for a given
  // input (SQL's `%` on a negative dividend can itself be negative).
  const sql = `SELECT * FROM ${objectRef} WHERE abs(hash(${keyColumn})) % ${strategy.modulus} = ${strategy.bucket}`;
  return {
    strategy: "deterministic-hash",
    sql: { kind: "query", sql },
    parameters: { keyColumn: strategy.keyColumn, modulus: strategy.modulus, bucket: strategy.bucket },
  };
}

function buildStratified(
  strategy: StratifiedStrategy,
  objectRef: string,
  connector: DataPlatformConnector
): SampleGeneratedQuery {
  requirePositiveInteger(strategy.perStratumLimit, "perStratumLimit");
  const stratifyColumn = connector.quoteIdentifier(strategy.stratifyColumn);
  const orderColumn = connector.quoteIdentifier(strategy.orderByColumn ?? strategy.stratifyColumn);
  const sql =
    `SELECT * FROM (` +
    `SELECT *, ROW_NUMBER() OVER (PARTITION BY ${stratifyColumn} ORDER BY ${orderColumn}) AS sampling_row_number ` +
    `FROM ${objectRef}` +
    `) AS sampling_stratified WHERE sampling_row_number <= ${strategy.perStratumLimit}`;
  return {
    strategy: "stratified",
    sql: { kind: "query", sql },
    parameters: {
      stratifyColumn: strategy.stratifyColumn,
      perStratumLimit: strategy.perStratumLimit,
      orderByColumn: strategy.orderByColumn ?? strategy.stratifyColumn,
    },
  };
}

function buildDateWindow(
  strategy: DateWindowStrategy,
  objectRef: string,
  connector: DataPlatformConnector
): SampleGeneratedQuery {
  const dateColumn = connector.quoteIdentifier(strategy.dateColumn);
  const startLiteral = sqlStringLiteral(strategy.startDate);
  const endLiteral = sqlStringLiteral(strategy.endDate);
  const sql = `SELECT * FROM ${objectRef} WHERE ${dateColumn} >= TIMESTAMP ${startLiteral} AND ${dateColumn} <= TIMESTAMP ${endLiteral}`;
  return {
    strategy: "date-window",
    sql: { kind: "query", sql },
    parameters: { dateColumn: strategy.dateColumn, startDate: strategy.startDate, endDate: strategy.endDate },
  };
}

function buildKeyRange(
  strategy: KeyRangeStrategy,
  objectRef: string,
  connector: DataPlatformConnector
): SampleGeneratedQuery {
  const keyColumn = connector.quoteIdentifier(strategy.keyColumn);
  const startLiteral = sqlValueLiteral(strategy.startKey);
  const endLiteral = sqlValueLiteral(strategy.endKey);
  const sql = `SELECT * FROM ${objectRef} WHERE ${keyColumn} >= ${startLiteral} AND ${keyColumn} <= ${endLiteral}`;
  return {
    strategy: "key-range",
    sql: { kind: "query", sql },
    parameters: { keyColumn: strategy.keyColumn, startKey: strategy.startKey, endKey: strategy.endKey },
  };
}

/** Resolves a `QueryInput` to a bare object reference usable after `FROM`,
 * mirroring T-13's `buildRowCountSql`'s own `resolveObjectReference`
 * (reimplemented here rather than imported, since volume.ts is T-13's owned
 * file, out of this task's ownership -- same reasoning volume.ts itself
 * gives for not importing from profiling.ts). */
function resolveObjectReference(connector: DataPlatformConnector, input: QueryInput): string {
  if (input.kind === "table") {
    return connector.quoteIdentifier(input.object);
  }
  if (input.kind === "query") {
    return `(${input.sql.trim().replace(/;\s*$/, "")}) AS sampling_subquery`;
  }
  throw new Error(
    `buildSampleQuery does not support { kind: "sqlFile" } input directly; supply { kind: "query" } with the file's contents instead.`
  );
}

function requirePositiveInteger(value: number, fieldName: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`buildSampleQuery: "${fieldName}" must be a positive integer; got ${value}.`);
  }
}

/**
 * Safely escapes a string value for embedding as a SQL string literal
 * (single-quote doubling, the standard SQL escaping rule -- same technique
 * `statement-safety.ts`'s own literal-stripping scanner treats as the
 * canonical escaped-quote form: `''` inside a `'...'`-delimited literal).
 * Column/table identifiers are never passed through this function -- those
 * always go through `connector.quoteIdentifier` instead, per this file's
 * "do not hardcode a single dialect's sampling syntax" rule and
 * TASK-BRIEF.md's adversarial-injection review requirement (a
 * stratification/date/key-range parameter used as an *identifier* is quoted
 * via `quoteIdentifier`; a parameter used as a *value* is escaped via this
 * function -- neither is ever interpolated raw).
 */
function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Emits a numeric literal unquoted (safe -- `Number` cannot carry SQL
 * syntax) or a safely-escaped string literal via `sqlStringLiteral`. Used
 * for key-range bounds, which may legitimately be either. */
function sqlValueLiteral(value: number | string): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`buildSampleQuery: key-range bound must be a finite number; got ${value}.`);
    }
    return String(value);
  }
  return sqlStringLiteral(value);
}
