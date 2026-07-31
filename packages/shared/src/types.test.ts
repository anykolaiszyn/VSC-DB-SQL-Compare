// Focused shape/type-check test for T-02 shared types.
//
// This file exercises every interface/type this task must produce by
// constructing minimal conforming object literals. TypeScript's structural
// checking (via `tsc --noEmit` in `npm run verify`, plus Vitest executing
// this file) is the actual "test" — if a required field is missing or
// misnamed, this file fails to compile.
import { describe, expect, it } from "vitest";
import type {
  CanonicalTypeCategory,
  ColumnDefinition,
  ComparisonResult,
  ConnectorCapabilities,
  DataPlatformConnector,
  ExecutionOptions,
  ObjectScope,
  ProfileOptions,
  QueryInput,
  RecordBatch
} from "./index.js";

describe("T-02 canonical shared types", () => {
  it("accepts all 15 canonical type categories", () => {
    const categories: CanonicalTypeCategory[] = [
      "Integer",
      "Decimal",
      "FloatingPoint",
      "Boolean",
      "String",
      "Binary",
      "Date",
      "Time",
      "Timestamp",
      "TimestampWithTimezone",
      "JSON",
      "Array",
      "Object",
      "Geospatial",
      "Unknown"
    ];
    expect(categories).toHaveLength(15);
  });

  it("constructs a minimal conforming ColumnDefinition", () => {
    const column: ColumnDefinition = {
      name: "customer_id",
      ordinalPosition: 1,
      nativeType: "NUMBER(38,0)",
      canonicalType: "Integer",
      nullable: false,
      isPrimaryKeyCandidate: true
    };
    expect(column.name).toBe("customer_id");
    expect(column.canonicalType).toBe("Integer");
  });

  it("constructs a ColumnDefinition with optional length/precision/scale", () => {
    const column: ColumnDefinition = {
      name: "customer_name",
      ordinalPosition: 2,
      nativeType: "VARCHAR(255)",
      canonicalType: "String",
      nullable: true,
      isPrimaryKeyCandidate: false,
      length: 255
    };
    expect(column.length).toBe(255);
  });

  it("constructs a minimal conforming QueryInput for each MVP input kind", () => {
    const tableInput: QueryInput = { kind: "table", object: "dbo.Customer" };
    const queryInput: QueryInput = { kind: "query", sql: "SELECT * FROM dbo.Customer" };
    const fileInput: QueryInput = { kind: "sqlFile", filePath: "./source.sql" };
    expect(tableInput.kind).toBe("table");
    expect(queryInput.kind).toBe("query");
    expect(fileInput.kind).toBe("sqlFile");
  });

  it("constructs a minimal conforming ExecutionOptions", () => {
    const options: ExecutionOptions = {
      maxRows: 100000,
      timeoutMs: 60000
    };
    expect(options.maxRows).toBe(100000);
  });

  it("constructs a minimal conforming RecordBatch", () => {
    const batch: RecordBatch = {
      columns: ["customer_id", "customer_name"],
      rows: [
        [1, "Acme Inc."],
        [2, "Widgets Co."]
      ],
      rowCount: 2
    };
    expect(batch.rowCount).toBe(2);
  });

  it("constructs a minimal conforming ConnectorCapabilities", () => {
    const capabilities: ConnectorCapabilities = {
      supportsApproximateDistinct: true,
      supportsNativeHashing: false,
      supportsTableSampling: true,
      supportsQueryCancellation: true,
      supportsArrowResults: false,
      supportsInformationSchema: true,
      supportsTemporaryTables: true,
      supportsServerSideProfiling: false
    };
    expect(capabilities.supportsApproximateDistinct).toBe(true);
  });

  it("constructs a ConnectorCapabilities with optional maximumParameters", () => {
    const capabilities: ConnectorCapabilities = {
      supportsApproximateDistinct: false,
      supportsNativeHashing: false,
      supportsTableSampling: false,
      supportsQueryCancellation: false,
      supportsArrowResults: false,
      supportsInformationSchema: false,
      supportsTemporaryTables: false,
      supportsServerSideProfiling: false,
      maximumParameters: 2100
    };
    expect(capabilities.maximumParameters).toBe(2100);
  });

  it("type-checks a minimal DataPlatformConnector implementation", () => {
    const connector: DataPlatformConnector = {
      async testConnection() {
        return { success: true };
      },
      async getCatalogs() {
        return [];
      },
      async getSchemas(catalog?: string) {
        void catalog;
        return [];
      },
      async getObjects(scope: ObjectScope) {
        void scope;
        return [];
      },
      async getSchema(input: QueryInput) {
        void input;
        return [];
      },
      executeQuery(input: QueryInput, options: ExecutionOptions): AsyncIterable<RecordBatch> {
        void input;
        void options;
        return {
          async *[Symbol.asyncIterator]() {
            // No batches yielded — this is a shape check only.
          }
        };
      },
      getCapabilities() {
        return {
          supportsApproximateDistinct: false,
          supportsNativeHashing: false,
          supportsTableSampling: false,
          supportsQueryCancellation: false,
          supportsArrowResults: false,
          supportsInformationSchema: false,
          supportsTemporaryTables: false,
          supportsServerSideProfiling: false
        };
      },
      quoteIdentifier(identifier: string) {
        return `"${identifier}"`;
      },
      buildProfileQuery(input: QueryInput, columns: ColumnDefinition[], profileOptions: ProfileOptions) {
        void input;
        void columns;
        void profileOptions;
        return { sql: "SELECT 1", parameters: [] };
      }
    };
    expect(connector.quoteIdentifier("foo")).toBe('"foo"');
  });

  it("constructs a minimal conforming ComparisonResult matching idea doc section 11", () => {
    const result: ComparisonResult = {
      comparison: "customer-migration-parity",
      runId: "2026-07-27T16:22:10Z",
      status: "failed",
      summary: {
        passed: 47,
        warnings: 3,
        failed: 2
      },
      rowCounts: {
        source: 12405128,
        target: 12402991,
        difference: -2137
      },
      schemaDifferences: [],
      profileDifferences: [],
      aggregateDifferences: [],
      rowDifferences: [],
      execution: {
        sourceDurationMs: 18230,
        targetDurationMs: 9410,
        comparisonDurationMs: 7183
      }
    };
    expect(result.summary.passed).toBe(47);
    expect(result.rowCounts.difference).toBe(-2137);
  });

  it("constructs difference-array items with a severity field", () => {
    const result: ComparisonResult = {
      comparison: "x",
      runId: "y",
      status: "warning",
      summary: { passed: 1, warnings: 1, failed: 0 },
      rowCounts: { source: 1, target: 1, difference: 0 },
      schemaDifferences: [
        { severity: "Warning", message: "column order differs", columnName: "CustomerID", kind: "order-mismatch" }
      ],
      profileDifferences: [
        { severity: "Informational", message: "distinct count differs", columnName: "STATUS", metric: "distinctCount" }
      ],
      aggregateDifferences: [
        {
          severity: "Failure",
          message: "sum(order_amount) differs",
          sourceCount: 100,
          targetCount: 90,
          difference: -10,
          differenceRate: -10
        }
      ],
      rowDifferences: [
        { severity: "Pass", message: "no differences", category: "matching", keyValues: [1] }
      ],
      execution: { sourceDurationMs: 1, targetDurationMs: 1, comparisonDurationMs: 1 }
    };
    expect(result.schemaDifferences[0]?.severity).toBe("Warning");
  });
});
