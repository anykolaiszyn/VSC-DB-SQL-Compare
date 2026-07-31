import { describe, expect, it, vi } from "vitest";
import type { ComparisonResult } from "@paritylens/shared";

// `vscode` only exists as a runtime module inside the real VS Code
// extension host. Outside it (this test runs under plain Vitest — see
// parityTreeDataProvider.test.ts for the established pattern this file
// follows), we mock just the surface this module actually uses:
// `window.createStatusBarItem` and the `StatusBarAlignment` enum. `vi.mock`
// calls are hoisted by Vitest above the static imports below, so the mock
// is in place before `./parityStatusBar` (which imports `vscode`) loads.
vi.mock("vscode", () => {
  const StatusBarAlignment = { Left: 1, Right: 2 };

  const createStatusBarItem = () => ({
    text: "",
    tooltip: undefined as string | undefined,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn()
  });

  return {
    StatusBarAlignment,
    window: { createStatusBarItem }
  };
});

import { createParityStatusBarItem, formatParitySummary } from "./parityStatusBar";

const SAMPLE_RESULT: ComparisonResult = {
  comparison: "customer-migration-parity",
  runId: "run-001",
  status: "warning",
  summary: { passed: 18, warnings: 2, failed: 1 },
  rowCounts: { source: 0, target: 0, difference: 0 },
  schemaDifferences: [],
  profileDifferences: [],
  aggregateDifferences: [],
  rowDifferences: [],
  execution: { sourceDurationMs: 10, targetDurationMs: 12, comparisonDurationMs: 3 }
};

describe("formatParitySummary", () => {
  it("formats a ComparisonResult's summary as 'Parity: N passed | N warnings | N failed'", () => {
    expect(formatParitySummary(SAMPLE_RESULT.summary)).toBe(
      "Parity: 18 passed | 2 warnings | 1 failed"
    );
  });
});

describe("createParityStatusBarItem", () => {
  it("sets the status bar item's text from a ComparisonResult's summary", () => {
    const item = createParityStatusBarItem();
    item.updateFromResult(SAMPLE_RESULT);

    expect(item.text).toBe("Parity: 18 passed | 2 warnings | 1 failed");
  });
});
