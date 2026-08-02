// T-14: row-level parity tests.
//
// Two red-state cases per TASK-BRIEF.md's "Red-state evidence" section:
// 1. A hand-built fixture row set covering matching / missing-from-target /
//    missing-from-source / duplicate-key-on-one-side / matched-key-differing
//    rows.
// 2. Idea Prompt.md section 2's literal ORDER_ID = 1008924 worked example
//    (all four columns), reproduced verbatim.
import { describe, expect, it } from "vitest";
import type { ColumnMappingEntry } from "../../orchestration/definition/definition.js";
import type { NormalizationRule } from "../../orchestration/definition/definition.js";
import { compareRows } from "./row-level.js";

describe("compareRows", () => {
  describe("classification categories", () => {
    // Columns: id, name, amount. Key: id.
    const columns = ["id", "name", "amount"];
    const mapping: ColumnMappingEntry[] = [
      { source: "name", target: "name" },
      { source: "amount", target: "amount" },
    ];

    it("classifies matching, missing, duplicate, and differing rows correctly", () => {
      const sourceRows = [
        [1, "Alice", 100], // matching
        [2, "Bob", 200], // missing-from-target
        [3, "Carl", 300], // matched-key-differing-values (name differs)
        [4, "Dup", 400], // duplicate-in-source (id 4 appears twice on source)
        [4, "Dup2", 401],
      ];
      const targetRows = [
        [1, "Alice", 100], // matching
        [3, "Carla", 300], // differs
        [5, "Eve", 500], // missing-from-source
      ];

      const results = compareRows(
        { columns, rows: sourceRows, rowCount: sourceRows.length },
        { columns, rows: targetRows, rowCount: targetRows.length },
        ["id"],
        mapping
      );

      const byCategory = (category: string) => results.filter((r) => r.category === category);

      expect(byCategory("matching")).toHaveLength(1);
      expect(byCategory("matching")[0]?.keyValues).toEqual([1]);

      expect(byCategory("missing-from-target")).toHaveLength(1);
      expect(byCategory("missing-from-target")[0]?.keyValues).toEqual([2]);

      expect(byCategory("missing-from-source")).toHaveLength(1);
      expect(byCategory("missing-from-source")[0]?.keyValues).toEqual([5]);

      expect(byCategory("matched-key-differing-values")).toHaveLength(1);
      const diffRow = byCategory("matched-key-differing-values")[0];
      expect(diffRow?.keyValues).toEqual([3]);
      expect(diffRow?.columnDifferences).toEqual([
        { columnName: "name", sourceValue: "Carl", targetValue: "Carla" },
      ]);

      // Both duplicate-in-source rows (key 4) should be reported.
      expect(byCategory("duplicate-in-source")).toHaveLength(2);
      expect(byCategory("duplicate-in-source").map((r) => r.keyValues)).toEqual([[4], [4]]);
    });

    it("classifies a key duplicated only on the target side", () => {
      const sourceRows = [[10, "Only", 1]];
      const targetRows = [
        [10, "Only", 1],
        [10, "OnlyAgain", 1],
      ];

      const results = compareRows(
        { columns, rows: sourceRows, rowCount: sourceRows.length },
        { columns, rows: targetRows, rowCount: targetRows.length },
        ["id"],
        mapping
      );

      const byCategory = (category: string) => results.filter((r) => r.category === category);
      expect(byCategory("duplicate-in-target")).toHaveLength(2);
      expect(byCategory("matching")).toHaveLength(0);
    });

    it("respects ignoreColumns: an excluded column that differs must not surface as matched-key-differing-values", () => {
      const sourceRows = [[1, "Alice", 100]];
      const targetRows = [[1, "AliceDiff", 100]];

      const results = compareRows(
        { columns, rows: sourceRows, rowCount: sourceRows.length },
        { columns, rows: targetRows, rowCount: targetRows.length },
        ["id"],
        mapping,
        {},
        { ignoreColumns: ["name"] }
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.category).toBe("matching");
    });

    it("classifies unable-to-compare when normalization throws for a mapped column", () => {
      const throwingRule: NormalizationRule = { truncateTo: "day" };
      const sourceRows = [[1, "Alice", 100]];
      // amount is expected to be a number; forcing a throw is simulated via
      // a rule that only applies to strings safely -- to exercise the
      // "Unable to compare" path deterministically, this test supplies a
      // mapping to a column that does not exist in the row shape (name
      // column index out of range on target), which the implementation
      // must catch and classify as unable-to-compare rather than throwing.
      const targetRows = [[1, "Alice"]]; // missing the "amount" column value entirely
      const badColumns = ["id", "name"];

      const results = compareRows(
        { columns, rows: sourceRows, rowCount: sourceRows.length },
        { columns: badColumns, rows: targetRows, rowCount: targetRows.length },
        ["id"],
        mapping,
        { amount: throwingRule }
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.category).toBe("unable-to-compare");
    });

    it("supports composite keys (two key columns)", () => {
      const compositeColumns = ["order_id", "line_number", "sku"];
      const compositeMapping: ColumnMappingEntry[] = [{ source: "sku", target: "sku" }];

      const sourceRows = [
        [100, 1, "SKU-A"],
        [100, 2, "SKU-B"],
      ];
      const targetRows = [
        [100, 1, "SKU-A"],
        [100, 2, "SKU-C"],
      ];

      const results = compareRows(
        { columns: compositeColumns, rows: sourceRows, rowCount: sourceRows.length },
        { columns: compositeColumns, rows: targetRows, rowCount: targetRows.length },
        ["order_id", "line_number"],
        compositeMapping
      );

      expect(results).toHaveLength(2);
      const matching = results.find((r) => r.category === "matching");
      expect(matching?.keyValues).toEqual([100, 1]);
      const differing = results.find((r) => r.category === "matched-key-differing-values");
      expect(differing?.keyValues).toEqual([100, 2]);
      expect(differing?.columnDifferences).toEqual([
        { columnName: "sku", sourceValue: "SKU-B", targetValue: "SKU-C" },
      ]);
    });

    // T-14-02 (REVIEW-REPORT.md, Minor): tolerance configured only via
    // rules[column].numericTolerance (the standard NormalizationRule field,
    // per Idea Prompt.md section 4 / definition.ts) must be honored without
    // also requiring the caller to duplicate it into
    // RowCompareOptions.numericTolerance.
    it("falls back to rules[column].numericTolerance when options.numericTolerance has no entry for the column", () => {
      const sourceRows = [[1, "Alice", 125.37]];
      const targetRows = [[1, "Alice", 125.38]];

      const results = compareRows(
        { columns, rows: sourceRows, rowCount: sourceRows.length },
        { columns, rows: targetRows, rowCount: targetRows.length },
        ["id"],
        mapping,
        { amount: { numericTolerance: { absolute: 0.01 } } }
        // No `options` argument -- options.numericTolerance is entirely absent.
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.category).toBe("matching");
    });
  });

  // T-28: bug fix -- indexByKey looked up the key column's index using the
  // source-side key name (from `keys`) against BOTH source and target
  // column lists, with no column_mapping translation applied to the key
  // lookup itself. When the key column is named differently on each side
  // (e.g. CustomerID source / CUSTOMER_ID target -- the real-world scenario
  // column_mapping exists for), the target-side lookup silently failed
  // (columns.indexOf returns -1), producing keyValues: [undefined] for
  // every target-side finding. Mirrors sqlserver-customer's real
  // CustomerID/CUSTOMER_ID naming and the live smoke-test bug report in
  // TASK-BRIEF.md.
  describe("T-28: key column named differently on source vs target", () => {
    const sourceColumns = ["CustomerID", "Name"];
    const targetColumns = ["CUSTOMER_ID", "NAME"];
    const mapping: ColumnMappingEntry[] = [
      { source: "CustomerID", target: "CUSTOMER_ID" },
      { source: "Name", target: "NAME" },
    ];

    it("resolves real key values (not undefined) for missing-from-target findings", () => {
      const sourceRows = [[1, "Alice"]];
      const targetRows: unknown[][] = [];

      const results = compareRows(
        { columns: sourceColumns, rows: sourceRows, rowCount: sourceRows.length },
        { columns: targetColumns, rows: targetRows, rowCount: targetRows.length },
        ["CustomerID"],
        mapping
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.category).toBe("missing-from-target");
      expect(results[0]?.keyValues).toEqual([1]);
    });

    it("resolves real key values (not undefined) for missing-from-source findings (target-side row, translated key column)", () => {
      const sourceRows: unknown[][] = [];
      const targetRows = [[2, "Bob"]];

      const results = compareRows(
        { columns: sourceColumns, rows: sourceRows, rowCount: sourceRows.length },
        { columns: targetColumns, rows: targetRows, rowCount: targetRows.length },
        ["CustomerID"],
        mapping
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.category).toBe("missing-from-source");
      expect(results[0]?.keyValues).toEqual([2]);
    });

    it("resolves real key values (not undefined) for a matched pair", () => {
      const sourceRows = [[3, "Carl"]];
      const targetRows = [[3, "Carl"]];

      const results = compareRows(
        { columns: sourceColumns, rows: sourceRows, rowCount: sourceRows.length },
        { columns: targetColumns, rows: targetRows, rowCount: targetRows.length },
        ["CustomerID"],
        mapping
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.category).toBe("matching");
      expect(results[0]?.keyValues).toEqual([3]);
    });
  });

  describe("Idea Prompt.md section 2 worked example: ORDER_ID = 1008924", () => {
    // Column           Source                 Target                Result
    // STATUS           Shipped                SHIPPED               Match after normalization
    // ORDER_AMOUNT     125.3700               125.37                Match
    // SHIP_DATE        2026-07-20 00:00:00    2026-07-20            Match
    // CUSTOMER_NAME    Acme Inc.              Acme, Inc.             Difference
    const columns = ["ORDER_ID", "STATUS", "ORDER_AMOUNT", "SHIP_DATE", "CUSTOMER_NAME"];
    const mapping: ColumnMappingEntry[] = [
      { source: "STATUS", target: "STATUS" },
      { source: "ORDER_AMOUNT", target: "ORDER_AMOUNT" },
      { source: "SHIP_DATE", target: "SHIP_DATE" },
      { source: "CUSTOMER_NAME", target: "CUSTOMER_NAME" },
    ];
    const rules: Record<string, NormalizationRule> = {
      STATUS: { caseSensitive: false },
      SHIP_DATE: { truncateTo: "day" },
    };

    const sourceRows = [[1008924, "Shipped", 125.37, "2026-07-20 00:00:00", "Acme Inc."]];
    const targetRows = [[1008924, "SHIPPED", 125.37, "2026-07-20", "Acme, Inc."]];

    it("reports Match for STATUS, ORDER_AMOUNT, SHIP_DATE and Difference for CUSTOMER_NAME", () => {
      const results = compareRows(
        { columns, rows: sourceRows, rowCount: 1 },
        { columns, rows: targetRows, rowCount: 1 },
        ["ORDER_ID"],
        mapping,
        rules,
        { numericTolerance: { ORDER_AMOUNT: { absolute: 0.01 } } }
      );

      expect(results).toHaveLength(1);
      const result = results[0];
      expect(result?.keyValues).toEqual([1008924]);
      expect(result?.category).toBe("matched-key-differing-values");

      // Only CUSTOMER_NAME should have failed to reconcile -- STATUS,
      // ORDER_AMOUNT, and SHIP_DATE all match after normalization/tolerance
      // and must NOT appear in columnDifferences.
      expect(result?.columnDifferences).toEqual([
        { columnName: "CUSTOMER_NAME", sourceValue: "Acme Inc.", targetValue: "Acme, Inc." },
      ]);
    });

    // T-14-01 (REVIEW-REPORT.md): the doc's own ORDER_AMOUNT row shows the
    // literal decimal-string forms "125.3700" vs "125.37", not two already-
    // equal parsed JS numbers. This case reproduces those literal strings
    // to prove numeric-string coercion (row-level.ts's own
    // coerceNumericTolerance helper) actually resolves them to "Match" via
    // numericTolerance, rather than relying on `===` equality of identical
    // parsed numbers to trivially pass.
    const sourceRowsLiteralStrings = [[1008924, "Shipped", "125.3700", "2026-07-20 00:00:00", "Acme Inc."]];
    const targetRowsLiteralStrings = [[1008924, "SHIPPED", "125.37", "2026-07-20", "Acme, Inc."]];

    it("reports Match for ORDER_AMOUNT using the doc's literal decimal-string forms (125.3700 vs 125.37)", () => {
      const results = compareRows(
        { columns, rows: sourceRowsLiteralStrings, rowCount: 1 },
        { columns, rows: targetRowsLiteralStrings, rowCount: 1 },
        ["ORDER_ID"],
        mapping,
        rules,
        { numericTolerance: { ORDER_AMOUNT: { absolute: 0.01 } } }
      );

      expect(results).toHaveLength(1);
      const result = results[0];
      expect(result?.category).toBe("matched-key-differing-values");

      // ORDER_AMOUNT must NOT appear in columnDifferences -- "125.3700" and
      // "125.37" are the same numeric value within tolerance once coerced.
      // Only CUSTOMER_NAME should differ.
      expect(result?.columnDifferences).toEqual([
        { columnName: "CUSTOMER_NAME", sourceValue: "Acme Inc.", targetValue: "Acme, Inc." },
      ]);
    });
  });
});
