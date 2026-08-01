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

/**
 * T-16 fixture: a ComparisonResult with a non-empty aggregateDifferences
 * entry (volume-parity failure) and a rowDifferences entry of category
 * "matched-key-differing-values" including columnDifferences, per
 * TASK-BRIEF.md's Red-state evidence section.
 */
const SAMPLE_RESULT_WITH_PHASE2: ComparisonResult = {
  ...SAMPLE_RESULT,
  aggregateDifferences: [
    {
      severity: "Failure",
      message: "Row count differs beyond tolerance.",
      sourceCount: 1000,
      targetCount: 950,
      difference: -50,
      differenceRate: -5,
      tolerance: { percentage: 1 }
    }
  ],
  rowDifferences: [
    {
      severity: "Warning",
      message: "Row ORDER_ID=1008924 has differing values.",
      category: "matched-key-differing-values",
      keyValues: [1008924],
      columnDifferences: [
        {
          columnName: "TotalAmount",
          sourceValue: 199.99,
          targetValue: 189.99
        }
      ]
    }
  ]
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

  it("renders an aggregateDifferences item as a table row containing sourceCount/targetCount/differenceRate", () => {
    const html = renderResultsHtml(SAMPLE_RESULT_WITH_PHASE2);

    expect(html).toContain("1000");
    expect(html).toContain("950");
    expect(html).toContain("-5");
  });

  it("renders a rowDifferences item of category matched-key-differing-values including its columnDifferences", () => {
    const html = renderResultsHtml(SAMPLE_RESULT_WITH_PHASE2);

    expect(html).toContain("matched-key-differing-values");
    expect(html).toContain("1008924");
    expect(html).toContain("TotalAmount");
    expect(html).toContain("199.99");
    expect(html).toContain("189.99");
  });

  it("renders empty-state messages when aggregateDifferences and rowDifferences are empty", () => {
    const html = renderResultsHtml(SAMPLE_RESULT);

    expect(html).toContain("No volume differences.");
    expect(html).toContain("No row-level differences.");
  });

  // T-16b: SQL preview panel.
  it("renders an empty-state message for Query Preview when queriesUsed is absent", () => {
    const html = renderResultsHtml(SAMPLE_RESULT);

    expect(html).toContain("Query Preview");
    expect(html).toContain("No queries recorded for this run.");
  });

  it("renders each queriesUsed entry, HTML-escaped", () => {
    const resultWithQueries: ComparisonResult = {
      ...SAMPLE_RESULT,
      queriesUsed: [
        `SELECT COUNT(*) AS row_count FROM "customer_source"`,
        `SELECT * FROM "customer_source" WHERE Region = '<script>alert(1)</script>'`
      ]
    };

    const html = renderResultsHtml(resultWithQueries);

    expect(html).toContain("SELECT COUNT(*) AS row_count FROM &quot;customer_source&quot;");
    // The XSS-shaped payload must be escaped, not passed through raw.
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
