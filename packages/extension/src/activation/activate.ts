import * as vscode from "vscode";
import { readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
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
import { ConnectionProfileStore, secretKeyFor } from "../connections/connectionProfileStore";
import { addConnectionCommand, editConnectionCommand, deleteConnectionCommand } from "../connections/connectionCommands";
import { resolveConnector } from "../connections/resolveConnector";
import type { ConnectionProfile } from "../connections/connectionProfile";
import { runNewComparisonCommand } from "../authoring/newComparisonWizard";

/** View ID the tree data provider registers against (matches `package.json`'s `contributes.views`). */
export const PARITY_TREE_VIEW_ID = "paritylens.dataParityView";

/** Command ID for the new "Run Comparison" command (T-22), matching
 * `package.json`'s `contributes.commands` entry. */
export const RUN_COMPARISON_COMMAND_ID = "paritylens.runComparison";

/** Command IDs for the three connection profile management commands (T-29),
 * matching `package.json`'s `contributes.commands` entries. */
export const ADD_CONNECTION_COMMAND_ID = "paritylens.addConnection";
export const EDIT_CONNECTION_COMMAND_ID = "paritylens.editConnection";
export const DELETE_CONNECTION_COMMAND_ID = "paritylens.deleteConnection";

/** Command ID for the new comparison-authoring scaffold command (T-32),
 * matching `package.json`'s `contributes.commands` entry. */
export const NEW_COMPARISON_COMMAND_ID = "paritylens.newComparison";

export interface ActivationResult {
  treeDataProvider: ParityTreeDataProvider;
  treeView: vscode.TreeView<unknown>;
  secretStore: SecretStore;
}

/**
 * T-30: connection resolution now consults saved `ConnectionProfile`s (T-29)
 * before falling back to fixtures, so the T-22-era notice claiming "this
 * command runs comparisons against built-in fixture data only" is no longer
 * accurate for every run — a connection name matching a saved profile now
 * resolves to a real `SqlServerConnector`/`PostgresConnector`. Per
 * TASK-BRIEF.md T-30 Scope item 3, this stays a disclosure notice rather
 * than being deleted outright: the fixture fallback path is still real and
 * still worth disclosing for the connection names it actually applies to.
 * `buildRunNotice` (below) picks between the two variants per-run based on
 * whether either side's connection name actually matched a saved profile,
 * so the message shown is accurate for the run that is about to happen
 * rather than a static, always-shown claim.
 */
const FIXTURE_ONLY_NOTICE =
  "ParityLens: this command runs comparisons against built-in fixture data only " +
  '(source connection maps to the "source" side, target connection maps to the ' +
  '"target" side of the sqlserver-customer fixture pair). Real database connection ' +
  "profiles are not yet supported.";

const MIXED_CONNECTION_NOTICE =
  "ParityLens: connection names matching a saved connection profile run against " +
  "the real database; any connection name without a matching saved profile falls " +
  "back to built-in fixture data (sqlserver-customer fixture pair) for this run.";

/**
 * Picks the accurate disclosure notice for this specific run: if at least
 * one of the two connection names resolves to a saved `ConnectionProfile`,
 * the run is (at least partly) real, so `MIXED_CONNECTION_NOTICE` is shown
 * instead of the T-22-era `FIXTURE_ONLY_NOTICE`, which would otherwise be a
 * false claim once real resolution exists (T-30 Scope item 3).
 */
function buildRunNotice(sourceProfile: ConnectionProfile | undefined, targetProfile: ConnectionProfile | undefined): string {
  return sourceProfile !== undefined || targetProfile !== undefined ? MIXED_CONNECTION_NOTICE : FIXTURE_ONLY_NOTICE;
}

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
 * Looks up a saved `ConnectionProfile` by its `name` field (not `id`) —
 * matches the existing lookup-by-name convention `connectionCommands.ts`'s
 * `editConnectionCommand`/`deleteConnectionCommand` already use for their
 * own `showQuickPick` selections (`profiles.find((profile) => profile.name
 * === selectedName)`), since a `.paritylens` definition's
 * `source.connection`/`target.connection` values are the same
 * human-chosen connection names a user enters via `paritylens.addConnection`
 * (`ConnectionProfile.name`), not the internally generated `id`.
 */
function findProfileByName(store: ConnectionProfileStore, connectionName: string): ConnectionProfile | undefined {
  return store.list().find((profile) => profile.name === connectionName);
}

/**
 * Builds a `ConnectorRegistry` for `runComparisonCommand`, consulting saved
 * `ConnectionProfile`s (T-29) before falling back to `FixtureConnector`
 * (T-22's `buildFixtureRegistry`), per TASK-BRIEF.md T-30 Scope item 1. For
 * each of `sourceConnectionName`/`targetConnectionName` independently: if a
 * saved profile's `name` matches, its password is read via `SecretStore`
 * (keyed by `secretKeyFor(profile.id)`, T-29's established key shape) and
 * `resolveConnector` constructs the real `SqlServerConnector`/
 * `PostgresConnector`; otherwise this falls back to the exact same
 * `FixtureConnector` construction `buildFixtureRegistry` above uses (same
 * `sqlserver-customer` fixture pair, same source/target side mapping) —
 * per TASK-BRIEF.md's "Prohibited changes": "Do not remove or weaken the
 * fixture-fallback path."
 *
 * Real connector *construction* here never throws/rejects on a bad
 * host/credential — `SqlServerConnector`/`PostgresConnector`'s constructors
 * only store connection options, they don't connect. Any actual
 * connectivity failure is deferred to `runComparison`'s own Layer-1
 * `testConnection()` check (`planner.ts`, not modified by this task), which
 * already converts a failed connection into a `"failed"`-status
 * `ComparisonResult` rather than a thrown error — exactly the behavior
 * TASK-BRIEF.md Scope item 4 requires ("let `runComparison`'s existing
 * Layer-1 handling do its job"). This function therefore has no try/catch
 * of its own around `resolveConnector`/profile lookup.
 */
async function buildConnectorRegistry(
  sourceConnectionName: string,
  targetConnectionName: string,
  connectionProfileStore: ConnectionProfileStore,
  secretStore: SecretStore
): Promise<ConnectorRegistry> {
  const registry: ConnectorRegistry = new Map();

  const sourceProfile = findProfileByName(connectionProfileStore, sourceConnectionName);
  if (sourceProfile !== undefined) {
    const password = (await secretStore.get(secretKeyFor(sourceProfile.id))) ?? "";
    registry.set(sourceConnectionName, resolveConnector(sourceProfile, password));
  } else {
    registry.set(sourceConnectionName, new FixtureConnector("sqlserver-customer", "source"));
  }

  const targetProfile = findProfileByName(connectionProfileStore, targetConnectionName);
  if (targetProfile !== undefined) {
    const password = (await secretStore.get(secretKeyFor(targetProfile.id))) ?? "";
    registry.set(targetConnectionName, resolveConnector(targetProfile, password));
  } else {
    registry.set(targetConnectionName, new FixtureConnector("sqlserver-customer", "target"));
  }

  return registry;
}

/**
 * The `paritylens.runComparison` command handler, extracted as a directly
 * testable function separate from the raw `vscode.commands.registerCommand`
 * callback — same pattern T-10/T-11 already use for testability without
 * `@vscode/test-electron` (see this file's and `resultsWebview.ts`'s own
 * header comments). Reads `yamlText`, parses it via `parseDefinition`,
 * builds a `ConnectorRegistry` (T-30: real `SqlServerConnector`/
 * `PostgresConnector` for connection names matching a saved
 * `ConnectionProfile`, `FixtureConnector` fallback otherwise — see
 * `buildConnectorRegistry` above), runs `runComparison`, and shows the real
 * result via `showResultsWebview`. Every dependency that touches the
 * `vscode` API or the filesystem is injected so this function can be
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
    /**
     * T-30: consulted for real-connector resolution before falling back to
     * `FixtureConnector`. The live `registerRunComparisonCommand` wiring
     * below always supplies both (from `activate()`'s own construction).
     * Both are typed optional here — rather than required — as a deliberate,
     * minimal judgment call: `packages/extension/src/activation/
     * runComparisonCommand.test.ts` (T-22's own pre-existing test file,
     * outside this task's declared "Files owned" list per TASK-BRIEF.md, so
     * not touchable by this task) calls `runComparisonCommand` without these
     * fields at all. Making them required would force every one of that
     * file's existing calls through the `deps as never` cast into a runtime
     * `TypeError` the moment `deps.connectionProfileStore.list()` is
     * invoked, breaking T-22's existing coverage — which TASK-BRIEF.md's
     * "Prohibited changes" section forbids ("do not remove or weaken the
     * fixture-fallback path"). Treating an absent store as "no profiles"
     * preserves that file's exact fixture-only behavior unchanged, while the
     * real `activate()` call site always provides both.
     */
    connectionProfileStore?: ConnectionProfileStore;
    secretStore?: SecretStore;
  }
): Promise<ComparisonResult | undefined> {
  try {
    const definition = parseDefinition(yamlText);

    const sourceProfile =
      deps.connectionProfileStore !== undefined
        ? findProfileByName(deps.connectionProfileStore, definition.source.connection)
        : undefined;
    const targetProfile =
      deps.connectionProfileStore !== undefined
        ? findProfileByName(deps.connectionProfileStore, definition.target.connection)
        : undefined;
    deps.showInformationMessage(buildRunNotice(sourceProfile, targetProfile));

    const registry =
      deps.connectionProfileStore !== undefined && deps.secretStore !== undefined
        ? await buildConnectorRegistry(
            definition.source.connection,
            definition.target.connection,
            deps.connectionProfileStore,
            deps.secretStore
          )
        : buildFixtureRegistry(definition.source.connection, definition.target.connection);

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
 *
 * T-30: now takes the same `connectionProfileStore`/`secretStore` `activate()`
 * already constructs for the connection-management commands, so real
 * connection profiles can be resolved for this command too.
 */
function registerRunComparisonCommand(connectionProfileStore: ConnectionProfileStore, secretStore: SecretStore): vscode.Disposable {
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
      showErrorMessage: vscode.window.showErrorMessage,
      connectionProfileStore,
      secretStore
    });
  });
}

