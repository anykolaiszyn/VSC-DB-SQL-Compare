import * as vscode from "vscode";

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
 * A node in the DATA PARITY tree view. For this task's scope, only the
 * three top-level section nodes exist (empty-state provider) — no
 * connections, comparisons, or run records have been implemented yet.
 */
export class ParityTreeItem extends vscode.TreeItem {
  constructor(public readonly section: ParitySectionDefinition) {
    super(section.label, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = `paritylens.section.${section.id}`;
    this.id = section.id;
  }
}

/**
 * Tree data provider for the "DATA PARITY" activity-bar view.
 *
 * This task scaffolds an empty-state provider: it renders the three
 * top-level section nodes (Connections, Comparisons, Recent Runs) with no
 * children under any of them yet. Populating each section with real data
 * (registered connections, defined comparisons, recorded runs) is later
 * scope (T-11 and beyond).
 */
export class ParityTreeDataProvider implements vscode.TreeDataProvider<ParityTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    ParityTreeItem | undefined | void
  >();

  readonly onDidChangeTreeData: vscode.Event<ParityTreeItem | undefined | void> =
    this.onDidChangeTreeDataEmitter.event;

  getTreeItem(element: ParityTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ParityTreeItem): ParityTreeItem[] {
    if (element) {
      // No children under any section yet — empty-state provider for this task.
      return [];
    }
    return PARITY_SECTIONS.map((section) => new ParityTreeItem(section));
  }

  /** Forces the tree view to re-render. Not exercised by this task's scope. */
  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire();
  }
}
