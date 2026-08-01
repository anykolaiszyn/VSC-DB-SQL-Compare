// SqlServerConnector (T-17): a `DataPlatformConnector` (@paritylens/shared)
// implementation backed by the `mssql` package (Tedious driver), talking to
// a real SQL Server instance -- the project's first connector against an
// actual database server rather than DuckDB (contrast with T-04's
// `FixtureConnector`, whose header comment this implementation's structure
// deliberately mirrors: lazy connection-pool creation reused for the
// lifetime of the instance, `assertReadOnlyStatement` called on every SQL
// string -- both caller-supplied and connector-generated -- before it
// reaches the driver, and the same `getSchema`/`executeQuery`/
// `buildProfileQuery` method shapes).
//
// Constructed from an explicit options object (host/port/user/password/
// database), never a bare connection string with credentials embedded in
// source, per TASK-BRIEF.md's Interfaces table and AGENTS.md's
// no-inline-credentials rule. Credentials are supplied by the caller at
// construction time (from VS Code SecretStorage, environment variables, or
// equivalent) -- this module never reads environment variables itself or
// hardcodes any credential.
//
// M-05 (carried-forward finding, T-03 review): SQL Server's `GO` batch
// separator is not a T-SQL keyword -- it is a client-tool-only convention
// (sqlcmd/SSMS) that splits a script into separately-executed batches
// before any of it reaches the server. `assertReadOnlyStatement` (T-03,
// off-limits to edit here) does not recognize it as a statement boundary,
// so `SELECT 1\nGO\nDROP TABLE x` was demonstrated not to throw for the
// "sqlserver" dialect. This connector resolves M-05 with option (a) from
// the brief: connector-level hardening that rejects any `GO` batch
// separator itself, before the SQL reaches `assertReadOnlyStatement` or the
// `mssql` driver, via `rejectGoBatchSeparator` below. This is deliberate
// defense-in-depth, not reliance on the `mssql` driver's own behavior --
// `mssql`/Tedious execute whatever T-SQL text is handed to `request.query()`
// as a single batch and do not special-case `GO` themselves (it is not a
// real T-SQL token), so passing a `GO`-containing string through would
// either error out mid-parse against SQL Server itself, or -- worse, if a
// future SQL Server version's parser tolerated it silently -- run whatever
// followed with no safety-parser coverage at all. Rejecting it explicitly
// closes the gap instead of depending on that being permanently true.
import * as sql from "mssql";
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

/** Dialect SqlServerConnector reports to `assertReadOnlyStatement`. */
const SQLSERVER_DIALECT: SqlDialect = "sqlserver";

/**
 * Connection details for `SqlServerConnector`. Deliberately an explicit
 * options object (not a bare connection string) so no credential can be
 * accidentally embedded in a single opaque string passed around/logged as
 * one unit -- matching the Interfaces table's "constructed from connection
 * details ... rather than a bare connection string with inline credentials
 * embedded in source" requirement. The caller is responsible for sourcing
 * `password` from VS Code SecretStorage/environment variables/an
 * equivalent secret store; this connector only holds it in memory for the
 * lifetime of the connection pool.
 */
export interface SqlServerConnectionOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /**
   * Whether to trust a self-signed/untrusted TLS certificate (e.g. a local
   * Docker test container). Defaults to `false`; must be explicitly opted
   * into by the caller for non-production targets.
   */
  trustServerCertificate?: boolean;
  /** Connection/request timeout in milliseconds. Defaults to 15000. */
  connectTimeoutMs?: number;
}

/**
 * `DataPlatformConnector` implementation backed by a real SQL Server
 * instance via the `mssql` package (Tedious driver under the hood).
 *
 * Judgment call: `getCatalogs`/`getSchemas`/`getObjects` are the parts of
 * the interface this connector queries live from `sys.databases`/
 * `INFORMATION_SCHEMA.SCHEMATA`/`INFORMATION_SCHEMA.TABLES` respectively --
 * unlike `FixtureConnector`, which hardcodes a single in-memory "database"
 * -- since a real server genuinely has multiple databases/schemas/objects
 * and the brief's Interfaces table requires every method implemented
 * against a real instance, not stubbed.
 */
export class SqlServerConnector implements DataPlatformConnector {
  private readonly options: SqlServerConnectionOptions;
  private poolPromise: Promise<sql.ConnectionPool> | undefined;

