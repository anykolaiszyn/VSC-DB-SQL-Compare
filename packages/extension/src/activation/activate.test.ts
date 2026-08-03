import { afterEach, describe, expect, it, vi } from "vitest";

// T-39: `vi.mock` factories are hoisted above all imports/top-level
// statements (same constraint the comment below already documents), so
// the map registered command callbacks are captured into must itself be
// created via `vi.hoisted` -- a plain top-level `const` declared after
// `vi.mock` would not yet exist when the (hoisted) factory runs.
const { registeredCommandCallbacks } = vi.hoisted(() => ({
  registeredCommandCallbacks: new Map<string, (...args: unknown[]) => unknown>()
}));

// See parityTreeDataProvider.test.ts for why `vscode` is mocked rather than
// run under a real extension host (@vscode/test-electron) — documented in
// IMPLEMENTATION-REPORT.md. `vi.mock` factories are hoisted above all
// imports/top-level statements, so `createTreeView` must be defined inside
// the factory itself (not referenced from an outer scope).
vi.mock("vscode", () => {
  class TreeItem {
    label: string;
    collapsibleState: number | undefined;
    contextValue: string | undefined;
    id: string | undefined;
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
  const StatusBarAlignment = { Left: 1, Right: 2 };

  const createTreeView = (viewId: string, options: unknown) => ({
    viewId,
    options,
    dispose: () => undefined
  });

  // T-22: activate() now also registers paritylens.runComparison, so the
  // mock needs `commands.registerCommand` (returning a disposable) and
  // `workspace.workspaceFolders` for that registration call to succeed --
  // these tests only exercise the pre-existing tree-view/SecretStore
  // behavior and never invoke the command callback itself (that is covered
  // by runComparisonCommand.test.ts, which tests the extracted, directly
  // callable `runComparisonCommand` function instead of going through
  // `vscode.commands.registerCommand`).
  //
  // T-39: registered callbacks are now also captured by command id (into
  // the module-level `registeredCommandCallbacks` map declared just below
  // this factory) so this file's new "registerRunComparisonCommand (T-39
  // uri argument)" suite can invoke the real `paritylens.runComparison`
  // callback directly -- the only way to exercise the
  // showOpenDialog-skip-when-uri-supplied behavior, since that logic lives
  // in the raw `registerCommand` callback itself
  // (`registerRunComparisonCommand`), not in the separately-exported,
  // directly-testable `runComparisonCommand` function.
  const registerCommand = (commandId: string, callback: (...args: unknown[]) => unknown) => {
    registeredCommandCallbacks.set(commandId, callback);
    return { dispose: () => undefined };
  };
  const showOpenDialog = vi.fn(async () => undefined);

  // T-30: the new `runComparisonCommand` (T-30 real-connector-wiring) test
  // suite below in this same file invokes `runComparisonCommand` directly
  // (mirroring `runComparisonCommand.test.ts`'s own vscode mock), so
  // `window` needs the same webview/message-box surface that file's mock
  // provides.
  //
  // T-39: the new "registerRunComparisonCommand (T-39 uri argument)" suite
  // invokes the *real* registered command callback end-to-end, which wires
  // the real `createWebviewConfirmRun` (T-38) as `confirmRun` -- that
  // function calls `panel.webview.onDidReceiveMessage`/`panel.onDidDispose`/
  // `panel.dispose`, none of which the pre-existing `{ webview: { html: "" } }`
  // stub provides (every prior test either injects its own `confirmRun`
  // directly or never reaches this real wiring). `onDidDispose` is invoked
  // immediately/synchronously by this mock -- resolving the confirmation
  // promise as "cancelled" (`false`) the same way a real panel closed
  // without a button click would -- which is sufficient for these tests'
  // purposes (they assert on showOpenDialog/showErrorMessage/
  // createWebviewPanel call counts, not on the confirmation outcome
  // itself); a test that needed to assert "Run" was actually confirmed
  // would need a richer mock, which none of these do.
  const createWebviewPanel = vi.fn(() => ({
    webview: {
      html: "",
      onDidReceiveMessage: () => ({ dispose: () => undefined })
    },
    onDidDispose: (listener: () => void) => {
      listener();
      return { dispose: () => undefined };
    },
    dispose: () => undefined
  }));
  const showInformationMessage = vi.fn();
  const showErrorMessage = vi.fn();

  // T-33: activate() now also constructs a status bar item
  // (createParityStatusBarItem, T-11) and calls
  // vscode.workspace.findFiles for the tree data provider's Comparisons
  // section -- both need a mock surface for activate()'s own construction
  // to succeed under plain Vitest (mirrors parityStatusBar.test.ts's own
  // vscode mock for createStatusBarItem/StatusBarAlignment).
  const createStatusBarItem = vi.fn(() => ({
    text: "",
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn()
  }));
  const findFiles = vi.fn(async () => []);

  // T-36: activate() now also registers a CustomTextEditorProvider for
  // `.paritylens` files (registerComparisonEditorProvider) -- a minimal,
  // mechanically-required addition to this pre-existing mock (this file is
  // outside TASK-BRIEF.md T-36's "Files owned" list, but every existing
  // test below constructs a real `activate()` call, which now
  // unconditionally calls `vscode.window.registerCustomEditorProvider` and
  // `vscode.workspace.applyEdit` needs a mock surface too, mirroring
  // `createTreeView`/`registerCommand`'s existing no-op-disposable mocks
  // above). No existing test's assertions change; this only keeps
  // `activate()` callable under this file's mocked `vscode` module.
  const registerCustomEditorProvider = () => ({ dispose: () => undefined });
  const applyEdit = vi.fn(async () => true);

  // T-39: activate() now also registers a CodeLensProvider for
  // `.paritylens` files (registerComparisonCodeLensProvider) -- a minimal,
  // mechanically-required addition to this pre-existing mock (mirrors the
  // T-36 registerCustomEditorProvider precedent's own comment above): every
  // existing test below constructs a real activate() call, which now
  // unconditionally calls vscode.languages.registerCodeLensProvider. No
  // existing test's assertions change.
  const registerCodeLensProvider = () => ({ dispose: () => undefined });

  class Range {
    constructor(
      public startLine: number,
      public startCharacter: number,
      public endLine: number,
      public endCharacter: number
    ) {}
  }

  class CodeLens {
    constructor(
      public range: Range,
      public command?: unknown
    ) {}
  }

  return {
    TreeItem,
    EventEmitter,
    Range,
    CodeLens,
    TreeItemCollapsibleState,
    ViewColumn,
    StatusBarAlignment,
    window: {
      createTreeView,
      createWebviewPanel,
      showInformationMessage,
      showErrorMessage,
      createStatusBarItem,
      registerCustomEditorProvider,
      showOpenDialog
    },
    commands: { registerCommand },
    workspace: { workspaceFolders: undefined, findFiles, applyEdit },
    languages: { registerCodeLensProvider }
  };
});

import * as vscode from "vscode";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activate, PARITY_TREE_VIEW_ID, RUN_COMPARISON_COMMAND_ID, runComparisonCommand, reopenRunCommand } from "./activate";
import { ParityTreeDataProvider, type ParityTreeItem } from "../views/parityTreeDataProvider";
import { SecretStore } from "../secrets/secretStore";
import { ConnectionProfileStore } from "../connections/connectionProfileStore";
import type { ConnectionProfile } from "../connections/connectionProfile";
import type { ComparisonResult } from "@paritylens/shared";
import type { PlanQueriesResult } from "@paritylens/engine";

