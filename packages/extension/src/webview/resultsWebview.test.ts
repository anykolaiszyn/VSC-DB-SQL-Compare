import { describe, expect, it, vi } from "vitest";
import type { ComparisonResult } from "@paritylens/shared";
import { renderResultsHtml, showResultsWebview } from "./resultsWebview";

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

  // T-34: visual redesign — red-state assertions for markup that does not
  // exist in the pre-T-34 bare/unstyled output. These must fail against
  // today's renderResultsHtml before the redesign, and pass after.
  describe("T-34 visual redesign", () => {
    it("includes a <style> block using VS Code theme CSS variables (not the Nocturne prototype's raw hex tokens)", () => {
      const html = renderResultsHtml(SAMPLE_RESULT);

      expect(html).toContain("<style>");
      expect(html).toContain("--vscode-editor-background");
      expect(html).toContain("--vscode-foreground");
      // Prohibited: the prototype's raw Nocturne token values are reference
      // only and must not be shipped verbatim.
      expect(html).not.toContain("#161826");
      expect(html).not.toContain("#9184d9");
    });

    it("renders a CSS-only tab strip with a checked radio/anchor technique, no <script> tag or inline event handlers", () => {
      const html = renderResultsHtml(SAMPLE_RESULT);

      expect(html).toContain('class="tab-strip"');
      expect(html).not.toContain("<script>");
      expect(html).not.toMatch(/\son\w+\s*=/i);
    });

    it("renders a summary stat tile band with a stat-tile class per Passed/Warnings/Failed/row-count-delta", () => {
      const html = renderResultsHtml(SAMPLE_RESULT);

      expect(html).toContain('class="stat-tile');
    });

    it("renders schema severity as a colored severity-tag class, not plain text", () => {
      const html = renderResultsHtml(SAMPLE_RESULT);

      expect(html).toMatch(/class="[^"]*severity-tag[^"]*"[^>]*>Failure</);
    });

    it("renders the row-level expand/collapse interaction via <details>/<summary> (CSS/native-only, no JS)", () => {
      const html = renderResultsHtml(SAMPLE_RESULT_WITH_PHASE2);

      expect(html).toContain("<details");
      expect(html).toContain("<summary");
    });

    it("renders a tab badge pill count for Schema/Profile/Volume/Row-Level tabs", () => {
      const html = renderResultsHtml(SAMPLE_RESULT);

      expect(html).toContain('class="tab-badge"');
    });
  });

  describe("T-34: renderResultsHtml purity + enableScripts guard", () => {
    it("is a pure function: the same input rendered twice produces identical output", () => {
      const first = renderResultsHtml(SAMPLE_RESULT_WITH_PHASE2);
      const second = renderResultsHtml(SAMPLE_RESULT_WITH_PHASE2);

      expect(first).toBe(second);
    });

    it("takes only a ComparisonResult argument (arity 1)", () => {
      expect(renderResultsHtml.length).toBe(1);
    });

    it("showResultsWebview still creates the panel with enableScripts: false (guards against silently flipping this)", () => {
      const fakePanel = { webview: { html: "" } };
      type CreateWebviewPanel = Parameters<typeof showResultsWebview>[0];
      const createWebviewPanel = vi.fn<CreateWebviewPanel>(
        () => fakePanel as unknown as ReturnType<CreateWebviewPanel>
      );

      showResultsWebview(createWebviewPanel, 1 as never, SAMPLE_RESULT);

      expect(createWebviewPanel).toHaveBeenCalledTimes(1);
      const optionsArg = createWebviewPanel.mock.calls[0]?.[3];
      expect(optionsArg).toEqual({ enableScripts: false });
    });
  });
});
