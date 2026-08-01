// T-20: hash-based comparison ("Strategy C") tests.
//
// Red-state evidence (see IMPLEMENTATION-REPORT.md for the captured failing
// run before this module existed): `npx vitest run
// packages/engine/src/comparison-core/hash-comparison` failed with a module
// resolution error because `./hash-comparison.js` did not exist yet.
//
// Fixture choice: `snowflake-orders` (packages/engine/fixtures/snowflake-orders.ts).
// Its header comment documents the planted mismatches used throughout this
// file:
//   - OrderID 103 exists in source but not target (missing-target row).
//   - OrderID 101's ORDER_TOTAL differs: source 250.00 vs target 199.99.
// ORDER_STATUS gives a natural partition dimension with three values
// (SHIPPED, PENDING, CANCELLED) that already produces a genuine
// partition-level mismatch without inventing new fixture data:
//   - PENDING partition: source has OrderID 103 (PENDING), target has zero
//     PENDING rows at all -- a clean partition-hash mismatch.
//   - SHIPPED partition: source rows 101/102/105 vs target rows 101/102/105
//     -- same key set, but OrderID 101's ORDER_TOTAL differs, so the
//     partition hash differs even though row *membership* (which OrderIDs
//     exist) is identical on both sides -- this is exactly the doc's
//     "table hash differs -> compare partition hashes -> compare row hashes"
//     narrowing story, worked end to end within one partition.
//   - CANCELLED partition: source/target both have exactly OrderID 104 with
//     identical values -- a partition-hash match, proving compareByHash
//     does not just always report a mismatch.
import { describe, expect, it } from "vitest";
import { FixtureConnector } from "../../connector-sdk/fixture/fixture-connector.js";
import { compareRows } from "../row-level/row-level.js";
import type { ColumnMappingEntry } from "../../orchestration/definition/definition.js";
import { compareByHash } from "./hash-comparison.js";

const ORDER_MAPPING: ColumnMappingEntry[] = [
  { source: "CUSTOMER_ID", target: "CUSTOMER_ID" },
  { source: "ORDER_TOTAL", target: "ORDER_TOTAL" },
  { source: "ORDER_STATUS", target: "ORDER_STATUS" },
];

function orderConnectors() {
  return {
    source: new FixtureConnector("snowflake-orders", "source"),
    target: new FixtureConnector("snowflake-orders", "target"),
  };
}

describe("compareByHash: table level", () => {
  it("reports a table-hash mismatch for the snowflake-orders fixture pair (planted row differences)", async () => {
    const { source, target } = orderConnectors();

    const result = await compareByHash(source, target, "table", {
      table: "orders_source",
      targetTable: "orders_target",
      keyColumns: ["ORDER_ID"],
      columns: ["CUSTOMER_ID", "ORDER_TOTAL", "ORDER_STATUS"],
    });

    expect(result.level).toBe("table");
    expect(result.matched).toBe(false);
    expect(result.sourceHash).not.toBe(result.targetHash);
    // Table level does not itself enumerate which partitions/keys differ --
    // it only proves *that* something differs, per the doc's own framing
    // ("Whole-table hashes alone are limited: they prove something differs
    // but do not explain what differs"). Narrower levels supply mismatch
    // detail; the caller is expected to call compareByHash again at a
    // narrower level, per this task's documented escalation-scope decision.
    expect(result.mismatches).toEqual([]);
  });
});

