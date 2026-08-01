// SqlServerConnector (T-17) integration tests, run against the local SQL
// Server 2022 test container defined by `docker-compose.test.yml` at the
// repo root. Per TASK-BRIEF.md's Test environment section, connection
// details are read from environment variables at test-run time, never
// hardcoded:
//
//   PARITYLENS_TEST_SQLSERVER_HOST      (e.g. "localhost")
//   PARITYLENS_TEST_SQLSERVER_PORT      (e.g. "14330")
//   PARITYLENS_TEST_SQLSERVER_USER      (e.g. "sa")
//   PARITYLENS_TEST_SQLSERVER_PASSWORD  (the container's SA password)
//   PARITYLENS_TEST_SQLSERVER_DATABASE  (optional, defaults to "master")
//
// If these are unset (or a connection attempt genuinely fails), every test
// in this file is explicitly skipped via `describe.skipIf` with a visible
// console log line -- never silently passed or silently disappeared, per
// TASK-BRIEF.md's Test environment section and IMPLEMENTATION-PLAN.md's
// T-17 review-gate column ("confirms no test skip hides a real failure").
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SqlServerConnector, type SqlServerConnectionOptions } from "./sqlServerConnector.js";

function readTestServerEnv(): SqlServerConnectionOptions | undefined {
  const host = process.env["PARITYLENS_TEST_SQLSERVER_HOST"];
  const portRaw = process.env["PARITYLENS_TEST_SQLSERVER_PORT"];
  const user = process.env["PARITYLENS_TEST_SQLSERVER_USER"];
  const password = process.env["PARITYLENS_TEST_SQLSERVER_PASSWORD"];
  const database = process.env["PARITYLENS_TEST_SQLSERVER_DATABASE"] ?? "master";

  if (!host || !portRaw || !user || !password) {
    return undefined;
  }
  const port = Number(portRaw);
  if (!Number.isFinite(port)) {
    return undefined;
  }
  return { host, port, user, password, database, trustServerCertificate: true };
}

const testServerEnv = readTestServerEnv();
const hasTestServerEnv = testServerEnv !== undefined;

if (!hasTestServerEnv) {
  // Explicit, visible skip reason -- not a bare `.skip` -- per
  // TASK-BRIEF.md's Test environment section.
  console.log(
    "[sqlServerConnector.test.ts] SKIPPING all SqlServerConnector integration tests: " +
      "PARITYLENS_TEST_SQLSERVER_HOST/PORT/USER/PASSWORD are not all set. " +
      "Start the test container (`docker compose -f docker-compose.test.yml up -d`, " +
      "wait for healthy) and set these env vars to run these tests for real."
  );
}

const TEST_SCHEMA = "dbo";
const TEST_TABLE = "t17_parity_lens_customer";
const QUALIFIED_TEST_TABLE = `${TEST_SCHEMA}.${TEST_TABLE}`;

