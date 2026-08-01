// T-07: column profiling tests.
//
// Red-state test (see IMPLEMENTATION-REPORT.md for the captured failing run):
// `profileColumn` is exercised against the T-04 `sqlserver-customer` fixture
// source table's `CustomerName` column (String canonical category), with
// expected values hand-counted directly from
// packages/engine/fixtures/sqlserver-customer.ts's 6 source rows:
//
//   CustomerName values (source): "John Smith", "Jane Roe", "Alan Turing",
//   "Grace Hopper", "Ada Lovelace", "Margaret Hamilton"
//
//   rowCount = 6 (6 rows total)
//   populatedCount = 6 (NOT NULL column, all 6 populated)
//   nullCount = 0
//   nullPercentage = 0
//   distinctCount = 6 (all 6 names are distinct)
//   duplicateCount = 0 (rowCount - distinctCount, no duplicates)
//   emptyStringCount = 0 (no empty strings)
//   whitespaceOnlyCount = 0 (no whitespace-only strings)
//   lengths: "John Smith"=10, "Jane Roe"=8, "Alan Turing"=11,
//            "Grace Hopper"=12, "Ada Lovelace"=12, "Margaret Hamilton"=17
//   minLength = 8, maxLength = 17, avgLength = (10+8+11+12+12+17)/6 = 70/6 = 11.666...6667
//   case distribution: every name is mixed case (upper first letter(s),
//   lower remainder) -> uppercaseCount=0, lowercaseCount=0, mixedCaseCount=6
import { describe, expect, it } from "vitest";
import { FixtureConnector } from "../../connector-sdk/fixture/fixture-connector.js";
import { profileColumn, compareProfiles, buildProfileQueries, type ColumnProfile } from "./profiling.js";
import type { ColumnDefinition, ExecutionOptions, QueryInput, RecordBatch } from "@paritylens/shared";

const CUSTOMER_NAME_COLUMN: ColumnDefinition = {
  name: "CustomerName",
  ordinalPosition: 2,
  nativeType: "VARCHAR(100)",
  canonicalType: "String",
  nullable: false,
  isPrimaryKeyCandidate: false,
  length: 100,
};

// packages/engine/fixtures/sqlserver-customer.ts source rows, CreatedDate
// column values: 2024-01-05 08:30:00, 2024-01-06 09:15:00,
// 2024-01-07 10:00:00, 2024-01-08 11:45:00, 2024-01-09 13:00:00,
// 2024-01-10 14:30:00 -- all populated, all in the past relative to any
// "now" after 2024, so futureDateCount = 0 for a "now" fixed in 2026.
const CREATED_DATE_COLUMN: ColumnDefinition = {
  name: "CreatedDate",
  ordinalPosition: 3,
  nativeType: "TIMESTAMP",
  canonicalType: "Timestamp",
  nullable: true,
  isPrimaryKeyCandidate: false,
};

// packages/engine/fixtures/postgres-products.ts source rows, price column
// values: 9.99, 19.99, 49.99, 14.50, 89.00 (5 rows, all populated).
// min = 9.99, max = 89.00, mean = (9.99+19.99+49.99+14.50+89.00)/5
//     = 183.47/5 = 36.694
// zeroCount = 0, negativeCount = 0, positiveCount = 5
const PRICE_COLUMN: ColumnDefinition = {
  name: "price",
  ordinalPosition: 4,
  nativeType: "DECIMAL(10,2)",
  canonicalType: "Decimal",
  nullable: false,
  isPrimaryKeyCandidate: false,
  precision: 10,
  scale: 2,
};

// packages/engine/fixtures/postgres-products.ts source rows, in_stock
// column values: true, true, false, true, true (5 rows, all populated).
// true count = 4 (80%), false count = 1 (20%), cardinality = 2.
const IN_STOCK_COLUMN: ColumnDefinition = {
  name: "in_stock",
  ordinalPosition: 5,
  nativeType: "BOOLEAN",
  canonicalType: "Boolean",
  nullable: false,
  isPrimaryKeyCandidate: false,
};