describe("compareByHash: partition level", () => {
  it("reports a mismatch for the PENDING partition (present in source, absent in target)", async () => {
    const { source, target } = orderConnectors();

    const result = await compareByHash(source, target, "partition", {
      table: "orders_source",
      targetTable: "orders_target",
      keyColumns: ["ORDER_ID"],
      columns: ["CUSTOMER_ID", "ORDER_TOTAL", "ORDER_STATUS"],
      partitionColumn: "ORDER_STATUS",
    });

    expect(result.level).toBe("partition");
    expect(result.matched).toBe(false);
    const pendingMismatch = result.mismatches.find((m) => m.partitionValue === "PENDING");
    expect(pendingMismatch).toBeDefined();
    expect(pendingMismatch?.sourceHash).not.toBe(pendingMismatch?.targetHash);
    // Target has no PENDING rows at all -- targetHash for an empty partition
    // is the documented empty-partition sentinel hash.
    expect(pendingMismatch?.targetRowCount).toBe(0);
    expect(pendingMismatch?.sourceRowCount).toBe(1);
  });

  it("reports a mismatch for the SHIPPED partition even though row membership (OrderIDs) is identical on both sides", async () => {
    const { source, target } = orderConnectors();

    const result = await compareByHash(source, target, "partition", {
      table: "orders_source",
      targetTable: "orders_target",
      keyColumns: ["ORDER_ID"],
      columns: ["CUSTOMER_ID", "ORDER_TOTAL", "ORDER_STATUS"],
      partitionColumn: "ORDER_STATUS",
    });

    const shippedMismatch = result.mismatches.find((m) => m.partitionValue === "SHIPPED");
    expect(shippedMismatch).toBeDefined();
    expect(shippedMismatch?.sourceRowCount).toBe(3);
    expect(shippedMismatch?.targetRowCount).toBe(3);
    expect(shippedMismatch?.sourceHash).not.toBe(shippedMismatch?.targetHash);
  });

  it("reports a partition-hash match for CANCELLED (identical single row on both sides)", async () => {
    const { source, target } = orderConnectors();

    const result = await compareByHash(source, target, "partition", {
      table: "orders_source",
      targetTable: "orders_target",
      keyColumns: ["ORDER_ID"],
      columns: ["CUSTOMER_ID", "ORDER_TOTAL", "ORDER_STATUS"],
      partitionColumn: "ORDER_STATUS",
    });

    const cancelledMismatch = result.mismatches.find((m) => m.partitionValue === "CANCELLED");
    // CANCELLED (OrderID 104) is identical on both sides -- no mismatch
    // entry should be reported for it at all.
    expect(cancelledMismatch).toBeUndefined();
  });
});

describe("compareByHash: row level", () => {
  it("reports a row-hash mismatch for OrderID 101 (differing ORDER_TOTAL) and identifies it by key", async () => {
    const { source, target } = orderConnectors();

    const result = await compareByHash(source, target, "row", {
      table: "orders_source",
      targetTable: "orders_target",
      keyColumns: ["ORDER_ID"],
      columns: ["CUSTOMER_ID", "ORDER_TOTAL", "ORDER_STATUS"],
    });

    expect(result.level).toBe("row");
    expect(result.matched).toBe(false);

    const row101 = result.mismatches.find((m) => m.keyValues?.[0] === 101);
    expect(row101).toBeDefined();
    expect(row101?.sourceHash).not.toBe(row101?.targetHash);

    const row102 = result.mismatches.find((m) => m.keyValues?.[0] === 102);
    expect(row102).toBeUndefined();
  });

  it("reports OrderID 103 as missing-from-target (present source-only)", async () => {
    const { source, target } = orderConnectors();

    const result = await compareByHash(source, target, "row", {
      table: "orders_source",
      targetTable: "orders_target",
      keyColumns: ["ORDER_ID"],
      columns: ["CUSTOMER_ID", "ORDER_TOTAL", "ORDER_STATUS"],
    });

    const row103 = result.mismatches.find((m) => m.keyValues?.[0] === 103);
    expect(row103).toBeDefined();
    expect(row103?.targetHash).toBeUndefined();
    expect(row103?.sourceHash).toBeDefined();
  });
});

describe("compareByHash: column level", () => {
  it("reports a column-hash mismatch for ORDER_TOTAL but not for CUSTOMER_ID", async () => {
    const { source, target } = orderConnectors();

    const result = await compareByHash(source, target, "column", {
      table: "orders_source",
      targetTable: "orders_target",
      keyColumns: ["ORDER_ID"],
      columns: ["CUSTOMER_ID", "ORDER_TOTAL", "ORDER_STATUS"],
    });

    expect(result.level).toBe("column");
    expect(result.matched).toBe(false);

    const totalMismatch = result.mismatches.find((m) => m.columnName === "ORDER_TOTAL");
    expect(totalMismatch).toBeDefined();
    expect(totalMismatch?.sourceHash).not.toBe(totalMismatch?.targetHash);
  });
});

