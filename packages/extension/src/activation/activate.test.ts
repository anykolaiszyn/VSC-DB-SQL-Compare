import { describe, expect, it, vi } from "vitest";

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

  const createTreeView = (viewId: string, options: unknown) => ({
    viewId,
    options,
    dispose: () => undefined
  });

  return {
    TreeItem,
    EventEmitter,
    TreeItemCollapsibleState,
    window: { createTreeView }
  };
});

import * as vscode from "vscode";
import { activate, PARITY_TREE_VIEW_ID } from "./activate";
import { ParityTreeDataProvider, type ParityTreeItem } from "../views/parityTreeDataProvider";
import { SecretStore } from "../secrets/secretStore";

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
