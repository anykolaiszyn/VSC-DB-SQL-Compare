import * as vscode from "vscode";
import { readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ComparisonResult, DataPlatformConnector } from "@paritylens/shared";
import {
  parseDefinition,
  runComparison,
  planQueries,
  FixtureConnector,
  InvalidDefinitionError,
  UnresolvedConnectionError,
  type ConnectorRegistry
} from "@paritylens/engine";
import { ParityTreeDataProvider } from "../views/parityTreeDataProvider";
import { SecretStore } from "../secrets/secretStore";
import { showResultsWebview } from "../webview/resultsWebview";
import { renderRunConfirmationHtml } from "../webview/runConfirmationWebview";
import { ConnectionProfileStore, secretKeyFor } from "../connections/connectionProfileStore";
import { addConnectionCommand, editConnectionCommand, deleteConnectionCommand } from "../connections/connectionCommands";
import { resolveConnector } from "../connections/resolveConnector";
import type { ConnectionProfile } from "../connections/connectionProfile";
import { runNewComparisonCommand } from "../authoring/newComparisonWizard";
import { persistRun, loadRun, listRecentRuns } from "../runHistory/runHistory";
import { createParityStatusBarItem, type ParityStatusBarItem } from "../statusbar/parityStatusBar";
import { ComparisonEditorProvider, COMPARISON_EDITOR_VIEW_TYPE } from "../authoring/comparisonEditorProvider";

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

/**
 * Command ID (T-33) the "Recent Runs" tree section's nodes
 * (`ParityRecentRunTreeItem`, `parityTreeDataProvider.ts`) invoke on click
 * to reopen a past persisted run. Not added to `package.json`'s
 * `contributes.commands` — that file is outside this task's declared
 * ownership (see TASK-BRIEF.md's "Files owned" list), and a manifest entry
 * is only needed for command-palette visibility, not for
 * `vscode.commands.registerCommand`/`executeCommand` to work for a
 * tree-item-triggered command. Judgment call, documented here rather than
 * silently expanding scope into `package.json`.
 */
export const REOPEN_RUN_COMMAND_ID = "paritylens.reopenRun";

/**
 * Run-history safe output root convention (T-33 Scope item 5): the first
 * open workspace folder's path, joined with a fixed `.paritylens/runs`
 * subdirectory. No existing command wires a concrete `safeOutputRoot`
 * value yet (`writeExport.ts` only defines the containment check) — this
 * mirrors `registerRunComparisonCommand`'s own `defaultUri` fallback
 * pattern (first workspace folder) a few lines below, and nests run
 * records under a dedicated hidden subdirectory (matching this project's
 * "isolated output paths under a safe output root (e.g. a project-local
 * `work/` or `.paritylens/` directory)" convention from `AGENTS.md`'s
 * Safety boundaries) rather than writing JSON run records directly into
 * the workspace root.
 */
const RUN_HISTORY_SUBDIRECTORY = ".paritylens/runs";

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
 * Resolves the concrete `safeOutputRoot` path `persistRun`/`listRecentRuns`
 * need, per the `RUN_HISTORY_SUBDIRECTORY` convention documented above.
 * Returns `undefined` when no workspace folder is open — `persistRun`
 * cannot run without a workspace-relative root, and per Scope item 5 this
 * must not crash; the caller (`runComparisonCommand`) treats `undefined`
 * as "skip persistence, surface via showErrorMessage" rather than throwing.
 */
