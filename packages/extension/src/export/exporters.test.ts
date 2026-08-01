import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComparisonResult } from "@paritylens/shared";
import { exportToCsv, exportToJson, exportToMarkdown } from "./exporters";
import { writeExport } from "./writeExport";

/**
 * Hand-built ComparisonResult fixture, independent of resultsWebview's
 * fixture, matching the real interface from packages/shared/src/result.ts.
 * Includes one item in every difference array so each export format's
 * content can be asserted against known values.
 */
const SAMPLE_RESULT: ComparisonResult = {
  comparison: "orders-migration-parity",
  runId: "run-042",
  status: "failed",
  summary: { passed: 10, warnings: 1, failed: 2 },
  rowCounts: { source: 500, target: 480, difference: -20 },
  schemaDifferences: [
    {
      severity: "Failure",
      message: "Column Discount is missing in target.",
      columnName: "Discount",
      kind: "missing-in-target",
      sourceType: "DECIMAL"
    }
  ],
  profileDifferences: [
    {
      severity: "Warning",
      message: "Null percentage changed for Email.",
      columnName: "Email",
      metric: "nullPercentage",
      sourceValue: 0.5,
      targetValue: 2.1
    }
  ],
  aggregateDifferences: [
    {
      severity: "Failure",
      message: "Row count differs beyond tolerance.",
      sourceCount: 500,
      targetCount: 480,
      difference: -20,
      differenceRate: -4,
      tolerance: { percentage: 1 }
    }
  ],
  rowDifferences: [
    {
      severity: "Warning",
      message: "Row ORDER_ID=77123 has differing values.",
      category: "matched-key-differing-values",
      keyValues: [77123],
      columnDifferences: [
        {
          columnName: "ShippedDate",
          sourceValue: "2024-01-01",
          targetValue: "2024-01-02"
        }
      ]
    }
  ],
  execution: { sourceDurationMs: 100, targetDurationMs: 110, comparisonDurationMs: 15 }
};

describe("exportToCsv", () => {
  it("includes row-difference rows with severity/category/keyValues/message columns", () => {
    const csv = exportToCsv(SAMPLE_RESULT);

    expect(csv).toContain("Warning");
    expect(csv).toContain("matched-key-differing-values");
    expect(csv).toContain("77123");
    expect(csv).toContain("Row ORDER_ID=77123 has differing values.");
  });
});

describe("exportToJson", () => {
  it("serializes the full ComparisonResult, including a known row-difference's key values", () => {
    const json = exportToJson(SAMPLE_RESULT);
    const parsed = JSON.parse(json) as ComparisonResult;

    expect(parsed.runId).toBe("run-042");
    expect(parsed.rowDifferences[0]?.keyValues).toEqual([77123]);
    expect(json).toContain("77123");
  });
});

describe("exportToMarkdown", () => {
  it("is human-readable and contains a known row-difference's key values", () => {
    const md = exportToMarkdown(SAMPLE_RESULT);

    expect(md).toContain("77123");
    expect(md).toContain("matched-key-differing-values");
    expect(md).toContain("orders-migration-parity");
  });
});

describe("writeExport", () => {
  let tempRoot: string;

  afterEach(() => {
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("writes content to a path contained under the safe output root", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "paritylens-export-"));
    const targetPath = join(tempRoot, "results.json");

    await writeExport(targetPath, "{}", tempRoot);

    expect(readFileSync(targetPath, "utf8")).toBe("{}");
  });

  it("rejects a write path that resolves outside the safe output root via relative traversal", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "paritylens-export-"));
    const escapingPath = join(tempRoot, "..", "escaped.json");

    await expect(writeExport(escapingPath, "{}", tempRoot)).rejects.toThrow();
  });

  it("rejects an absolute write path outside the safe output root", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "paritylens-export-"));
    const otherRoot = mkdtempSync(join(tmpdir(), "paritylens-other-"));
    const outsidePath = join(otherRoot, "escaped.json");

    try {
      await expect(writeExport(outsidePath, "{}", tempRoot)).rejects.toThrow();
    } finally {
      rmSync(otherRoot, { recursive: true, force: true });
    }
  });
});