describe("profileColumn", () => {
  it("computes general + string metrics for CustomerName (sqlserver-customer source), matching hand-counted values", async () => {
    const connector = new FixtureConnector("sqlserver-customer", "source");
    const profile = await profileColumn(connector, CUSTOMER_NAME_COLUMN, {
      input: { kind: "table", object: "customer_source" },
    });

    expect(profile.columnName).toBe("CustomerName");
    expect(profile.rowCount).toBe(6);
    expect(profile.populatedCount).toBe(6);
    expect(profile.nullCount).toBe(0);
    expect(profile.nullPercentage).toBe(0);
    expect(profile.distinctCount).toBe(6);
    expect(profile.duplicateCount).toBe(0);

    expect(profile.stringMetrics).toBeDefined();
    expect(profile.stringMetrics?.emptyStringCount).toBe(0);
    expect(profile.stringMetrics?.whitespaceOnlyCount).toBe(0);
    expect(profile.stringMetrics?.minLength).toBe(8);
    expect(profile.stringMetrics?.maxLength).toBe(17);
    expect(profile.stringMetrics?.avgLength).toBeCloseTo(70 / 6, 6);
    expect(profile.stringMetrics?.uppercaseCount).toBe(0);
    expect(profile.stringMetrics?.lowercaseCount).toBe(0);
    expect(profile.stringMetrics?.mixedCaseCount).toBe(6);

    expect(profile.numericMetrics).toBeUndefined();
    expect(profile.dateMetrics).toBeUndefined();
    expect(profile.booleanMetrics).toBeUndefined();
  });

  it("computes date/timestamp metrics for CreatedDate (sqlserver-customer source), matching hand-counted values", async () => {
    const connector = new FixtureConnector("sqlserver-customer", "source");
    const profile = await profileColumn(connector, CREATED_DATE_COLUMN, {
      input: { kind: "table", object: "customer_source" },
      now: new Date("2026-07-27T00:00:00Z"),
    });

    expect(profile.rowCount).toBe(6);
    expect(profile.populatedCount).toBe(6);
    expect(profile.nullCount).toBe(0);
    expect(profile.distinctCount).toBe(6);

    expect(profile.dateMetrics).toBeDefined();
    expect(profile.dateMetrics?.futureDateCount).toBe(0);
    expect(profile.dateMetrics?.earliest).toContain("2024-01-05");
    expect(profile.dateMetrics?.latest).toContain("2024-01-10");

    expect(profile.stringMetrics).toBeUndefined();
    expect(profile.numericMetrics).toBeUndefined();
    expect(profile.booleanMetrics).toBeUndefined();
  });

  it("computes numeric metrics for price (postgres-products source), matching hand-counted values", async () => {
    const connector = new FixtureConnector("postgres-products", "source");
    const profile = await profileColumn(connector, PRICE_COLUMN, {
      input: { kind: "table", object: "products_source" },
    });

    expect(profile.rowCount).toBe(5);
    expect(profile.populatedCount).toBe(5);
    expect(profile.nullCount).toBe(0);

    expect(profile.numericMetrics).toBeDefined();
    expect(profile.numericMetrics?.min).toBeCloseTo(9.99, 6);
    expect(profile.numericMetrics?.max).toBeCloseTo(89.0, 6);
    expect(profile.numericMetrics?.mean).toBeCloseTo(183.47 / 5, 6);
    expect(profile.numericMetrics?.zeroCount).toBe(0);
    expect(profile.numericMetrics?.negativeCount).toBe(0);
    expect(profile.numericMetrics?.positiveCount).toBe(5);

    expect(profile.stringMetrics).toBeUndefined();
    expect(profile.dateMetrics).toBeUndefined();
    expect(profile.booleanMetrics).toBeUndefined();
  });

  // I-02 regression test: TASK-BRIEF.md line 44's interface contract for
  // profileColumn explicitly requires "numeric metrics (min/max/mean/
  // median/stddev, ...)" for Integer/Decimal/FloatingPoint columns. Hand-
  // computed expected values from postgres-products.ts's price column
  // (source rows): 9.99, 19.99, 49.99, 14.50, 89.00.
  //
  //   sorted = [9.99, 14.50, 19.99, 49.99, 89.00], n = 5 (odd)
  //   median = middle value = 19.99
  //
  //   mean = 183.47 / 5 = 36.694
  //   deviations from mean: 9.99-36.694=-26.704, 19.99-36.694=-16.704,
  //     49.99-36.694=13.296, 14.50-36.694=-22.194, 89.00-36.694=52.306
  //   squared deviations: 713.103616, 279.023616, 176.783616, 492.573636,
  //     2735.917636
  //   sum of squared deviations = 4397.40212
  //   sample variance (n-1 = 4) = 4397.40212 / 4 = 1099.35053
  //   sample stddev = sqrt(1099.35053) = 33.156455329241695
  //
  // (Cross-checked with Python's statistics.stdev([9.99,19.99,49.99,14.50,89.00])
  // = 33.156455329241695, statistics.median(...) = 19.99.)
  it("computes median and stddev for price (postgres-products source), matching hand-computed values (I-02)", async () => {
    const connector = new FixtureConnector("postgres-products", "source");
    const profile = await profileColumn(connector, PRICE_COLUMN, {
      input: { kind: "table", object: "products_source" },
    });

    expect(profile.numericMetrics).toBeDefined();
    expect(profile.numericMetrics?.median).toBeCloseTo(19.99, 6);
    expect(profile.numericMetrics?.stddev).toBeCloseTo(33.156455329241695, 6);
  });

  it("computes boolean metrics for in_stock (postgres-products source), matching hand-counted values", async () => {
    const connector = new FixtureConnector("postgres-products", "source");
    const profile = await profileColumn(connector, IN_STOCK_COLUMN, {
      input: { kind: "table", object: "products_source" },
    });

    expect(profile.rowCount).toBe(5);
    expect(profile.populatedCount).toBe(5);
    expect(profile.nullCount).toBe(0);

    expect(profile.booleanMetrics).toBeDefined();
    expect(profile.booleanMetrics?.cardinality).toBe(2);
    expect(profile.booleanMetrics?.countByValue.true).toBe(4);
    expect(profile.booleanMetrics?.countByValue.false).toBe(1);
    expect(profile.booleanMetrics?.percentageByValue.true).toBeCloseTo(80, 6);
    expect(profile.booleanMetrics?.percentageByValue.false).toBeCloseTo(20, 6);
    expect(profile.distinctValues?.sort()).toEqual(["false", "true"]);

    expect(profile.stringMetrics).toBeUndefined();
    expect(profile.numericMetrics).toBeUndefined();
    expect(profile.dateMetrics).toBeUndefined();
  });
});

