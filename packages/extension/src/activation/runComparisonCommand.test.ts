import { afterEach, describe, expect, it, vi } from "vitest";

// Mirrors activate.test.ts's vscode mock pattern (see that file's header
// comment for why vscode is mocked rather than run under a real extension
// host). Only the additional surface this test needs is added: ViewColumn
// and a createWebviewPanel stub good enough for showResultsWebview to call
// panel.webview.html = ... without error.
vi.mock("vscode", () => {
  // activate.ts (which this test imports runComparisonCommand from) also
  // imports ParityTreeDataProvider, which extends vscode.TreeItem -- these
  // three are needed purely so that module-level class declaration doesn't
  // throw on import, even though this test never constructs a tree item.
  class TreeItem {
    label: string;
    collapsibleState: number | undefined;
    constructor(label: string, collapsibleState?: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }
  class EventEmitter<T> {
    private listeners: Array<(e: T) => void> = [];
    event = (listener: (e: T) => void) => {
      this.listeners.push(listener);
      return { dispose: () => undefined };
    };
    fire(data: T): void {
      for (const listener of this.listeners) {
        listener(data);
      }
    }
  }
  const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
  const ViewColumn = { Active: -1 };

  return {
    TreeItem,
    EventEmitter,
    TreeItemCollapsibleState,
    ViewColumn,
    window: {
      createWebviewPanel: vi.fn(() => ({
        webview: { html: "" }
      })),
      showInformationMessage: vi.fn(),
      showErrorMessage: vi.fn()
    }
  };
});

import * as vscode from "vscode";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ComparisonResult } from "@paritylens/shared";
import { runComparisonCommand } from "./activate";
import { listRecentRuns } from "../runHistory/runHistory";
import { formatParitySummary } from "../statusbar/parityStatusBar";

// Same fixture-shaped YAML used throughout planner.test.ts (T-09) --
// "legacy-sql-prod"/"snowflake-analytics" are arbitrary connection names a
// real .paritylens author would choose; this command resolves whatever
// names are actually present in the definition against the
// sqlserver-customer fixture pair (fixture-only limitation, disclosed to
// the user via showInformationMessage).
const VALID_YAML = `
version: 1
name: customer-migration-parity
source:
  connection: legacy-sql-prod
  object: customer_source
target:
  connection: snowflake-analytics
  object: customer_target
keys:
  - CustomerID
checks:
  schema:
    enabled: true
`;

const MALFORMED_YAML = `
version: 1
name: customer-migration-parity
source: [this is not a valid source shape
`;

function createDeps() {
  return {
    createWebviewPanel: vscode.window.createWebviewPanel as unknown as (
      ...args: unknown[]
    ) => { webview: { html: string } },
    viewColumn: vscode.ViewColumn.Active as unknown as number,
    showInformationMessage: vscode.window.showInformationMessage as unknown as (message: string) => unknown,
    showErrorMessage: vscode.window.showErrorMessage as unknown as (message: string) => unknown
  };
}

