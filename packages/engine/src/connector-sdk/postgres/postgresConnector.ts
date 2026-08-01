// PostgresConnector (T-19): a `DataPlatformConnector` (@paritylens/shared)
// implementation backed by the `pg` package, talking to a real PostgreSQL
// instance -- mirrors T-17's `SqlServerConnector` structure deliberately
// (read that file for the established pattern; this file does not import
// from it, per TASK-BRIEF.md's Files owned/Prohibited changes sections):
// lazy connection-pool creation reused for the lifetime of the instance,
// `assertReadOnlyStatement` called on every SQL string -- both
// caller-supplied and connector-generated -- before it reaches the driver,
// and the same `getSchema`/`executeQuery`/`buildProfileQuery` method shapes.
//
// Constructed from an explicit options object (host/port/user/password/
// database), never a bare connection string with credentials embedded in
// source, per TASK-BRIEF.md's Interfaces table and AGENTS.md's
// no-inline-credentials rule. Credentials are supplied by the caller at
// construction time (from VS Code SecretStorage, environment variables, or
// equivalent) -- this module never reads environment variables itself or
// hardcodes any credential.
//
// M-06 (carried-forward finding, T-03 review): PostgreSQL dollar-quoted
// strings (`$$...$$`, or tagged `$tag$...$tag$`) are not recognized as
// string literals by `assertReadOnlyStatement` (T-03, off-limits to edit
// here) -- only single/double-quoted literals and bracketed identifiers are
// stripped there. An apostrophe inside a dollar-quoted body desyncs that
// scanner's single-quote literal tracking, so
// `SELECT $$it's fine$$ AS x; DROP TABLE y;` was demonstrated by the T-03
// reviewer not to throw for the "postgres" dialect. This connector resolves
// M-06 with option (a) from the brief: connector-level hardening that
// detects and rejects any dollar-quoted content itself, before the SQL
// reaches `assertReadOnlyStatement` or the `pg` driver, via
// `rejectDollarQuoting` below -- mirroring T-17's `rejectGoBatchSeparator`
// pattern for M-05. This is deliberate defense-in-depth: dollar-quoting is a
// genuine, commonly-used PostgreSQL feature (function bodies, literal
// strings containing quotes) that a real caller might reasonably supply, so
// rather than attempting to safely tokenize it here (which would duplicate
// a meaningful slice of `assertReadOnlyStatement`'s own literal-stripping
// logic, outside this task's file ownership), this connector conservatively
// rejects any statement containing a dollar-quote delimiter outright. A
// legitimate caller needing dollar-quoted SQL (e.g. defining a function) is
// not a supported use case for the read-only comparison queries this
// connector executes.
import { Pool, type PoolConfig } from "pg";
import type {
  CatalogInfo,
  ColumnDefinition,
  ConnectionTestResult,
  ConnectorCapabilities,
  DataObjectInfo,
  DataPlatformConnector,
  ExecutionOptions,
  GeneratedQuery,
  ObjectScope,
  ProfileOptions,
  QueryInput,
  RecordBatch,
  SchemaInfo,
} from "@paritylens/shared";
import { assertReadOnlyStatement, type SqlDialect } from "../safety/statement-safety.js";
import { mapNativeType } from "../../comparison-core/type-mapping/type-mapping.js";

/** Dialect PostgresConnector reports to `assertReadOnlyStatement`. */
const POSTGRES_DIALECT: SqlDialect = "postgres";

/**
 * Connection details for `PostgresConnector`. Deliberately an explicit
 * options object (not a bare connection string) so no credential can be
 * accidentally embedded in a single opaque string passed around/logged as
 * one unit -- matching the Interfaces table's "constructed from connection
 * details ... rather than a bare connection string with inline credentials
 * embedded in source" requirement. The caller is responsible for sourcing
 * `password` from VS Code SecretStorage/environment variables/an
 * equivalent secret store; this connector only holds it in memory for the
 * lifetime of the connection pool.
 */
export interface PostgresConnectionOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /**
   * Whether to require TLS for the connection. Defaults to `false` (plain
   * connection), matching the local Docker test container, which does not
   * present a certificate. A caller targeting a production PostgreSQL
   * instance should opt into this explicitly.
   */
  ssl?: boolean;
  /** Connection/statement timeout in milliseconds. Defaults to 15000. */
  connectTimeoutMs?: number;
}

