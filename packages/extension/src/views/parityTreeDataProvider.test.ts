import { describe, expect, it, vi } from "vitest";

// `vscode` only exists as a runtime module inside the real VS Code
// extension host. Outside it (this test runs under plain Vitest, not
// @vscode/test-electron — see IMPLEMENTATION-REPORT.md for why), we mock
// just the surface this module actually uses: `TreeItem`,
// `TreeItemCollapsibleState`, and `EventEmitter`. `vi.mock` calls are
// hoisted by Vitest above the static imports below, so the mock is in
// place before `./parityTreeDataProvider` (which imports `vscode`) loads.
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

  return { TreeItem, EventEmitter, TreeItemCollapsibleState };
});

import {
  ParityTreeDataProvider,
  ParityTreeItem,
  PARITY_SECTIONS,
  type ParitySectionDefinition
} from "./parityTreeDataProvider";

describe("ParityTreeDataProvider", () => {
  it("exposes exactly the three top-level sections from Idea Prompt.md section 6", () => {
    expect(PARITY_SECTIONS.map((s: ParitySectionDefinition) => s.id)).toEqual([
      "connections",
      "comparisons",
      "recentRuns"
    ]);
    expect(PARITY_SECTIONS.map((s: ParitySectionDefinition) => s.label)).toEqual([
      "Connections",
      "Comparisons",
      "Recent Runs"
    ]);
  });

  it("getChildren() with no element returns the three top-level section nodes", () => {
    const provider = new ParityTreeDataProvider();
    const children = provider.getChildren();

    expect(children).toHaveLength(3);
    expect(children.every((c: ParityTreeItem) => c instanceof ParityTreeItem)).toBe(true);
    expect(children.map((c: ParityTreeItem) => c.section.label)).toEqual([
      "Connections",
      "Comparisons",
      "Recent Runs"
    ]);
  });

  it("getChildren() under a section node returns no children (empty-state provider)", () => {
    const provider = new ParityTreeDataProvider();
    const [connectionsSection] = provider.getChildren();
    expect(connectionsSection).toBeDefined();

    const grandchildren = provider.getChildren(connectionsSection);
    expect(grandchildren).toEqual([]);
  });

  it("getTreeItem() returns the element itself", () => {
    const provider = new ParityTreeDataProvider();
    const [section] = provider.getChildren();
    expect(section).toBeDefined();
    expect(provider.getTreeItem(section as InstanceType<typeof ParityTreeItem>)).toBe(section);
  });

  it("refresh() fires onDidChangeTreeData", () => {
    const provider = new ParityTreeDataProvider();
    const handler = vi.fn();
    provider.onDidChangeTreeData(handler);

    provider.refresh();

    expect(handler).toHaveBeenCalledTimes(1);
  });
});