describe("compareByHash: key-range level", () => {
  it("narrows a key-range mismatch to the sub-range containing OrderID 101/103 without enumerating individual rows", async () => {
    const { source, target } = orderConnectors();

    const result = await compareByHash(source, target, "key-range", {
      table: "orders_source",
      targetTable: "orders_target",
      keyColumns: ["ORDER_ID"],
      columns: ["CUSTOMER_ID", "ORDER_TOTAL", "ORDER_STATUS"],
      rangeSize: 2,
    });

    expect(result.level).toBe("key-range");
    expect(result.matched).toBe(false);
    // OrderIDs 101-105 with rangeSize 2 -> ranges [101,102], [103,104], [105,105].
    // Both the first range (101 differs) and the second range (103 missing
    // from target) should be flagged.
    const rangeTexts = result.mismatches.map((m) => `${m.rangeStart}-${m.rangeEnd}`);
    expect(rangeTexts).toContain("101-102");
    expect(rangeTexts).toContain("103-104");
    // 105-105 (OrderID 105 identical on both sides) should not be flagged.
    expect(rangeTexts).not.toContain("105-105");
  });
});

describe("compareByHash agrees with compareRows (T-14) on the same fixture mismatch", () => {
  it("row-level hash mismatches correspond exactly to compareRows's differing/missing classifications, and hash matches correspond to compareRows's matching classification", async () => {
    const { source, target } = orderConnectors();

    const hashResult = await compareByHash(source, target, "row", {
      table: "orders_source",
      targetTable: "orders_target",
      keyColumns: ["ORDER_ID"],
      columns: ["CUSTOMER_ID", "ORDER_TOTAL", "ORDER_STATUS"],
    });

    // Independently fetch full row sets and run T-14's compareRows over the
    // exact same fixture pair and column mapping.
    const sourceRows = await fetchAllRows(source, "orders_source", ["ORDER_ID", "CUSTOMER_ID", "ORDER_TOTAL", "ORDER_STATUS"]);
    const targetRows = await fetchAllRows(target, "orders_target", ["ORDER_ID", "CUSTOMER_ID", "ORDER_TOTAL", "ORDER_STATUS"]);

    const rowDifferences = compareRows(sourceRows, targetRows, ["ORDER_ID"], ORDER_MAPPING);

    const hashMismatchKeys = new Set<unknown>(hashResult.mismatches.map((m) => m.keyValues?.[0]));
    const hashMatchedKeys = new Set<unknown>(
      [101, 102, 103, 104, 105].filter((key) => !hashMismatchKeys.has(key))
    );

    for (const diff of rowDifferences) {
      const key = diff.keyValues[0];
      if (diff.category === "matching") {
        expect(hashMatchedKeys.has(key)).toBe(true);
        expect(hashMismatchKeys.has(key)).toBe(false);
      } else if (diff.category === "matched-key-differing-values" || diff.category === "missing-from-target") {
        // OrderID 101 (differing-values) and OrderID 103 (missing-from-target,
        // since 103 only exists in source) must both appear as hash mismatches.
        expect(hashMismatchKeys.has(key)).toBe(true);
      }
    }

    // And the reverse: every hash mismatch key must correspond to a non-
    // "matching" compareRows classification for that key (no case where
    // hash comparison flags a difference compareRows considers identical).
    for (const mismatch of hashResult.mismatches) {
      const key = mismatch.keyValues?.[0];
      const correspondingDiff = rowDifferences.find((d) => d.keyValues[0] === key);
      expect(correspondingDiff).toBeDefined();
      expect(correspondingDiff?.category).not.toBe("matching");
    }
  });
});