/**
 * `DataPlatformConnector` implementation backed by a real PostgreSQL
 * instance via the `pg` package (node-postgres).
 *
 * Judgment call: `getCatalogs`/`getSchemas`/`getObjects` are the parts of
 * the interface this connector queries live from `pg_catalog.pg_database`/
 * `information_schema.schemata`/`information_schema.tables` respectively --
 * unlike `FixtureConnector`, which hardcodes a single in-memory "database"
 * -- since a real server genuinely has multiple databases/schemas/objects
 * and the brief's Interfaces table requires every method implemented
 * against a real instance, not stubbed. Mirrors T-17's same judgment call
 * for SqlServerConnector.
 */
export class PostgresConnector implements DataPlatformConnector {
  private readonly options: PostgresConnectionOptions;
  private poolPromise: Promise<Pool> | undefined;

  constructor(options: PostgresConnectionOptions) {
    this.options = options;
  }

  /** Lazily creates a pooled `pg` connection, reused for the lifetime of
   * this connector instance. `pg.Pool` connects lazily on first query, so
   * this does not itself prove connectivity -- `testConnection()` issues a
   * real round-trip query for that. */
  private async getPool(): Promise<Pool> {
    if (!this.poolPromise) {
      this.poolPromise = this.createPool();
    }
    return this.poolPromise;
  }