describe("compareProfiles", () => {
  it("surfaces a most-common-value change as a meaningful difference (STATUS worked example pattern)", () => {
    const source: ColumnProfile = {
      columnName: "STATUS",
      rowCount: 100,
      populatedCount: 100,
      nullCount: 0,
      nullPercentage: 0,
      distinctCount: 4,
      duplicateCount: 96,
      mostCommonValue: "ACTIVE",
    };
    const target: ColumnProfile = {
      columnName: "STATUS",
      rowCount: 100,
      populatedCount: 100,
      nullCount: 0,
      nullPercentage: 0,
      distinctCount: 5,
      duplicateCount: 95,
      mostCommonValue: "ARCHIVED",
    };

    const differences = compareProfiles(source, target);

    const mostCommonFinding = differences.find((d) => d.metric === "mostCommonValue");
    expect(mostCommonFinding).toBeDefined();
    expect(mostCommonFinding?.sourceValue).toBe("ACTIVE");
    expect(mostCommonFinding?.targetValue).toBe("ARCHIVED");
    expect(mostCommonFinding?.columnName).toBe("STATUS");

    const distinctFinding = differences.find((d) => d.metric === "distinctCount");
    expect(distinctFinding).toBeDefined();
    expect(distinctFinding?.sourceValue).toBe(4);
    expect(distinctFinding?.targetValue).toBe(5);
  });

  it("surfaces a new target value and a missing target value for boolean/categorical profiles", () => {
    const source: ColumnProfile = {
      columnName: "STATUS",
      rowCount: 100,
      populatedCount: 100,
      nullCount: 0,
      nullPercentage: 0,
      distinctCount: 2,
      duplicateCount: 98,
      mostCommonValue: "ACTIVE",
      distinctValues: ["ACTIVE", "INACTIVE"],
    };
    const target: ColumnProfile = {
      columnName: "STATUS",
      rowCount: 100,
      populatedCount: 100,
      nullCount: 0,
      nullPercentage: 0,
      distinctCount: 2,
      duplicateCount: 98,
      mostCommonValue: "ACTIVE",
      distinctValues: ["ACTIVE", "ARCHIVED"],
    };

    const differences = compareProfiles(source, target);

    const newTarget = differences.find((d) => d.metric === "newTargetValue");
    expect(newTarget).toBeDefined();
    expect(newTarget?.targetValue).toBe("ARCHIVED");

    const missingTarget = differences.find((d) => d.metric === "missingTargetValue");
    expect(missingTarget).toBeDefined();
    expect(missingTarget?.sourceValue).toBe("INACTIVE");

    // distinctCount and mostCommonValue are unchanged (both 2 / "ACTIVE"), so
    // neither of those findings should appear -- confirms this is a targeted
    // diff, not a blind side-by-side dump.
    expect(differences.find((d) => d.metric === "distinctCount")).toBeUndefined();
    expect(differences.find((d) => d.metric === "mostCommonValue")).toBeUndefined();
  });

  it("reports a null-percentage change only when it exceeds the documented threshold", () => {
    const base: ColumnProfile = {
      columnName: "EMAIL",
      rowCount: 1000,
      populatedCount: 998,
      nullCount: 2,
      nullPercentage: 0.2,
      distinctCount: 998,
      duplicateCount: 0,
      mostCommonValue: "a@example.com",
    };

    const tinyChange: ColumnProfile = { ...base, nullPercentage: 0.3 };
    expect(compareProfiles(base, tinyChange).find((d) => d.metric === "nullPercentage")).toBeUndefined();

    const materialChange: ColumnProfile = { ...base, nullPercentage: 5.0 };
    const findings = compareProfiles(base, materialChange);
    const nullFinding = findings.find((d) => d.metric === "nullPercentage");
    expect(nullFinding).toBeDefined();
    expect(nullFinding?.severity).toBe("Warning");
    expect(nullFinding?.sourceValue).toBe(0.2);
    expect(nullFinding?.targetValue).toBe(5.0);
  });

  it("returns no findings for two identical profiles", () => {
    const profile: ColumnProfile = {
      columnName: "ID",
      rowCount: 10,
      populatedCount: 10,
      nullCount: 0,
      nullPercentage: 0,
      distinctCount: 10,
      duplicateCount: 0,
      mostCommonValue: "1",
      distinctValues: ["1", "2"],
    };
    expect(compareProfiles(profile, { ...profile })).toEqual([]);
  });
});

