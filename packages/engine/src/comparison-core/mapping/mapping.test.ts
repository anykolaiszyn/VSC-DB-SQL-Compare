// T-12: column mapping suggestion tests.
//
// Red-state proof (TASK-BRIEF.md "Red-state evidence"): a test asserting
// suggestMappings proposes customer_id -> CUSTOMER_ID (case-insensitive
// exact match) for a fixture pair of ColumnDefinition[] arrays. This must
// fail until suggestMappings exists.
//
// Structure:
//   1. Idea Prompt.md section 3 worked example, exercised literally:
//      - customer_id -> CUSTOMER_ID: exact match once case-folded (the
//        idea doc labels this pair as achievable by simple matching).
//      - cust_nm, created_dt, active_ind: abbreviation-based renames that
//        the brief explicitly excludes from scope (no fuzzy/abbreviation
//        matching) -- asserted to NOT produce a confident suggestion,
//        proving the scope boundary rather than claiming it "mostly works".
//   2. Each of the four in-scope strategies individually: exact,
//      case-insensitive, snake_case<->camelCase, ordinal fallback.
//   3. No-candidate case: a source column with no plausible target at all.
import { describe, expect, it } from "vitest";
import type { ColumnDefinition } from "@paritylens/shared";
import { suggestMappings } from "./mapping.js";

function column(overrides: Partial<ColumnDefinition> & Pick<ColumnDefinition, "name">): ColumnDefinition {
  return {
    ordinalPosition: 1,
    nativeType: "VARCHAR",
    canonicalType: "String",
    nullable: true,
    isPrimaryKeyCandidate: false,
    ...overrides,
  };
}

describe("suggestMappings", () => {
  describe("Idea Prompt.md section 3 worked example", () => {
    const source: ColumnDefinition[] = [
      column({ name: "customer_id", ordinalPosition: 1 }),
      column({ name: "cust_nm", ordinalPosition: 2 }),
      column({ name: "created_dt", ordinalPosition: 3 }),
      column({ name: "active_ind", ordinalPosition: 4 }),
    ];
    const target: ColumnDefinition[] = [
      column({ name: "CUSTOMER_ID", ordinalPosition: 1 }),
      column({ name: "CUSTOMER_NAME", ordinalPosition: 2 }),
      column({ name: "CREATED_TIMESTAMP", ordinalPosition: 3 }),
      column({ name: "IS_ACTIVE", ordinalPosition: 4 }),
    ];

    it("suggests customer_id -> CUSTOMER_ID via case-insensitive matching", () => {
      const suggestions = suggestMappings(source, target);
      const match = suggestions.find((s) => s.source === "customer_id");
      expect(match).toBeDefined();
      expect(match?.target).toBe("CUSTOMER_ID");
      expect(match?.strategy).toBe("case-insensitive");
    });

    it("does NOT suggest a confident match for cust_nm -> CUSTOMER_NAME (abbreviation, out of scope)", () => {
      const suggestions = suggestMappings(source, target);
      const match = suggestions.find((s) => s.source === "cust_nm");
      // Ordinal fallback would still pair cust_nm (position 2) with
      // CUSTOMER_NAME (position 2) -- but per the brief, only the four
      // named strategies are in scope, and ordinal is explicitly a
      // "last-resort fallback", not a confident match. Assert directly
      // that no exact/case-insensitive/snake-camel strategy fired.
      if (match) {
        expect(match.strategy).not.toBe("exact");
        expect(match.strategy).not.toBe("case-insensitive");
        expect(match.strategy).not.toBe("snake-camel");
      }
    });

    it("does NOT suggest a confident match for created_dt -> CREATED_TIMESTAMP (abbreviation, out of scope)", () => {
      const suggestions = suggestMappings(source, target);
      const match = suggestions.find((s) => s.source === "created_dt");
      if (match) {
        expect(match.strategy).not.toBe("exact");
        expect(match.strategy).not.toBe("case-insensitive");
        expect(match.strategy).not.toBe("snake-camel");
      }
    });

    it("does NOT suggest a confident match for active_ind -> IS_ACTIVE (abbreviation, out of scope)", () => {
      const suggestions = suggestMappings(source, target);
      const match = suggestions.find((s) => s.source === "active_ind");
      if (match) {
        expect(match.strategy).not.toBe("exact");
        expect(match.strategy).not.toBe("case-insensitive");
        expect(match.strategy).not.toBe("snake-camel");
      }
    });
  });

  describe("individual strategies", () => {
    it("prefers an exact name match over any other candidate", () => {
      const source = [column({ name: "email", ordinalPosition: 1 })];
      const target = [
        column({ name: "email", ordinalPosition: 2 }),
        column({ name: "EMAIL", ordinalPosition: 1 }),
      ];
      const [suggestion] = suggestMappings(source, target);
      expect(suggestion?.target).toBe("email");
      expect(suggestion?.strategy).toBe("exact");
    });

    it("matches case-insensitively when no exact match exists", () => {
      const source = [column({ name: "Status", ordinalPosition: 1 })];
      const target = [column({ name: "STATUS", ordinalPosition: 1 })];
      const [suggestion] = suggestMappings(source, target);
      expect(suggestion?.target).toBe("STATUS");
      expect(suggestion?.strategy).toBe("case-insensitive");
    });

    it("matches snake_case source to camelCase target", () => {
      const source = [column({ name: "order_amount", ordinalPosition: 1 })];
      const target = [column({ name: "orderAmount", ordinalPosition: 1 })];
      const [suggestion] = suggestMappings(source, target);
      expect(suggestion?.target).toBe("orderAmount");
      expect(suggestion?.strategy).toBe("snake-camel");
    });

    it("matches camelCase source to snake_case target", () => {
      const source = [column({ name: "shipDate", ordinalPosition: 1 })];
      const target = [column({ name: "ship_date", ordinalPosition: 1 })];
      const [suggestion] = suggestMappings(source, target);
      expect(suggestion?.target).toBe("ship_date");
      expect(suggestion?.strategy).toBe("snake-camel");
    });

    it("falls back to ordinal position only when no name-based strategy matches", () => {
      const source = [column({ name: "col_a", ordinalPosition: 1 })];
      const target = [column({ name: "totally_different_name", ordinalPosition: 1 })];
      const [suggestion] = suggestMappings(source, target);
      expect(suggestion?.target).toBe("totally_different_name");
      expect(suggestion?.strategy).toBe("ordinal");
    });

    it("does not suggest anything when there is no target at all", () => {
      const source = [column({ name: "orphan_column", ordinalPosition: 5 })];
      const target: ColumnDefinition[] = [];
      const suggestions = suggestMappings(source, target);
      expect(suggestions).toHaveLength(0);
    });
  });

  describe("suggestion shape and non-mutation", () => {
    it("reports which strategy matched for every suggestion produced", () => {
      const source = [column({ name: "id", ordinalPosition: 1 })];
      const target = [column({ name: "id", ordinalPosition: 1 })];
      const suggestions = suggestMappings(source, target);
      expect(suggestions).toEqual([{ source: "id", target: "id", strategy: "exact" }]);
    });

    it("does not mutate the input arrays", () => {
      const source = [column({ name: "a", ordinalPosition: 1 })];
      const target = [column({ name: "a", ordinalPosition: 1 })];
      const sourceCopy = JSON.parse(JSON.stringify(source));
      const targetCopy = JSON.parse(JSON.stringify(target));
      suggestMappings(source, target);
      expect(source).toEqual(sourceCopy);
      expect(target).toEqual(targetCopy);
    });
  });
});
