import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComparisonResult } from "@paritylens/shared";
import { listRecentRuns, loadRun, persistRun } from "./runHistory";

/**
 * Hand-built ComparisonResult fixture, matching the real interface from
 * packages/shared/src/result.ts (mirrors the fixture style already used by
 * packages/extension/src/export/exporters.test.ts).
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
  profileDifferences: [],
  aggregateDifferences: [],
  rowDifferences: [],
  execution: { sourceDurationMs: 100, targetDurationMs: 110, comparisonDurationMs: 15 }
};

describe("runHistory", () => {
  let tempRoot: string;

  afterEach(() => {
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("persists a ComparisonResult via persistRun and reads it back via loadRun as a byte-for-byte-equivalent object", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "paritylens-runhistory-"));

    const id = await persistRun(SAMPLE_RESULT, tempRoot);
    const loaded = await loadRun(id, tempRoot);

    expect(loaded).toEqual(JSON.parse(JSON.stringify(SAMPLE_RESULT)));
  });

  it("rejects a loadRun id crafted to resolve outside the safe output root", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "paritylens-runhistory-"));
    const otherRoot = mkdtempSync(join(tmpdir(), "paritylens-runhistory-other-"));

    try {
      await expect(loadRun("../paritylens-runhistory-other/escaped", tempRoot)).rejects.toThrow();
      // Absolute-path style escape attempt too.
      await expect(loadRun(join(otherRoot, "escaped"), tempRoot)).rejects.toThrow();
    } finally {
      rmSync(otherRoot, { recursive: true, force: true });
    }
  });

  it("persists two runs in quick succession with the same name as distinct, non-overwriting records", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "paritylens-runhistory-"));

    const idOne = await persistRun(SAMPLE_RESULT, tempRoot);
    const idTwo = await persistRun(SAMPLE_RESULT, tempRoot);

    expect(idOne).not.toBe(idTwo);

    const runs = await listRecentRuns(tempRoot);
    expect(runs).toHaveLength(2);

    const loadedOne = await loadRun(idOne, tempRoot);
    const loadedTwo = await loadRun(idTwo, tempRoot);
    expect(loadedOne).toEqual(JSON.parse(JSON.stringify(SAMPLE_RESULT)));
    expect(loadedTwo).toEqual(JSON.parse(JSON.stringify(SAMPLE_RESULT)));
  });

  it("lists recent runs most recent first", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "paritylens-runhistory-"));

    const idOne = await persistRun({ ...SAMPLE_RESULT, comparison: "first-run" }, tempRoot);
    const idTwo = await persistRun({ ...SAMPLE_RESULT, comparison: "second-run" }, tempRoot);

    const runs = await listRecentRuns(tempRoot);
    expect(runs.map((r) => r.id)).toEqual([idTwo, idOne]);
    expect(runs[0]?.name).toBe("second-run");
  });
});