  constructor(options: SqlServerConnectionOptions) {
    this.options = options;
  }

  /** Lazily creates and connects a pooled `mssql` connection, reused for
   * the lifetime of this connector instance. */
  private async getPool(): Promise<sql.ConnectionPool> {
    if (!this.poolPromise) {
      this.poolPromise = this.createPool();
    }
    return this.poolPromise;
  }

  private async createPool(): Promise<sql.ConnectionPool> {
    const config: sql.config = {
      server: this.options.host,
      port: this.options.port,
      user: this.options.user,
      password: this.options.password,
      database: this.options.database,
      connectionTimeout: this.options.connectTimeoutMs ?? 15000,
      requestTimeout: this.options.connectTimeoutMs ?? 15000,
      options: {
        trustServerCertificate: this.options.trustServerCertificate ?? false,
        encrypt: true,
      },
    };
    const pool = new sql.ConnectionPool(config);
    await pool.connect();
    return pool;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const pool = await this.getPool();
      await pool.request().query("SELECT 1 AS ok");
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
    // Lists every database visible to the connected login, including the
    // four built-in system databases (master/tempdb/model/msdb) -- unlike
    // an earlier draft that excluded `database_id <= 4`, since a caller may
    // legitimately be connected to (and want to enumerate) a system
    // database itself, as this task's own test environment does (the
    // default `PARITYLENS_TEST_SQLSERVER_DATABASE` is "master"). This is
    // read-only catalog metadata (`sys.databases`), not a security
    // boundary decision.
    const querySql = "SELECT name FROM sys.databases ORDER BY name";
    assertReadOnlyStatement(querySql, SQLSERVER_DIALECT);
    const result = await pool.request().query<{ name: string }>(querySql);
    return result.recordset.map((row) => ({ name: row.name }));
  }

  async getSchemas(catalog?: string): Promise<SchemaInfo[]> {
    void catalog; // The connection is already scoped to one database at construction time.
    const pool = await this.getPool();
    const querySql =
      "SELECT SCHEMA_NAME AS name FROM INFORMATION_SCHEMA.SCHEMATA ORDER BY SCHEMA_NAME";
    assertReadOnlyStatement(querySql, SQLSERVER_DIALECT);
    const result = await pool.request().query<{ name: string }>(querySql);
    return result.recordset.map((row) => ({ name: row.name, catalog: this.options.database }));
  }

  async getObjects(scope: ObjectScope): Promise<DataObjectInfo[]> {
    const pool = await this.getPool();
    const request = pool.request();
    const conditions: string[] = [];
    if (scope.schema) {
      conditions.push("TABLE_SCHEMA = @schemaName");
      request.input("schemaName", sql.NVarChar, scope.schema);
    }
    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
    const querySql =
      "SELECT TABLE_NAME AS name, TABLE_SCHEMA AS tableSchema, TABLE_TYPE AS tableType " +
      `FROM INFORMATION_SCHEMA.TABLES${whereClause} ORDER BY TABLE_SCHEMA, TABLE_NAME`;
    assertReadOnlyStatement(querySql, SQLSERVER_DIALECT);
    const result = await request.query<{ name: string; tableSchema: string; tableType: string }>(
      querySql
    );
    return result.recordset.map((row) => ({
      name: row.name,
      kind: row.tableType === "VIEW" ? "view" : row.tableType === "BASE TABLE" ? "table" : "other",
      catalog: scope.catalog ?? this.options.database,
      schema: row.tableSchema,
    }));
  }

