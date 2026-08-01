import * as vscode from "vscode";
import { readFile } from "node:fs/promises";
import type { ComparisonResult } from "@paritylens/shared";
import {
  parseDefinition,
  runComparison,
  FixtureConnector,
  InvalidDefinitionError,
  UnresolvedConnectionError,
  type ConnectorRegistry
} from "@paritylens/engine";
import { ParityTreeDataProvider } from "../views/parityTreeDataProvider";
import { SecretStore } from "../secrets/secretStore";
import { showResultsWebview } from "../webview/resultsWebview";

/** View ID the tree data provider registers against (matches `package.json`'s `contributes.views`). */
export const PARITY_TREE_VIEW_ID = "paritylens.dataParityView";

/** Command ID for the new "Run Comparison" command (T-22), matching
 * `package.json`'s `contributes.commands` entry. */
export const RUN_COMPARISON_COMMAND_ID = "paritylens.runComparison";

export interface ActivationResult {
  treeDataProvider: ParityTreeDataProvider;
  treeView: vscode.TreeView<unknown>;
  secretStore: SecretStore;
}

/**
 * T-22 fixture-only limitation, disclosed both as this code comment and as
 * a user-visible notice shown every time the command runs (see
 * `runComparisonCommand` below) — per TASK-BRIEF.md's explicit instruction
 * not to leave this limitation "silently only working for fixture names."
 * Real connection-profile resolution (SQL Server/Snowflake/PostgreSQL
 * credentials via `SecretStore`) is unscheduled future work; no task has
 * built connection-profile management yet, so this command can only ever
 * resolve a `.paritylens` definition's `source.connection`/
 * `target.connection` names against the three fixed fixture-set/side pairs
 * built by `buildFixtureRegistry` below, never a real database.
 */
const FIXTURE_ONLY_NOTICE =
  "ParityLens: this command runs comparisons against built-in fixture data only " +
  '(source connection maps to the "source" side, target connection maps to the ' +
  '"target" side of the sqlserver-customer fixture pair). Real database connection ' +
  "profiles are not yet supported.";

/**
 * Builds a `ConnectorRegistry` backed entirely by `FixtureConnector`
 * instances — no real connection-profile resolution, per TASK-BRIEF.md T-22
 * Scope item 2 ("Builds a `ConnectorRegistry` using `FixtureConnector`
 * only"). Both `definition.source.connection` and
 * `definition.target.connection` (whatever names the parsed definition
 * actually uses) are registered against the "source"/"target" sides of the
 * same `sqlserver-customer` fixture pair used throughout this project's
 * engine-layer tests (see `planner.test.ts`), so any `.paritylens`
 * definition file's connection names resolve for this command regardless
 * of what the author actually called them.
 */
function buildFixtureRegistry(sourceConnectionName: string, targetConnectionName: string): ConnectorRegistry {
  const registry: ConnectorRegistry = new Map();
  registry.set(sourceConnectionName, new FixtureConnector("sqlserver-customer", "source"));
  registry.set(targetConnectionName, new FixtureConnector("sqlserver-customer", "target"));
  return registry;
}

/**
 * The `paritylens.runComparison` command handler, extracted as a directly
 * testable function separate from the raw `vscode.commands.registerCommand`
 * callback — same pattern T-10/T-11 already use for testability without
 * `@vscode/test-electron` (see this file's and `resultsWebview.ts`'s own
 * header comments). Reads `yamlText`, parses it via `parseDefinition`,
 * builds a fixture-only `ConnectorRegistry`, runs `runComparison`, and shows
 * the real result via `showResultsWebview`. Every dependency that touches
 * the `vscode` API or the filesystem is injected so this function can be
 * exercised in a plain Vitest run.
 *
 * Never throws: `InvalidDefinitionError`, `UnresolvedConnectionError`, and
 * any other error are all caught and surfaced via `showErrorMessage` rather
 * than left to become an unhandled rejection / generic VS Code crash
 * notification, per TASK-BRIEF.md's Scope item 2.
 */
export async function runComparisonCommand(
  yamlText: string,
  deps: {
    createWebviewPanel: (
      viewType: string,
      title: string,
      showOptions: vscode.ViewColumn,
      options?: vscode.WebviewPanelOptions & vscode.WebviewOptions
    ) => vscode.WebviewPanel;
    viewColumn: vscode.ViewColumn;
    showInformationMessage: (message: string) => unknown;
    showErrorMessage: (message: string) => unknown;
  }
): Promise<ComparisonResult | undefined> {
  try {
    deps.showInformationMessage(FIXTURE_ONLY_NOTICE);

    const definition = parseDefinition(yamlText);
    const registry = buildFixtureRegistry(definition.source.connection, definition.target.connection);

    const result = await runComparison(definition, registry);

    showResultsWebview(deps.createWebviewPanel, deps.viewColumn, result);
    return result;
  } catch (err) {
    const message =
      err instanceof InvalidDefinitionError || err instanceof UnresolvedConnectionError || err instanceof Error
        ? err.message
        : String(err);
    deps.showErrorMessage(`ParityLens: run comparison failed — ${message}`);
    return undefined;
  }
}

/**
 * Registers `paritylens.runComparison` against the live `vscode` API:
 * prompts the user to pick a `.paritylens` file from the open workspace via
 * `vscode.window.showOpenDialog`, reads it from disk, and delegates to
 * `runComparisonCommand` above for the actual parse/run/render logic.
 */
function registerRunComparisonCommand(): vscode.Disposable {
  return vscode.commands.registerCommand(RUN_COMPARISON_COMMAND_ID, async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    const defaultUri = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0]?.uri : undefined;

    const picked = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      ...(defaultUri !== undefined ? { defaultUri } : {}),
      filters: { "ParityLens definition": ["paritylens", "yaml", "yml"] },
      openLabel: "Run Comparison"
    });

    if (!picked || picked.length === 0) {
      return;
    }

    const fileUri = picked[0];
    if (!fileUri) {
      return;
    }

    let yamlText: string;
    try {
      yamlText = await readFile(fileUri.fsPath, "utf8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`ParityLens: could not read "${fileUri.fsPath}" — ${message}`);
      return;
    }

    await runComparisonCommand(yamlText, {
      createWebviewPanel: vscode.window.createWebviewPanel.bind(vscode.window),
      viewColumn: vscode.ViewColumn.Active,
      showInformationMessage: vscode.window.showInformationMessage,
      showErrorMessage: vscode.window.showErrorMessage
    });
  });
}

/**
 * Extension activation entry point. Registers the "DATA PARITY" tree view,
 * constructs the `SecretStore` wrapper around `context.secrets`, and (T-22)
 * registers the `paritylens.runComparison` command.
 *
 * Per `TASK-BRIEF.md` T-10: no comparison logic, no connection management,
 * no results rendering lived here originally — T-22 is the first task to
 * extend this file's command registration beyond what T-10 needed for the
 * tree view, per T-22's own brief ("the only permitted edit is adding the
 * new command registration; do not restructure `activate()`'s existing
 * tree-view/SecretStore wiring").
 */
export function activate(context: vscode.ExtensionContext): ActivationResult {
  const treeDataProvider = new ParityTreeDataProvider();
  const treeView = vscode.window.createTreeView(PARITY_TREE_VIEW_ID, {
    treeDataProvider
  });
  context.subscriptions.push(treeView);

  const secretStore = new SecretStore(context.secrets);

  const runComparisonDisposable = registerRunComparisonCommand();
  context.subscriptions.push(runComparisonDisposable);

  return { treeDataProvider, treeView, secretStore };
}