// T-16b: SQL preview panel. buildProfileQueries must mirror profileColumn's
// own type-dispatch logic exactly (not an approximate/simplified copy), and
// must return the ordered list of every SQL string profileColumn actually
// issues for that column, so preview and execution can never drift apart.
describe("buildProfileQueries", () => {
  it("returns the general-metrics and most-common-value queries for every column, and matches the SQL profileColumn actually issues (String category)", async () => {
    const connector = new FixtureConnector("sqlserver-customer", "source");
    const input: QueryInput = { kind: "table", object: "customer_source" };

    const previewedQueries = buildProfileQueries(connector, CUSTOMER_NAME_COLUMN, { input });

    // Spy on executeQuery to capture every SQL string profileColumn actually
    // sends, in order, and assert the full ordered list matches the
    // builder's output byte-for-byte -- not just that both look plausible.
    const capturedSql: string[] = [];
    const originalExecuteQuery = connector.executeQuery.bind(connector);
    connector.executeQuery = function spyExecuteQuery(
      query: QueryInput,
      options: ExecutionOptions
    ): AsyncIterable<RecordBatch> {
      if (query.kind === "query") {
        capturedSql.push(query.sql);
      }
      return originalExecuteQuery(query, options);
    };

    await profileColumn(connector, CUSTOMER_NAME_COLUMN, { input });

    expect(capturedSql).toEqual(previewedQueries);
    // General metrics + most-common-value + string metrics (2 queries) = 4.
    expect(previewedQueries.length).toBe(4);
    expect(previewedQueries[0]).toContain("row_count");
    expect(previewedQueries[0]).toContain("populated_count");
    expect(previewedQueries[0]).toContain("distinct_count");
  });

  it("returns a list containing at least the general-metrics and numeric-metrics query strings for a numeric column, matching profileColumn's actual issued queries", async () => {
    const connector = new FixtureConnector("postgres-products", "source");
    const input: QueryInput = { kind: "table", object: "products_source" };

    const previewedQueries = buildProfileQueries(connector, PRICE_COLUMN, { input });

    const capturedSql: string[] = [];
    const originalExecuteQuery = connector.executeQuery.bind(connector);
    connector.executeQuery = function spyExecuteQuery(
      query: QueryInput,
      options: ExecutionOptions
    ): AsyncIterable<RecordBatch> {
      if (query.kind === "query") {
        capturedSql.push(query.sql);
      }
      return originalExecuteQuery(query, options);
    };

    await profileColumn(connector, PRICE_COLUMN, { input });

    expect(capturedSql).toEqual(previewedQueries);
    // General metrics + most-common-value + numeric metrics (1 query) = 3.
    expect(previewedQueries.length).toBe(3);
    expect(previewedQueries.some((sql) => sql.includes("MEDIAN") && sql.includes("STDDEV_SAMP"))).toBe(true);
  });

  it("matches profileColumn's actual issued queries for a Date-family column", async () => {
    const connector = new FixtureConnector("sqlserver-customer", "source");
    const input: QueryInput = { kind: "table", object: "customer_source" };
    const now = new Date("2026-07-27T00:00:00Z");

    const previewedQueries = buildProfileQueries(connector, CREATED_DATE_COLUMN, { input, now });

    const capturedSql: string[] = [];
    const originalExecuteQuery = connector.executeQuery.bind(connector);
    connector.executeQuery = function spyExecuteQuery(
      query: QueryInput,
      options: ExecutionOptions
    ): AsyncIterable<RecordBatch> {
      if (query.kind === "query") {
        capturedSql.push(query.sql);
      }
      return originalExecuteQuery(query, options);
    };

    await profileColumn(connector, CREATED_DATE_COLUMN, { input, now });

    expect(capturedSql).toEqual(previewedQueries);
    // General metrics + most-common-value + date metrics (2 queries) = 4.
    expect(previewedQueries.length).toBe(4);
  });

  it("matches profileColumn's actual issued queries for a Boolean column", async () => {
    const connector = new FixtureConnector("postgres-products", "source");
    const input: QueryInput = { kind: "table", object: "products_source" };

    const previewedQueries = buildProfileQueries(connector, IN_STOCK_COLUMN, { input });

    const capturedSql: string[] = [];
    const originalExecuteQuery = connector.executeQuery.bind(connector);
    connector.executeQuery = function spyExecuteQuery(
      query: QueryInput,
      options: ExecutionOptions
    ): AsyncIterable<RecordBatch> {
      if (query.kind === "query") {
        capturedSql.push(query.sql);
      }
      return originalExecuteQuery(query, options);
    };

    await profileColumn(connector, IN_STOCK_COLUMN, { input });

    expect(capturedSql).toEqual(previewedQueries);
    // General metrics + most-common-value + boolean metrics (1 query) = 3.
    expect(previewedQueries.length).toBe(3);
  });
});