describe("compareByHash applies normalization before hashing", () => {
  // Uses the sqlserver-customer fixture pair's CustomerName column, adding a
  // deliberate ad hoc casing/whitespace difference on top of its existing
  // planted mismatches, via CUSTOMER_ID 1 ("John Smith" on both sides,
  // identical baseline) re-fetched through a lower-cased/padded source-side
  // SQL projection -- giving a controlled, genuinely equivalent-but-
  // differently-formatted pair, matching TASK-BRIEF.md's Handoff note to the
  // reviewer ("construct a case where two differently-formatted-but-
  // equivalent values ... hash to the same value after normalization").
  it("reports a row-hash mismatch for a casing/whitespace difference with no rule, but a match once trim + caseSensitive:false normalize it away", async () => {
    // Uses a dedicated single-row fixture pair (see fixtureWithCasingVariant
    // below) built the same way FixtureConnector builds its own fixtures
    // (a fresh in-memory DuckDB instance via @duckdb/node-api), seeded with
    // a deliberately re-cased/padded variant of the same logical value
    // ("  JOHN SMITH  " vs "John Smith") -- so this exercises compareByHash's
    // real fetch-and-hash code path, not a hand-rolled reimplementation of
    // it, and gives a controlled, unambiguous normalization case rather than
    // reusing an existing fixture's already-fixed column values.
    const { casedSource, plainTarget } = await fixtureWithCasingVariant();

    const rawMismatch = await compareByHash(casedSource, plainTarget, "row", {
      table: "casing_source",
      targetTable: "casing_target",
      keyColumns: ["ID"],
      columns: ["NAME"],
    });
    const rawRow = rawMismatch.mismatches.find((m) => m.keyValues?.[0] === 1);
    expect(rawRow).toBeDefined();
    expect(rawRow?.sourceHash).not.toBe(rawRow?.targetHash);

    const normalizedResult = await compareByHash(casedSource, plainTarget, "row", {
      table: "casing_source",
      targetTable: "casing_target",
      keyColumns: ["ID"],
      columns: ["NAME"],
      rules: { NAME: { trim: true, caseSensitive: false } },
    });
    // With trim + case-insensitive normalization applied BEFORE hashing,
    // "  JOHN SMITH  " and "John Smith" hash identically -- proving
    // normalization genuinely runs pre-hash, not post-hash or not at all
    // (raw-value hashing, per the assertion above, would never converge).
    expect(normalizedResult.mismatches.find((m) => m.keyValues?.[0] === 1)).toBeUndefined();
  });
});

describe("compareByHash: numericTolerance (T-20-01 regression)", () => {
  // Round-2 follow-up. REVIEW-REPORT.md's Critical finding T-20-01:
  // compareByHash disagreed with compareRows (T-14) on Idea Prompt.md's own
  // canonical numeric-tolerance example -- "125.3700" (source) vs "125.37"
  // (target), with `numericTolerance: { absolute: 0.01 }` configured on the
  // column. Reproduced here with a dedicated one-row-per-side DuckDB fixture
  // pair (same pattern as fixtureWithCasingVariant below, generalized to
  // carry an arbitrary string value per side via fixtureWithStringVariant),
  // so this exercises compareByHash's real fetch-and-hash code path, not a
  // hand-rolled reimplementation.
  it("hashes '125.3700' and '125.37' identically once numericTolerance: { absolute: 0.01 } is configured (previously reported a mismatch -- REVIEW-REPORT.md T-20-01)", async () => {
    const { source, target } = await fixtureWithStringVariant("AMOUNT", "125.3700", "125.37");

    const withoutTolerance = await compareByHash(source, target, "row", {
      table: "variant_source",
      targetTable: "variant_target",
      keyColumns: ["ID"],
      columns: ["AMOUNT"],
    });
    // Raw strings genuinely differ -- confirms this fixture pair actually
    // exercises a real mismatch absent any tolerance configuration (i.e.
    // the test below isn't vacuously passing because the values were
    // already identical).
    expect(withoutTolerance.mismatches.find((m) => m.keyValues?.[0] === 1)).toBeDefined();

    const withTolerance = await compareByHash(source, target, "row", {
      table: "variant_source",
      targetTable: "variant_target",
      keyColumns: ["ID"],
      columns: ["AMOUNT"],
      rules: { AMOUNT: { numericTolerance: { absolute: 0.01 } } },
    });
    // Fixed: with numericTolerance configured, "125.3700" and "125.37"
    // canonicalize to the same pre-hash representation and therefore hash
    // identically -- no mismatch entry for key 1.
    expect(withTolerance.mismatches.find((m) => m.keyValues?.[0] === 1)).toBeUndefined();
    expect(withTolerance.matched).toBe(true);
  });

  it("agrees with compareRows (T-14) on the identical numericTolerance scenario -- direct regression test for T-20-01", async () => {
    const { source, target } = await fixtureWithStringVariant("AMOUNT", "125.3700", "125.37");
    const rule = { numericTolerance: { absolute: 0.01 } };

    const hashResult = await compareByHash(source, target, "row", {
      table: "variant_source",
      targetTable: "variant_target",
      keyColumns: ["ID"],
      columns: ["AMOUNT"],
      rules: { AMOUNT: rule },
    });
    expect(hashResult.matched).toBe(true);

    const sourceRows = await fetchAllRows(source, "variant_source", ["ID", "AMOUNT"]);
    const targetRows = await fetchAllRows(target, "variant_target", ["ID", "AMOUNT"]);
    const rowDifferences = compareRows(
      sourceRows,
      targetRows,
      ["ID"],
      [{ source: "AMOUNT", target: "AMOUNT" }],
      { AMOUNT: rule }
    );

    // compareRows classifies key 1 as "matching" (within tolerance);
    // compareByHash must agree -- no hash mismatch for key 1 either.
    expect(rowDifferences).toHaveLength(1);
    expect(rowDifferences[0]?.category).toBe("matching");
    expect(hashResult.mismatches.find((m) => m.keyValues?.[0] === 1)).toBeUndefined();
  });

  it("still reports a mismatch when the numeric difference exceeds the configured tolerance", async () => {
    const { source, target } = await fixtureWithStringVariant("AMOUNT", "125.37", "126.50");

    const result = await compareByHash(source, target, "row", {
      table: "variant_source",
      targetTable: "variant_target",
      keyColumns: ["ID"],
      columns: ["AMOUNT"],
      rules: { AMOUNT: { numericTolerance: { absolute: 0.01 } } },
    });

    expect(result.matched).toBe(false);
    expect(result.mismatches.find((m) => m.keyValues?.[0] === 1)).toBeDefined();
  });
});

