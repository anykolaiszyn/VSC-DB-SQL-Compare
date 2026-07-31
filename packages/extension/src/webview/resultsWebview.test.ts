import { describe, expect, it } from "vitest";
import type { ComparisonResult } from "@paritylens/shared";
import { renderResultsHtml } from "./resultsWebview";

/**
 * Hand-built `ComparisonResult` fixture literal matching the real interface
 * from `packages/shared/src/result.ts`. Per TASK-BRIEF.md T-11's
 * Green-state section: "a small hand-built literal matching the real
 * interface is fine" since no ready-made, importable `ComparisonResult`
 * fixture literal exists in the engine package (the planner test only
 * produces one asynchronously via `runComparison` against `FixtureConnector`,
 * which the extension package should not depend on for a presentation-layer
 * unit test).
 */
const SAMPLE_RESULT: ComparisonResult = {
  comparison: "customer-migration-parity",
  runId: "run-001",
  status: "warning",
  summary: { passed: 18, warnings: 2, failed: 1 },
  rowCounts: { source: 0, target: 0, difference: 0 },
  schemaDifferences: [
    {
      severity: "Failure",
      message: "Column CreditLimit is missing in target.",
      columnName: "CreditLimit",
      kind: "missing-in-target",
      sourceType: "MONEY"
    }
  ],
  profileDifferences: [
    {
      severity: "Warning",
      message: "Distinct count changed for CustomerName.",
      columnName: "CustomerName",
      metric: "distinctCount",
      sourceValue: 120,
      targetValue: 115
    }
  ],
  aggregateDifferences: [],
  rowDifferences: [],
  execution: { sourceDurationMs: 10, targetDurationMs: 12, comparisonDurationMs: 3 }
};

describe("renderResultsHtml", () => {
  it("renders a schemaDifferences item as a table row containing its column name and severity", () => {
    const html = renderResultsHtml(SAMPLE_RESULT);

    expect(html).toContain("CreditLimit");
    expect(html).toContain("Failure");
    expect(html).toContain("missing-in-target");
  });

  it("renders a profileDifferences item as a table row containing its column name and severity", () => {
    const html = renderResultsHtml(SAMPLE_RESULT);

    expect(html).toContain("CustomerName");
    expect(html).toContain("Warning");
    expect(html).toContain("distinctCount");
  });
});