const VALID_YAML_FOR_CONFIRMATION = `
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

function createMockExtensionContext() {
  const secretsStore = new Map<string, string>();
  // T-39: registerRunComparisonCommand's real callback (invoked directly by
  // the new "registerRunComparisonCommand (T-39 uri argument)" suite below)
  // constructs a ConnectionProfileStore against context.globalState, which
  // every pre-existing test in this file never exercised (they only assert
  // on activate()'s registration side effects, never invoke the registered
  // paritylens.runComparison callback body itself). A minimal in-memory
  // Memento-shaped globalState is added here so that real callback path
  // works; no existing test's assertions depend on globalState's absence.
  const globalStateStore = new Map<string, unknown>();
  return {
    subscriptions: [] as Array<{ dispose(): unknown }>,
    secrets: {
      store: vi.fn(async (key: string, value: string) => {
        secretsStore.set(key, value);
      }),
      get: vi.fn(async (key: string) => secretsStore.get(key)),
      delete: vi.fn(async (key: string) => {
        secretsStore.delete(key);
      })
    },
    globalState: {
      get: <T>(key: string, defaultValue?: T) => (globalStateStore.has(key) ? (globalStateStore.get(key) as T) : (defaultValue as T)),
      update: vi.fn(async (key: string, value: unknown) => {
        globalStateStore.set(key, value);
      })
    }
  };
}

describe("activate", () => {
  it("registers the DATA PARITY tree view against the expected view ID", () => {
    const context = createMockExtensionContext();
    const createTreeViewSpy = vi.spyOn(vscode.window, "createTreeView");

    activate(context as never);

    expect(createTreeViewSpy).toHaveBeenCalledTimes(1);
    expect(createTreeViewSpy).toHaveBeenCalledWith(
      PARITY_TREE_VIEW_ID,
      expect.objectContaining({ treeDataProvider: expect.any(ParityTreeDataProvider) })
    );
  });

  it("returns a ParityTreeDataProvider whose getChildren() yields the three top-level sections", () => {
    const context = createMockExtensionContext();

    const { treeDataProvider } = activate(context as never);
    const children = treeDataProvider.getChildren() as ParityTreeItem[];

    expect(children.map((c: ParityTreeItem) => c.section.label)).toEqual([
      "Connections",
      "Comparisons",
      "Recent Runs"
    ]);
  });

  it("constructs a SecretStore wrapping context.secrets and registers the tree view for disposal", () => {
    const context = createMockExtensionContext();

    const { secretStore, treeView } = activate(context as never);

    expect(secretStore).toBeInstanceOf(SecretStore);
    expect(context.subscriptions).toContain(treeView);
  });

  it("constructs a status bar item once via createParityStatusBarItem and registers it for disposal (T-33 Scope item 6)", () => {
    const context = createMockExtensionContext();
    const createStatusBarItemSpy = vi.spyOn(vscode.window, "createStatusBarItem");

    activate(context as never);

    expect(createStatusBarItemSpy).toHaveBeenCalledTimes(1);
    // The status bar item's own dispose() must be reachable through one of
    // context.subscriptions' disposables, per "add it to
    // context.subscriptions for disposal — the same wiring pattern already
    // used for connectionProfileStore/secretStore."
    const createdStatusBarItem = createStatusBarItemSpy.mock.results[0]?.value as { dispose: ReturnType<typeof vi.fn> };
    for (const subscription of context.subscriptions) {
      subscription.dispose();
    }
    expect(createdStatusBarItem.dispose).toHaveBeenCalled();
  });

  it("registers the paritylens.reopenRun command (T-33)", () => {
    const context = createMockExtensionContext();
    const registerCommandSpy = vi.spyOn(vscode.commands, "registerCommand");

    activate(context as never);

    expect(registerCommandSpy).toHaveBeenCalledWith("paritylens.reopenRun", expect.any(Function));
  });
});

/**
 * T-30: `runComparisonCommand`'s registry-building must consult saved
 * `ConnectionProfile`s (T-29) before falling back to `FixtureConnector`
 * (T-22's `buildFixtureRegistry` behavior). Mirrors
 * `connectionProfileStore.test.ts`'s own in-memory `vscode.Memento`/
 * `SecretStorage` mocks exactly, and `runComparisonCommand.test.ts`'s
 * `deps`/YAML fixtures, so this suite stays consistent with both files'
 * established patterns rather than inventing a third mocking style.
 */
describe("runComparisonCommand (T-30 real-connector wiring)", () => {
  function createMockSecretStorage() {
    const store = new Map<string, string>();
    return {
      store: async (key: string, value: string) => {
        store.set(key, value);
      },
      get: async (key: string) => store.get(key),
      delete: async (key: string) => {
        store.delete(key);
      },
      onDidChange: () => undefined
    };
  }

  function createMockMemento() {
    const store = new Map<string, unknown>();
    return {
      get: <T>(key: string, defaultValue?: T) => (store.has(key) ? (store.get(key) as T) : (defaultValue as T)),
      update: async (key: string, value: unknown) => {
        store.set(key, value);
      }
    };
  }

  function createDeps(profileStore: ConnectionProfileStore, secretStore: SecretStore) {
    return {
      createWebviewPanel: vscode.window.createWebviewPanel as unknown as (
        ...args: unknown[]
      ) => { webview: { html: string } },
      viewColumn: vscode.ViewColumn.Active as unknown as number,
      showInformationMessage: vscode.window.showInformationMessage as unknown as (message: string) => unknown,
      showErrorMessage: vscode.window.showErrorMessage as unknown as (message: string) => unknown,
      connectionProfileStore: profileStore,
      secretStore
    };
  }

  const YAML_WITH_SAVED_SOURCE = `
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

  const SQLSERVER_PROFILE: ConnectionProfile = {
    id: "profile-sqlserver",
    name: "legacy-sql-prod",
    platform: "sqlserver",
    host: "db.example.internal",
    port: 1433,
    database: "CustomerDb",
    user: "parity_reader",
    trustServerCertificate: true
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("resolves a connection name matching a saved ConnectionProfile to a real SqlServerConnector instead of FixtureConnector", async () => {
    const secretStore = new SecretStore(createMockSecretStorage() as never);
    const profileStore = new ConnectionProfileStore(createMockMemento() as never, secretStore);
    await profileStore.add(SQLSERVER_PROFILE, "s3cr3t-password");

    const deps = createDeps(profileStore, secretStore);

    const result = await runComparisonCommand(YAML_WITH_SAVED_SOURCE, deps as never);

    // A real SqlServerConnector pointed at "db.example.internal" cannot
    // succeed in this test environment (no such host), so
    // runComparison's own Layer-1 connectivity check must reject the
    // connection and return a "failed"-status ComparisonResult (per
    // planner.ts's buildFailedResult path) -- not the sqlserver-customer
    // fixture pair's normal successful comparison the way T-22's
    // fixture-backed run produces (see runComparisonCommand.test.ts's first
    // test for that contrasting success shape: non-empty schemaDifferences
    // including the known CreditLimit fixture mismatch). This is the key
    // falsifiable signal that the saved profile was actually consulted: if
    // resolution still fell back to FixtureConnector (today's bug), this run
    // would succeed against fixture data instead of failing connectivity.
    expect(result).toBeDefined();
    expect(result?.status).toBe("failed");
    expect(result?.summary.failed).toBe(1);
    expect(result?.schemaDifferences).toEqual([]);
    expect(deps.showErrorMessage).not.toHaveBeenCalled();
    expect(deps.createWebviewPanel).toHaveBeenCalledTimes(1);
  }, 15000);

  it("falls back to FixtureConnector for a connection name with no matching saved profile, unchanged from T-22 behavior", async () => {
    const secretStore = new SecretStore(createMockSecretStorage() as never);
    const profileStore = new ConnectionProfileStore(createMockMemento() as never, secretStore);
    // Store is non-empty but contains no profile named "legacy-sql-prod" or
    // "snowflake-analytics" -- both connection names in the YAML above must
    // still fall back to the same sqlserver-customer fixture pair/side
    // mapping T-22's buildFixtureRegistry always used.
    await profileStore.add({ ...SQLSERVER_PROFILE, name: "unrelated-connection" }, "s3cr3t-password");

    const deps = createDeps(profileStore, secretStore);

    const result = await runComparisonCommand(YAML_WITH_SAVED_SOURCE, deps as never);

    expect(result).toBeDefined();
    expect(result?.comparison).toBe("customer-migration-parity");
    const creditLimitFinding = result?.schemaDifferences.find(
      (f) => f.columnName === "CreditLimit" && f.kind === "missing-in-target"
    );
    expect(creditLimitFinding).toBeDefined();
    expect(deps.showErrorMessage).not.toHaveBeenCalled();
  });

  it("surfaces a real connection failure via runComparison's own Layer-1 failed-result path, not an uncaught exception or a generic catch-all error reshaped by a redundant try/catch", async () => {
    const secretStore = new SecretStore(createMockSecretStorage() as never);
    const profileStore = new ConnectionProfileStore(createMockMemento() as never, secretStore);
    await profileStore.add(SQLSERVER_PROFILE, "s3cr3t-password");

    const deps = createDeps(profileStore, secretStore);

    // Must not throw/reject uncaught -- resolves cleanly either way.
    const resultPromise = runComparisonCommand(YAML_WITH_SAVED_SOURCE, deps as never);
    await expect(resultPromise).resolves.toBeDefined();
    const result = await resultPromise;

    // If a redundant try/catch around connector construction/testConnection
    // had swallowed this into activate.ts's generic
    // "ParityLens: run comparison failed — ..." showErrorMessage path (the
    // behavior TASK-BRIEF.md Scope item 4 explicitly prohibits), the result
    // would be undefined and showErrorMessage would have been called
    // instead. Neither happens: runComparison's own Layer-1 handling
    // produces a real "failed"-status ComparisonResult, which flows through
    // exactly like any other successfully-returned result.
    expect(result?.status).toBe("failed");
    expect(deps.showErrorMessage).not.toHaveBeenCalled();
    expect(deps.createWebviewPanel).toHaveBeenCalledTimes(1);
  }, 15000);
});

