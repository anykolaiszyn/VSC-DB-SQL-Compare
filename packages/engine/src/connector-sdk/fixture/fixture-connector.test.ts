import { describe, expect, it } from "vitest";
import { MutatingStatementError } from "../safety/statement-safety.js";
import { FIXTURE_SET_IDS, fixtureTableName, type FixtureSide } from "../../../fixtures/index.js";
import { FixtureConnector } from "./fixture-connector.js";

const SIDES: FixtureSide[] = ["source", "target"];

describe("FixtureConnector", () => {
  it("testConnection succeeds for a seeded fixture", async () => {
    const connector = new FixtureConnector("sqlserver-customer", "source");
    const result = await connector.testConnection();
    expect(result.success).toBe(true);
  });

  it("getSchema returns a non-empty ColumnDefinition[] for a seeded fixture", async () => {
    const connector = new FixtureConnector("sqlserver-customer", "source");
    const columns = await connector.getSchema({ kind: "table", object: "customer_source" });
    expect(columns.length).toBeGreaterThan(0);
  });

  describe("all three fixture pairs, both sides", () => {
    for (const fixtureSetId of FIXTURE_SET_IDS) {
      for (const side of SIDES) {
        describe(`${fixtureSetId} / ${side}`, () => {
          const tableName = fixtureTableName(fixtureSetId, side);

          it("testConnection succeeds", async () => {
            const connector = new FixtureConnector(fixtureSetId, side);
            const result = await connector.testConnection();
            expect(result.success).toBe(true);
            expect(result.message).toBeUndefined();
          });

          it("getSchema returns a non-empty ColumnDefinition[] with expected shape", async () => {
            const connector = new FixtureConnector(fixtureSetId, side);
            const columns = await connector.getSchema({ kind: "table", object: tableName });
            expect(columns.length).toBeGreaterThan(0);
            for (const column of columns) {
              expect(typeof column.name).toBe("string");
              expect(column.name.length).toBeGreaterThan(0);
              expect(typeof column.nativeType).toBe("string");
              expect(typeof column.canonicalType).toBe("string");
              expect(typeof column.nullable).toBe("boolean");
              expect(typeof column.ordinalPosition).toBe("number");
            }
          });

          it("executeQuery returns at least one RecordBatch with rows for a table input", async () => {
            const connector = new FixtureConnector(fixtureSetId, side);
            const batches = [];
            for await (const batch of connector.executeQuery(
              { kind: "table", object: tableName },
              { maxRows: 1000, timeoutMs: 5000 }
            )) {
              batches.push(batch);
            }
            expect(batches.length).toBeGreaterThan(0);
            const totalRows = batches.reduce((sum, b) => sum + b.rowCount, 0);
            expect(totalRows).toBeGreaterThan(0);
            expect(batches[0]?.columns.length).toBeGreaterThan(0);
          });

          it("executeQuery works for a { kind: 'query' } SELECT input", async () => {
            const connector = new FixtureConnector(fixtureSetId, side);
            const batches = [];
            for await (const batch of connector.executeQuery(
              { kind: "query", sql: `SELECT * FROM ${tableName}` },
              { maxRows: 1000, timeoutMs: 5000 }
            )) {
              batches.push(batch);
            }
            const totalRows = batches.reduce((sum, b) => sum + b.rowCount, 0);
            expect(totalRows).toBeGreaterThan(0);
          });
        });
      }
    }
  });

  describe("statement safety integration", () => {
    it("rejects a mutating statement supplied as query input, via T-03's parser, before it reaches DuckDB", async () => {
      const connector = new FixtureConnector("sqlserver-customer", "source");
      const iterator = connector.executeQuery(
        { kind: "query", sql: "DELETE FROM customer_source" },
        { maxRows: 1000, timeoutMs: 5000 }
      )[Symbol.asyncIterator]();

      await expect(iterator.next()).rejects.toThrow(MutatingStatementError);
    });

    it("rejects a mutating statement hidden after a comment", async () => {
      const connector = new FixtureConnector("sqlserver-customer", "source");
      const iterator = connector.executeQuery(
        { kind: "query", sql: "-- looks safe\nDROP TABLE customer_source" },
        { maxRows: 1000, timeoutMs: 5000 }
      )[Symbol.asyncIterator]();

      await expect(iterator.next()).rejects.toThrow(MutatingStatementError);
    });

    it("does not mutate fixture data: the rejected DELETE never reduces the row count", async () => {
      const connector = new FixtureConnector("sqlserver-customer", "source");

      const iterator = connector.executeQuery(
        { kind: "query", sql: "DELETE FROM customer_source" },
        { maxRows: 1000, timeoutMs: 5000 }
      )[Symbol.asyncIterator]();
      await expect(iterator.next()).rejects.toThrow(MutatingStatementError);

      const batches = [];
      for await (const batch of connector.executeQuery(
        { kind: "table", object: "customer_source" },
        { maxRows: 1000, timeoutMs: 5000 }
      )) {
        batches.push(batch);
      }
      const totalRows = batches.reduce((sum, b) => sum + b.rowCount, 0);
      expect(totalRows).toBe(6); // full source row count, untouched
    });
  });

  describe("deliberate mismatch verification", () => {
    it("sqlserver-customer: source has 6 rows, target has 7 rows (volume mismatch)", async () => {
      const source = new FixtureConnector("sqlserver-customer", "source");
      const target = new FixtureConnector("sqlserver-customer", "target");

      const sourceRows = await collectRows(source, "customer_source");
      const targetRows = await collectRows(target, "customer_target");

      expect(sourceRows.length).toBe(6);
      expect(targetRows.length).toBe(7);
    });

    it("sqlserver-customer: CreditLimit column present in source, absent in target (schema mismatch)", async () => {
      const source = new FixtureConnector("sqlserver-customer", "source");
      const target = new FixtureConnector("sqlserver-customer", "target");

      const sourceColumns = await source.getSchema({ kind: "table", object: "customer_source" });
      const targetColumns = await target.getSchema({ kind: "table", object: "customer_target" });

      expect(sourceColumns.some((c) => c.name === "CreditLimit")).toBe(true);
      expect(targetColumns.some((c) => c.name === "CreditLimit")).toBe(false);
    });

    it("sqlserver-customer: CustomerID 4 present in source, missing from target (row-level mismatch)", async () => {
      const source = new FixtureConnector("sqlserver-customer", "source");
      const target = new FixtureConnector("sqlserver-customer", "target");

      const sourceRows = await collectRowObjects(source, "customer_source");
      const targetRows = await collectRowObjects(target, "customer_target");

      expect(sourceRows.some((r) => r.CustomerID === 4)).toBe(true);
      expect(targetRows.some((r) => r.CUSTOMER_ID === 4)).toBe(false);
    });

    it("sqlserver-customer: CustomerID 5 duplicated in target (duplicate row-level mismatch)", async () => {
      const target = new FixtureConnector("sqlserver-customer", "target");
      const targetRows = await collectRowObjects(target, "customer_target");
      const id5Rows = targetRows.filter((r) => r.CUSTOMER_ID === 5);
      expect(id5Rows.length).toBe(2);
    });

    it("snowflake-orders: DISCOUNT_PCT column present in source, absent in target (schema mismatch)", async () => {
      const source = new FixtureConnector("snowflake-orders", "source");
      const target = new FixtureConnector("snowflake-orders", "target");

      const sourceColumns = await source.getSchema({ kind: "table", object: "orders_source" });
      const targetColumns = await target.getSchema({ kind: "table", object: "orders_target" });

      expect(sourceColumns.some((c) => c.name === "DISCOUNT_PCT")).toBe(true);
      expect(targetColumns.some((c) => c.name === "DISCOUNT_PCT")).toBe(false);
    });

    it("snowflake-orders: source has 5 rows, target has 4 rows (volume mismatch)", async () => {
      const source = new FixtureConnector("snowflake-orders", "source");
      const target = new FixtureConnector("snowflake-orders", "target");

      const sourceRows = await collectRows(source, "orders_source");
      const targetRows = await collectRows(target, "orders_target");

      expect(sourceRows.length).toBe(5);
      expect(targetRows.length).toBe(4);
    });

    it("snowflake-orders: OrderID 101 ORDER_TOTAL differs between source and target (row-level mismatch)", async () => {
      const source = new FixtureConnector("snowflake-orders", "source");
      const target = new FixtureConnector("snowflake-orders", "target");

      const sourceRows = await collectRowObjects(source, "orders_source");
      const targetRows = await collectRowObjects(target, "orders_target");

      const sourceOrder = sourceRows.find((r) => r.ORDER_ID === 101);
      const targetOrder = targetRows.find((r) => r.ORDER_ID === 101);
      expect(sourceOrder?.ORDER_TOTAL).not.toEqual(targetOrder?.ORDER_TOTAL);
    });

    it("postgres-products: description column present in source, absent in target (schema mismatch)", async () => {
      const source = new FixtureConnector("postgres-products", "source");
      const target = new FixtureConnector("postgres-products", "target");

      const sourceColumns = await source.getSchema({ kind: "table", object: "products_source" });
      const targetColumns = await target.getSchema({ kind: "table", object: "products_target" });

      expect(sourceColumns.some((c) => c.name === "description")).toBe(true);
      expect(targetColumns.some((c) => c.name === "description")).toBe(false);
    });

    it("postgres-products: source has 5 rows, target has 6 rows (volume mismatch)", async () => {
      const source = new FixtureConnector("postgres-products", "source");
      const target = new FixtureConnector("postgres-products", "target");

      const sourceRows = await collectRows(source, "products_source");
      const targetRows = await collectRows(target, "products_target");

      expect(sourceRows.length).toBe(5);
      expect(targetRows.length).toBe(6);
    });

    it("postgres-products: product_id 3 missing from target, product_id 6 missing from source (row-level mismatch)", async () => {
      const source = new FixtureConnector("postgres-products", "source");
      const target = new FixtureConnector("postgres-products", "target");

      const sourceRows = await collectRowObjects(source, "products_source");
      const targetRows = await collectRowObjects(target, "products_target");

      expect(sourceRows.some((r) => r.product_id === 3)).toBe(true);
      expect(targetRows.some((r) => r.product_id === 3)).toBe(false);

      expect(targetRows.some((r) => r.product_id === 6)).toBe(true);
      expect(sourceRows.some((r) => r.product_id === 6)).toBe(false);
    });

    it("postgres-products: product_id 2 duplicated in target with a differing price (duplicate row-level mismatch)", async () => {
      const target = new FixtureConnector("postgres-products", "target");
      const targetRows = await collectRowObjects(target, "products_target");
      const id2Rows = targetRows.filter((r) => r.product_id === 2);
      expect(id2Rows.length).toBe(2);
      expect(id2Rows[0]?.price).not.toEqual(id2Rows[1]?.price);
    });
  });
});

async function collectRows(
  connector: FixtureConnector,
  tableName: string
): Promise<unknown[][]> {
  const rows: unknown[][] = [];
  for await (const batch of connector.executeQuery(
    { kind: "table", object: tableName },
    { maxRows: 1000, timeoutMs: 5000 }
  )) {
    rows.push(...batch.rows);
  }
  return rows;
}

async function collectRowObjects(
  connector: FixtureConnector,
  tableName: string
): Promise<Record<string, unknown>[]> {
  const objects: Record<string, unknown>[] = [];
  for await (const batch of connector.executeQuery(
    { kind: "table", object: tableName },
    { maxRows: 1000, timeoutMs: 5000 }
  )) {
    for (const row of batch.rows) {
      const obj: Record<string, unknown> = {};
      batch.columns.forEach((col, idx) => {
        obj[col] = row[idx];
      });
      objects.push(obj);
    }
  }
  return objects;
}