function resolveRunHistoryRoot(workspaceFolders: readonly { uri: { fsPath: string } }[] | undefined): string | undefined {
  const first = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0] : undefined;
  return first !== undefined ? join(first.uri.fsPath, RUN_HISTORY_SUBDIRECTORY) : undefined;
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
    /**
     * T-33 Scope item 5: resolves the safe output root `persistRun` writes
     * run records under, given the live `vscode.workspace.workspaceFolders`
     * array (or `undefined` if none is open). Injected — like
     * `connectionProfileStore`/`secretStore` above — as a typed optional
     * defaulting to a no-op-safe absent state: `runComparisonCommand.test.ts`
     * (T-22's pre-existing file, outside this task's "Files owned" list)
     * calls this function without this field, and per this task's own
     * "Prohibited changes," a `persistRun` failure (including "no
     * workspace open") must never crash or replace the success path with
     * an error — omitting this dep simply skips persistence for that call,
     * exactly like an unresolvable workspace would.
     */
    resolveRunHistoryRoot?: () => string | undefined;
    /**
     * T-33 Scope item 5/6: the status bar item `activate()` constructs
     * once via `createParityStatusBarItem` and passes through here so a
     * successful run can call `updateFromResult` + `.show()`. Typed
     * optional for the same reason as the two fields above — this
     * function's pre-existing test file never supplies it.
     */
    statusBarItem?: ParityStatusBarItem;
    /**
     * T-38: called with `planQueries`'s output (the exact SQL list a real
     * run would issue) after the connector registry is resolved and before
     * `runComparison` is ever invoked — resolving `true` proceeds with the
     * existing, unmodified `runComparison(...)` call; resolving `false`
     * (or the promise's default when this dep is unsupplied) cancels the
     * run cleanly, with `runComparison` never called and no error shown.
     * The live `registerRunComparisonCommand` wiring below always supplies
     * a real implementation backed by `renderRunConfirmationHtml` +
     * `createWebviewPanel` + `onDidReceiveMessage` (see
     * `createWebviewConfirmRun` below).
     *
     * Typed optional, defaulting to "proceed" (`true`) when absent — the
     * same documented pattern `resolveRunHistoryRoot`/`statusBarItem`
     * above already use: `runComparisonCommand.test.ts` (T-22's
     * pre-existing file, outside this task's declared "Files owned" list
     * per TASK-BRIEF.md, so not touchable by this task) calls this
     * function without this field at all, and its existing assertions
     * depend on `runComparison` actually being reached and
     * `createWebviewPanel` actually being called for the results webview.
     * Defaulting an absent `confirmRun` to "proceed" preserves that file's
     * exact existing behavior unchanged, while `activate.test.ts`'s new
     * T-38 suite (this task's own test file) and the real
     * `registerRunComparisonCommand` wiring always supply a real
     * confirmation callback, so "every run goes through confirmation"
     * holds for every actual caller this task controls.
     */
    confirmRun?: (queries: string[]) => Promise<boolean>;
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

    // T-38: preview the exact SQL a real run would issue, and block until
    // the user confirms Run (or cancels). planQueries never calls
    // executeQuery -- see planQueries.ts's own header comment -- so this
    // step is safe to run before any real query executes. A planQueries
    // failure (e.g. a getSchema rejection) falls through to this
    // function's existing outer catch below, exactly like any other
    // pre-execution failure.
    const plannedQueries = await planQueries(definition, registry);
    const proceed = deps.confirmRun !== undefined ? await deps.confirmRun(plannedQueries) : true;
    if (!proceed) {
      // Cancellation is not a failure -- exit cleanly, no error shown,
      // runComparison never called.
      return undefined;
    }

    const result = await runComparison(definition, registry);

    // T-33 Scope item 5: persist the run and update the status bar
    // additively, alongside showing the results webview. Both are
    // best-effort: a persistRun failure (no workspace open, unwritable
    // root, etc.) must not prevent the results webview from showing the
    // run's actual result, per this task's Scope item 5 and Prohibited
    // Changes ("only permitted change to that function is the additive
    // persist/status-bar calls") — so this is a separate try/catch, not
    // folded into the outer one that reports parse/connection failures.
    if (deps.resolveRunHistoryRoot !== undefined) {
      const safeOutputRoot = deps.resolveRunHistoryRoot();
      if (safeOutputRoot !== undefined) {
        try {
          await persistRun(result, safeOutputRoot);
        } catch (persistErr) {
          const message = persistErr instanceof Error ? persistErr.message : String(persistErr);
          deps.showErrorMessage(`ParityLens: could not save this run to history — ${message}`);
        }
      } else {
        deps.showErrorMessage("ParityLens: could not save this run to history — no workspace folder is open.");
      }
    }

    if (deps.statusBarItem !== undefined) {
      deps.statusBarItem.updateFromResult(result);
      deps.statusBarItem.show();
    }

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
 *
 * T-33: also takes the `ParityStatusBarItem` `activate()` constructs once,
 * and passes a `resolveRunHistoryRoot` closure bound to the live
 * `vscode.workspace.workspaceFolders` — see `resolveRunHistoryRoot`'s doc
 * comment for the convention.
 *
 * T-38: also passes `confirmRun` (see `createWebviewConfirmRun` below),
 * a real blocking confirmation callback backed by a new webview panel.
 */