/**
 * T-33-01 fix (REVIEW-REPORT.md): the brief's Green-state Verification
 * section requires "a test confirms clicking a listed 'Recent Runs' item
 * invokes `loadRun` for the correct `id` and passes its result to
 * `showResultsWebview`." Previously, `registerReopenRunCommand`'s callback
 * body was inlined directly in the `vscode.commands.registerCommand`
 * callback, so no test could invoke it (the mocked `registerCommand` in
 * this file's own `vi.mock("vscode", ...)` factory discards the callback:
 * `() => ({ dispose: () => undefined })`) — only the command's
 * *registration* (existing "registers the paritylens.reopenRun command"
 * test above) and the tree item's *command binding*
 * (`parityTreeDataProvider.test.ts`) were ever tested, never the handler's
 * actual behavior once invoked. `reopenRunCommand` is now extracted as a
 * directly callable function (mirroring `runComparisonCommand`'s existing
 * extraction pattern above), so these tests call it directly with mocked
 * deps instead of trying to capture-and-invoke a callback handed to a
 * mocked `registerCommand`.
 */
describe("reopenRunCommand (T-33-01: recent-run click behavior)", () => {
  const SAMPLE_RESULT: ComparisonResult = {
    comparison: "orders-migration-parity",
    runId: "run-042",
    status: "failed",
    summary: { passed: 10, warnings: 1, failed: 2 },
    rowCounts: { source: 500, target: 480, difference: -20 },
    schemaDifferences: [],
    profileDifferences: [],
    aggregateDifferences: [],
    rowDifferences: [],
    execution: { sourceDurationMs: 100, targetDurationMs: 110, comparisonDurationMs: 15 }
  };

  function createDeps(loadRunResult: Promise<ComparisonResult>) {
    return {
      loadRun: vi.fn(() => loadRunResult),
      createWebviewPanel: vi.fn(() => ({ webview: { html: "" } })) as never,
      viewColumn: vscode.ViewColumn.Active as unknown as number,
      showErrorMessage: vi.fn(),
      showResultsWebview: vi.fn()
    };
  }

  it("invokes loadRun with the clicked run's id and the resolved safeOutputRoot", async () => {
    const deps = createDeps(Promise.resolve(SAMPLE_RESULT));

    await reopenRunCommand("run-b", "/workspace/.paritylens/runs", deps as never);

    expect(deps.loadRun).toHaveBeenCalledWith("run-b", "/workspace/.paritylens/runs");
  });

  it("passes loadRun's resolved ComparisonResult to showResultsWebview", async () => {
    const deps = createDeps(Promise.resolve(SAMPLE_RESULT));

    await reopenRunCommand("run-b", "/workspace/.paritylens/runs", deps as never);

    expect(deps.showResultsWebview).toHaveBeenCalledWith(deps.createWebviewPanel, deps.viewColumn, SAMPLE_RESULT);
    expect(deps.showErrorMessage).not.toHaveBeenCalled();
  });

  it("catches a loadRun rejection and surfaces it via showErrorMessage instead of propagating as an unhandled rejection", async () => {
    const deps = createDeps(Promise.reject(new Error("record not found")));

    await expect(reopenRunCommand("run-missing", "/workspace/.paritylens/runs", deps as never)).resolves.toBeUndefined();

    expect(deps.showErrorMessage).toHaveBeenCalledWith(
      'ParityLens: could not reopen run "run-missing" — record not found'
    );
    expect(deps.showResultsWebview).not.toHaveBeenCalled();
  });

  it("surfaces a clear error via showErrorMessage, without calling loadRun, when no workspace folder is open", async () => {
    const deps = createDeps(Promise.resolve(SAMPLE_RESULT));

    await reopenRunCommand("run-b", undefined, deps as never);

    expect(deps.loadRun).not.toHaveBeenCalled();
    expect(deps.showErrorMessage).toHaveBeenCalledWith(
      "ParityLens: could not reopen this run — no workspace folder is open."
    );
    expect(deps.showResultsWebview).not.toHaveBeenCalled();
  });
});

