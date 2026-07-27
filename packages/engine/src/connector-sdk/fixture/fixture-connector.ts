// FixtureConnector (T-04): a DuckDB-backed implementation of
// `DataPlatformConnector` (@paritylens/shared) that stands in for a real
// source/target platform during development, per DESIGN-SPEC.md's
// "DuckDB-backed fixture connectors" decision — fixtures implement the same
// interface real connectors (T-17/T-18/T-19) will implement later, so no
// rework is needed when real database access becomes available.
//
// DuckDB binding choice: `@duckdb/node-api` (DuckDB Labs' official
// "Neo" Node client), not the legacy `duckdb` npm package. Reasons:
//   - Promise-native API (`DuckDBInstance.create`, `connection.runAndReadAll`,
//     etc.) instead of the legacy package's callback/EventEmitter style —
//     a much closer match to `DataPlatformConnector.executeQuery`'s
//     `AsyncIterable<RecordBatch>` contract, with no manual promisification.
//   - Actively maintained by DuckDB Labs as the forward-looking Node client
//     (the legacy `duckdb` package is in maintenance mode upstream).
//   - Ships prebuilt native binaries per-platform (via
//     `@duckdb/node-bindings`) the same way the legacy package does, so
//     there is no added native-toolchain requirement for this project.
//   - Its `DuckDBResultReader` exposes `columnNames()`/`columnTypes()` and
//     `getRowsJS()` (plain JS values, not DuckDB's internal value wrapper
//     types), which maps directly onto `RecordBatch`'s
//     `{ columns: string[]; rows: unknown[][] }` shape.
//
// Every fixture-set's source and target tables are seeded into a single
// **in-memory** DuckDB instance per FixtureConnector instance (in-memory:
// no fixture data is ever persisted to disk, keeping this safely disposable
// test-only state). `executeQuery` calls T-03's `assertReadOnlyStatement`
// on every SQL string before running it against DuckDB — both for
// user-supplied `{ kind: "query" }` input and for the `SELECT * FROM
// <table>` this connector itself generates for `{ kind: "table" }` input,
// so the safety gate is exercised on every code path, not bypassed for
// connector-generated SQL.
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
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
import { fixtureTableName, getFixtureSet, type FixtureSetId, type FixtureSide } from "../../../fixtures/index.js";
import { mapDuckDbTypeToCanonical } from "./type-mapping.js";

/** Dialect FixtureConnector reports to `assertReadOnlyStatement` — fixtures
 * run on DuckDB regardless of which real platform shape they model. */
const FIXTURE_DIALECT: SqlDialect = "duckdb";

/**
 * `DataPlatformConnector` implementation backed by an in-memory DuckDB
 * database, seeded from one side (source or target) of a named fixture set
 * (see `packages/engine/fixtures/index.ts`).
 *
 * Constructed with a fixture-set identifier and which side (source/target)
 * of that pair this connector instance represents — mirroring how a real
 * connector would be constructed once per connection profile, one for the
 * source system and one for the target system.
 */
export class FixtureConnector implements DataPlatformConnector {
  private readonly fixtureSetId: FixtureSetId;
  private readonly side: FixtureSide;
  private readonly tableName: string;
  private connectionPromise: Promise<DuckDBConnection> | undefined;

  constructor(fixtureSetId: FixtureSetId, side: FixtureSide) {
    this.fixtureSetId = fixtureSetId;
    this.side = side;
    this.tableName = fixtureTableName(fixtureSetId, side);
  }

  /** Lazily creates and seeds an in-memory DuckDB connection on first use,
   * reused for the lifetime of this connector instance. */
  private async getConnection(): Promise<DuckDBConnection> {
    if (!this.connectionPromise) {
      this.connectionPromise = this.createAndSeedConnection();
    }
    return this.connectionPromise;
  }

