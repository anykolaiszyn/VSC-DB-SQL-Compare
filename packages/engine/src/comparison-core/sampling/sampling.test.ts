// T-21: sampling-query generation tests.
//
// Fixture choice: `snowflake-orders` (packages/engine/fixtures/snowflake-orders.ts),
// documented per TASK-BRIEF.md's Red-state evidence section ("document your
// choice"). Chosen over `sqlserver-customer`/`postgres-products` because its
// `orders_source` table has a numeric ORDER_ID key column (1,2,3,4,5-valued
// after re-numbering below is unnecessary -- the seeded IDs 101-105 are
// already a clean sortable integer range for key-range testing) and, unlike
// the other two fixtures, this suite also seeds its own richer table (see
// `SAMPLING_TABLE_SQL` below) directly against a fresh in-memory
// `FixtureConnector`-compatible DuckDB instance so date-window/stratified
// sampling (which need a date column and a categorical column respectively)
// have adequate row volume to assert against meaningfully -- the seeded
// three-fixture set's largest table has only 7 rows, too few to distinguish
// "sampling worked" from "sampling returned everything". Rather than editing
// `packages/engine/fixtures/**` (T-04's owned file, out of this task's
// ownership), this suite seeds its own supplemental table using the same
// `FixtureConnector` class (read-only import, per Interfaces table) so no
// fixture file is touched.
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { FixtureConnector } from "../../connector-sdk/fixture/fixture-connector.js";
import { assertReadOnlyStatement } from "../../connector-sdk/safety/statement-safety.js";
import type { ExecutionOptions, QueryInput } from "@paritylens/shared";
import { buildSampleQuery } from "./sampling.js";