  async getSchema(input: QueryInput): Promise<ColumnDefinition[]> {
    const pool = await this.getPool();

    if (input.kind === "table") {
      const { schemaName, tableName } = parseObjectRef(input.object);
      const request = pool.request();
      request.input("tableName", sql.NVarChar, tableName);
      const conditions = ["TABLE_NAME = @tableName"];
      if (schemaName) {
        conditions.push("TABLE_SCHEMA = @schemaName");
        request.input("schemaName", sql.NVarChar, schemaName);
      }
      const querySql =
        "SELECT COLUMN_NAME AS columnName, ORDINAL_POSITION AS ordinalPosition, " +
        "DATA_TYPE AS dataType, IS_NULLABLE AS isNullable, " +
        "CHARACTER_MAXIMUM_LENGTH AS charMaxLength, NUMERIC_PRECISION AS numericPrecision, " +
        "NUMERIC_SCALE AS numericScale " +
        `FROM INFORMATION_SCHEMA.COLUMNS WHERE ${conditions.join(" AND ")} ORDER BY ORDINAL_POSITION`;
      assertReadOnlyStatement(querySql, SQLSERVER_DIALECT);
      const result = await request.query<InformationSchemaColumnRow>(querySql);
      if (result.recordset.length === 0) {
        throw new Error(
          `SqlServerConnector.getSchema: no columns found for table "${input.object}" -- table may not exist or is not visible to the connected user`
        );
      }
      const primaryKeyColumns = await this.getPrimaryKeyColumns(pool, schemaName, tableName);
      return result.recordset.map((row) => toColumnDefinition(row, primaryKeyColumns));
    }

    // { kind: "query" } / { kind: "sqlFile" }: describe the shape of an
    // arbitrary result set by running it capped to zero rows (SET FETCH via
    // TOP 0), then reading column metadata from the driver's own recordset
    // column metadata rather than INFORMATION_SCHEMA (which only knows
    // about persisted tables/views, not ad hoc query shapes).
    const querySql = this.resolveExecutableSql(input);
    assertReadOnlyStatement(querySql, SQLSERVER_DIALECT);
    const wrapped = `SELECT TOP 0 * FROM (${stripTrailingSemicolon(querySql)}) AS sqlserver_shape`;
    assertReadOnlyStatement(wrapped, SQLSERVER_DIALECT);
    const request = pool.request();
    const result = await request.query(wrapped);
    const columns = result.recordset.columns as Record<
      string,
      { name: string; type: unknown; nullable?: boolean }
    >;
    return Object.values(columns).map((col, index) => {
      const nativeType = mssqlTypeToNativeTypeName(col.type);
      return {
        name: col.name,
        ordinalPosition: index + 1,
        nativeType,
        canonicalType: mapNativeType(nativeType, SQLSERVER_DIALECT),
        nullable: col.nullable ?? true,
        isPrimaryKeyCandidate: false,
      } satisfies ColumnDefinition;
    });
  }

  /** Reads primary-key column names for a table via
   * `INFORMATION_SCHEMA.TABLE_CONSTRAINTS`/`KEY_COLUMN_USAGE`, used to set
   * `ColumnDefinition.isPrimaryKeyCandidate` from real metadata rather than
   * the name-heuristic `FixtureConnector` uses (a real server has this
   * metadata available). */
  private async getPrimaryKeyColumns(
    pool: sql.ConnectionPool,
    schemaName: string | undefined,
    tableName: string
  ): Promise<Set<string>> {
    const request = pool.request();
    request.input("tableName", sql.NVarChar, tableName);
    const conditions = ["tc.TABLE_NAME = @tableName", "tc.CONSTRAINT_TYPE = 'PRIMARY KEY'"];
    if (schemaName) {
      conditions.push("tc.TABLE_SCHEMA = @schemaName");
      request.input("schemaName", sql.NVarChar, schemaName);
    }
    const querySql =
      "SELECT kcu.COLUMN_NAME AS columnName " +
      "FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc " +
      "JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu " +
      "ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA " +
      `WHERE ${conditions.join(" AND ")}`;
    assertReadOnlyStatement(querySql, SQLSERVER_DIALECT);
    const result = await request.query<{ columnName: string }>(querySql);
    return new Set(result.recordset.map((row) => row.columnName));
  }

