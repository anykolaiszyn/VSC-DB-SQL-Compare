// DataPlatformConnector and supporting connector-facing types, translated
// verbatim (interface names, method signatures, capability flags) from
// Idea Prompt.md section 9 ("Connector Architecture").
import type { ColumnDefinition, ExecutionOptions, QueryInput, RecordBatch } from "./types.js";

/** Result of `DataPlatformConnector.testConnection()`. */
export interface ConnectionTestResult {
  success: boolean;
  /** Human-readable detail, e.g. an error message when `success` is false. */
  message?: string;
  /** Round-trip latency of the test connection, in milliseconds. */
  latencyMs?: number;
}

/** A catalog (top-level namespace) reported by `getCatalogs()`. */
export interface CatalogInfo {
  name: string;
}

/** A schema (namespace within a catalog) reported by `getSchemas()`. */
export interface SchemaInfo {
  name: string;
  catalog?: string;
}

/**
 * Scope used to narrow `getObjects()` — which catalog/schema to list
 * tables, views, and other queryable objects within.
 */
export interface ObjectScope {
  catalog?: string;
  schema?: string;
}

/** Kind of queryable object reported by `getObjects()`. */
export type DataObjectKind = "table" | "view" | "other";

/** A single queryable object (table/view/etc.) reported by `getObjects()`. */
export interface DataObjectInfo {
  name: string;
  kind: DataObjectKind;
  catalog?: string;
  schema?: string;
}

/**
 * Options controlling profile-query generation, passed to
 * `buildProfileQuery()`. Mirrors the general/string/numeric/date/boolean
 * metrics families described in Idea Prompt.md "Layer 4: Data Profiling".
 *
 * Judgment call: kept intentionally small (which columns to profile, how
 * many top/common values to compute, and whether to prefer an
 * approximate-distinct pushdown) since the full profiling metric catalog is
 * T-07's concern, not this task's. This shape only needs to exist so
 * `buildProfileQuery()` type-checks; T-07 may extend it.
 */
export interface ProfileOptions {
  /** Number of most-common values to compute per column, where applicable. */
  topValueCount?: number;
  /** Prefer an approximate-distinct pushdown when the connector supports it. */
  useApproximateDistinct?: boolean;
}

/** A generated SQL statement plus its bound parameters, shown to the user
 * for preview before execution (Idea Prompt.md section 10). */
export interface GeneratedQuery {
  sql: string;
  parameters: unknown[];
}

/**
 * Capabilities a connector declares about the platform it talks to, so the
 * Comparison Core does not force every platform into identical execution
 * mechanics (Idea Prompt.md section 9).
 */
export interface ConnectorCapabilities {
  supportsApproximateDistinct: boolean;
  supportsNativeHashing: boolean;
  supportsTableSampling: boolean;
  supportsQueryCancellation: boolean;
  supportsArrowResults: boolean;
  supportsInformationSchema: boolean;
  supportsTemporaryTables: boolean;
  supportsServerSideProfiling: boolean;
  maximumParameters?: number;
}

/**
 * The common contract every data-platform connector (SQL Server, Snowflake,
 * PostgreSQL, and the DuckDB-backed Fixture connector) implements, per Idea
 * Prompt.md section 9. No implementation lives in this package — this is
 * the interface real and fixture connectors (T-04, T-17, T-18, T-19)
 * implement, and the statement-safety parser (T-03) wraps.
 */
export interface DataPlatformConnector {
  testConnection(): Promise<ConnectionTestResult>;

  getCatalogs(): Promise<CatalogInfo[]>;
  getSchemas(catalog?: string): Promise<SchemaInfo[]>;
  getObjects(scope: ObjectScope): Promise<DataObjectInfo[]>;

  getSchema(input: QueryInput): Promise<ColumnDefinition[]>;

  executeQuery(input: QueryInput, options: ExecutionOptions): AsyncIterable<RecordBatch>;

  getCapabilities(): ConnectorCapabilities;

  quoteIdentifier(identifier: string): string;

  buildProfileQuery(
    input: QueryInput,
    columns: ColumnDefinition[],
    profileOptions: ProfileOptions
  ): GeneratedQuery;
}