  private async createAndSeedConnection(): Promise<DuckDBConnection> {
    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    const set = getFixtureSet(this.fixtureSetId);
    const { tableName, definition } = this.side === "source" ? set.source : set.target;

    await connection.run(definition.createTableSql);
    for (const insertSql of definition.insertRowsSql) {
      await connection.run(insertSql);
    }

    // Sanity check: the table this connector was constructed to represent
    // must be the one just seeded.
    if (tableName !== this.tableName) {
      throw new Error(
        `Fixture registry inconsistency: expected table "${this.tableName}" but seeded "${tableName}"`
      );
    }

    return connection;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const start = Date.now();
    try {
      const connection = await this.getConnection();
      await connection.run("SELECT 1");
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
    return [{ name: "memory" }];
  }

  // `catalog`/`scope` are part of the `DataPlatformConnector` interface
  // contract but unused here: a fixture connector always exposes exactly
  // one in-memory catalog ("memory"), one schema ("main"), and one object
  // (the table it was constructed to represent), regardless of what a
  // caller narrows the listing to.
  async getSchemas(catalog?: string): Promise<SchemaInfo[]> {
    void catalog;
    return [{ name: "main", catalog: "memory" }];
  }

  async getObjects(scope: ObjectScope): Promise<DataObjectInfo[]> {
    void scope;
    return [{ name: this.tableName, kind: "table", catalog: "memory", schema: "main" }];
  }

  async getSchema(input: QueryInput): Promise<ColumnDefinition[]> {
    const connection = await this.getConnection();
    const objectRef = this.resolveObjectReference(input);
    const describeSql = `DESCRIBE SELECT * FROM ${objectRef}`;
    // DESCRIBE is a metadata-only, read-only statement, but it is still
    // routed through the same safety gate as any other generated SQL for
    // consistency and defense in depth.
    assertReadOnlyStatement(describeSql, FIXTURE_DIALECT);
    const reader = await connection.runAndReadAll(describeSql);
    const rows = reader.getRowsJS();
    const columnNames = reader.columnNames();
    const nameIdx = columnNames.indexOf("column_name");
    const typeIdx = columnNames.indexOf("column_type");
    const nullIdx = columnNames.indexOf("null");

    return rows.map((row, index) => {
      const name = String(row[nameIdx]);
      const nativeType = String(row[typeIdx]);
      const nullableRaw = nullIdx >= 0 ? row[nullIdx] : "YES";
      const nullable = String(nullableRaw).toUpperCase() !== "NO";
      const { length, precision, scale } = parseTypeModifiers(nativeType);

      return {
        name,
        ordinalPosition: index + 1,
        nativeType,
        canonicalType: mapDuckDbTypeToCanonical(nativeType),
        nullable,
        isPrimaryKeyCandidate: /id$/i.test(name) && index === 0,
        ...(length !== undefined ? { length } : {}),
        ...(precision !== undefined ? { precision } : {}),
        ...(scale !== undefined ? { scale } : {}),
      } satisfies ColumnDefinition;
    });
  }

  async *executeQuery(input: QueryInput, options: ExecutionOptions): AsyncIterable<RecordBatch> {
    const connection = await this.getConnection();
    const sql = this.resolveExecutableSql(input);

    // Defense in depth per DESIGN-SPEC.md: every statement is checked
    // before it reaches DuckDB, whether it came from the caller directly
    // (`{ kind: "query" }`) or was generated by this connector itself
    // (`{ kind: "table" }` -> `SELECT * FROM <table>`).
    assertReadOnlyStatement(sql, FIXTURE_DIALECT);

    // `ExecutionOptions.signal` is typed as the ambient `AbortSignal` from
    // `@paritylens/shared`; this workspace's TypeScript configuration
    // (`lib: ["ES2022"]`, no DOM lib, no `@types/node`) resolves that
    // ambient type to an empty interface with no accessible members, so
    // `.aborted` cannot be read through the declared type directly even
    // though the real runtime value (a Node/WHATWG `AbortSignal`) has one.
    // Read it defensively through `unknown` rather than asserting a richer
    // type onto a value this package does not control the shape of.
    const signal = options.signal as unknown as { aborted?: boolean } | undefined;
    if (signal?.aborted) {
      return;
    }

    const cappedSql = `SELECT * FROM (${stripTrailingSemicolon(sql)}) AS fixture_query LIMIT ${options.maxRows}`;
    const reader = await connection.runAndReadAll(cappedSql);
    const columns = reader.columnNames();
    const rows = reader.getRowsJS() as unknown[][];

    if (rows.length === 0) {
      yield { columns, rows: [], rowCount: 0 };
      return;
    }

    yield { columns, rows, rowCount: rows.length };
  }

  getCapabilities(): ConnectorCapabilities {
    return {
      supportsApproximateDistinct: true,
      supportsNativeHashing: true,
      supportsTableSampling: true,
      supportsQueryCancellation: false,
      supportsArrowResults: false,
      supportsInformationSchema: true,
      supportsTemporaryTables: true,
      supportsServerSideProfiling: true,
      maximumParameters: 100,
    };
  }

  quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
  }