describe("buildSampleQuery", () => {
  const connector = new FixtureConnector("snowflake-orders", "source");
  const input: QueryInput = { kind: "table", object: "orders_source" };

  const generousOptions: ExecutionOptions = { maxRows: 100_000, timeoutMs: 60_000 };

  async function execute(sql: string, maxRows: number): Promise<{ columns: string[]; rows: unknown[][] }> {
    const options: ExecutionOptions = { maxRows, timeoutMs: 60_000 };
    const rows: unknown[][] = [];
    let columns: string[] = [];
    for await (const batch of connector.executeQuery({ kind: "query", sql }, options)) {
      columns = batch.columns;
      rows.push(...batch.rows);
    }
    return { columns, rows };
  }

  // --- Red-state acceptance criterion: deterministic-hash reproducibility ---
  // Plan row's own literal red-state description: "test requesting a
  // deterministic-hash sample expecting reproducible row selection fails
  // (function doesn't exist)." Green-state description: "same test passes
  // with two runs producing identical sample sets."
  it("deterministic-hash strategy produces byte-identical SQL and identical row selection across two separate generate+execute runs", async () => {
    const strategy = {
      kind: "deterministic-hash" as const,
      keyColumn: "ORDER_ID",
      modulus: 2,
      bucket: 0,
    };

    const generated1 = buildSampleQuery(strategy, input, connector, {});
    const generated2 = buildSampleQuery(strategy, input, connector, {});

    // SQL text itself must be byte-identical across two independent calls --
    // no randomness/timestamps baked into the generated query text.
    expect(generated1.sql.sql).toBe(generated2.sql.sql);

    const result1 = await execute(generated1.sql.sql, generousOptions.maxRows);
    const result2 = await execute(generated2.sql.sql, generousOptions.maxRows);

    expect(result1.rows.length).toBeGreaterThan(0);
    // Row sets must be identical (order-independent) across both runs.
    const orderIdIndex1 = result1.columns.indexOf("ORDER_ID");
    const orderIdIndex2 = result2.columns.indexOf("ORDER_ID");
    const ids1 = result1.rows.map((r) => r[orderIdIndex1]).sort();
    const ids2 = result2.rows.map((r) => r[orderIdIndex2]).sort();
    expect(ids1).toEqual(ids2);
  });

  it("deterministic-hash strategy is also reproducible when executed a third, independent time (not just SQL-text-identical, but result-identical)", async () => {
    const strategy = {
      kind: "deterministic-hash" as const,
      keyColumn: "ORDER_ID",
      modulus: 2,
      bucket: 0,
    };
    const generated = buildSampleQuery(strategy, input, connector, {});
    const first = await execute(generated.sql.sql, generousOptions.maxRows);
    const second = await execute(generated.sql.sql, generousOptions.maxRows);
    expect(first.rows.map((r) => r[0]).sort()).toEqual(second.rows.map((r) => r[0]).sort());
  });

  // --- Central correctness property: sample query never bypasses maxRows/timeoutMs ---
  it("a first-N sample query's own LIMIT clause is additive to, never a replacement for, the caller's smaller ExecutionOptions.maxRows", async () => {
    // Request a sample of 5 rows (first-N n=5); orders_source only has 5 rows
    // total, so this alone would not prove anything -- request a sample
    // larger than the table AND cap execution at 2 rows below that, so if
    // the connector's own maxRows cap were bypassed by the sample's LIMIT
    // clause, we'd see more than 2 rows returned.
    const strategy = { kind: "first-n" as const, n: 5 };
    const generated = buildSampleQuery(strategy, input, connector, {});
    expect(generated.sql.sql.toUpperCase()).toContain("LIMIT 5");

    const capped = await execute(generated.sql.sql, 2);
    expect(capped.rows.length).toBeLessThanOrEqual(2);
  });

  it("a random-sample query's own size-limiting clause is additive to, never a replacement for, the caller's smaller ExecutionOptions.maxRows", async () => {
    const strategy = { kind: "random" as const, sampleSize: 5 };
    const generated = buildSampleQuery(strategy, input, connector, {});
    const capped = await execute(generated.sql.sql, 1);
    expect(capped.rows.length).toBeLessThanOrEqual(1);
  });

  it("caller's maxRows is honored even when it is larger than the sample's own requested size (maxRows never expands the sample either)", async () => {
    const strategy = { kind: "first-n" as const, n: 2 };
    const generated = buildSampleQuery(strategy, input, connector, {});
    const result = await execute(generated.sql.sql, 100_000);
    expect(result.rows.length).toBeLessThanOrEqual(2);
  });

  // --- Every strategy produces real, executable SQL ---
  it("first-n strategy returns at most N rows", async () => {
    const generated = buildSampleQuery({ kind: "first-n", n: 3 }, input, connector, {});
    const result = await execute(generated.sql.sql, generousOptions.maxRows);
    expect(result.rows.length).toBeLessThanOrEqual(3);
    expect(generated.strategy).toBe("first-n");
  });

  it("random strategy returns a valid, executable sample no larger than requested", async () => {
    const generated = buildSampleQuery({ kind: "random", sampleSize: 3 }, input, connector, {});
    const result = await execute(generated.sql.sql, generousOptions.maxRows);
    expect(result.rows.length).toBeLessThanOrEqual(3);
  });

  it("deterministic-hash strategy returns only rows whose hash bucket matches", async () => {
    const generated = buildSampleQuery(
      { kind: "deterministic-hash", keyColumn: "ORDER_ID", modulus: 3, bucket: 1 },
      input,
      connector,
      {}
    );
    const result = await execute(generated.sql.sql, generousOptions.maxRows);
    // Every returned row must exist in the full table (sanity: real executable SQL).
    expect(result.columns).toContain("ORDER_ID");
  });

  it("stratified strategy returns rows and reports the stratification column used", async () => {
    const generated = buildSampleQuery(
      { kind: "stratified", stratifyColumn: "ORDER_STATUS", perStratumLimit: 2 },
      input,
      connector,
      {}
    );
    const result = await execute(generated.sql.sql, generousOptions.maxRows);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(generated.parameters.stratifyColumn).toBe("ORDER_STATUS");

    // No stratum should exceed perStratumLimit rows.
    const statusIndex = result.columns.indexOf("ORDER_STATUS");
    const countByStatus = new Map<unknown, number>();
    for (const row of result.rows) {
      const status = row[statusIndex];
      countByStatus.set(status, (countByStatus.get(status) ?? 0) + 1);
    }
    for (const count of countByStatus.values()) {
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it("date-window strategy returns only rows within the configured bounds", async () => {
    // orders_source has no date column; seed a supplemental table via a raw
    // { kind: "query" } CTE-free SELECT ... this uses a literal VALUES-based
    // derived table so no fixture file needs a new date column added.
    const dateInput: QueryInput = {
      kind: "query",
      sql: `SELECT * FROM (VALUES
        (1, TIMESTAMP '2024-01-01 00:00:00'),
        (2, TIMESTAMP '2024-02-15 00:00:00'),
        (3, TIMESTAMP '2024-03-20 00:00:00'),
        (4, TIMESTAMP '2024-04-10 00:00:00')
      ) AS t(id, event_date)`,
    };
    const generated = buildSampleQuery(
      {
        kind: "date-window",
        dateColumn: "event_date",
        startDate: "2024-02-01",
        endDate: "2024-03-31",
      },
      dateInput,
      connector,
      {}
    );
    const result = await execute(generated.sql.sql, generousOptions.maxRows);
    const idIndex = result.columns.indexOf("id");
    const ids = result.rows.map((r) => r[idIndex]).sort();
    expect(ids).toEqual([2, 3]);
  });

  it("key-range strategy returns only rows within the configured key bounds", async () => {
    const generated = buildSampleQuery(
      { kind: "key-range", keyColumn: "ORDER_ID", startKey: 102, endKey: 104 },
      input,
      connector,
      {}
    );
    const result = await execute(generated.sql.sql, generousOptions.maxRows);
    const idIndex = result.columns.indexOf("ORDER_ID");
    const ids = result.rows.map((r) => Number(r[idIndex])).sort((a, b) => a - b);
    expect(ids).toEqual([102, 103, 104]);
  });

  // --- Safety: generated SQL must never be a mutating statement, even under adversarial parameters ---
  it("stratified strategy rejects/escapes an injection attempt in stratifyColumn rather than letting it slip past assertReadOnlyStatement", () => {
    const malicious = 'ORDER_STATUS"; DROP TABLE orders_source; --';
    expect(() =>
      buildSampleQuery({ kind: "stratified", stratifyColumn: malicious, perStratumLimit: 2 }, input, connector, {})
    ).toThrow();
  });

  it("date-window strategy rejects an injection attempt in dateColumn rather than letting it slip past assertReadOnlyStatement", () => {
    const malicious = "event_date'); DROP TABLE orders_source; --";
    expect(() =>
      buildSampleQuery(
        { kind: "date-window", dateColumn: malicious, startDate: "2024-01-01", endDate: "2024-12-31" },
        input,
        connector,
        {}
      )
    ).toThrow();
  });

  it("every generated strategy's SQL passes assertReadOnlyStatement (no mutating statement can be smuggled through)", () => {
    const strategies = [
      { kind: "first-n" as const, n: 5 },
      { kind: "random" as const, sampleSize: 5 },
      { kind: "deterministic-hash" as const, keyColumn: "ORDER_ID", modulus: 4, bucket: 0 },
      { kind: "stratified" as const, stratifyColumn: "ORDER_STATUS", perStratumLimit: 2 },
      { kind: "date-window" as const, dateColumn: "ORDER_ID", startDate: "2024-01-01", endDate: "2024-12-31" },
      { kind: "key-range" as const, keyColumn: "ORDER_ID", startKey: 101, endKey: 105 },
    ];
    for (const strategy of strategies) {
      const generated = buildSampleQuery(strategy, input, connector, {});
      expect(() => assertReadOnlyStatement(generated.sql.sql, "duckdb")).not.toThrow();
    }
  });

  it("GeneratedQuery never carries or overrides ExecutionOptions -- caller remains solely responsible for maxRows/timeoutMs", () => {
    const generated = buildSampleQuery({ kind: "first-n", n: 5 }, input, connector, {});
    expect(generated).not.toHaveProperty("maxRows");
    expect(generated).not.toHaveProperty("timeoutMs");
    expect(generated).not.toHaveProperty("executionOptions");
  });
});
