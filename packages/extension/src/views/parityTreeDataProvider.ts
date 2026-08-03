import * as vscode from "vscode";
import type { RunSummary } from "../runHistory/runHistory";

/**
 * The three top-level sections of the "DATA PARITY" activity-bar tree view,
 * per `Idea Prompt.md` section 6's sidebar sketch:
 *
 * ```
 * DATA PARITY
 * ├── Connections
 * ├── Comparisons
 * ├── Recent Runs
 * └── Saved Profiles
 * ```
 *
 * `Saved Profiles` is not included here: T-10's scope (per `TASK-BRIEF.md`)
 * is limited to "Connections / Comparisons / Recent Runs" — the brief names
 * exactly those three sections as this task's tree view contract. Saved
 * Profiles is left for a later, not-yet-scheduled task.
 */
export type ParitySectionId = "connections" | "comparisons" | "recentRuns";

export interface ParitySectionDefinition {
  id: ParitySectionId;
  label: string;
}

export const PARITY_SECTIONS: readonly ParitySectionDefinition[] = [
  { id: "connections", label: "Connections" },
  { id: "comparisons", label: "Comparisons" },
  { id: "recentRuns", label: "Recent Runs" }
];

/**
 * A node in the DATA PARITY tree view. For the top-level sections, only the
 * three section nodes exist. T-33 adds two further node "kinds" beneath
 * `comparisons` and `recentRuns` — `ParityTreeItem` stays a single class
 * (rather than a subclass per kind) since `vscode.TreeItem` doesn't need
 * anything more, and `getTreeItem` just returns whichever node was built.
 */