/**
 * Builds the `ConnectionCommandDeps` the connection command handlers
 * (`connectionCommands.ts`) need, wired against the real `vscode.window`
 * API — same extraction/binding pattern `registerRunComparisonCommand`
 * above already uses for `runComparisonCommand`'s deps.
 */
function buildConnectionCommandDeps() {
  return {
    showInputBox: vscode.window.showInputBox.bind(vscode.window),
    showQuickPick: vscode.window.showQuickPick.bind(vscode.window),
    showInformationMessage: vscode.window.showInformationMessage,
    showErrorMessage: vscode.window.showErrorMessage
  };
}

/** Registers `paritylens.addConnection` against the live `vscode` API, delegating to `addConnectionCommand`. */
function registerAddConnectionCommand(store: ConnectionProfileStore): vscode.Disposable {
  return vscode.commands.registerCommand(ADD_CONNECTION_COMMAND_ID, async () => {
    await addConnectionCommand(store, buildConnectionCommandDeps() as never);
  });
}

/** Registers `paritylens.editConnection` against the live `vscode` API, delegating to `editConnectionCommand`. */
function registerEditConnectionCommand(store: ConnectionProfileStore): vscode.Disposable {
  return vscode.commands.registerCommand(EDIT_CONNECTION_COMMAND_ID, async () => {
    await editConnectionCommand(store, buildConnectionCommandDeps() as never);
  });
}

