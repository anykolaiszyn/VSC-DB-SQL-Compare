import * as vscode from "vscode";
import { ParityTreeDataProvider } from "../views/parityTreeDataProvider";
import { SecretStore } from "../secrets/secretStore";

/** View ID the tree data provider registers against (matches `package.json`'s `contributes.views`). */
export const PARITY_TREE_VIEW_ID = "paritylens.dataParityView";

export interface ActivationResult {
  treeDataProvider: ParityTreeDataProvider;
  treeView: vscode.TreeView<unknown>;
  secretStore: SecretStore;
}

/**
 * Extension activation entry point. Registers the "DATA PARITY" tree view
 * and constructs the `SecretStore` wrapper around `context.secrets`.
 *
 * Per `TASK-BRIEF.md` T-10: no comparison logic, no connection management,
 * no results rendering — this wires the extension shell only. Command
 * registration is limited to what's needed to make the tree view
 * functional; connection/comparison/run commands are later scope
 * (T-11/T-16 and unscheduled connection-management work).
 */
export function activate(context: vscode.ExtensionContext): ActivationResult {
  const treeDataProvider = new ParityTreeDataProvider();
  const treeView = vscode.window.createTreeView(PARITY_TREE_VIEW_ID, {
    treeDataProvider
  });
  context.subscriptions.push(treeView);

  const secretStore = new SecretStore(context.secrets);

  return { treeDataProvider, treeView, secretStore };
}