describe.skipIf(!hasTestServerEnv)("SqlServerConnector (live SQL Server 2022 container)", () => {
  // Non-null assertion is safe: this whole describe block is skipped via
  // `describe.skipIf(!hasTestServerEnv)` above whenever `testServerEnv` is
  // undefined, so every test body below only ever runs with it defined.
  const env = testServerEnv as SqlServerConnectionOptions;
  let setupConnector: SqlServerConnector;

  beforeAll(async () => {
    setupConnector = new SqlServerConnector(env);
    // Seed a small real table with a MONEY column (exercising T-05's
    // mapping, per the brief's Green-state requirement) and a DECIMAL
    // column, via the driver directly (not through executeQuery, since
    // CREATE TABLE/INSERT are themselves mutating and must not go through
    // the read-only-enforced path this task is testing).
    const pool = await (
      setupConnector as unknown as { getPool(): Promise<import("mssql").ConnectionPool> }
    ).getPool();
    await pool.request().query(`
      IF OBJECT_ID('${QUALIFIED_TEST_TABLE}', 'U') IS NOT NULL DROP TABLE ${QUALIFIED_TEST_TABLE};
      CREATE TABLE ${QUALIFIED_TEST_TABLE} (
        CustomerId INT NOT NULL PRIMARY KEY,
        CustomerName NVARCHAR(100) NOT NULL,
        CreditLimit MONEY NOT NULL,
        DiscountRate DECIMAL(5,2) NULL
      );
      INSERT INTO ${QUALIFIED_TEST_TABLE} (CustomerId, CustomerName, CreditLimit, DiscountRate) VALUES
        (1, 'Acme Corp', 5000.00, 2.50),
        (2, 'Globex Inc', 12500.75, NULL),
        (3, 'Initech', 750.25, 5.00);
    `);
  }, 30000);

  afterAll(async () => {
    const pool = await (
      setupConnector as unknown as { getPool(): Promise<import("mssql").ConnectionPool> }
    ).getPool();
    await pool.request().query(`IF OBJECT_ID('${QUALIFIED_TEST_TABLE}', 'U') IS NOT NULL DROP TABLE ${QUALIFIED_TEST_TABLE};`);
    await pool.close();
  }, 30000);

  it("testConnection() succeeds against a live connection", async () => {
    const connector = new SqlServerConnector(env);
    const result = await connector.testConnection();
    expect(result.success).toBe(true);
    expect(result.message).toBeUndefined();
    expect(typeof result.latencyMs).toBe("number");
  });

  it("testConnection() fails gracefully (never throws) against a bad connection", async () => {
    const badEnv: SqlServerConnectionOptions = {
      ...env,
      password: "definitely-the-wrong-password-123!",
    };
    const connector = new SqlServerConnector(badEnv);
    const result = await connector.testConnection();
    expect(result.success).toBe(false);
    expect(typeof result.message).toBe("string");
    expect(result.message?.length).toBeGreaterThan(0);
  });

  it("testConnection() fails gracefully against an unreachable host", async () => {
    const unreachableEnv: SqlServerConnectionOptions = {
      ...env,
      host: "127.0.0.1",
      port: 1, // Reserved/unlikely-to-be-listening port.
      connectTimeoutMs: 3000,
    };
    const connector = new SqlServerConnector(unreachableEnv);
    const result = await connector.testConnection();
    expect(result.success).toBe(false);
    expect(result.message).toBeDefined();
  });

  it("getSchema returns correct ColumnDefinition[] for a real table, including MONEY and DECIMAL mapping (T-05)", async () => {
    const connector = new SqlServerConnector(env);
    const columns = await connector.getSchema({ kind: "table", object: QUALIFIED_TEST_TABLE });

    expect(columns.length).toBe(4);

    const creditLimit = columns.find((c) => c.name === "CreditLimit");
    expect(creditLimit).toBeDefined();
    expect(creditLimit?.nativeType.toLowerCase()).toBe("money");
    // T-05's mapNativeType maps MONEY -> "Decimal" (fixed-point currency
    // type, not FloatingPoint) -- exercised for real here against a live
    // server's own INFORMATION_SCHEMA.COLUMNS.DATA_TYPE report.
    expect(creditLimit?.canonicalType).toBe("Decimal");

    const discountRate = columns.find((c) => c.name === "DiscountRate");
    expect(discountRate).toBeDefined();
    expect(discountRate?.nativeType.toLowerCase()).toBe("decimal");
    expect(discountRate?.canonicalType).toBe("Decimal");
    expect(discountRate?.precision).toBe(5);
    expect(discountRate?.scale).toBe(2);
    expect(discountRate?.nullable).toBe(true);

    const customerId = columns.find((c) => c.name === "CustomerId");
    expect(customerId).toBeDefined();
    expect(customerId?.canonicalType).toBe("Integer");
    expect(customerId?.nullable).toBe(false);
    expect(customerId?.isPrimaryKeyCandidate).toBe(true);
  });

  it("executeQuery streams RecordBatches honoring options.maxRows for a table input", async () => {
    const connector = new SqlServerConnector(env);
    const batches: import("@paritylens/shared").RecordBatch[] = [];
    for await (const batch of connector.executeQuery(
      { kind: "table", object: QUALIFIED_TEST_TABLE },
      { maxRows: 2, timeoutMs: 10000 }
    )) {
      batches.push(batch);
    }
    const totalRows = batches.reduce((sum, b) => sum + b.rowCount, 0);
    expect(totalRows).toBe(2); // capped from 3 seeded rows to maxRows: 2
    expect(batches[0]?.columns).toContain("CustomerName");
  });

  it("executeQuery works for a { kind: 'query' } SELECT input", async () => {
    const connector = new SqlServerConnector(env);
    const batches: import("@paritylens/shared").RecordBatch[] = [];
    for await (const batch of connector.executeQuery(
      { kind: "query", sql: `SELECT CustomerId, CustomerName FROM ${QUALIFIED_TEST_TABLE} ORDER BY CustomerId` },
      { maxRows: 1000, timeoutMs: 10000 }
    )) {
      batches.push(batch);
    }
    const totalRows = batches.reduce((sum, b) => sum + b.rowCount, 0);
    expect(totalRows).toBe(3);
    expect(batches[0]?.rows[0]?.[0]).toBe(1);
  });

  it("executeQuery rejects a DROP TABLE statement via assertReadOnlyStatement before reaching the driver", async () => {
    const connector = new SqlServerConnector(env);
    const iterate = () => {
      const asyncIterator = connector.executeQuery(
        { kind: "query", sql: `DROP TABLE ${QUALIFIED_TEST_TABLE}` },
        { maxRows: 1000, timeoutMs: 10000 }
      )[Symbol.asyncIterator]();
      return asyncIterator.next(); // rejection must happen before any batch is yielded
    };
    await expect(iterate()).rejects.toThrow(/mutating keyword "DROP"/i);

    // Confirm the table genuinely still exists server-side -- the rejection
    // must happen before the statement reaches SQL Server, not merely throw
    // client-side after already executing.
    const verifyConnector = new SqlServerConnector(env);
    const columns = await verifyConnector.getSchema({ kind: "table", object: QUALIFIED_TEST_TABLE });
    expect(columns.length).toBe(4);
  });

  it("executeQuery rejects other mutating statements (INSERT/UPDATE/DELETE) via assertReadOnlyStatement", async () => {
    const connector = new SqlServerConnector(env);
    const attempts = [
      `INSERT INTO ${QUALIFIED_TEST_TABLE} (CustomerId, CustomerName, CreditLimit) VALUES (99, 'Hacker', 0)`,
      `UPDATE ${QUALIFIED_TEST_TABLE} SET CreditLimit = 0`,
      `DELETE FROM ${QUALIFIED_TEST_TABLE}`,
    ];
    for (const sqlText of attempts) {
      const iterate = () => {
        const iterable = connector.executeQuery(
          { kind: "query", sql: sqlText },
          { maxRows: 1000, timeoutMs: 10000 }
        );
        const asyncIterator = iterable[Symbol.asyncIterator]();
        return asyncIterator.next();
      };
      await expect(iterate()).rejects.toThrow();
    }

    // Server-side verification: row count is still 3, unaffected.
    const verifyConnector = new SqlServerConnector(env);
    const batches: import("@paritylens/shared").RecordBatch[] = [];
    for await (const batch of verifyConnector.executeQuery(
      { kind: "table", object: QUALIFIED_TEST_TABLE },
      { maxRows: 1000, timeoutMs: 10000 }
    )) {
      batches.push(batch);
    }
    const totalRows = batches.reduce((sum, b) => sum + b.rowCount, 0);
    expect(totalRows).toBe(3);
  });

  it("executeQuery rejects a GO batch separator (M-05 connector-level hardening)", async () => {
    const connector = new SqlServerConnector(env);
    const iterate = () => {
      const asyncIterator = connector.executeQuery(
        { kind: "query", sql: `SELECT 1 AS ok\nGO\nDROP TABLE ${QUALIFIED_TEST_TABLE}` },
        { maxRows: 1000, timeoutMs: 10000 }
      )[Symbol.asyncIterator]();
      return asyncIterator.next();
    };
    await expect(iterate()).rejects.toThrow(/GO.*batch separator/i);

    // Server-side verification: table still exists, M-05 gap genuinely closed.
    const verifyConnector = new SqlServerConnector(env);
    const columns = await verifyConnector.getSchema({ kind: "table", object: QUALIFIED_TEST_TABLE });
    expect(columns.length).toBe(4);
  });

  it("getCatalogs/getSchemas/getObjects return real server metadata", async () => {
    const connector = new SqlServerConnector(env);
    const catalogs = await connector.getCatalogs();
    expect(catalogs.length).toBeGreaterThan(0);

    const schemas = await connector.getSchemas();
    expect(schemas.some((s) => s.name === "dbo")).toBe(true);

    const objects = await connector.getObjects({ schema: "dbo" });
    expect(objects.some((o) => o.name === TEST_TABLE && o.kind === "table")).toBe(true);
  });

  it("buildProfileQuery generates a valid, read-only aggregate query", async () => {
    const connector = new SqlServerConnector(env);
    const columns = await connector.getSchema({ kind: "table", object: QUALIFIED_TEST_TABLE });
    const generated = connector.buildProfileQuery(
      { kind: "table", object: QUALIFIED_TEST_TABLE },
      columns,
      {}
    );
    expect(generated.sql).toMatch(/^SELECT/i);
    expect(generated.parameters).toEqual([]);

    const batches: import("@paritylens/shared").RecordBatch[] = [];
    for await (const batch of connector.executeQuery(
      { kind: "query", sql: generated.sql },
      { maxRows: 10, timeoutMs: 10000 }
    )) {
      batches.push(batch);
    }
    expect(batches.length).toBeGreaterThan(0);
  });

  it("quoteIdentifier brackets identifiers and escapes embedded closing brackets", () => {
    const connector = new SqlServerConnector(env);
    expect(connector.quoteIdentifier("CustomerName")).toBe("[CustomerName]");
    expect(connector.quoteIdentifier("weird]name")).toBe("[weird]]name]");
  });

  it("getCapabilities returns the declared ConnectorCapabilities shape", () => {
    const connector = new SqlServerConnector(env);
    const caps = connector.getCapabilities();
    expect(caps.supportsInformationSchema).toBe(true);
    expect(caps.supportsQueryCancellation).toBe(true);
  });
});