function registerRunComparisonCommand(
  connectionProfileStore: ConnectionProfileStore,
  secretStore: SecretStore,
  statusBarItem: ParityStatusBarItem
): vscode.Disposable {
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
      secretStore,
      resolveRunHistoryRoot: () => resolveRunHistoryRoot(vscode.workspace.workspaceFolders),
      statusBarItem,
      confirmRun: createWebviewConfirmRun()
    });
  });
}

/**
 * T-38: builds the real, `vscode`-backed `confirmRun` callback
 * `runComparisonCommand` blocks on before ever calling `runComparison`.
 * Opens a new webview panel (`enableScripts: true`, following T-36's
 * established interactive-webview pattern — see
 * `comparisonEditorProvider.ts`'s header comment) rendered via
 * `renderRunConfirmationHtml`, and resolves the returned promise from the
 * panel's `onDidReceiveMessage` handler: `{ type: "run" }` resolves `true`,
 * `{ type: "cancel" }` resolves `false`. `onDidDispose` (the panel closed
 * without either button being clicked — e.g. the user closed the tab)
 * resolves `false` as well, matching TASK-BRIEF.md Scope item 2's "If the
 * user clicks Cancel (or closes the panel without choosing), runComparison
 * must never be called" contract. The panel is always disposed once a
 * decision is reached (whichever happens first: a message or a manual
 * close), so a stray disposal after a message never double-resolves the
 * promise (`resolved` guards against exactly that).
 */
