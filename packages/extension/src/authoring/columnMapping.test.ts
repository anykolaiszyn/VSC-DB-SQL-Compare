import { describe, expect, it } from "vitest";
import type { ColumnDefinition } from "@paritylens/shared";
import {
  buildMappingRowsFromColumns,
  buildManualMappingRows,
  mappingRowsToColumnMappingEntries,
  type ColumnMappingRow
} from "./columnMapping";

function col(name: string, ordinalPosition: number): ColumnDefinition {
  return {
    name,
    ordinalPosition,
    nativeType: "VARCHAR(50)",
    canonicalType: "String",
    nullable: true,
    isPrimaryKeyCandidate: false
  };
}

describe("buildMappingRowsFromColumns (Table-mode-only live fetch shaping)", () => {
  it("builds one row per source column, each carrying the full target column-name list for the dropdown", () => {
    const sourceColumns = [col("customer_uuid", 1), col("full_name", 2)];
    const targetColumns = [col("customer_id", 1), col("name", 2), col("email", 3)];

    const rows = buildMappingRowsFromColumns(sourceColumns, targetColumns);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ source: "customer_uuid", target: "", targetOptions: ["customer_id", "name", "email"] });
    expect(rows[1]).toEqual({ source: "full_name", target: "", targetOptions: ["customer_id", "name", "email"] });
  });

  it("pre-selects a target column when its name matches the source column name exactly (identical-name default)", () => {
    const sourceColumns = [col("customer_id", 1)];
    const targetColumns = [col("customer_id", 1), col("name", 2)];

    const rows = buildMappingRowsFromColumns(sourceColumns, targetColumns);

    expect(rows[0]?.target).toBe("customer_id");
  });

  it("returns an empty row list for an empty source column list", () => {
    expect(buildMappingRowsFromColumns([], [col("a", 1)])).toEqual([]);
  });
});

describe("buildManualMappingRows (fallback for non-Table-mode / fetch-failure)", () => {
  it("returns a single blank editable row by default", () => {
    const rows = buildManualMappingRows();
    expect(rows).toEqual([{ source: "", target: "", targetOptions: [] }]);
  });

  it("preserves an existing set of manually-entered rows when provided", () => {
    const existing: ColumnMappingRow[] = [
      { source: "a", target: "b", targetOptions: [] },
      { source: "c", target: "d", targetOptions: [] }
    ];
    expect(buildManualMappingRows(existing)).toEqual(existing);
  });
});

describe("mappingRowsToColumnMappingEntries", () => {
  it("converts rows with both source and target filled into plain {source, target} ColumnMappingEntry entries", () => {
    const rows: ColumnMappingRow[] = [
      { source: "customer_id", target: "customer_id", targetOptions: ["customer_id"] },
      { source: "full_name", target: "name", targetOptions: ["name"] }
    ];

    expect(mappingRowsToColumnMappingEntries(rows)).toEqual([
      { source: "customer_id", target: "customer_id" },
      { source: "full_name", target: "name" }
    ]);
  });

  it("skips a row with no target selected (identical-name fallback applies at comparison time, per T-28 precedent -- no entry needed)", () => {
    const rows: ColumnMappingRow[] = [{ source: "customer_id", target: "", targetOptions: ["customer_id"] }];
    expect(mappingRowsToColumnMappingEntries(rows)).toEqual([]);
  });

  it("skips a row with an empty/blank source name (incomplete manual-entry row)", () => {
    const rows: ColumnMappingRow[] = [{ source: "   ", target: "name", targetOptions: [] }];
    expect(mappingRowsToColumnMappingEntries(rows)).toEqual([]);
  });

  it("trims whitespace from manually-entered source/target names", () => {
    const rows: ColumnMappingRow[] = [{ source: "  full_name  ", target: "  name  ", targetOptions: [] }];
    expect(mappingRowsToColumnMappingEntries(rows)).toEqual([{ source: "full_name", target: "name" }]);
  });

  it("returns an empty array for an empty row list", () => {
    expect(mappingRowsToColumnMappingEntries([])).toEqual([]);
  });
});