describe("runComparisonCommand", () => {
  // vscode.window.createWebviewPanel/showInformationMessage/showErrorMessage
  // are module-level vi.fn() mocks shared across every test in this file
  // (createDeps() just re-wraps the same underlying mock functions) -- clear
  // call history between tests so one test's assertions never see calls
  // made by a previous test.
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("runs parseDefinition -> runComparison -> showResultsWebview against a real .paritylens YAML string and a FixtureConnector-backed registry", async () => {
    const deps = createDeps();

    const result = await runComparisonCommand(VALID_YAML, deps as never);

    expect(result).toBeDefined();
    expect(result?.comparison).toBe("customer-migration-parity");
    // sqlserver-customer's known dropped-CreditLimit-column finding (same
    // fact planner.test.ts's acceptance-criterion-1 test proves), confirming
    // this ran the real engine pipeline, not a stub.
    const creditLimitFinding = result?.schemaDifferences.find(
      (f) => f.columnName === "CreditLimit" && f.kind === "missing-in-target"
    );
    expect(creditLimitFinding).toBeDefined();

    expect(deps.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(deps.showErrorMessage).not.toHaveBeenCalled();
  });

  it("discloses the fixture-only limitation to the user on every run", async () => {
    const deps = createDeps();

    await runComparisonCommand(VALID_YAML, deps as never);

    expect(deps.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining("fixture"));
  });

  it("surfaces InvalidDefinitionError as a clean showErrorMessage call, not an unhandled rejection", async () => {
    const deps = createDeps();

    const result = await runComparisonCommand(MALFORMED_YAML, deps as never);

    expect(result).toBeUndefined();
    expect(deps.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(deps.createWebviewPanel).not.toHaveBeenCalled();
    const [message] = (deps.showErrorMessage as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(message).toContain("ParityLens");
  });

  it("surfaces UnresolvedConnectionError-shaped failures (or any other runComparison error) as a clean showErrorMessage call", async () => {
    const deps = createDeps();
    // A definition that parses fine but whose source/target objects don't
    // exist in the sqlserver-customer fixture -- runComparison's Layer-1
    // connectivity/schema-fetch path will reject (getSchema against an
    // unknown table), exercising the generic catch-and-report path rather
    // than the parse-error path above.
    const yamlWithUnknownObject = `
version: 1
name: customer-migration-parity
source:
  connection: legacy-sql-prod
  object: does_not_exist_table
target:
  connection: snowflake-analytics
  object: customer_target
keys:
  - CustomerID
checks:
  schema:
    enabled: true
`;

    const result = await runComparisonCommand(yamlWithUnknownObject, deps as never);

    expect(result).toBeUndefined();
    expect(deps.showErrorMessage).toHaveBeenCalledTimes(1);
    expect(deps.createWebviewPanel).not.toHaveBeenCalled();
  });
});

/**
 * T-33 Scope item 5: runComparisonCommand additively calls persistRun and
 * the status bar's updateFromResult/.show() after a successful run. Fake
 * `ParityStatusBarItem` implementation below mirrors
 * parityStatusBar.test.ts's own mock shape (text/updateFromResult/show/
 * dispose) rather than depending on the live vscode.window.createStatusBarItem
 * mock, keeping this suite focused on runComparisonCommand's own call
 * sequencing rather than parityStatusBar.ts's (untouched, per Scope item 4)
 * internals.
 */
describe("runComparisonCommand (T-33 persist-run/status-bar wiring)", () => {
  function createFakeStatusBarItem() {
    let text = "";
    return {
      updateFromResult: vi.fn((result: ComparisonResult) => {
        text = formatParitySummary(result.summary);
      }),
      show: vi.fn(),
      dispose: vi.fn(),
      get text() {
        return text;
      }
    };
  }

  let tempRoot: string;

  afterEach(() => {
    vi.clearAllMocks();
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("persists the run via persistRun so listRecentRuns picks it up afterward (red-state: today nothing calls persistRun, so this always returns [])", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "paritylens-runcmd-"));
    const deps = {
      ...createDeps(),
      resolveRunHistoryRoot: () => tempRoot
    };

    const before = await listRecentRuns(tempRoot);
    expect(before).toEqual([]);

    const result = await runComparisonCommand(VALID_YAML, deps as never);
    expect(result).toBeDefined();

    const after = await listRecentRuns(tempRoot);
    expect(after).toHaveLength(1);
    expect(after[0]?.name).toBe("customer-migration-parity");
  });

  it("updates the injected status bar item to match formatParitySummary(result.summary) and calls .show()", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), "paritylens-runcmd-"));
    const statusBarItem = createFakeStatusBarItem();
    const deps = {
      ...createDeps(),
      resolveRunHistoryRoot: () => tempRoot,
      statusBarItem
    };

    const result = await runComparisonCommand(VALID_YAML, deps as never);
    expect(result).toBeDefined();

    expect(statusBarItem.updateFromResult).toHaveBeenCalledWith(result);
    expect(statusBarItem.show).toHaveBeenCalledTimes(1);
    expect(statusBarItem.text).toBe(formatParitySummary(result!.summary));
  });

  it("does not prevent showResultsWebview from being called when persistRun fails (no workspace open / resolveRunHistoryRoot returns undefined)", async () => {
    const deps = {
      ...createDeps(),
      resolveRunHistoryRoot: () => undefined
    };

    const result = await runComparisonCommand(VALID_YAML, deps as never);

    expect(result).toBeDefined();
    expect(deps.createWebviewPanel).toHaveBeenCalledTimes(1);
    // Surfaced as a showErrorMessage call (this implementation's chosen
    // judgment call — see activate.ts's doc comment), but never replacing
    // the success path: showErrorMessage is called for the persistence
    // failure specifically, not for a generic "run comparison failed"
    // message, and the run's actual result is still returned/rendered.
    expect(deps.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining("could not save this run to history"));
  });

  it("does not prevent showResultsWebview from being called when persistRun itself throws (e.g. an unwritable root)", async () => {
    const deps = {
      ...createDeps(),
      // A path nested under a file (not a directory) forces writeExport's
      // mkdir to fail — a real, not simulated, persistRun failure.
      resolveRunHistoryRoot: () => join(tmpdir(), "paritylens-not-a-real-dir-file.txt", "nested")
    };

    const result = await runComparisonCommand(VALID_YAML, deps as never);

    expect(result).toBeDefined();
    expect(deps.createWebviewPanel).toHaveBeenCalledTimes(1);
  });
});
