// T-12: normalization rule tests.
//
// Red-state proof (TASK-BRIEF.md "Red-state evidence"): a test asserting
// applyNormalization("  Alice  ", {trim: true, caseSensitive: false})
// equals "alice". This must fail until applyNormalization exists.
//
// Structure:
//   1. The exact red-state case from the brief.
//   2. Idea Prompt.md section 4's worked example, exercised literally for
//      each of the four rule shapes given there (customer_name,
//      order_amount, created_timestamp, cancellation_date).
//   3. Each field of NormalizationRule individually (trim,
//      collapseWhitespace, caseSensitive, truncateTo, timezone,
//      nullEquivalents) plus valuesEqualWithinTolerance for
//      numericTolerance (a two-value comparison, not a value transform --
//      see the brief's Interfaces table).
//   4. Non-mutation proof: passing an object/array value through
//      normalization must not alter the original reference (the brief's
//      primary reviewer scrutiny target).
import { describe, expect, it } from "vitest";
import type { NormalizationRule } from "../../orchestration/definition/definition.js";
import { applyNormalization, valuesEqualWithinTolerance } from "./normalization.js";

describe("applyNormalization", () => {
  it("trims and case-folds a value (brief's literal red-state case)", () => {
    expect(applyNormalization("  Alice  ", { trim: true, caseSensitive: false })).toBe("alice");
  });

  describe("Idea Prompt.md section 4 worked example", () => {
    it("customer_name: trim + case_sensitive:false + collapse_whitespace", () => {
      const rule: NormalizationRule = { trim: true, caseSensitive: false, collapseWhitespace: true };
      expect(applyNormalization("  Acme   Inc.  ", rule)).toBe("acme inc.");
    });

    it("order_amount: numeric_tolerance.absolute is a comparison, not a value transform", () => {
      const rule: NormalizationRule = { numericTolerance: { absolute: 0.01 } };
      // applyNormalization leaves the numeric value itself unchanged --
      // tolerance is evaluated by valuesEqualWithinTolerance instead.
      expect(applyNormalization(125.37, rule)).toBe(125.37);
      expect(valuesEqualWithinTolerance(125.3699, 125.37, rule.numericTolerance)).toBe(true);
      expect(valuesEqualWithinTolerance(125.3, 125.37, rule.numericTolerance)).toBe(false);
    });

    it("created_timestamp: timezone conversion + truncate_to second", () => {
      const rule: NormalizationRule = {
        timezone: { source: "America/New_York", target: "UTC" },
        truncateTo: "second",
      };
      // 2026-07-20T12:00:00.500 in America/New_York (EDT, UTC-4) is
      // 2026-07-20T16:00:00.500Z; truncating to the second drops the
      // fractional-second component.
      const result = applyNormalization("2026-07-20T12:00:00.500", rule);
      expect(result).toBe("2026-07-20T16:00:00.000Z");
    });

    it("created_timestamp: DST-boundary sanity check, winter EST offset is UTC-5 not UTC-4", () => {
      // Confirms the timezone conversion actually resolves the IANA zone's
      // DST rules for the given date rather than using a fixed offset --
      // 12:00 America/New_York in January (EST, UTC-5) is 17:00 UTC, one
      // hour different from the July (EDT, UTC-4) case above.
      const rule: NormalizationRule = {
        timezone: { source: "America/New_York", target: "UTC" },
      };
      const result = applyNormalization("2026-01-20T12:00:00.000", rule);
      expect(result).toBe("2026-01-20T17:00:00.000Z");
    });

    it("cancellation_date: null_equivalents treats sentinel values as null", () => {
      const rule: NormalizationRule = { nullEquivalents: ["1900-01-01", "9999-12-31"] };
      expect(applyNormalization("9999-12-31", rule)).toBeNull();
      expect(applyNormalization("1900-01-01", rule)).toBeNull();
      expect(applyNormalization("2026-07-20", rule)).toBe("2026-07-20");
    });
  });

  describe("individual fields", () => {
    it("trim only removes leading/trailing whitespace", () => {
      expect(applyNormalization("  padded  ", { trim: true })).toBe("padded");
    });

    it("collapseWhitespace collapses repeated internal whitespace to a single space", () => {
      expect(applyNormalization("a   b\t\tc", { collapseWhitespace: true })).toBe("a b c");
    });

    it("caseSensitive:false case-folds strings", () => {
      expect(applyNormalization("MixedCase", { caseSensitive: false })).toBe("mixedcase");
    });

    it("caseSensitive:true (or absent) leaves case unchanged", () => {
      expect(applyNormalization("MixedCase", { caseSensitive: true })).toBe("MixedCase");
      expect(applyNormalization("MixedCase", {})).toBe("MixedCase");
    });

    it("truncateTo second drops fractional seconds from an ISO timestamp with no timezone rule", () => {
      expect(applyNormalization("2026-07-20T12:00:00.123Z", { truncateTo: "second" })).toBe(
        "2026-07-20T12:00:00.000Z"
      );
    });

    it("nullEquivalents matches non-string rule values only when the input value equals a listed sentinel", () => {
      expect(applyNormalization("N/A", { nullEquivalents: ["N/A", "UNKNOWN"] })).toBeNull();
      expect(applyNormalization("UNKNOWN", { nullEquivalents: ["N/A", "UNKNOWN"] })).toBeNull();
      expect(applyNormalization("known-value", { nullEquivalents: ["N/A", "UNKNOWN"] })).toBe("known-value");
    });

    it("passes through null/undefined unchanged regardless of rule", () => {
      expect(applyNormalization(null, { trim: true, caseSensitive: false })).toBeNull();
      expect(applyNormalization(undefined, { trim: true, caseSensitive: false })).toBeUndefined();
    });

    it("passes through non-string values unaffected by string-only rules", () => {
      expect(applyNormalization(42, { trim: true, caseSensitive: false, collapseWhitespace: true })).toBe(42);
    });
  });

  describe("purity / non-mutation (brief's primary reviewer scrutiny target)", () => {
    it("does not mutate an object value passed through normalization", () => {
      const original = { a: 1, nested: { b: 2 } };
      const reference = original;
      const result = applyNormalization(original, { trim: true });
      // The same object reference must come back unchanged (normalization
      // only meaningfully transforms strings/dates; a non-string/array
      // value passes through untouched, but must never be mutated).
      expect(reference).toBe(original);
      expect(original).toEqual({ a: 1, nested: { b: 2 } });
      void result;
    });

    it("does not mutate an array value passed through normalization", () => {
      const original = [1, 2, 3];
      const snapshot = [...original];
      applyNormalization(original, { trim: true });
      expect(original).toEqual(snapshot);
    });

    it("does not mutate the rule object passed in", () => {
      const rule: NormalizationRule = { trim: true, nullEquivalents: ["N/A"] };
      const ruleSnapshot = JSON.parse(JSON.stringify(rule));
      applyNormalization("  N/A  ", rule);
      expect(rule).toEqual(ruleSnapshot);
    });

    it("returns a new string rather than mutating in place (strings are already immutable, but confirm no side effects on repeat calls)", () => {
      const value = "  Repeatable  ";
      const first = applyNormalization(value, { trim: true, caseSensitive: false });
      const second = applyNormalization(value, { trim: true, caseSensitive: false });
      expect(first).toBe(second);
      expect(value).toBe("  Repeatable  ");
    });
  });
});

describe("valuesEqualWithinTolerance", () => {
  it("returns true when within absolute tolerance", () => {
    expect(valuesEqualWithinTolerance(100, 100.005, { absolute: 0.01 })).toBe(true);
  });

  it("returns false when outside absolute tolerance", () => {
    expect(valuesEqualWithinTolerance(100, 100.02, { absolute: 0.01 })).toBe(false);
  });

  it("returns true when within percentage tolerance", () => {
    expect(valuesEqualWithinTolerance(1000, 1005, { percentage: 1 })).toBe(true);
  });

  it("returns false when outside percentage tolerance", () => {
    expect(valuesEqualWithinTolerance(1000, 1200, { percentage: 1 })).toBe(false);
  });

  it("falls back to strict equality when no tolerance is configured", () => {
    expect(valuesEqualWithinTolerance(5, 5, undefined)).toBe(true);
    expect(valuesEqualWithinTolerance(5, 5.0001, undefined)).toBe(false);
  });

  it("treats non-numeric values as unequal unless strictly equal", () => {
    expect(valuesEqualWithinTolerance("5", 5, { absolute: 1 })).toBe(false);
    expect(valuesEqualWithinTolerance(null, null, { absolute: 1 })).toBe(true);
  });
});