  // `profileOptions` (top-value count, approximate-distinct preference) is
  // part of the interface contract; this connector generates a fixed,
  // minimal general-metrics profile query regardless, since the full
  // profiling metric catalog is T-07's concern, not this task's (see
  // `ProfileOptions`'s own judgment-call note in connector.ts).
  buildProfileQuery(
    input: QueryInput,
    columns: ColumnDefinition[],
    profileOptions: ProfileOptions
  ): GeneratedQuery {
    void profileOptions;
    const objectRef = this.resolveObjectReference(input);
    const aggregates = columns.map((column) => {
      const quoted = this.quoteIdentifier(column.name);
      return (
        `COUNT(*) AS total_count, ` +
        `COUNT(${quoted}) AS non_null_count_${sanitizeAlias(column.name)}, ` +
        `COUNT(DISTINCT ${quoted}) AS distinct_count_${sanitizeAlias(column.name)}`
      );
    });
    const sql = `SELECT ${aggregates.join(", ")} FROM ${objectRef}`;
    return { sql, parameters: [] };
  }

  /** Resolves a `QueryInput` to a bare object reference usable after `FROM`,
   * for `getSchema`/`buildProfileQuery`. `{ kind: "table" }` uses the
   * caller-supplied object name directly (quoted); `{ kind: "query" }` and
   * `{ kind: "sqlFile" }` are wrapped as a derived-table subquery. */
  private resolveObjectReference(input: QueryInput): string {
    if (input.kind === "table") {
      return this.quoteIdentifier(input.object);
    }
    const sql = this.resolveExecutableSql(input);
    return `(${stripTrailingSemicolon(sql)}) AS fixture_object`;
  }

  /** Resolves a `QueryInput` to the executable SQL string that
   * `executeQuery` should run (before safety-checking and row-capping). */
  private resolveExecutableSql(input: QueryInput): string {
    switch (input.kind) {
      case "table":
        return `SELECT * FROM ${this.quoteIdentifier(input.object)}`;
      case "query":
        return input.sql;
      case "sqlFile":
        throw new Error(
          `FixtureConnector does not read SQL files from disk (kind: "sqlFile", path: "${input.filePath}"); ` +
            "supply { kind: \"query\" } with the file's contents instead."
        );
    }
  }
}

function sanitizeAlias(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
}

function stripTrailingSemicolon(sql: string): string {
  return sql.trim().replace(/;\s*$/, "");
}

/** Extracts length/precision/scale from a DuckDB DESCRIBE type string like
 * `VARCHAR(255)` or `DECIMAL(12,2)`, where applicable. */
function parseTypeModifiers(nativeType: string): {
  length?: number;
  precision?: number;
  scale?: number;
} {
  const decimalMatch = /^DECIMAL\((\d+),\s*(\d+)\)$/i.exec(nativeType);
  if (decimalMatch) {
    const [, precision, scale] = decimalMatch;
    return { precision: Number(precision), scale: Number(scale) };
  }
  const lengthMatch = /^(?:VARCHAR|CHAR|BPCHAR)\((\d+)\)$/i.exec(nativeType);
  if (lengthMatch) {
    return { length: Number(lengthMatch[1]) };
  }
  return {};
}