export class ParityTreeItem extends vscode.TreeItem {
  constructor(public readonly section: ParitySectionDefinition) {
    super(section.label, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = `paritylens.section.${section.id}`;
    this.id = section.id;
  }
}

/**
 * A child node under the "Comparisons" section: one per `.paritylens` file
 * discovered in the workspace via the injected `findComparisonFiles`
 * dependency (Scope item 1). Clicking it invokes `paritylens.runComparison`
 * (T-22/T-30) — per the brief, if that command's existing file-picking flow
 * does not accept a pre-selected URI argument, it is acceptable for the
 * click to just invoke the command and let the existing open-dialog flow
 * run; this node passes the file's URI as a command argument regardless (a
 * future revision to `runComparisonCommand`'s picking behavior could choose
 * to consume it), since VS Code command arguments are otherwise unused/
 * ignored by a zero-arg command handler — this is a no-op-safe superset of
 * the "just invoke the command" fallback the brief explicitly allows.
 */
export class ParityComparisonTreeItem extends vscode.TreeItem {
  constructor(
    public readonly uri: vscode.Uri,
    runComparisonCommandId: string
  ) {
    super(uri.path.split("/").pop() ?? uri.path, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "paritylens.comparisonFile";
    this.resourceUri = uri;
    // T-34: file-type codicon per the design handoff's "file icon"
    // description for Comparisons rows. `"file"` is a valid built-in
    // codicon id (VS Code codicon reference); no color argument, since the
    // handoff doesn't call for comparison-row icon coloring (only Recent
    // Runs rows carry an outcome-colored dot).
    this.iconPath = new vscode.ThemeIcon("file");
    this.command = {
      command: runComparisonCommandId,
      title: "Run Comparison",
      arguments: [uri]
    };
  }
}

/**
 * A child node under the "Recent Runs" section: one per `RunSummary` from
 * T-31's `listRecentRuns` (Scope item 2), most-recent first (already sorted
 * that way by `listRecentRuns`, so this class does no sorting of its own).
 * Label shows the run's `name` and `timestamp`; clicking it invokes
 * `reopenRunCommandId` with the run's `id` as the sole argument — the
 * command handler (wired in `activate.ts`) is what actually calls `loadRun`
 * and `showResultsWebview`, keeping this class itself free of any
 * filesystem/`vscode.commands.executeCommand` dependency so it stays a
 * plain data object constructible in a unit test.
 */
export class ParityRecentRunTreeItem extends vscode.TreeItem {
  constructor(
    public readonly run: RunSummary,
    reopenRunCommandId: string
  ) {
    super(`${run.name} — ${run.timestamp}`, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "paritylens.recentRun";
    // T-34: the design handoff calls for a status-colored dot (pass/warn/
    // fail) per run, driven by the run's outcome. `RunSummary`
    // (packages/extension/src/runHistory/runHistory.ts) is intentionally
    // minimal -- `{ id, name, timestamp }` only, per that file's own doc
    // comment -- and carries no outcome/status field to key an outcome
    // color off of. Per TASK-BRIEF.md Scope item 2 ("if it doesn't carry
    // anything sufficient, that's a scope boundary to flag and stop at,
    // not silently work around"), this task does not invent a status
    // (e.g. by re-reading the full ComparisonResult body, which
    // `listRecentRuns`'s own doc comment says is deliberately avoided for
    // a listing operation, or by widening RunSummary, which is out of this
    // task's file ownership and belongs to whichever future task extends
    // runHistory.ts). A neutral, uncolored codicon is used instead so
    // every run still gets an icon (satisfying "add iconPath/ThemeIcon"),
    // without fabricating an outcome-based color this task cannot
    // correctly compute. See IMPLEMENTATION-REPORT.md for the full
    // disclosure of this decision.
    this.iconPath = new vscode.ThemeIcon("circle-outline");
    this.command = {
      command: reopenRunCommandId,
      title: "Reopen Run",
      arguments: [run.id]
    };
  }
}

/**
 * Dependencies `ParityTreeDataProvider` needs beyond the `vscode.TreeItem`
 * base class it already extends. Every dependency that touches the
 * filesystem or the live `vscode.workspace`/`vscode.commands` API is
 * injected here rather than imported directly inside this module, matching
 * this codebase's established pure-core/injected-glue split (see
 * `runComparisonCommand`'s `deps` object and `resultsWebview.ts`'s
 * `showResultsWebview`) — this keeps `ParityTreeDataProvider` testable
 * under plain Vitest without `@vscode/test-electron`.
 */
export interface ParityTreeDataProviderDeps {
  /**
   * Discovers `.paritylens` files in the current workspace. The live
   * `activate()` wiring supplies a function backed by
   * `vscode.workspace.findFiles` — this module never calls it directly
   * (Scope item 1 / Interfaces consumed: "only via an injected
   * dependency, never called directly inside parityTreeDataProvider.ts").
   */
  findComparisonFiles: () => Promise<vscode.Uri[]>;
  /** T-31's `listRecentRuns`, bound to a concrete `safeOutputRoot` by the caller. */
  listRecentRuns: () => Promise<RunSummary[]>;
  /** Command ID `ParityComparisonTreeItem` nodes invoke on click (`paritylens.runComparison`, T-22/T-30). */
  runComparisonCommandId: string;
  /** Command ID `ParityRecentRunTreeItem` nodes invoke on click, to reopen a past result. */
  reopenRunCommandId: string;
}

/**
 * Tree data provider for the "DATA PARITY" activity-bar view.
 *
 * T-10 scaffolded an empty-state provider (three section nodes, no
 * children). T-33 populates "Comparisons" (workspace `.paritylens` files,
 * via injected `findComparisonFiles`) and "Recent Runs" (T-31's persisted
 * run history, via injected `listRecentRuns`) — "Connections" stays
 * empty-state per `IMPLEMENTATION-PLAN.md`'s T-33 row, which names only
 * "Comparisons" and "Recent Runs" as this task's scope.
 */
export class ParityTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    vscode.TreeItem | undefined | void
  >();

  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | void> =
    this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly deps?: ParityTreeDataProviderDeps) {}

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  /**
   * Returns `vscode.TreeItem[]` synchronously for the top-level call (no
   * `element` — same contract T-10 established, preserved so the existing
   * "getChildren() with no element returns the three top-level section
   * nodes" test keeps working unchanged) and a `Promise<vscode.TreeItem[]>`
   * for any section's children, since populating "Comparisons"/"Recent
   * Runs" requires awaiting the injected `findComparisonFiles`/
   * `listRecentRuns` dependencies. `vscode.TreeDataProvider.getChildren`'s
   * own return type is `ProviderResult<T>` (`T[] | undefined |
   * Thenable<T[] | undefined>`), so returning either shape per call is
   * within the interface's contract.
   */
  getChildren(element?: ParityTreeItem): vscode.TreeItem[] | Promise<vscode.TreeItem[]> {
    if (element) {
      if (element.section.id === "comparisons") {
        return this.getComparisonChildren();
      }
      if (element.section.id === "recentRuns") {
        return this.getRecentRunChildren();
      }
      // "connections" stays empty-state — out of this task's scope.
      return [];
    }
    return PARITY_SECTIONS.map((section) => new ParityTreeItem(section));
  }

  private async getComparisonChildren(): Promise<vscode.TreeItem[]> {
    if (!this.deps) {
      return [];
    }
    const uris = await this.deps.findComparisonFiles();
    return uris.map((uri) => new ParityComparisonTreeItem(uri, this.deps!.runComparisonCommandId));
  }

  private async getRecentRunChildren(): Promise<vscode.TreeItem[]> {
    if (!this.deps) {
      return [];
    }
    const runs = await this.deps.listRecentRuns();
    return runs.map((run) => new ParityRecentRunTreeItem(run, this.deps!.reopenRunCommandId));
  }

  /** Forces the tree view to re-render. */
  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }
}