  private async createPool(): Promise<Pool> {
    const config: PoolConfig = {
      host: this.options.host,
      port: this.options.port,
      user: this.options.user,
      password: this.options.password,
      database: this.options.database,
      connectionTimeoutMillis: this.options.connectTimeoutMs ?? 15000,
      statement_timeout: this.options.connectTimeoutMs ?? 15000,
      ssl: this.options.ssl ?? false,
    };
    return new Pool(config);
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const pool = await this.getPool();
      await pool.query("SELECT 1 AS ok");
      return { success: true, latencyMs: Date.now() - start };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - start,
      };
    }
  }

  async getCatalogs(): Promise<CatalogInfo[]> {
    const pool = await this.getPool();
    // Lists every database visible via `pg_catalog.pg_database`, including
    // template databases -- unlike an earlier draft that excluded
    // `datistemplate`, since a caller may legitimately be connected to a
    // system database, mirroring T-17's `getCatalogs` judgment call (no
    // exclusion of system databases; this is read-only catalog metadata,
    // not a security boundary decision).
    const querySql = "SELECT datname AS name FROM pg_catalog.pg_database ORDER BY datname";
    assertReadOnlyStatement(querySql, POSTGRES_DIALECT);
    const result = await pool.query<{ name: string }>(querySql);
    return result.rows.map((row) => ({ name: row.name }));
  }

  async getSchemas(catalog?: string): Promise<SchemaInfo[]> {
    void catalog; // The connection is already scoped to one database at construction time.
    const pool = await this.getPool();
    const querySql = "SELECT schema_name AS name FROM information_schema.schemata ORDER BY schema_name";
    assertReadOnlyStatement(querySql, POSTGRES_DIALECT);
    const result = await pool.query<{ name: string }>(querySql);
    return result.rows.map((row) => ({ name: row.name, catalog: this.options.database }));
  }

  async getObjects(scope: ObjectScope): Promise<DataObjectInfo[]> {
    const pool = await this.getPool();
    const conditions: string[] = [];
    const params: string[] = [];
    if (scope.schema) {
      params.push(scope.schema);
      conditions.push(`table_schema = $${params.length}`);
    }
    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
    const querySql =
      "SELECT table_name AS name, table_schema AS table_schema, table_type AS table_type " +
      `FROM information_schema.tables${whereClause} ORDER BY table_schema, table_name`;
    assertReadOnlyStatement(querySql, POSTGRES_DIALECT);
    const result = await pool.query<{ name: string; table_schema: string; table_type: string }>(
      querySql,
      params
    );
    return result.rows.map((row) => ({
      name: row.name,
      kind: row.table_type === "VIEW" ? "view" : row.table_type === "BASE TABLE" ? "table" : "other",
      catalog: scope.catalog ?? this.options.database,
      schema: row.table_schema,
    }));
  }

  async getSchema(input: QueryInput): Promise<ColumnDefinition[]> {
    const pool = await this.getPool();

    if (input.kind === "table") {
      const { schemaName, tableName } = parseObjectRef(input.object);
      const params: string[] = [tableName];
      const conditions = ["table_name = $1"];
      if (schemaName) {
        params.push(schemaName);
        conditions.push(`table_schema = $${params.length}`);
      }
      const querySql =
        "SELECT column_name AS column_name, ordinal_position AS ordinal_position, " +
        "data_type AS data_type, is_nullable AS is_nullable, " +
        "character_maximum_length AS char_max_length, numeric_precision AS numeric_precision, " +
        "numeric_scale AS numeric_scale " +
        `FROM information_schema.columns WHERE ${conditions.join(" AND ")} ORDER BY ordinal_position`;
      assertReadOnlyStatement(querySql, POSTGRES_DIALECT);
      const result = await pool.query<InformationSchemaColumnRow>(querySql, params);
      if (result.rows.length === 0) {
        throw new Error(
          `PostgresConnector.getSchema: no columns found for table "${input.object}" -- table may not exist or is not visible to the connected user`
        );
      }
      const primaryKeyColumns = await this.getPrimaryKeyColumns(pool, schemaName, tableName);
      return result.rows.map((row) => toColumnDefinition(row, primaryKeyColumns));
    }

    // { kind: "query" } / { kind: "sqlFile" }: describe the shape of an
    // arbitrary result set by running it capped to zero rows (LIMIT 0), then
    // reading column metadata from the driver's own `RowDescription`
    // (`result.fields`) rather than information_schema (which only knows
    // about persisted tables/views, not ad hoc query shapes) -- mirrors
    // T-17's `getSchema` judgment call for the same input kinds.
    const querySql = this.resolveExecutableSql(input);
    assertReadOnlyStatement(querySql, POSTGRES_DIALECT);
    rejectDollarQuoting(querySql);
    const wrapped = `SELECT * FROM (${stripTrailingSemicolon(querySql)}) AS postgres_shape LIMIT 0`;
    assertReadOnlyStatement(wrapped, POSTGRES_DIALECT);
    const result = await pool.query(wrapped);
    return result.fields.map((field, index) => {
      const nativeType = pgTypeOidToNativeTypeName(field.dataTypeID);
      return {
        name: field.name,
        ordinalPosition: index + 1,
        nativeType,
        canonicalType: mapNativeType(nativeType, POSTGRES_DIALECT),
        nullable: true, // Driver field metadata does not expose nullability for ad hoc queries.
        isPrimaryKeyCandidate: false,
      } satisfies ColumnDefinition;
    });
  }

  /** Reads primary-key column names for a table via
   * `information_schema.table_constraints`/`key_column_usage`, used to set
   * `ColumnDefinition.isPrimaryKeyCandidate` from real metadata rather than
   * the name-heuristic `FixtureConnector` uses (a real server has this
   * metadata available). Mirrors T-17's `getPrimaryKeyColumns`. */
  private async getPrimaryKeyColumns(
    pool: Pool,
    schemaName: string | undefined,
    tableName: string
  ): Promise<Set<string>> {
    const params: string[] = [tableName];
    const conditions = ["tc.table_name = $1", "tc.constraint_type = 'PRIMARY KEY'"];
    if (schemaName) {
      params.push(schemaName);
      conditions.push(`tc.table_schema = $${params.length}`);
    }
    const querySql =
      "SELECT kcu.column_name AS column_name " +
      "FROM information_schema.table_constraints tc " +
      "JOIN information_schema.key_column_usage kcu " +
      "ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema " +
      `WHERE ${conditions.join(" AND ")}`;
    assertReadOnlyStatement(querySql, POSTGRES_DIALECT);
    const result = await pool.query<{ column_name: string }>(querySql, params);
    return new Set(result.rows.map((row) => row.column_name));
  }

  async *executeQuery(input: QueryInput, options: ExecutionOptions): AsyncIterable<RecordBatch> {
    const pool = await this.getPool();
    const querySql = this.resolveExecutableSql(input);

    // M-06 hardening: reject dollar-quoted content before the SQL reaches
    // the safety parser or the driver -- see this file's header comment.
    rejectDollarQuoting(querySql);

    // Defense in depth (matches FixtureConnector's/SqlServerConnector's
    // pattern exactly): every statement is checked before it reaches the
    // driver, whether supplied directly by the caller
    // ({ kind: "query" }/{ kind: "sqlFile" }) or generated by this
    // connector itself ({ kind: "table" } -> SELECT).
    assertReadOnlyStatement(querySql, POSTGRES_DIALECT);

    const signal = options.signal as unknown as { aborted?: boolean } | undefined;
    if (signal?.aborted) {
      return;
    }

    const cappedSql = buildRowCappedSql(querySql, options.maxRows);
    // The row cap is applied via a validated integer LIMIT clause built from
    // `options.maxRows` (a number, never user-controlled string
    // interpolation), so it is not a SQL-injection surface distinct from
    // the underlying query text itself, which has already been checked
    // above via `assertReadOnlyStatement`.
    assertReadOnlyStatement(cappedSql, POSTGRES_DIALECT);

    const result = await pool.query(cappedSql);
    const columns = result.fields.map((f) => f.name);

    if (result.rows.length === 0) {
      yield { columns, rows: [], rowCount: 0 };
      return;
    }

    const rowTuples = result.rows.map((row) =>
      columns.map((col) => (row as Record<string, unknown>)[col])
    );
    yield { columns, rows: rowTuples, rowCount: rowTuples.length };
  }

  getCapabilities(): ConnectorCapabilities {
    return {
      supportsApproximateDistinct: false,
      supportsNativeHashing: true,
      supportsTableSampling: true,
      supportsQueryCancellation: true,
      supportsArrowResults: false,
      supportsInformationSchema: true,
      supportsTemporaryTables: true,
      supportsServerSideProfiling: true,
      maximumParameters: 65535,
    };
  }

  quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  buildProfileQuery(
    input: QueryInput,
    columns: ColumnDefinition[],
    profileOptions: ProfileOptions
  ): GeneratedQuery {
    void profileOptions;
    const objectRef = this.resolveObjectReference(input);
    // `total_count` is emitted exactly once, matching T-17's own fix for
    // the identical duplicate-output-column-name problem (DuckDB tolerates
    // it; SQL Server rejects it) -- PostgreSQL also rejects a result set
    // with duplicate output column names ("column reference \"total_count\"
    // is ambiguous" / duplicate RTE alias issues in some shapes), so the
    // same fix is applied here proactively rather than rediscovering it via
    // a live-server failure, since the underlying cause (duplicate output
    // column aliases) is dialect-independent.
    const perColumnAggregates = columns.map((column) => {
      const quoted = this.quoteIdentifier(column.name);
      return (
        `COUNT(${quoted}) AS non_null_count_${sanitizeAlias(column.name)}, ` +
        `COUNT(DISTINCT ${quoted}) AS distinct_count_${sanitizeAlias(column.name)}`
      );
    });
    const sqlText = `SELECT COUNT(*) AS total_count, ${perColumnAggregates.join(", ")} FROM ${objectRef}`;
    return { sql: sqlText, parameters: [] };
  }

  /** Resolves a `QueryInput` to a bare object reference usable after
   * `FROM`, for `buildProfileQuery`. `{ kind: "table" }` uses the
   * caller-supplied object name directly (quoted, schema-qualified where
   * given); `{ kind: "query" }` and `{ kind: "sqlFile" }` are wrapped as a
   * derived-table subquery. */
  private resolveObjectReference(input: QueryInput): string {
    if (input.kind === "table") {
      return quoteObjectRef(input.object, this);
    }
    const sqlText = this.resolveExecutableSql(input);
    return `(${stripTrailingSemicolon(sqlText)}) AS postgres_object`;
  }

  /** Resolves a `QueryInput` to the executable SQL string that
   * `executeQuery`/`getSchema` should run (before safety-checking and
   * row-capping). */
  private resolveExecutableSql(input: QueryInput): string {
    switch (input.kind) {
      case "table":
        return `SELECT * FROM ${quoteObjectRef(input.object, this)}`;
      case "query":
        return input.sql;
      case "sqlFile":
        throw new Error(
          `PostgresConnector does not read SQL files from disk (kind: "sqlFile", path: "${input.filePath}"); ` +
            "supply { kind: \"query\" } with the file's contents instead."
        );
    }
  }
}

