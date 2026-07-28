// T-06: schema diff tests.
//
// Structure:
//   1. Acceptance-criterion-1 proof: compareSchemas against the actual
//      T-04 sqlserver-customer fixture pair's real schemas (fetched via
//      FixtureConnector.getSchema), asserting the documented dropped
//      CreditLimit column produces a Failure-severity finding.
//   2. M-07 resolution proof: identical native-type strings on both sides
//      short-circuit to Compatible (no Review), even though T-05's
//      compareCanonicalTypes would otherwise downgrade same-category
//      Timestamp/Timestamp (and Time/Time) pairs to Review.
//   3. M-07 non-regression proof: the original DATETIME/TIMESTAMP_NTZ
//      (different native strings, same Timestamp category) pairing still
//      produces a Review-level finding, confirming the identical-string
//      short-circuit did not just delete T-05's documented behavior.
//   4. Broader coverage: matching schema -> zero findings; column order
//      difference; length/precision/scale mismatches; nullability mismatch.
import { describe, expect, it } from "vitest";
import type { ColumnDefinition } from "@paritylens/shared";
import { FixtureConnector } from "../../connector-sdk/fixture/fixture-connector.js";
import { compareSchemas } from "./schema-diff.js";

function column(overrides: Partial<ColumnDefinition> & Pick<ColumnDefinition, "name" | "nativeType">): ColumnDefinition {
  return {
    ordinalPosition: 1,
    canonicalType: "Unknown",
    nullable: true,
    isPrimaryKeyCandidate: false,
    ...overrides,
  };
}