/** Registers `paritylens.deleteConnection` against the live `vscode` API, delegating to `deleteConnectionCommand`. */
function registerDeleteConnectionCommand(store: ConnectionProfileStore): vscode.Disposable {
  return vscode.commands.registerCommand(DELETE_CONNECTION_COMMAND_ID, async () => {
    await deleteConnectionCommand(store, buildConnectionCommandDeps() as never);
  });
}

/**
 * Registers `paritylens.newComparison` (T-32) against the live `vscode`
 * API, delegating to `runNewComparisonCommand`
 * (`packages/extension/src/authoring/newComparisonWizard.ts`) for the
 * actual wizard/scaffold logic. `resolveTargetPath` joins the user-entered
 * file name against the first open workspace folder (falling back to the
 * file name as-is if no workspace folder is open, matching
 * `registerRunComparisonCommand`'s own `defaultUri` fallback pattern
 * above); `fileExists`/`writeFile` are backed by `node:fs` so the pure
 * wizard module never imports `fs`/`path`/`vscode` itself.
 */
function registerNewComparisonCommand(connectionProfileStore: ConnectionProfileStore): vscode.Disposable {
  return vscode.commands.registerCommand(NEW_COMPARISON_COMMAND_ID, async () => {
    await runNewComparisonCommand({
      showInputBox: vscode.window.showInputBox.bind(vscode.window),
      showQuickPick: vscode.window.showQuickPick.bind(vscode.window),
      showInformationMessage: vscode.window.showInformationMessage,
      showErrorMessage: vscode.window.showErrorMessage,
      connectionProfileStore,
      fileExists: async (path: string) => {
        try {
          await stat(path);
          return true;
        } catch {
          return false;
        }
      },
      writeFile: async (path: string, contents: string) => {
        await writeFile(path, contents, "utf8");
      },
      resolveTargetPath: (fileName: string) => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const baseUri = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0]?.uri : undefined;
        return baseUri !== undefined ? join(baseUri.fsPath, fileName) : fileName;
      }
    } as never);
  });
}