interface InformationSchemaColumnRow {
  column_name: string;
  ordinal_position: number;
  data_type: string;
  is_nullable: string;
  char_max_length: number | null;
  numeric_precision: number | null;
  numeric_scale: number | null;
}

function toColumnDefinition(
  row: InformationSchemaColumnRow,
  primaryKeyColumns: Set<string>
): ColumnDefinition {
  return {
    name: row.column_name,
    ordinalPosition: row.ordinal_position,
    nativeType: row.data_type,
    canonicalType: mapNativeType(row.data_type, POSTGRES_DIALECT),
    nullable: row.is_nullable.toUpperCase() !== "NO",
    isPrimaryKeyCandidate: primaryKeyColumns.has(row.column_name),
    ...(row.char_max_length !== null && row.char_max_length >= 0 ? { length: row.char_max_length } : {}),
    ...(row.numeric_precision !== null ? { precision: row.numeric_precision } : {}),
    ...(row.numeric_scale !== null ? { scale: row.numeric_scale } : {}),
  } satisfies ColumnDefinition;
}

/** Splits a possibly schema-qualified object name ("public.customer_source"
 * or "customer_source") into its schema and bare table name parts. */
function parseObjectRef(object: string): { schemaName?: string; tableName: string } {
  const parts = object.split(".");
  if (parts.length >= 2) {
    return {
      schemaName: parts[parts.length - 2] as string,
      tableName: parts[parts.length - 1] as string,
    };
  }
  return { tableName: object };
}