/** Builds a minimal, dedicated one-row-per-side DuckDB fixture pair (two
 * fresh FixtureConnector-compatible connectors backed by their own
 * in-memory DuckDB instance, reusing FixtureConnector's public constructor
 * contract is not possible for arbitrary ad hoc schemas since fixture sets
 * are a fixed named registry -- see packages/engine/fixtures/index.ts, T-04's
 * owned file, not editable by this task). Uses the same `@duckdb/node-api`
 * dependency FixtureConnector itself uses (already a transitive dependency
 * of this workspace) to seed a throwaway in-memory table with a deliberate
 * casing/whitespace difference, then wraps it in a tiny local
 * DataPlatformConnector-shaped adapter exposing only the surface
 * compareByHash actually calls (`executeQuery`, `quoteIdentifier`) --
 * matching this task's Interfaces contract of consuming the connector only
 * through its public surface. */
async function fixtureWithCasingVariant(): Promise<{
  casedSource: import("@paritylens/shared").DataPlatformConnector;
  plainTarget: import("@paritylens/shared").DataPlatformConnector;
}> {
  const { DuckDBInstance } = await import("@duckdb/node-api");

  async function buildConnector(tableName: string, nameValue: string): Promise<import("@paritylens/shared").DataPlatformConnector> {
    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    await connection.run(`CREATE TABLE ${tableName} (ID INTEGER NOT NULL, NAME VARCHAR(100) NOT NULL)`);
    await connection.run(`INSERT INTO ${tableName} VALUES (1, '${nameValue}')`);

    return {
      async testConnection() {
        return { success: true };
      },
      async getCatalogs() {
        return [{ name: "memory" }];
      },
      async getSchemas() {
        return [{ name: "main", catalog: "memory" }];
      },
      async getObjects() {
        return [{ name: tableName, kind: "table" as const, catalog: "memory", schema: "main" }];
      },
      async getSchema() {
        return [];
      },
      async *executeQuery(input, options) {
        if (input.kind !== "query") {
          throw new Error("test adapter only supports { kind: 'query' }");
        }
        const capped = `SELECT * FROM (${input.sql}) AS t LIMIT ${options.maxRows}`;
        const reader = await connection.runAndReadAll(capped);
        yield {
          columns: reader.columnNames(),
          rows: reader.getRowsJS() as unknown[][],
          rowCount: reader.getRowsJS().length,
        };
      },
      getCapabilities() {
        return {
          supportsApproximateDistinct: false,
          supportsNativeHashing: true,
          supportsTableSampling: false,
          supportsQueryCancellation: false,
          supportsArrowResults: false,
          supportsInformationSchema: false,
          supportsTemporaryTables: false,
          supportsServerSideProfiling: false,
        };
      },
      quoteIdentifier(identifier: string) {
        return `"${identifier.replace(/"/g, '""')}"`;
      },
      buildProfileQuery() {
        return { sql: "", parameters: [] };
      },
    };
  }

  return {
    casedSource: await buildConnector("casing_source", "  JOHN SMITH  "),
    plainTarget: await buildConnector("casing_target", "John Smith"),
  };
}

