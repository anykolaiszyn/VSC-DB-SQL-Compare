import { describe, expect, it, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

  // T-47: resolves finding T-34-01 -- RunRecord/RunSummary gained an
  // optional `status` field so the "Recent Runs" tree view can key an
  // outcome-colored icon off it.
  describe("T-47: status field", () => {
    it("persistRun populates RunRecord.status from result.status, and listRecentRuns surfaces it", async () => {
      tempRoot = mkdtempSync(join(tmpdir(), "paritylens-runhistory-"));

      const id = await persistRun(SAMPLE_RESULT, tempRoot);

      const runs = await listRecentRuns(tempRoot);
      expect(runs).toHaveLength(1);
      expect(runs[0]?.id).toBe(id);
      expect(runs[0]?.status).toBe("failed");

      // loadRun's full ComparisonResult also still round-trips status
      // (it was always part of `result`, unaffected by this change).
      const loaded = await loadRun(id, tempRoot);
      expect(loaded.status).toBe("failed");
    });

    it("persistRun populates a different status value correctly (not a hardcoded pass-through of one literal)", async () => {
      tempRoot = mkdtempSync(join(tmpdir(), "paritylens-runhistory-"));

      const passedResult: ComparisonResult = { ...SAMPLE_RESULT, status: "passed" };
      await persistRun(passedResult, tempRoot);

      const runs = await listRecentRuns(tempRoot);
      expect(runs[0]?.status).toBe("passed");
    });

    it("listRecentRuns backward-compat: a pre-existing on-disk record with no status key still lists successfully with status undefined", async () => {
      tempRoot = mkdtempSync(join(tmpdir(), "paritylens-runhistory-"));

      // Simulate a RunRecord written before T-47: no `status` key at all
      // (not `status: undefined` -- a genuinely absent key, matching what
      // JSON.stringify on a pre-T-47 RunRecord object would have produced).
      const legacyRecord = {
        id: "legacy-run-001",
        name: "legacy-run",
        timestamp: "2025-01-01T00:00:00.000Z",
        result: { ...SAMPLE_RESULT, comparison: "legacy-run" }
      };
      writeFileSync(join(tempRoot, "legacy-run-001.json"), JSON.stringify(legacyRecord));

      const runs = await listRecentRuns(tempRoot);
      expect(runs).toHaveLength(1);
      expect(runs[0]?.id).toBe("legacy-run-001");
      expect(runs[0]?.status).toBeUndefined();
    });
  });
});
