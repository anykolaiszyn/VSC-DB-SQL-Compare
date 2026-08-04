import { randomUUID } from "node:crypto";
import type { ConnectionProfile } from "./connectionProfile";
import type { ConnectionProfileStore } from "./connectionProfileStore";
import { resolveConnector } from "./resolveConnector";
import type { ConnectionTestResult } from "@paritylens/shared";

/** The two supported platforms, in the order offered to `showQuickPick`. */
const PLATFORM_OPTIONS: ReadonlyArray<ConnectionProfile["platform"]> = ["sqlserver", "postgres"];

/**
 * VS Code UI dependencies the three command handlers below need, injected
 * so each handler is a plain, directly testable function -- same
 * extraction pattern `runComparisonCommand`
 * (`packages/extension/src/activation/activate.ts`, T-22) already uses,
 * per TASK-BRIEF.md Scope item 3.
 */
export interface ConnectionCommandDeps {
  showInputBox: (options: {
    prompt: string;
    password?: boolean;
    value?: string;
    validateInput?: (value: string) => string | undefined;
  }) => Promise<string | undefined>;
  showQuickPick: (
    items: string[],
    options: { placeHolder: string }
  ) => Promise<string | undefined>;
  showInformationMessage: (message: string) => unknown;
  showErrorMessage: (message: string) => unknown;
  /**
   * Narrow projection of `vscode.window.withProgress` (T-42): shows a
   * blocking progress notification with `title` while `task` runs, resolving
   * to whatever `task` resolves to. Only the title + async-callback shape
   * this task needs is injected, not the full `withProgress` signature, per
   * this file's existing narrow-injected-dependency style.
   */
  withProgress: <T>(title: string, task: () => Promise<T>) => Promise<T>;
  /**
   * Narrow projection of `vscode.window.showWarningMessage` (T-42): shows a
   * warning with `message` and the given item labels, resolving to the
   * clicked item's label or `undefined` if dismissed.
   */
  showWarningMessage: (message: string, ...items: string[]) => Promise<string | undefined>;
}

/** Parses a user-entered port string into a positive integer, or `undefined` if invalid. */
function parsePort(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Prompts for every `ConnectionProfile` field (per TASK-BRIEF.md Scope item
 * 3: name, platform, host, port, database, user, password) plus an optional
 * `existing` profile to prefill values for (used by
 * `editConnectionCommand`). Returns `undefined` if the user cancels any
 * prompt (VS Code's `showInputBox`/`showQuickPick` resolve `undefined` on
 * Escape), so callers can bail out cleanly without partial state.
 *
 * The password prompt sets `password: true` on the input box so it isn't
 * shown in plaintext on screen, per TASK-BRIEF.md Scope item 3 -- "mirrors
 * how a real VS Code extension collects a secret interactively." The
 * resolved password is returned alongside the profile fields but is never
 * placed on the `ConnectionProfile` object itself.
 */
async function promptForProfileFields(
  deps: ConnectionCommandDeps,
  existing?: ConnectionProfile
): Promise<{ fields: Omit<ConnectionProfile, "id">; password: string } | undefined> {
  const name = await deps.showInputBox({ prompt: "Connection name", ...(existing ? { value: existing.name } : {}) });
  if (name === undefined) {
    return undefined;
  }

  const platform = await deps.showQuickPick([...PLATFORM_OPTIONS], { placeHolder: "Platform" });
  if (platform === undefined || !PLATFORM_OPTIONS.includes(platform as ConnectionProfile["platform"])) {
    return undefined;
  }

  const host = await deps.showInputBox({ prompt: "Host", ...(existing ? { value: existing.host } : {}) });
  if (host === undefined) {
    return undefined;
  }

  const portInput = await deps.showInputBox({
    prompt: "Port",
    ...(existing ? { value: String(existing.port) } : {}),
    validateInput: (value) => (parsePort(value) === undefined ? "Port must be a positive integer" : undefined)
  });
  if (portInput === undefined) {
    return undefined;
  }
  const port = parsePort(portInput);
  if (port === undefined) {
    return undefined;
  }

  const database = await deps.showInputBox({
    prompt: "Database",
    ...(existing ? { value: existing.database } : {})
  });
  if (database === undefined) {
    return undefined;
  }

  const user = await deps.showInputBox({ prompt: "User", ...(existing ? { value: existing.user } : {}) });
  if (user === undefined) {
    return undefined;
  }

  const password = await deps.showInputBox({ prompt: "Password", password: true });
  if (password === undefined) {
    return undefined;
  }

  return {
    fields: {
      name,
      platform: platform as ConnectionProfile["platform"],
      host,
      port,
      database,
      user
    },
    password
  };
}

/**
 * Runs `testConnection()` against the connector resolved for `profile` +
 * `password`, wrapped in the injected `withProgress` dependency (T-42).
 * `DataPlatformConnector.testConnection()` (`@paritylens/shared`) is typed
 * to resolve a `ConnectionTestResult`, not documented as throw-free, so a
 * thrown/rejected call is caught here and normalized into the same
 * `{ success: false, message }` shape a resolved failure would produce --
 * per TASK-BRIEF.md Scope item 5, both shapes must reach the same
 * save-anyway/don't-save choice, never the outer catch's generic error
 * message.
 */
async function testConnectionProfile(
  deps: ConnectionCommandDeps,
  profile: ConnectionProfile,
  password: string
): Promise<ConnectionTestResult> {
  return deps.withProgress("Testing connection...", async () => {
    try {
      return await resolveConnector(profile, password).testConnection();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, message };
    }
  });
}

