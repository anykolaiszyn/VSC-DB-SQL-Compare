import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * T-40: minimal `vscode` mock so `./activate` can be imported under plain
 * Vitest, matching `activate.test.ts`'s own established pattern (see that
 * file's header comment for why `vscode` is mocked rather than run under a
 * real extension host). `vi.mock` factories are hoisted above all
 * imports/top-level statements, so the map registered command callbacks
 * are captured into must itself be created via `vi.hoisted` -- mirrors
 * `activate.test.ts`'s own `registeredCommandCallbacks` pattern exactly,
 * since the "context-key recomputation fires after every relevant
 * mutation" suite below needs to invoke the real registered
 * addConnection/editConnection/deleteConnection/newComparison callbacks,
 * not just assert on registration.
 */
const { registeredCommandCallbacks, executeCommandSpy } = vi.hoisted(() => ({
  registeredCommandCallbacks: new Map<string, (...args: unknown[]) => unknown>(),
  executeCommandSpy: vi.fn()
}));

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
    event = () => ({ dispose: () => undefined });
    fire(_data: T): void {
      void _data;
    }
  }
  const registerCommand = (commandId: string, callback: (...args: unknown[]) => unknown) => {
    registeredCommandCallbacks.set(commandId, callback);
    return { dispose: () => undefined };
  };
  return {
    TreeItem,
    EventEmitter,
    Range: class {},
    CodeLens: class {},
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ViewColumn: { Active: -1 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    window: {
      createTreeView: () => ({ dispose: () => undefined }),
      createWebviewPanel: vi.fn(),
      showInformationMessage: vi.fn(),
      showErrorMessage: vi.fn(),
      showInputBox: vi.fn(),
      showQuickPick: vi.fn(),
      createStatusBarItem: vi.fn(() => ({ text: "", show: vi.fn(), hide: vi.fn(), dispose: vi.fn() })),
      registerCustomEditorProvider: () => ({ dispose: () => undefined }),
      showOpenDialog: vi.fn()
    },
    commands: { registerCommand, executeCommand: executeCommandSpy },
    workspace: { workspaceFolders: undefined, findFiles: vi.fn(async () => []), applyEdit: vi.fn(async () => true) },
    languages: { registerCodeLensProvider: () => ({ dispose: () => undefined }) }
  };
});

import * as vscode from "vscode";
import {
  activate,
  computeHasNoContent,
  HAS_NO_CONTENT_CONTEXT_KEY,
  ADD_CONNECTION_COMMAND_ID,
  EDIT_CONNECTION_COMMAND_ID,
  DELETE_CONNECTION_COMMAND_ID,
  NEW_COMPARISON_COMMAND_ID
} from "./activate";

function createMockExtensionContext() {
  const secretsStore = new Map<string, string>();
  const globalStateStore = new Map<string, unknown>();
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
    },
    globalState: {
      get: <T>(key: string, defaultValue?: T) => (globalStateStore.has(key) ? (globalStateStore.get(key) as T) : (defaultValue as T)),
      update: vi.fn(async (key: string, value: unknown) => {
        globalStateStore.set(key, value);
      })
    }
  };
}

/**
 * Red-state evidence for the `paritylens.hasNoContent` context-key
 * computation function. Per TASK-BRIEF.md's "Red-state evidence required":
 * "a failing/absent test demonstrating the context-key computation function
 * doesn't exist yet." Before `computeHasNoContent` was exported by
 * `./activate`, this static import failed to resolve the named export
 * (`computeHasNoContent` was `undefined`), and every `it` below threw
 * `TypeError: computeHasNoContent is not a function` when invoked — the
 * predicted failing reason (captured as this task's red-state evidence
 * before the function was implemented).
 *
 * Green-state evidence required item 2: "A test proving the context-key
 * computation function returns `true` when both zero `.paritylens` files
 * and zero saved profiles are present, and `false` when either is
 * non-zero." The four cases below cover all combinations, including the
 * two the brief calls out by name in its Handoff/reviewer-probe section
 * (one file + zero profiles; zero files + one profile) to confirm the gate
 * is a genuine AND, not an accidental OR.
 */
