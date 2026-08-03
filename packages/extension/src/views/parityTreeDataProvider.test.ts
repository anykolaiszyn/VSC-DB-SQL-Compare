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
    iconPath: unknown;
    description: string | boolean | undefined;
    constructor(label: string, collapsibleState?: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }

  class ThemeIcon {
    constructor(
      public readonly id: string,
      public readonly color?: unknown
    ) {}
  }

  class ThemeColor {
    constructor(public readonly id: string) {}
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

  class Uri {
    private constructor(public readonly fsPath: string, public readonly path: string) {}
    static file(fsPath: string): Uri {
      return new Uri(fsPath, fsPath.replace(/\\/g, "/"));
    }
  }

  return { TreeItem, EventEmitter, TreeItemCollapsibleState, Uri, ThemeIcon, ThemeColor };
});

import {
  ParityTreeDataProvider,
  ParityTreeItem,
  ParityComparisonTreeItem,
  ParityRecentRunTreeItem,
  PARITY_SECTIONS,
  type ParitySectionDefinition
} from "./parityTreeDataProvider";
import type { RunSummary } from "../runHistory/runHistory";
import * as vscode from "vscode";

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
    const children = provider.getChildren() as ParityTreeItem[];

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
    const [connectionsSection] = provider.getChildren() as ParityTreeItem[];
    expect(connectionsSection).toBeDefined();

    const grandchildren = provider.getChildren(connectionsSection);
    expect(grandchildren).toEqual([]);
  });

  it("getTreeItem() returns the element itself", () => {
    const provider = new ParityTreeDataProvider();
    const [section] = provider.getChildren() as ParityTreeItem[];
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

  it("getChildren() under 'connections' still returns no children when deps are supplied (out of T-33 scope)", async () => {
    const provider = new ParityTreeDataProvider({
      findComparisonFiles: vi.fn(async () => []),
      listRecentRuns: vi.fn(async () => []),
      runComparisonCommandId: "paritylens.runComparison",
      reopenRunCommandId: "paritylens.reopenRun"
    });
    const [connectionsSection] = provider.getChildren() as ParityTreeItem[];
    expect(connectionsSection?.section.id).toBe("connections");

    const grandchildren = await provider.getChildren(connectionsSection);
    expect(grandchildren).toEqual([]);
  });

  describe("Comparisons section (T-33)", () => {
    it("returns one ParityComparisonTreeItem per .paritylens file the injected findComparisonFiles dependency discovers", async () => {
      const uris = [vscode.Uri.file("/workspace/customer-migration.paritylens"), vscode.Uri.file("/workspace/orders.paritylens")];
      const findComparisonFiles = vi.fn(async () => uris);
      const provider = new ParityTreeDataProvider({
        findComparisonFiles,
        listRecentRuns: vi.fn(async () => []),
        runComparisonCommandId: "paritylens.runComparison",
        reopenRunCommandId: "paritylens.reopenRun"
      });

      const [, comparisonsSection] = provider.getChildren() as ParityTreeItem[];
      expect(comparisonsSection?.section.id).toBe("comparisons");

      const children = (await provider.getChildren(comparisonsSection)) as ParityComparisonTreeItem[];

      expect(findComparisonFiles).toHaveBeenCalledTimes(1);
      expect(children).toHaveLength(2);
      expect(children.every((c) => c instanceof ParityComparisonTreeItem)).toBe(true);
      expect(children.map((c) => c.uri.path)).toEqual([
        "/workspace/customer-migration.paritylens",
        "/workspace/orders.paritylens"
      ]);
    });

    it("each comparison node's command invokes paritylens.runComparison with the file's URI as an argument", async () => {
      const uri = vscode.Uri.file("/workspace/customer-migration.paritylens");
      const provider = new ParityTreeDataProvider({
        findComparisonFiles: vi.fn(async () => [uri]),
        listRecentRuns: vi.fn(async () => []),
        runComparisonCommandId: "paritylens.runComparison",
        reopenRunCommandId: "paritylens.reopenRun"
      });

      const [, comparisonsSection] = provider.getChildren() as ParityTreeItem[];
      const [node] = (await provider.getChildren(comparisonsSection)) as ParityComparisonTreeItem[];

      expect(node?.command?.command).toBe("paritylens.runComparison");
      expect(node?.command?.arguments).toEqual([uri]);
    });

    it("without injected deps (empty-state provider), the Comparisons section still returns no children", async () => {
      const provider = new ParityTreeDataProvider();
      const [, comparisonsSection] = provider.getChildren() as ParityTreeItem[];
      const children = await provider.getChildren(comparisonsSection);
      expect(children).toEqual([]);
    });
  });

  describe("Recent Runs section (T-33)", () => {
    const RUNS: RunSummary[] = [
      { id: "run-b", name: "second-run", timestamp: "2026-08-02T10:00:00.000Z" },
      { id: "run-a", name: "first-run", timestamp: "2026-08-01T09:00:00.000Z" }
    ];

    it("returns one ParityRecentRunTreeItem per RunSummary from the injected listRecentRuns dependency, in the order given", async () => {
      const listRecentRuns = vi.fn(async () => RUNS);
      const provider = new ParityTreeDataProvider({
        findComparisonFiles: vi.fn(async () => []),
        listRecentRuns,
        runComparisonCommandId: "paritylens.runComparison",
        reopenRunCommandId: "paritylens.reopenRun"
      });

      const [, , recentRunsSection] = provider.getChildren() as ParityTreeItem[];
      expect(recentRunsSection?.section.id).toBe("recentRuns");

      const children = (await provider.getChildren(recentRunsSection)) as ParityRecentRunTreeItem[];

      expect(listRecentRuns).toHaveBeenCalledTimes(1);
      expect(children).toHaveLength(2);
      expect(children.every((c) => c instanceof ParityRecentRunTreeItem)).toBe(true);
      expect(children.map((c) => c.run.id)).toEqual(["run-b", "run-a"]);
      expect(children[0]?.label).toContain("second-run");
      expect(children[0]?.label).toContain("2026-08-02T10:00:00.000Z");
    });

    it("each recent-run node's command invokes the reopen-run command with the run's id as the sole argument (not just plausible-looking label rendering)", async () => {
      const provider = new ParityTreeDataProvider({
        findComparisonFiles: vi.fn(async () => []),
        listRecentRuns: vi.fn(async () => RUNS),
        runComparisonCommandId: "paritylens.runComparison",
        reopenRunCommandId: "paritylens.reopenRun"
      });

      const [, , recentRunsSection] = provider.getChildren() as ParityTreeItem[];
      const [first] = (await provider.getChildren(recentRunsSection)) as ParityRecentRunTreeItem[];

      expect(first?.command?.command).toBe("paritylens.reopenRun");
      expect(first?.command?.arguments).toEqual(["run-b"]);
    });
  });

  // T-34: visual redesign — red-state assertions for iconPath/ThemeIcon
  // presentation that does not exist on pre-T-34 tree items.
  describe("T-34 visual redesign: icons", () => {
    it("ParityComparisonTreeItem constructs a ThemeIcon iconPath (file-type icon)", () => {
      const uri = vscode.Uri.file("/workspace/customer-migration.paritylens");
      const item = new ParityComparisonTreeItem(uri, "paritylens.runComparison");

      expect(item.iconPath).toBeInstanceOf(vscode.ThemeIcon);
    });

    it("ParityRecentRunTreeItem constructs a ThemeIcon iconPath", () => {
      const run: RunSummary = { id: "run-a", name: "first-run", timestamp: "2026-08-01T09:00:00.000Z" };
      const item = new ParityRecentRunTreeItem(run, "paritylens.reopenRun");

      expect(item.iconPath).toBeInstanceOf(vscode.ThemeIcon);
    });
  });
});