  async *executeQuery(input: QueryInput, options: ExecutionOptions): AsyncIterable<RecordBatch> {
    const pool = await this.getPool();
    const querySql = this.resolveExecutableSql(input);

    // M-05 hardening: reject GO batch separators before the SQL reaches
    // the safety parser or the driver -- see this file's header comment.
    rejectGoBatchSeparator(querySql);

    // Defense in depth (matches FixtureConnector's pattern exactly): every
    // statement is checked before it reaches the driver, whether supplied
    // directly by the caller ({ kind: "query" }/{ kind: "sqlFile" }) or
    // generated by this connector itself ({ kind: "table" } -> SELECT).
    assertReadOnlyStatement(querySql, SQLSERVER_DIALECT);

    const signal = options.signal as unknown as { aborted?: boolean } | undefined;
    if (signal?.aborted) {
      return;
    }

    const cappedSql = buildRowCappedSql(querySql, options.maxRows);
    // The row cap is applied via a validated integer TOP clause built from
    // `options.maxRows` (a number, never user-controlled string
    // interpolation), so it is not a SQL-injection surface distinct from
    // the underlying query text itself, which has already been checked
    // above via `assertReadOnlyStatement`.
    assertReadOnlyStatement(cappedSql, SQLSERVER_DIALECT);

    const request = pool.request();
    request.stream = false;
    const result = await request.query(cappedSql);
    const rows = result.recordset;
    const columns = rows.columns
      ? Object.keys(rows.columns as Record<string, unknown>)
      : rows.length > 0
        ? Object.keys(rows[0] as object)
        : [];

    if (rows.length === 0) {
      yield { columns, rows: [], rowCount: 0 };
      return;
    }

    const rowTuples = rows.map((row) => columns.map((col) => (row as Record<string, unknown>)[col]));
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
      maximumParameters: 2100,
    };
  }

  quoteIdentifier(identifier: string): string {
    return `[${identifier.replace(/]/g, "]]")}]`;
  }

  buildProfileQuery(
    input: QueryInput,
    columns: ColumnDefinition[],
    profileOptions: ProfileOptions
  ): GeneratedQuery {
    void profileOptions;
    const objectRef = this.resolveObjectReference(input);
    // `total_count` is emitted exactly once (not once per column, unlike
    // an earlier draft of this method) -- SQL Server rejects a result set
    // with a repeated column alias ("The column 'total_count' was
    // specified multiple times"), unlike DuckDB (FixtureConnector's own
    // near-identical query shape happens not to hit this because DuckDB
    // tolerates duplicate output-column names), demonstrated directly
    // against the live test container by this task's own multi-column
    // profile-query test case.
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
    return `(${stripTrailingSemicolon(sqlText)}) AS sqlserver_object`;
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
          `SqlServerConnector does not read SQL files from disk (kind: "sqlFile", path: "${input.filePath}"); ` +
            "supply { kind: \"query\" } with the file's contents instead."
        );
    }
  }
}

interface InformationSchemaColumnRow {
  columnName: string;
  ordinalPosition: number;
  dataType: string;
  isNullable: string;
  charMaxLength: number | null;
  numericPrecision: number | null;
  numericScale: number | null;
}

function toColumnDefinition(
  row: InformationSchemaColumnRow,
  primaryKeyColumns: Set<string>
): ColumnDefinition {
  return {
    name: row.columnName,
    ordinalPosition: row.ordinalPosition,
    nativeType: row.dataType,
    canonicalType: mapNativeType(row.dataType, SQLSERVER_DIALECT),
    nullable: row.isNullable.toUpperCase() !== "NO",
    isPrimaryKeyCandidate: primaryKeyColumns.has(row.columnName),
    ...(row.charMaxLength !== null && row.charMaxLength >= 0 ? { length: row.charMaxLength } : {}),
    ...(row.numericPrecision !== null ? { precision: row.numericPrecision } : {}),
    ...(row.numericScale !== null ? { scale: row.numericScale } : {}),
  } satisfies ColumnDefinition;
}