describe("compareSchemas", () => {
  describe("acceptance criterion 1: sqlserver-customer fixture (dropped CreditLimit column)", () => {
    it("produces a Failure-severity finding for the missing CreditLimit column", async () => {
      const source = new FixtureConnector("sqlserver-customer", "source");
      const target = new FixtureConnector("sqlserver-customer", "target");

      const sourceColumns = await source.getSchema({ kind: "table", object: "customer_source" });
      const targetColumns = await target.getSchema({ kind: "table", object: "customer_target" });

      const findings = compareSchemas(sourceColumns, targetColumns);

      const creditLimitFinding = findings.find(
        (f) => f.columnName === "CreditLimit" && f.kind === "missing-in-target"
      );
      expect(creditLimitFinding).toBeDefined();
      expect(creditLimitFinding?.severity).toBe("Failure");
    });
  });

  describe("M-07 resolution: identical native type strings", () => {
    it("produces no Review finding when source and target native type strings are identical", () => {
      const source = [column({ name: "CreatedDate", nativeType: "DATETIME2", canonicalType: "Timestamp" })];
      const target = [column({ name: "CreatedDate", nativeType: "DATETIME2", canonicalType: "Timestamp" })];

      const findings = compareSchemas(source, target);

      const typeFindings = findings.filter((f) => f.columnName === "CreatedDate" && f.kind === "type-mismatch");
      expect(typeFindings).toHaveLength(0);
    });

    it("still produces a Review-level finding for DATETIME vs TIMESTAMP_NTZ (different native strings, same category)", () => {
      const source = [column({ name: "CreatedDate", nativeType: "DATETIME", canonicalType: "Timestamp" })];
      const target = [column({ name: "CreatedDate", nativeType: "TIMESTAMP_NTZ", canonicalType: "Timestamp" })];

      const findings = compareSchemas(source, target);

      const typeFinding = findings.find((f) => f.kind === "type-mismatch");
      expect(typeFinding).toBeDefined();
      expect(typeFinding?.severity).toBe("Warning");
    });
  });

  describe("broader coverage", () => {
    it("produces zero findings for identical matching schemas", () => {
      const columns: ColumnDefinition[] = [
        column({ name: "ID", ordinalPosition: 1, nativeType: "INT", canonicalType: "Integer", nullable: false }),
        column({ name: "Name", ordinalPosition: 2, nativeType: "VARCHAR(100)", canonicalType: "String", length: 100 }),
      ];
      const findings = compareSchemas(columns, columns.map((c) => ({ ...c })));
      expect(findings).toHaveLength(0);
    });

    it("flags a column-order difference", () => {
      const source: ColumnDefinition[] = [
        column({ name: "ID", ordinalPosition: 1, nativeType: "INT", canonicalType: "Integer" }),
        column({ name: "Name", ordinalPosition: 2, nativeType: "VARCHAR(100)", canonicalType: "String" }),
      ];
      const target: ColumnDefinition[] = [
        column({ name: "Name", ordinalPosition: 1, nativeType: "VARCHAR(100)", canonicalType: "String" }),
        column({ name: "ID", ordinalPosition: 2, nativeType: "INT", canonicalType: "Integer" }),
      ];
      const findings = compareSchemas(source, target);
      const orderFindings = findings.filter((f) => f.kind === "order-mismatch");
      expect(orderFindings.length).toBeGreaterThan(0);
    });

    it("flags a length mismatch", () => {
      const source = [column({ name: "Name", nativeType: "VARCHAR(100)", canonicalType: "String", length: 100 })];
      const target = [column({ name: "Name", nativeType: "VARCHAR(50)", canonicalType: "String", length: 50 })];
      const findings = compareSchemas(source, target);
      const lengthFinding = findings.find((f) => f.kind === "length-mismatch");
      expect(lengthFinding).toBeDefined();
    });

    it("flags a precision mismatch", () => {
      const source = [
        column({ name: "Amount", nativeType: "DECIMAL(18,2)", canonicalType: "Decimal", precision: 18, scale: 2 }),
      ];
      const target = [
        column({ name: "Amount", nativeType: "DECIMAL(10,2)", canonicalType: "Decimal", precision: 10, scale: 2 }),
      ];
      const findings = compareSchemas(source, target);
      const precisionFinding = findings.find((f) => f.kind === "precision-mismatch");
      expect(precisionFinding).toBeDefined();
    });

    it("flags a scale mismatch", () => {
      const source = [
        column({ name: "Amount", nativeType: "DECIMAL(18,4)", canonicalType: "Decimal", precision: 18, scale: 4 }),
      ];
      const target = [
        column({ name: "Amount", nativeType: "DECIMAL(18,2)", canonicalType: "Decimal", precision: 18, scale: 2 }),
      ];
      const findings = compareSchemas(source, target);
      const scaleFinding = findings.find((f) => f.kind === "scale-mismatch");
      expect(scaleFinding).toBeDefined();
    });

    it("flags a nullability mismatch", () => {
      const source = [column({ name: "Email", nativeType: "VARCHAR(255)", canonicalType: "String", nullable: true })];
      const target = [column({ name: "Email", nativeType: "VARCHAR(255)", canonicalType: "String", nullable: false })];
      const findings = compareSchemas(source, target);
      const nullabilityFinding = findings.find((f) => f.kind === "nullability-mismatch");
      expect(nullabilityFinding).toBeDefined();
    });

    it("defaults a missing-in-source column to Failure severity", () => {
      const source: ColumnDefinition[] = [];
      const target = [column({ name: "Extra", nativeType: "VARCHAR(50)", canonicalType: "String" })];
      const findings = compareSchemas(source, target);
      const finding = findings.find((f) => f.kind === "missing-in-source");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("Failure");
    });

    it("honors an expectations override for missing_target_column severity", () => {
      const source = [column({ name: "CreditLimit", nativeType: "MONEY", canonicalType: "Decimal" })];
      const target: ColumnDefinition[] = [];
      const findings = compareSchemas(source, target, { missingTargetColumnSeverity: "Warning" });
      const finding = findings.find((f) => f.kind === "missing-in-target");
      expect(finding?.severity).toBe("Warning");
    });
  });
});
