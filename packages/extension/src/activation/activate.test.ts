import { afterEach, describe, expect, it, vi } from "vitest";

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
  const registerCommand = () => ({ dispose: () => undefined });

  // T-30: the new `runComparisonCommand` (T-30 real-connector-wiring) test
  // suite below in this same file invokes `runComparisonCommand` directly
  // (mirroring `runComparisonCommand.test.ts`'s own vscode mock), so
  // `window` needs the same webview/message-box surface that file's mock
  // provides.
  const createWebviewPanel = vi.fn(() => ({
    webview: { html: "" }
  }));
  const showInformationMessage = vi.fn();
  const showErrorMessage = vi.fn();

  return {
    TreeItem,
    EventEmitter,
    TreeItemCollapsibleState,
    ViewColumn,
    window: { createTreeView, createWebviewPanel, showInformationMessage, showErrorMessage },
    commands: { registerCommand },
    workspace: { workspaceFolders: undefined }
  };
});

import * as vscode from "vscode";
import { activate, PARITY_TREE_VIEW_ID, runComparisonCommand } from "./activate";
import { ParityTreeDataProvider, type ParityTreeItem } from "../views/parityTreeDataProvider";
import { SecretStore } from "../secrets/secretStore";
import { ConnectionProfileStore } from "../connections/connectionProfileStore";
import type { ConnectionProfile } from "../connections/connectionProfile";

function createMockExtensionContext() {
  const secretsStore = new Map<string, string>();
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
    const children = treeDataProvider.getChildren();

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
