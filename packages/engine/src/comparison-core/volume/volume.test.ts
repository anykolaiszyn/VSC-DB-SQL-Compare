// T-13: volume parity tests.
//
// Red-state evidence (see IMPLEMENTATION-REPORT.md for the captured failing
// run before this module existed): `npx vitest run
// packages/engine/src/comparison-core/volume` failed with a module
// resolution error because `./volume.js` did not exist yet.
//
// The primary case reproduces Idea Prompt.md section 2's Layer 3 "Volume
// Parity" worked example literally:
//
//   Source rows:      12,405,128
//   Target rows:      12,402,991
//   Difference:           -2,137
//   Difference rate:      -0.0172%
//   Tolerance:             0.0100%
//   Result:                FAIL
//
// Both counts are exercised as literal single-row SELECTs against
// FixtureConnector (via `{ kind: "query" }` input) rather than the small
// seeded fixture tables, since the fixture tables' actual row counts (a
// handful of rows each) cannot reproduce the idea doc's specific literal
// numbers -- FixtureConnector executes any read-only SQL string through the
// same `assertReadOnlyStatement` + DuckDB path regardless of whether that
// SQL references a seeded table, so a literal-count SELECT exercises
// exactly the same `executeQuery` code path `compareVolume` uses against a
// real connector.
import { describe, expect, it } from "vitest";
import { FixtureConnector } from "../../connector-sdk/fixture/fixture-connector.js";
import { compareVolume } from "./volume.js";
import type { QueryInput } from "@paritylens/shared";

// Produces exactly `count` rows via DuckDB's `generate_series` table
// function (inclusive on both ends, hence `count - 1` as the upper bound),
// so `SELECT COUNT(*) FROM (...)` against this input yields exactly
// `count` -- a literal `SELECT <count> AS n` would instead yield a single
// row containing the value `count`, not `count` rows, which is not what a
// row-count comparison needs to exercise.
function literalCountInput(count: number): QueryInput {
  return { kind: "query", sql: `SELECT * FROM generate_series(0, ${count - 1})` };
}

describe("compareVolume", () => {
  it("reproduces Idea Prompt.md section 2's worked example (FAIL, percentage tolerance)", async () => {
    const source = new FixtureConnector("sqlserver-customer", "source");
    const target = new FixtureConnector("sqlserver-customer", "target");

    const result = await compareVolume(
      source,
      target,
      literalCountInput(12_405_128),
      literalCountInput(12_402_991),
      { percentage: 0.01 }
    );

    expect(result.sourceCount).toBe(12_405_128);
    expect(result.targetCount).toBe(12_402_991);
    expect(result.difference).toBe(-2_137);
    // -2137 / 12405128 * 100 = -0.017226746...%, rounded to 4 decimal places
    // per the idea doc's "-0.0172%" display -> assert on the unrounded value
    // to a tight tolerance so the test is not just re-asserting a rounded
    // literal back at itself.
    expect(result.differenceRate).toBeCloseTo(-0.0172267, 6);
    expect(result.tolerance).toEqual({ percentage: 0.01 });
    expect(result.severity).toBe("Failure");
    expect(result.message).toMatch(/-2,137|-2137/);
  });

  it("passes when the difference is within a percentage tolerance", async () => {
    const source = new FixtureConnector("sqlserver-customer", "source");
    const target = new FixtureConnector("sqlserver-customer", "target");

    // 10 vs 10 -> zero difference, trivially within any tolerance.
    const result = await compareVolume(source, target, literalCountInput(1_000_000), literalCountInput(999_995), {
      percentage: 0.01,
    });

    // difference = -5, rate = -5/1_000_000*100 = -0.0005%, within 0.01% tolerance.
    expect(result.difference).toBe(-5);
    expect(result.differenceRate).toBeCloseTo(-0.0005, 6);
    expect(result.severity).not.toBe("Failure");
  });

  it("evaluates an absolute tolerance instead of percentage when supplied", async () => {
    const source = new FixtureConnector("sqlserver-customer", "source");
    const target = new FixtureConnector("sqlserver-customer", "target");

    const withinTolerance = await compareVolume(
      source,
      target,
      literalCountInput(10_000),
      literalCountInput(9_990),
      { absolute: 20 }
    );
    expect(withinTolerance.difference).toBe(-10);
    expect(withinTolerance.severity).not.toBe("Failure");

    const exceedsTolerance = await compareVolume(
      source,
      target,
      literalCountInput(10_000),
      literalCountInput(9_950),
      { absolute: 20 }
    );
    expect(exceedsTolerance.difference).toBe(-50);
    expect(exceedsTolerance.severity).toBe("Failure");
  });

  it("treats an omitted tolerance as exact equality: any nonzero difference fails", async () => {
    const source = new FixtureConnector("sqlserver-customer", "source");
    const target = new FixtureConnector("sqlserver-customer", "target");

    const exact = await compareVolume(source, target, literalCountInput(500), literalCountInput(500));
    expect(exact.difference).toBe(0);
    expect(exact.severity).not.toBe("Failure");

    const mismatched = await compareVolume(source, target, literalCountInput(500), literalCountInput(501));
    expect(mismatched.difference).toBe(1);
    expect(mismatched.severity).toBe("Failure");
  });

  it("passes when source and target counts are exactly equal, tolerance supplied", async () => {
    const source = new FixtureConnector("sqlserver-customer", "source");
    const target = new FixtureConnector("sqlserver-customer", "target");

    const result = await compareVolume(source, target, literalCountInput(42), literalCountInput(42), {
      percentage: 0.01,
    });
    expect(result.difference).toBe(0);
    expect(result.differenceRate).toBe(0);
    expect(result.severity).toBe("Pass");
  });
});
