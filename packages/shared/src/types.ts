// Canonical type-category enum (Idea Prompt.md section 2, Layer 2:
// Structural Parity). Exactly these 15 values allow native platform types
// (INT, NUMBER(38,0), BIGINT, etc.) to be compared intelligently rather than
// merely matching type names.
export type CanonicalTypeCategory =
  | "Integer"
  | "Decimal"
  | "FloatingPoint"
  | "Boolean"
  | "String"
  | "Binary"
  | "Date"
  | "Time"
  | "Timestamp"
  | "TimestampWithTimezone"
  | "JSON"
  | "Array"
  | "Object"
  | "Geospatial"
  | "Unknown";

/**
 * A single column's structural metadata, as reported by a connector's
 * `getSchema()` and consumed by the canonical type-mapping layer (T-05),
 * schema diff (T-06), profiling (T-07), and column mapping (T-12).
 *
 * Judgment call: only the fields explicitly required by the task brief
 * (native type, canonical type, length, precision, scale, nullability,
 * name, ordinal position, primary-key-candidate flag) are included here.
 * Idea Prompt.md section 2 also lists partition columns, default values,
 * and collation/case-sensitivity behavior as comparison targets, but those
 * are left for the schema-diff task (T-06) to add if/when it needs them,
 * to avoid over-specifying a shape this task doesn't consume.
 */
export interface ColumnDefinition {
  /** Column name as reported by the source platform. */
  name: string;
  /** 1-based ordinal position of the column within its object/result set. */
  ordinalPosition: number;
  /** Platform-native type string, e.g. "NUMBER(38,0)", "VARCHAR(255)". */
  nativeType: string;
  /** Normalized category from the canonical type system. */
  canonicalType: CanonicalTypeCategory;
  /** Whether the column allows NULL values. */
  nullable: boolean;
  /**
   * Whether this column is a candidate for use as (part of) a matching key
   * in row-level comparison — derived from primary-key metadata where the
   * platform exposes it, or heuristically otherwise.
   */
  isPrimaryKeyCandidate: boolean;
  /** Declared character/byte length, where applicable (e.g. VARCHAR(255) -> 255). */
  length?: number;
  /** Declared numeric precision, where applicable (e.g. NUMBER(38,0) -> 38). */
  precision?: number;
  /** Declared numeric scale, where applicable (e.g. NUMBER(38,2) -> 2). */
  scale?: number;
}

/**
 * Identifies what a connector should read: a table/view/object reference, a
 * literal query string, or a SQL file — the three MVP input types from Idea
 * Prompt.md section 14 ("MVP inputs": table vs table, query vs query, SQL
 * file vs SQL file).
 *
 * Judgment call: modeled as a discriminated union on `kind` so downstream
 * consumers (statement-safety parser in T-03, connectors in T-04/T-17-19)
 * can exhaustively switch over the three MVP shapes without ambiguity about
 * which fields apply.
 */
export type QueryInput =
  | { kind: "table"; object: string }
  | { kind: "query"; sql: string }
  | { kind: "sqlFile"; filePath: string };

/**
 * Execution controls applied to a connector's `executeQuery()` call,
 * enforcing the safety limits described in DESIGN-SPEC.md ("Read-only
 * systems": default row cap and query timeout, both overridable).
 *
 * Judgment call: kept minimal — only the two limits explicitly named in the
 * design spec plus an optional cancellation signal, since richer execution
 * controls (e.g. fetch size, isolation level) are not called for by this
 * task's consumers.
 */
export interface ExecutionOptions {
  /** Maximum number of rows the connector should return before stopping. */
  maxRows: number;
  /** Query timeout in milliseconds. */
  timeoutMs: number;
  /** Optional abort signal allowing the caller to cancel a running query. */
  signal?: AbortSignal;
}

/**
 * A batch of query result rows returned by `executeQuery()`.
 *
 * Judgment call: represented in row-oriented columnar form (a shared
 * `columns` name list plus an array of row-value tuples) rather than a true
 * Apache Arrow `RecordBatch`. Idea Prompt.md section 8 recommends Arrow as
 * "the preferred internal transfer format where drivers support it," but
 * that is a later engine-level optimization (see
 * `ConnectorCapabilities.supportsArrowResults`, which lets a connector
 * advertise Arrow support). This shared-types package intentionally stays
 * dependency-free (no `apache-arrow` import) and defines the row-oriented
 * shape every connector can produce regardless of driver capability; a
 * connector that does support Arrow can still convert to this shape (or a
 * future `ArrowRecordBatch` variant can be added without breaking this one).
 */
export interface RecordBatch {
  /** Ordered column names for this batch. */
  columns: string[];
  /** Row values, each row's values ordered to match `columns`. */
  rows: unknown[][];
  /** Number of rows in this batch. */
  rowCount: number;
}