/**
 * T-38: `runComparisonCommand` now calls `planQueries` first and blocks on
 * an injected `confirmRun` callback (mirroring `resolveRunHistoryRoot`/
 * `statusBarItem`'s existing optional-injected-dependency pattern above --
 * `runComparisonCommand.test.ts`, T-22's pre-existing file, is outside this
 * task's declared "Files owned" list per TASK-BRIEF.md, so its calls
 * (which never supply `confirmRun`) must keep compiling and passing
 * unchanged; `confirmRun` is therefore typed optional, defaulting to
 * "proceed" when absent, exactly like `resolveRunHistoryRoot`/
 * `statusBarItem` already do for the same documented reason). The live
 * `registerRunComparisonCommand` wiring always supplies a real
 * webview-backed `confirmRun` — see this file's own assertions on
 * `registerRunComparisonCommand`'s registration below for that wiring, and
 * `runConfirmationWebview.test.ts` for the render function's own purity/
 * escaping tests) before `runComparison` (the real query-execution
 * function) is ever called.
 */
describe("runComparisonCommand (T-38 pre-execution confirmation)", () => {
  function createDeps(confirmRun: (result: PlanQueriesResult) => Promise<boolean>) {
    return {
      createWebviewPanel: vscode.window.createWebviewPanel as unknown as (
        ...args: unknown[]
      ) => { webview: { html: string } },
      viewColumn: vscode.ViewColumn.Active as unknown as number,
      showInformationMessage: vscode.window.showInformationMessage as unknown as (message: string) => unknown,
      showErrorMessage: vscode.window.showErrorMessage as unknown as (message: string) => unknown,
      confirmRun
    };
  }

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("blocks on confirmRun and never calls runComparison (or shows the results webview) when the user cancels", async () => {
    const confirmRun = vi.fn<(result: PlanQueriesResult) => Promise<boolean>>(async () => false);
    const deps = createDeps(confirmRun);

    const result = await runComparisonCommand(VALID_YAML_FOR_CONFIRMATION, deps as never);

    expect(confirmRun).toHaveBeenCalledTimes(1);
    // The confirmation panel must have been shown with the real planned
    // queries -- schema-only YAML issues no SQL (see planQueries.test.ts's
    // own "schema comparison issues no SQL" case), so an empty list here is
    // correct and still proves confirmRun was invoked with planQueries's
    // actual output, not a placeholder.
    expect(confirmRun.mock.calls[0]?.[0]).toEqual({ queries: [], connectionUnreachable: false });
    expect(result).toBeUndefined();
    expect(deps.createWebviewPanel).not.toHaveBeenCalled();
    expect(deps.showErrorMessage).not.toHaveBeenCalled();
  });

  it("proceeds to call runComparison and show the results webview when the user confirms Run", async () => {
    const confirmRun = vi.fn<(result: PlanQueriesResult) => Promise<boolean>>(async () => true);
    const deps = createDeps(confirmRun);

    const result = await runComparisonCommand(VALID_YAML_FOR_CONFIRMATION, deps as never);

    expect(confirmRun).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
    expect(result?.comparison).toBe("customer-migration-parity");
    expect(deps.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(deps.showErrorMessage).not.toHaveBeenCalled();
  });

  it("surfaces a planQueries failure via showErrorMessage without ever calling confirmRun or runComparison", async () => {
    const confirmRun = vi.fn<(result: PlanQueriesResult) => Promise<boolean>>(async () => true);
    const deps = createDeps(confirmRun);
    // A definition whose object doesn't exist in the sqlserver-customer
    // fixture -- planQueries's own getSchema call (needed because
    // checks.schema.enabled: true) will reject, the same way
    // runComparisonCommand.test.ts's existing "unknown object" test proves
    // runComparison's equivalent getSchema call rejects.
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
    expect(confirmRun).not.toHaveBeenCalled();
    expect(deps.createWebviewPanel).not.toHaveBeenCalled();
    expect(deps.showErrorMessage).toHaveBeenCalledTimes(1);
  });

  it("passes the exact planQueries output (not a re-derived list) to confirmRun for a check combination that does produce SQL", async () => {
    const confirmRun = vi.fn<(result: PlanQueriesResult) => Promise<boolean>>(async () => false);
    const deps = createDeps(confirmRun);
    const rowCountYaml = `
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
  row_count:
    enabled: true
`;

    await runComparisonCommand(rowCountYaml, deps as never);

    const passedResult = confirmRun.mock.calls[0]?.[0];
    expect(passedResult?.connectionUnreachable).toBe(false);
    const passedQueries = passedResult?.queries ?? [];
    expect(passedQueries).toHaveLength(2);
    expect(passedQueries[0]).toContain("SELECT COUNT(*)");
    expect(passedQueries[1]).toContain("SELECT COUNT(*)");
  });
});

/**
 * T-39: `runComparisonCommand` gains an optional `checksOverride` dep,
 * applied in-memory only (a shallow copy of the parsed `ParityDefinition`
 * with `checks` replaced) before `planQueries`/`runComparison` are called.
 * These tests confirm: (1) the override actually reaches `planQueries`'s
 * `confirmRun` callback (proving it flows into the query-planning step,
 * not just `runComparison`), (2) absent `checksOverride` behaves exactly
 * like before this parameter existed (backward compatibility), and (3) the
 * override never touches the on-disk `.paritylens` file -- the only
 * "file" `runComparisonCommand` ever sees is the `yamlText` string
 * argument itself, so this suite also proves that string is never mutated.
 */
describe("runComparisonCommand (T-39 check-subset override)", () => {
  function createDeps(confirmRun: (result: PlanQueriesResult) => Promise<boolean>) {
    return {
      createWebviewPanel: vscode.window.createWebviewPanel as unknown as (
        ...args: unknown[]
      ) => { webview: { html: string } },
      viewColumn: vscode.ViewColumn.Active as unknown as number,
      showInformationMessage: vscode.window.showInformationMessage as unknown as (message: string) => unknown,
      showErrorMessage: vscode.window.showErrorMessage as unknown as (message: string) => unknown,
      confirmRun
    };
  }

  // Schema-enabled-only YAML (checks.schema.enabled: true, no profile/
  // rowCount/rowLevel) -- the same VALID_YAML_FOR_CONFIRMATION shape this
  // file's T-38 suite above already uses, but declared fresh here per-test
  // below so each test can independently confirm it is byte-for-byte
  // unchanged afterward.
  const SCHEMA_ONLY_YAML = VALID_YAML_FOR_CONFIRMATION;

  const ROW_COUNT_YAML = `
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
  row_count:
    enabled: true
`;

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("with no checksOverride supplied, behaves exactly as before this parameter existed (backward compatible)", async () => {
    const confirmRun = vi.fn<(result: PlanQueriesResult) => Promise<boolean>>(async () => true);
    const deps = createDeps(confirmRun);

    const result = await runComparisonCommand(SCHEMA_ONLY_YAML, deps as never);

    expect(result).toBeDefined();
    expect(result?.comparison).toBe("customer-migration-parity");
    // Definition's own checks.schema.enabled: true was honored -- schema
    // differences from the known sqlserver-customer fixture mismatch are
    // present, exactly like every pre-T-39 call of this function.
    expect(result?.schemaDifferences.length).toBeGreaterThan(0);
  });

  it("checksOverride enabling only rowCount overrides the definition's own checks.schema before planQueries is called", async () => {
    // SCHEMA_ONLY_YAML's own checks only enable schema (no row_count), so
    // without an override planQueries would issue zero SQL (schema checks
    // use getSchema, not executeQuery -- see planQueries.test.ts). If the
    // override reaches planQueries, confirmRun instead receives the two
    // SELECT COUNT(*) queries a row_count-enabled definition produces --
    // proving the in-memory override, not the definition's own parsed
    // checks, drove query planning.
    const confirmRun = vi.fn<(result: PlanQueriesResult) => Promise<boolean>>(async () => false);
    const deps = { ...createDeps(confirmRun), checksOverride: { rowCount: { enabled: true } } };

    await runComparisonCommand(SCHEMA_ONLY_YAML, deps as never);

    expect(confirmRun).toHaveBeenCalledTimes(1);
    const passedQueries = confirmRun.mock.calls[0]?.[0]?.queries ?? [];
    expect(passedQueries).toHaveLength(2);
    expect(passedQueries[0]).toContain("SELECT COUNT(*)");
  });

  it("checksOverride disabling everything the definition itself enabled results in no SQL reaching confirmRun", async () => {
    const confirmRun = vi.fn<(result: PlanQueriesResult) => Promise<boolean>>(async () => false);
    const deps = {
      ...createDeps(confirmRun),
      checksOverride: { schema: { enabled: false }, profile: { enabled: true } }
    };

    await runComparisonCommand(ROW_COUNT_YAML, deps as never);

    expect(confirmRun).toHaveBeenCalledTimes(1);
    // ROW_COUNT_YAML's own checks.row_count.enabled: true is superseded by
    // the override (which has no rowCount key at all, i.e. not enabled) --
    // profile is enabled instead, which for this schema-less object still
    // issues profile SQL, not the row-count SELECT COUNT(*) queries the
    // definition's own (overridden-away) checks would have produced.
    const passedQueries = confirmRun.mock.calls[0]?.[0]?.queries ?? [];
    expect(passedQueries.some((q) => q.includes("SELECT COUNT(*)"))).toBe(false);
  });

  it("never mutates the yamlText string passed in, regardless of whether checksOverride is supplied", async () => {
    const confirmRun = vi.fn<(result: PlanQueriesResult) => Promise<boolean>>(async () => true);
    const deps = { ...createDeps(confirmRun), checksOverride: { profile: { enabled: true } } };
    const originalText = SCHEMA_ONLY_YAML;

    await runComparisonCommand(originalText, deps as never);

    // yamlText is a JS string (immutable by language semantics), so this
    // assertion is a belt-and-suspenders confirmation that the exact same
    // reference/value was never reassigned or fed through any mutating
    // codepath -- the real containment guarantee is architectural
    // (runComparisonCommand never calls writeFile/fs at all, only
    // readFile happens in registerRunComparisonCommand before this
    // function is ever invoked), verified end-to-end by the
    // "registerRunComparisonCommand (T-39 uri argument)" suite below via a
    // real on-disk file diffed before/after.
    expect(originalText).toBe(SCHEMA_ONLY_YAML);
  });
});

/**
 * T-39: `registerRunComparisonCommand`'s raw `vscode.commands.
 * registerCommand` callback (not the separately-exported, directly-
 * testable `runComparisonCommand` function above) now accepts an optional
 * `vscode.Uri` first argument. These tests invoke the *real* registered
 * callback (captured into `registeredCommandCallbacks` by this file's
 * mocked `commands.registerCommand`, since this is the only way to
 * exercise the showOpenDialog-skip-when-uri-supplied branch, which lives
 * entirely inside that raw callback, not inside `runComparisonCommand`
 * itself.
 */
describe("registerRunComparisonCommand (T-39 uri argument)", () => {
  let tempRoot: string;
  let tempFilePath: string;

  const FIXTURE_YAML = VALID_YAML_FOR_CONFIRMATION;

  function makeContext() {
    return createMockExtensionContext();
  }

  function getRegisteredRunComparisonCallback(): (...args: unknown[]) => Promise<unknown> {
    const callback = registeredCommandCallbacks.get(RUN_COMPARISON_COMMAND_ID);
    if (!callback) {
      throw new Error(`${RUN_COMPARISON_COMMAND_ID} was not registered`);
    }
    return callback as (...args: unknown[]) => Promise<unknown>;
  }

  afterEach(() => {
    vi.clearAllMocks();
    registeredCommandCallbacks.clear();
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  function writeTempParitylensFile(): { fsPath: string } {
    tempRoot = mkdtempSync(join(tmpdir(), "paritylens-codelens-"));
    tempFilePath = join(tempRoot, "customer.paritylens");
    writeFileSync(tempFilePath, FIXTURE_YAML, "utf8");
    return { fsPath: tempFilePath };
  }

  it("skips showOpenDialog and reads the supplied Uri directly when a Uri argument is provided", async () => {
    const context = makeContext();
    activate(context as never);
    const callback = getRegisteredRunComparisonCallback();
    const uri = writeTempParitylensFile();

    await callback(uri);

    expect(vscode.window.showOpenDialog).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
  });

  it("still shows the file-picker dialog when no Uri argument is supplied (regression guard for command-palette behavior)", async () => {
    const context = makeContext();
    activate(context as never);
    const callback = getRegisteredRunComparisonCallback();

    await callback();

    expect(vscode.window.showOpenDialog).toHaveBeenCalledTimes(1);
    // showOpenDialog's mock resolves undefined -- no file selected -- so
    // the callback returns early; createWebviewPanel/runComparison must
    // never have been reached.
    expect(vscode.window.createWebviewPanel).not.toHaveBeenCalled();
  });

  it("a checksOverride argument (position 2) never modifies the on-disk .paritylens file the Uri points to", async () => {
    const context = makeContext();
    activate(context as never);
    const callback = getRegisteredRunComparisonCallback();
    const uri = writeTempParitylensFile();
    const contentsBefore = readFileSync(tempFilePath, "utf8");

    await callback(uri, { profile: { enabled: true } });

    const contentsAfter = readFileSync(tempFilePath, "utf8");
    expect(contentsAfter).toBe(contentsBefore);
    expect(contentsAfter).toBe(FIXTURE_YAML);
  });
});