describe("computeHasNoContent", () => {
  it("returns true when there are zero .paritylens files and zero saved profiles", async () => {
    const result = await computeHasNoContent({
      findComparisonFiles: async () => [],
      listProfiles: () => []
    });

    expect(result).toBe(true);
  });

  it("returns false when there is one .paritylens file and zero saved profiles", async () => {
    const result = await computeHasNoContent({
      findComparisonFiles: async () => [{ path: "/workspace/customer.paritylens" } as never],
      listProfiles: () => []
    });

    expect(result).toBe(false);
  });

  it("returns false when there are zero .paritylens files and one saved profile", async () => {
    const result = await computeHasNoContent({
      findComparisonFiles: async () => [],
      listProfiles: () => [{ id: "p1", name: "prod", platform: "sqlserver", host: "h", port: 1433, database: "d", user: "u" }]
    });

    expect(result).toBe(false);
  });

  it("returns false when there is both a .paritylens file and a saved profile (confirms AND, not OR)", async () => {
    const result = await computeHasNoContent({
      findComparisonFiles: async () => [{ path: "/workspace/customer.paritylens" } as never],
      listProfiles: () => [{ id: "p1", name: "prod", platform: "sqlserver", host: "h", port: 1433, database: "d", user: "u" }]
    });

    expect(result).toBe(false);
  });
});

/**
 * T-40 Green-state evidence required item 3: "A `package.json`-shape test
 * ... confirming the `viewsWelcome` JSON key exists with the correct
 * `view`/`contents`/`when` fields and that both command IDs referenced in
 * `contents` are real, already-registered command IDs (no typo'd `command:`
 * URI)." `viewsWelcome` is declarative JSON with no unit-testable runtime
 * behavior of its own (VS Code renders it internally; there's no
 * `TreeDataProvider`-level hook this repo's Vitest suite can drive to
 * observe the welcome overlay actually painting) — per
 * `IMPLEMENTATION-PLAN.md`'s own T-40 row, this is the disclosed approach:
 * asserting on the manifest shape and cross-referencing it against
 * `contributes.commands`, rather than a documented manual Extension
 * Development Host check. No manual check was performed for this task;
 * this test is the sole green-state evidence for `viewsWelcome`'s shape.
 */
describe("package.json viewsWelcome contribution (T-40)", () => {
  interface CommandContribution {
    command: string;
    title: string;
  }
  interface ViewsWelcomeContribution {
    view: string;
    contents: string;
    when: string;
  }
  interface ExtensionManifest {
    contributes: {
      commands: CommandContribution[];
      viewsWelcome?: ViewsWelcomeContribution[];
    };
  }

  function loadManifest(): ExtensionManifest {
    const manifestPath = join(__dirname, "..", "..", "package.json");
    return JSON.parse(readFileSync(manifestPath, "utf8")) as ExtensionManifest;
  }

  it("declares exactly one viewsWelcome entry targeting paritylens.dataParityView", () => {
    const manifest = loadManifest();

    expect(manifest.contributes.viewsWelcome).toBeDefined();
    expect(manifest.contributes.viewsWelcome).toHaveLength(1);
    expect(manifest.contributes.viewsWelcome?.[0]?.view).toBe("paritylens.dataParityView");
  });

  it("gates on the paritylens.hasNoContent context key, scoped to the correct view (AND, not unconditional)", () => {
    const manifest = loadManifest();
    const entry = manifest.contributes.viewsWelcome?.[0];

    expect(entry?.when).toBe("view == paritylens.dataParityView && paritylens.hasNoContent");
  });

  it("references only real, already-registered command IDs in its command: links (no typo'd URI)", () => {
    const manifest = loadManifest();
    const entry = manifest.contributes.viewsWelcome?.[0];
    const registeredCommandIds = new Set(manifest.contributes.commands.map((c) => c.command));

    // Extract every `command:<id>` URI referenced inside the Markdown
    // `contents` string, the same syntax VS Code itself parses for
    // viewsWelcome command links.
    const commandLinkPattern = /command:([\w.]+)/g;
    const referencedIds = [...(entry?.contents ?? "").matchAll(commandLinkPattern)].map((match) => match[1]);

    expect(referencedIds).toEqual(["paritylens.addConnection", "paritylens.newComparison"]);
    for (const id of referencedIds) {
      expect(registeredCommandIds.has(id as string)).toBe(true);
    }
  });

  it("includes a one-line explanatory sentence above the command links", () => {
    const manifest = loadManifest();
    const contents = manifest.contributes.viewsWelcome?.[0]?.contents ?? "";
    const lines = contents.split("\n");

    // First line is prose (no command: link), and at least one line after
    // it is a command link -- matches TASK-BRIEF.md Scope item 2's example
    // shape (explanatory sentence, then each [label](command:id) on its
    // own line).
    expect(lines[0]).not.toMatch(/command:/);
    expect(lines.slice(1).some((line) => line.includes("command:"))).toBe(true);
  });
});