/**
 * Extension activation entry point. Registers the "DATA PARITY" tree view,
 * constructs the `SecretStore` wrapper around `context.secrets`, and (T-22)
 * registers the `paritylens.runComparison` command, (T-29) registers the
 * `paritylens.addConnection`/`paritylens.editConnection`/
 * `paritylens.deleteConnection` commands, and (T-32) registers the
 * `paritylens.newComparison` scaffold command, all against a
 * `ConnectionProfileStore` wrapping `context.globalState` and the same
 * `secretStore` constructed above.
 *
 * Per `TASK-BRIEF.md` T-10: no comparison logic, no connection management,
 * no results rendering lived here originally — T-22 is the first task to
 * extend this file's command registration beyond what T-10 needed for the
 * tree view, per T-22's own brief ("the only permitted edit is adding the
 * new command registration; do not restructure `activate()`'s existing
 * tree-view/SecretStore wiring"). T-29 and T-32 each follow that exact same
 * precedent for their own commands, per their own briefs' identical
 * instruction.
 */
export function activate(context: vscode.ExtensionContext): ActivationResult {
  const treeDataProvider = new ParityTreeDataProvider();
  const treeView = vscode.window.createTreeView(PARITY_TREE_VIEW_ID, {
    treeDataProvider
  });
  context.subscriptions.push(treeView);

  const secretStore = new SecretStore(context.secrets);
  const connectionProfileStore = new ConnectionProfileStore(context.globalState, secretStore);

  // T-30: registerRunComparisonCommand now needs connectionProfileStore/
  // secretStore for real-connector resolution, so connectionProfileStore's
  // construction (originally below, after this call) moves above it. This
  // is a reorder only -- neither construction call's own arguments nor the
  // three connection-management command registrations below change.
  const runComparisonDisposable = registerRunComparisonCommand(connectionProfileStore, secretStore);
  context.subscriptions.push(runComparisonDisposable);

  context.subscriptions.push(registerAddConnectionCommand(connectionProfileStore));
  context.subscriptions.push(registerEditConnectionCommand(connectionProfileStore));
  context.subscriptions.push(registerDeleteConnectionCommand(connectionProfileStore));
  context.subscriptions.push(registerNewComparisonCommand(connectionProfileStore));

  return { treeDataProvider, treeView, secretStore };
}