function quoteObjectRef(object: string, connector: { quoteIdentifier(id: string): string }): string {
  const { schemaName, tableName } = parseObjectRef(object);
  return schemaName
    ? `${connector.quoteIdentifier(schemaName)}.${connector.quoteIdentifier(tableName)}`
    : connector.quoteIdentifier(tableName);
}

function sanitizeAlias(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
}

function stripTrailingSemicolon(sqlText: string): string {
  return sqlText.trim().replace(/;\s*$/, "");
}

/**
 * Builds a `SELECT * FROM (<sql>) AS alias LIMIT n` row-capping wrapper
 * around an arbitrary caller-supplied or connector-generated SELECT.
 *
 * Unlike SQL Server's `TOP`, PostgreSQL's `LIMIT` is a clause on the outer
 * query, not an in-list modifier, and (unlike SQL Server) PostgreSQL
 * permits a bare `ORDER BY` inside a derived table/subquery without any
 * special accommodation -- so, unlike T-17's `buildRowCappedSql`, no
 * ORDER-BY-detection heuristic is needed here; the naive wrap-and-append
 * form is valid PostgreSQL syntax for every input shape this connector
 * needs to support. This asymmetry with SQL Server (documented in T-17's
 * `IMPLEMENTATION-REPORT.md` as a live-server-discovered bug) is exactly
 * the kind of per-dialect surprise TASK-BRIEF.md's dispatch prompt warned
 * to watch for -- confirmed directly against the live PostgreSQL 16
 * container by this task's own `{ kind: 'query' }` + `ORDER BY` test case
 * passing without any such wrapper logic.
 */
function buildRowCappedSql(sqlText: string, maxRows: number): string {
  const stripped = stripTrailingSemicolon(sqlText);
  return `SELECT * FROM (${stripped}) AS postgres_query LIMIT ${maxRows}`;
}

/**
 * M-06 hardening: rejects any statement containing a PostgreSQL
 * dollar-quote delimiter (`$$` or a tagged `$tag$`), before the SQL reaches
 * `assertReadOnlyStatement` or the `pg` driver. See this file's header
 * comment for the full rationale. Matches `$$` or `$<identifier-chars>$`
 * (PostgreSQL's own tag-character rules: a tag is any sequence of letters,
 * digits, and underscores, not starting with a digit -- same identifier
 * rules as an unquoted SQL identifier) anywhere in the statement, not just
 * at a leading position, since dollar-quoting can appear anywhere a string
 * literal is valid.
 */
function rejectDollarQuoting(sqlText: string): void {
  const DOLLAR_QUOTE_DELIMITER = /\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/;
  if (DOLLAR_QUOTE_DELIMITER.test(sqlText)) {
    throw new Error(
      "PostgresConnector rejected a statement containing a dollar-quote delimiter " +
        '("$$" or a tagged "$tag$"): dollar-quoted content is not supported through ' +
        "executeQuery()/getSchema() because it is not safely tokenized as a string " +
        "literal by assertReadOnlyStatement(); supply a query without dollar-quoting. " +
        "(M-06 hardening)"
    );
  }
}

/** Best-effort mapping from `pg`'s reported column type OID (exposed via
 * `result.fields[i].dataTypeID`) back to a native PostgreSQL type name
 * string, for the `{ kind: "query" }`/`{ kind: "sqlFile" }` getSchema path
 * where information_schema is not available (an ad hoc query has no
 * persisted column metadata). Falls back to "unknown" (an "Unknown"-mapping
 * native type per T-05) for any OID not in this table, rather than
 * throwing -- consistent with `mapNativeType`'s own documented never-throw
 * fallback contract. OIDs are PostgreSQL's own stable, built-in type OIDs
 * (see `pg_type` catalog / `pg-types` package's well-known constants), not
 * connector-specific. */
function pgTypeOidToNativeTypeName(oid: number): string {
  switch (oid) {
    case 16:
      return "boolean";
    case 20:
      return "bigint";
    case 21:
      return "smallint";
    case 23:
      return "integer";
    case 700:
      return "real";
    case 701:
      return "double precision";
    case 1700:
      return "numeric";
    case 18:
      return "char";
    case 25:
      return "text";
    case 1042:
      return "bpchar";
    case 1043:
      return "varchar";
    case 1082:
      return "date";
    case 1083:
      return "time";
    case 1114:
      return "timestamp";
    case 1184:
      return "timestamptz";
    case 2950:
      return "uuid";
    case 17:
      return "bytea";
    default:
      return "unknown";
  }
}