function createWebviewConfirmRun(): (queries: string[]) => Promise<boolean> {
  return (queries: string[]) =>
    new Promise<boolean>((resolvePromise) => {
      let resolved = false;
      const resolveOnce = (value: boolean) => {
        if (resolved) {
          return;
        }
        resolved = true;
        resolvePromise(value);
      };

      const panel = vscode.window.createWebviewPanel(
        "paritylens.runConfirmation",
        "ParityLens: Confirm Run",
        vscode.ViewColumn.Active,
        { enableScripts: true }
      );
      panel.webview.html = renderRunConfirmationHtml(queries);

      const messageSubscription = panel.webview.onDidReceiveMessage((message: unknown) => {
        if (typeof message !== "object" || message === null) {
          return;
        }
        const type = (message as { type?: unknown }).type;
        if (type === "run") {
          resolveOnce(true);
          panel.dispose();
        } else if (type === "cancel") {
          resolveOnce(false);
          panel.dispose();
        }
      });

      panel.onDidDispose(() => {
        messageSubscription.dispose();
        resolveOnce(false);
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
 * The `paritylens.reopenRun` command handler (T-33), extracted as a
 * directly testable function separate from the raw
 * `vscode.commands.registerCommand` callback — same extraction pattern
 * `runComparisonCommand` above already uses for the same reason (see its
 * own header comment): every dependency that touches the `vscode` API or
 * the filesystem is injected, so this function can be exercised in a plain
 * Vitest run without going through a mocked `registerCommand` that would
 * otherwise discard the callback and never invoke it (the exact gap
 * REVIEW-REPORT.md's T-33-01 finding identified — `registerReopenRunCommand`
 * previously inlined this logic directly in the `registerCommand` callback,
 * so no test could invoke it).
 *
 * Loads the persisted `ComparisonResult` via T-31's `loadRun` (given the
 * caller-resolved `safeOutputRoot`, following the same
 * `resolveRunHistoryRoot` convention `runComparisonCommand` uses for
 * `persistRun`) and reopens it via `showResultsWebview` — mirroring the
 * brief's Scope item 2 ("its `command` should invoke `loadRun` for that
 * `id` and pass the result to `showResultsWebview`"). Never throws: a
 * `loadRun` rejection (bad id, unreadable record, etc.) is caught and
 * surfaced via `showErrorMessage` rather than left as an unhandled
 * rejection.
 */
export async function reopenRunCommand(
  id: string,
  safeOutputRoot: string | undefined,
  deps: {
    loadRun: (id: string, safeOutputRoot: string) => Promise<ComparisonResult>;
    createWebviewPanel: (
      viewType: string,
      title: string,
      showOptions: vscode.ViewColumn,
      options?: vscode.WebviewPanelOptions & vscode.WebviewOptions
    ) => vscode.WebviewPanel;
    viewColumn: vscode.ViewColumn;
    showErrorMessage: (message: string) => unknown;
    showResultsWebview: (
      createWebviewPanel: (
        viewType: string,
        title: string,
        showOptions: vscode.ViewColumn,
        options?: vscode.WebviewPanelOptions & vscode.WebviewOptions
      ) => vscode.WebviewPanel,
      viewColumn: vscode.ViewColumn,
      result: ComparisonResult
    ) => vscode.WebviewPanel;
  }
): Promise<void> {
  if (safeOutputRoot === undefined) {
    deps.showErrorMessage("ParityLens: could not reopen this run — no workspace folder is open.");
    return;
  }

  try {
    const result = await deps.loadRun(id, safeOutputRoot);
    deps.showResultsWebview(deps.createWebviewPanel, deps.viewColumn, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.showErrorMessage(`ParityLens: could not reopen run "${id}" — ${message}`);
  }
}

/**
 * T-37: resolves a saved connection profile *name* into a real
 * `DataPlatformConnector`, composing exactly the same
 * `ConnectionProfileStore`/`SecretStore`/`resolveConnector` (T-29) pieces
 * `buildConnectorRegistry` above already uses for `runComparisonCommand`
 * -- mirrored deliberately (per TASK-BRIEF.md Scope item 1) rather than
 * reimplemented, so credential resolution has exactly one code path in
 * this file. Unlike `buildConnectorRegistry`, this never falls back to
 * `FixtureConnector` for an unmatched name: it returns `undefined`, which
 * `ComparisonEditorProviderDeps.resolveConnectorByName`'s own contract
 * treats as "fall back to manual entry" -- silently substituting fixture
 * data into an editing UI that's supposed to reflect the user's actual
 * configured connections would be misleading, not helpful, in this
 * context (distinct from `runComparisonCommand`'s own fixture-fallback
 * behavior, which this function does not touch or weaken).
 */
function buildResolveConnectorByName(
  connectionProfileStore: ConnectionProfileStore,
  secretStore: SecretStore
): (connectionName: string) => Promise<DataPlatformConnector | undefined> {
  return async (connectionName: string) => {
    const profile = findProfileByName(connectionProfileStore, connectionName);
    if (profile === undefined) {
      return undefined;
    }
    const password = (await secretStore.get(secretKeyFor(profile.id))) ?? "";
    return resolveConnector(profile, password);
  };
}

/**
 * Registers `ComparisonEditorProvider` (T-36) against the live `vscode`
 * API for `.paritylens` files (per `package.json`'s
 * `contributes.customEditors` entry, `viewType:
 * "paritylens.comparisonEditor"` -- `COMPARISON_EDITOR_VIEW_TYPE`). The
 * provider's own `ComparisonEditorProviderDeps` (see
 * `comparisonEditorProvider.ts`) are bound here against the live
 * `connectionProfileStore`/`vscode.workspace.applyEdit`, following the
 * same injected-dependency binding pattern
 * `registerRunComparisonCommand`/`registerNewComparisonCommand` above
 * already use. T-37 additionally binds `resolveConnectorByName` (see
 * above) for the Column Mapping tab's live `getSchema` fetch.
 */
function registerComparisonEditorProvider(connectionProfileStore: ConnectionProfileStore, secretStore: SecretStore): vscode.Disposable {
  const provider = new ComparisonEditorProvider({
    listConnectionNames: () => connectionProfileStore.list().map((profile) => profile.name),
    applyEdit: (edit) => vscode.workspace.applyEdit(edit),
    resolveConnectorByName: buildResolveConnectorByName(connectionProfileStore, secretStore)
  });
  return vscode.window.registerCustomEditorProvider(COMPARISON_EDITOR_VIEW_TYPE, provider);
}

/**
 * Registers `paritylens.reopenRun` (T-33) against the live `vscode` API:
 * invoked by a "Recent Runs" tree node
 * (`ParityRecentRunTreeItem.command`, `parityTreeDataProvider.ts`) with the
 * run's `id` as its sole argument. Delegates to `reopenRunCommand` above
 * for the actual load/reopen logic, binding it against the live `vscode`
 * API the same way `registerRunComparisonCommand` binds
 * `runComparisonCommand`.
 */
function registerReopenRunCommand(): vscode.Disposable {
  return vscode.commands.registerCommand(REOPEN_RUN_COMMAND_ID, async (id: string) => {
    const safeOutputRoot = resolveRunHistoryRoot(vscode.workspace.workspaceFolders);
    await reopenRunCommand(id, safeOutputRoot, {
      loadRun,
      createWebviewPanel: vscode.window.createWebviewPanel.bind(vscode.window),
      viewColumn: vscode.ViewColumn.Active,
      showErrorMessage: vscode.window.showErrorMessage,
      showResultsWebview
    });
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
  // T-33: statusBarItem is constructed once here (via createParityStatusBarItem,
  // T-11) and passed into registerRunComparisonCommand's deps, then added to
  // context.subscriptions for disposal — same wiring pattern already used
  // for connectionProfileStore/secretStore below.
  const statusBarItem = createParityStatusBarItem();
  context.subscriptions.push({ dispose: () => statusBarItem.dispose() });

  const treeDataProvider = new ParityTreeDataProvider({
    findComparisonFiles: async () => vscode.workspace.findFiles("**/*.paritylens"),
    listRecentRuns: async () => {
      const safeOutputRoot = resolveRunHistoryRoot(vscode.workspace.workspaceFolders);
      return safeOutputRoot !== undefined ? listRecentRuns(safeOutputRoot) : [];
    },
    runComparisonCommandId: RUN_COMPARISON_COMMAND_ID,
    reopenRunCommandId: REOPEN_RUN_COMMAND_ID
  });
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
  const runComparisonDisposable = registerRunComparisonCommand(connectionProfileStore, secretStore, statusBarItem);
  context.subscriptions.push(runComparisonDisposable);

  context.subscriptions.push(registerAddConnectionCommand(connectionProfileStore));
  context.subscriptions.push(registerEditConnectionCommand(connectionProfileStore));
  context.subscriptions.push(registerDeleteConnectionCommand(connectionProfileStore));
  context.subscriptions.push(registerNewComparisonCommand(connectionProfileStore));
  context.subscriptions.push(registerReopenRunCommand());
  context.subscriptions.push(registerComparisonEditorProvider(connectionProfileStore, secretStore));

  return { treeDataProvider, treeView, secretStore };
}