/** Splits a possibly schema-qualified object name ("dbo.customer_source" or
 * "customer_source") into its schema and bare table name parts. */
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
 * Builds a `SELECT TOP (n) * FROM (<sql>) AS alias` row-capping wrapper
 * around an arbitrary caller-supplied or connector-generated SELECT.
 *
 * SQL Server rejects a bare `ORDER BY` inside a derived table/subquery
 * ("The ORDER BY clause is invalid in views, inline functions, derived
 * tables, subqueries, and common table expressions, unless TOP, OFFSET or
 * FOR XML is also specified") -- demonstrated directly against the live
 * test container by this task's own `{ kind: 'query' }` + `ORDER BY` test
 * case. A naive `SELECT TOP n * FROM (<sql with ORDER BY>) AS x` wrapper
 * therefore fails for any input query that itself ends in an `ORDER BY`
 * clause, which is an entirely ordinary, expected shape for a
 * caller-supplied query. Detect a trailing top-level `ORDER BY` and inject
 * `TOP 100 PERCENT` immediately after the inner query's own leading
 * `SELECT` so the inner query becomes syntactically valid to nest, without
 * changing which rows it selects or their order (`TOP 100 PERCENT` is a
 * no-op restriction, purely there to satisfy SQL Server's grammar
 * requirement for ORDER BY inside a derived table).
 *
 * This targets the ordinary, common case (`ORDER BY` as the final clause
 * of a single top-level SELECT) via a lexical heuristic, not a full parser
 * -- consistent with this codebase's existing statement-safety scanner
 * being lexical rather than a true SQL grammar. A false negative here
 * (an ORDER BY not detected as trailing, e.g. one hidden inside a nested
 * subquery within the caller's own SQL) still produces a correct result:
 * SQL Server's own error surfaces to the caller exactly as it did before
 * this fix, rather than silently mis-capping or mis-ordering rows.
 */
function buildRowCappedSql(sqlText: string, maxRows: number): string {
  const stripped = stripTrailingSemicolon(sqlText);
  const trailingOrderBy = /\border\s+by\b(?![\s\S]*\bfrom\b\s*\()/i.test(stripped);
  const innerSql = trailingOrderBy
    ? stripped.replace(/^(\s*select\s+)/i, "$1TOP 100 PERCENT ")
    : stripped;
  return `SELECT TOP ${maxRows} * FROM (${innerSql}) AS sqlserver_query`;
}

/**
 * M-05 hardening: rejects any `GO` batch separator appearing on its own
 * line (the only syntactically valid position for it as a client-tool
 * directive -- SQL Server client tools require `GO` to be the only
 * non-whitespace token on its line). This runs *before*
 * `assertReadOnlyStatement`, closing the gap the T-03 review disclosed
 * (`SELECT 1\nGO\nDROP TABLE x` did not throw for the "sqlserver" dialect)
 * at the connector level, per TASK-BRIEF.md's option (a). Throws the same
 * `MutatingStatementError`-shaped rejection semantics conceptually, but as
 * a distinct, clearly-labeled error so a caller can tell the two rejection
 * reasons apart (batch-separator hardening vs. a genuinely mutating single
 * statement).
 */
function rejectGoBatchSeparator(sqlText: string): void {
  // Matches a line whose only non-whitespace content is "GO" (case
  // insensitive, matching sqlcmd/SSMS's own recognition rules), optionally
  // followed by a repeat count (e.g. "GO 5"), on its own line.
  const GO_BATCH_SEPARATOR = /^[ \t]*GO[ \t]*(?:\d+[ \t]*)?$/im;
  if (GO_BATCH_SEPARATOR.test(sqlText)) {
    throw new Error(
      'SqlServerConnector rejected a statement containing a "GO" batch separator: ' +
        "batch-separated scripts are not supported through executeQuery(); " +
        "supply a single batch (no GO) per QueryInput. (M-05 hardening)"
    );
  }
}

/** Best-effort mapping from `mssql`'s runtime column-type constructor
 * (exposed via `recordset.columns[name].type`) back to a native SQL Server
 * type name string, for the `{ kind: "query" }`/`{ kind: "sqlFile" }`
 * getSchema path where INFORMATION_SCHEMA is not available (an ad hoc
 * query has no persisted column metadata). Falls back to "sql_variant" (an
 * "Unknown"-mapping native type per T-05) for any constructor not in this
 * table, rather than throwing -- consistent with `mapNativeType`'s own
 * documented never-throw fallback contract. */
function mssqlTypeToNativeTypeName(type: unknown): string {
  const ctor = type as { name?: string } | undefined;
  const name = ctor?.name;
  switch (name) {
    case "Int":
      return "int";
    case "TinyInt":
      return "tinyint";
    case "SmallInt":
      return "smallint";
    case "BigInt":
      return "bigint";
    case "Bit":
      return "bit";
    case "Float":
      return "float";
    case "Real":
      return "real";
    case "Money":
      return "money";
    case "SmallMoney":
      return "smallmoney";
    case "Decimal":
    case "Numeric":
      return "decimal";
    case "VarChar":
    case "Char":
      return "varchar";
    case "NVarChar":
    case "NChar":
      return "nvarchar";
    case "Text":
    case "NText":
      return "text";
    case "Date":
      return "date";
    case "Time":
      return "time";
    case "DateTime":
    case "SmallDateTime":
      return "datetime";
    case "DateTime2":
      return "datetime2";
    case "DateTimeOffset":
      return "datetimeoffset";
    case "UniqueIdentifier":
      return "uniqueidentifier";
    case "VarBinary":
    case "Binary":
    case "Image":
      return "varbinary";
    default:
      return "sql_variant";
  }
}