/** Round-2 (T-20-01) generalization of `fixtureWithCasingVariant`'s DuckDB
 * fixture-building pattern: builds a one-row-per-side pair with a single
 * caller-chosen column (typed VARCHAR so it can carry numeric-looking
 * strings like "125.3700" as well as free text) seeded with an arbitrary
 * source/target value pair, wrapped in the same minimal
 * DataPlatformConnector-shaped adapter `fixtureWithCasingVariant` uses.
 * Table names are namespaced "variant_source"/"variant_target" to match
 * this file's new numericTolerance regression tests. */
async function fixtureWithStringVariant(
  columnName: string,
  sourceValue: string,
  targetValue: string
): Promise<{
  source: import("@paritylens/shared").DataPlatformConnector;
  target: import("@paritylens/shared").DataPlatformConnector;
}> {
  const { DuckDBInstance } = await import("@duckdb/node-api");

  async function buildConnector(tableName: string, value: string): Promise<import("@paritylens/shared").DataPlatformConnector> {
    const instance = await DuckDBInstance.create(":memory:");
    const connection = await instance.connect();
    await connection.run(`CREATE TABLE ${tableName} (ID INTEGER NOT NULL, ${columnName} VARCHAR(100) NOT NULL)`);
    await connection.run(`INSERT INTO ${tableName} VALUES (1, '${value}')`);

    return {
      async testConnection() {
        return { success: true };
      },
      async getCatalogs() {
        return [{ name: "memory" }];
      },
      async getSchemas() {
        return [{ name: "main", catalog: "memory" }];
      },
      async getObjects() {
        return [{ name: tableName, kind: "table" as const, catalog: "memory", schema: "main" }];
      },
      async getSchema() {
        return [];
      },
      async *executeQuery(input, options) {
        if (input.kind !== "query") {
          throw new Error("test adapter only supports { kind: 'query' }");
        }
        const capped = `SELECT * FROM (${input.sql}) AS t LIMIT ${options.maxRows}`;
        const reader = await connection.runAndReadAll(capped);
        yield {
          columns: reader.columnNames(),
          rows: reader.getRowsJS() as unknown[][],
          rowCount: reader.getRowsJS().length,
        };
      },
      getCapabilities() {
        return {
          supportsApproximateDistinct: false,
          supportsNativeHashing: true,
          supportsTableSampling: false,
          supportsQueryCancellation: false,
          supportsArrowResults: false,
          supportsInformationSchema: false,
          supportsTemporaryTables: false,
          supportsServerSideProfiling: false,
        };
      },
      quoteIdentifier(identifier: string) {
        return `"${identifier.replace(/"/g, '""')}"`;
      },
      buildProfileQuery() {
        return { sql: "", parameters: [] };
      },
    };
  }

  return {
    source: await buildConnector("variant_source", sourceValue),
    target: await buildConnector("variant_target", targetValue),
  };
}

/** Test-local row fetch helper (does not reuse planner.ts's fetchAllRows,
 * which is private to that module and outside this task's file ownership --
 * this is a minimal fetch, not a reimplementation of compareByHash's own
 * internal fetch logic, used purely to build an independent compareRows
 * input for the cross-check above). Accepts any `DataPlatformConnector`
 * (widened in round 2 to also accept the ad hoc adapters
 * `fixtureWithStringVariant` builds, not just `FixtureConnector`). */
async function fetchAllRows(
  connector: import("@paritylens/shared").DataPlatformConnector,
  table: string,
  columns: string[]
): Promise<{ columns: string[]; rows: unknown[][]; rowCount: number }> {
  const quoted = columns.map((c) => connector.quoteIdentifier(c)).join(", ");
  const sql = `SELECT ${quoted} FROM ${connector.quoteIdentifier(table)}`;
  const rows: unknown[][] = [];
  let resultColumns: string[] = [];
  for await (const batch of connector.executeQuery({ kind: "query", sql }, { maxRows: 1000, timeoutMs: 30_000 })) {
    resultColumns = batch.columns;
    rows.push(...batch.rows);
  }
  return { columns: resultColumns, rows, rowCount: rows.length };
}