/**
 * T-40 Handoff / reviewer-probe requirement: "the context-key recomputation
 * genuinely fires after every relevant mutation (add/edit/delete
 * connection, scaffold a new comparison ...) -- not just at activation,
 * which would leave a stale welcome view showing after a user's first
 * action." These tests invoke the real registered command callbacks
 * end-to-end (captured via the `registeredCommandCallbacks` map, mirroring
 * `activate.test.ts`'s own established pattern for exercising raw
 * `registerCommand` callback bodies) and assert
 * `vscode.commands.executeCommand("setContext", HAS_NO_CONTENT_CONTEXT_KEY,
 * ...)` is called again after each one, beyond the one call already made at
 * activation time.
 */
describe("paritylens.hasNoContent context-key recomputation wiring (T-40)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    registeredCommandCallbacks.clear();
  });

  function getCallback(commandId: string): (...args: unknown[]) => Promise<unknown> {
    const callback = registeredCommandCallbacks.get(commandId);
    if (!callback) {
      throw new Error(`${commandId} was not registered`);
    }
    return callback as (...args: unknown[]) => Promise<unknown>;
  }

  it("recomputes the context key once at activation", async () => {
    const context = createMockExtensionContext();

    activate(context as never);
    // activate() fires the recomputation without awaiting it (see
    // refreshHasNoContentContext's fire-and-forget call site) -- flush
    // microtasks so the async call (which itself awaits Promise.all before
    // calling executeCommand) has a chance to fully settle before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(executeCommandSpy).toHaveBeenCalledWith("setContext", HAS_NO_CONTENT_CONTEXT_KEY, true);
  });

  it("recomputes the context key again after paritylens.addConnection runs (cancelled input still triggers a safe recompute)", async () => {
    const context = createMockExtensionContext();
    activate(context as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    executeCommandSpy.mockClear();
    // showInputBox's mock resolves undefined by default -- addConnectionCommand
    // returns early (user "cancelled" the first prompt), but the wrapper must
    // still recompute the context key afterward per this task's wiring.
    (vscode.window.showInputBox as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const callback = getCallback(ADD_CONNECTION_COMMAND_ID);
    await callback();

    expect(executeCommandSpy).toHaveBeenCalledWith("setContext", HAS_NO_CONTENT_CONTEXT_KEY, expect.any(Boolean));
  });

  it("recomputes the context key again after paritylens.editConnection runs", async () => {
    const context = createMockExtensionContext();
    activate(context as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    executeCommandSpy.mockClear();

    const callback = getCallback(EDIT_CONNECTION_COMMAND_ID);
    await callback();

    expect(executeCommandSpy).toHaveBeenCalledWith("setContext", HAS_NO_CONTENT_CONTEXT_KEY, expect.any(Boolean));
  });

  it("recomputes the context key again after paritylens.deleteConnection runs", async () => {
    const context = createMockExtensionContext();
    activate(context as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    executeCommandSpy.mockClear();

    const callback = getCallback(DELETE_CONNECTION_COMMAND_ID);
    await callback();

    expect(executeCommandSpy).toHaveBeenCalledWith("setContext", HAS_NO_CONTENT_CONTEXT_KEY, expect.any(Boolean));
  });

  it("recomputes the context key again after paritylens.newComparison runs", async () => {
    const context = createMockExtensionContext();
    activate(context as never);
    await new Promise((resolve) => setTimeout(resolve, 0));
    executeCommandSpy.mockClear();
    (vscode.window.showInputBox as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    const callback = getCallback(NEW_COMPARISON_COMMAND_ID);
    await callback();

    expect(executeCommandSpy).toHaveBeenCalledWith("setContext", HAS_NO_CONTENT_CONTEXT_KEY, expect.any(Boolean));
  });
});