/**
 * `paritylens.addConnection` command handler, extracted as a directly
 * testable function per TASK-BRIEF.md Scope item 3. Prompts for every
 * profile field, tests the resulting connection (T-42), and stores the
 * result via `ConnectionProfileStore.add` -- either because the test
 * succeeded, or because the user explicitly chose to save an unreachable
 * profile anyway (e.g. a VPN-gated host that is legitimately unreachable at
 * add-time; this is not meant to become a hard block).
 */
export async function addConnectionCommand(
  store: ConnectionProfileStore,
  deps: ConnectionCommandDeps
): Promise<ConnectionProfile | undefined> {
  try {
    const prompted = await promptForProfileFields(deps);
    if (prompted === undefined) {
      return undefined;
    }

    const profile: ConnectionProfile = { id: randomUUID(), ...prompted.fields };

    const testResult = await testConnectionProfile(deps, profile, prompted.password);
    if (!testResult.success) {
      const reason = testResult.message ?? "unknown reason";
      const choice = await deps.showWarningMessage(
        `ParityLens: connection test failed for "${profile.name}" — ${reason}`,
        "Save Anyway",
        "Don't Save"
      );
      if (choice !== "Save Anyway") {
        return undefined;
      }
    }

    await store.add(profile, prompted.password);
    deps.showInformationMessage(`ParityLens: added connection "${profile.name}"`);
    return profile;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.showErrorMessage(`ParityLens: add connection failed — ${message}`);
    return undefined;
  }
}

/**
 * `paritylens.editConnection` command handler. Prompts the user to pick an
 * existing profile by name, then re-prompts for every field (prefilled with
 * the existing values) and writes the result via
 * `ConnectionProfileStore.update`, preserving the original `id`.
 */
export async function editConnectionCommand(
  store: ConnectionProfileStore,
  deps: ConnectionCommandDeps
): Promise<ConnectionProfile | undefined> {
  try {
    const profiles = store.list();
    if (profiles.length === 0) {
      deps.showInformationMessage("ParityLens: no connections to edit");
      return undefined;
    }

    const names = profiles.map((profile) => profile.name);
    const selectedName = await deps.showQuickPick(names, { placeHolder: "Select a connection to edit" });
    if (selectedName === undefined) {
      return undefined;
    }
    const existing = profiles.find((profile) => profile.name === selectedName);
    if (existing === undefined) {
      return undefined;
    }

    const prompted = await promptForProfileFields(deps, existing);
    if (prompted === undefined) {
      return undefined;
    }

    const profile: ConnectionProfile = { id: existing.id, ...prompted.fields };
    await store.update(profile, prompted.password);
    deps.showInformationMessage(`ParityLens: updated connection "${profile.name}"`);
    return profile;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.showErrorMessage(`ParityLens: edit connection failed — ${message}`);
    return undefined;
  }
}

/**
 * `paritylens.deleteConnection` command handler. Prompts the user to pick an
 * existing profile by name, then deletes it (and its `SecretStore` entry,
 * via `ConnectionProfileStore.delete`) — per TASK-BRIEF.md Scope item 2's
 * "no orphaned credential left behind" requirement.
 */
export async function deleteConnectionCommand(
  store: ConnectionProfileStore,
  deps: ConnectionCommandDeps
): Promise<string | undefined> {
  try {
    const profiles = store.list();
    if (profiles.length === 0) {
      deps.showInformationMessage("ParityLens: no connections to delete");
      return undefined;
    }

    const names = profiles.map((profile) => profile.name);
    const selectedName = await deps.showQuickPick(names, { placeHolder: "Select a connection to delete" });
    if (selectedName === undefined) {
      return undefined;
    }
    const existing = profiles.find((profile) => profile.name === selectedName);
    if (existing === undefined) {
      return undefined;
    }

    await store.delete(existing.id);
    deps.showInformationMessage(`ParityLens: deleted connection "${existing.name}"`);
    return existing.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    deps.showErrorMessage(`ParityLens: delete connection failed — ${message}`);
    return undefined;
  }
}
