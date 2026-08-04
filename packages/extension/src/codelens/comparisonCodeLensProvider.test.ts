import { afterEach, describe, expect, it, vi } from "vitest";

// Mirrors activate.test.ts's vscode mock pattern (see that file's header
// comment for why vscode is mocked rather than run under a real extension
// host). comparisonCodeLensProvider.ts imports RUN_COMPARISON_COMMAND_ID/
// REOPEN_RUN_COMMAND_ID from activate.ts, which itself imports several
// vscode-dependent modules -- so this mock needs the same broad surface
// activate.test.ts's own mock provides, plus vscode.Range/vscode.CodeLens
// (this file's own new surface, used directly by
// comparisonCodeLensProvider.ts).
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

  class Range {
    constructor(
      public startLine: number,
      public startCharacter: number,
      public endLine: number,
      public endCharacter: number
    ) {}
  }

  class CodeLens {
    constructor(
      public range: Range,
      public command?: unknown
    ) {}
  }

  const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 };
  const ViewColumn = { Active: -1 };
  const StatusBarAlignment = { Left: 1, Right: 2 };

  const createTreeView = (viewId: string, options: unknown) => ({
    viewId,
    options,
    dispose: () => undefined
  });
  const registerCommand = () => ({ dispose: () => undefined });
  const createWebviewPanel = vi.fn(() => ({
    webview: { html: "" }
  }));
  const showInformationMessage = vi.fn();
  const showErrorMessage = vi.fn();
  const createStatusBarItem = vi.fn(() => ({
    text: "",
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn()
  }));
  const findFiles = vi.fn(async () => []);
  const registerCustomEditorProvider = () => ({ dispose: () => undefined });
  const applyEdit = vi.fn(async () => true);
  const registerCodeLensProvider = () => ({ dispose: () => undefined });

  return {
    TreeItem,
    EventEmitter,
    Range,
    CodeLens,
    TreeItemCollapsibleState,
    ViewColumn,
    StatusBarAlignment,
    window: {
      createTreeView,
      createWebviewPanel,
      showInformationMessage,
      showErrorMessage,
      createStatusBarItem,
      registerCustomEditorProvider
    },
    commands: { registerCommand },
    workspace: { workspaceFolders: undefined, findFiles, applyEdit },
    languages: { registerCodeLensProvider }
  };
});

import { ComparisonCodeLensProvider, NO_RUNS_YET_COMMAND_ID } from "./comparisonCodeLensProvider";
import { RUN_COMPARISON_COMMAND_ID, REOPEN_RUN_COMMAND_ID } from "../activation/activate";
import type { RunSummary } from "../runHistory/runHistory";

const VALID_YAML = `
version: 1
name: customer-migration-parity
source:
  connection: legacy-sql-prod
  object: customer_source
target:
  connection: snowflake-analytics
  object: customer_target
keys:
  - CustomerID
checks:
  schema:
    enabled: true
`;

const INVALID_YAML_MALFORMED = `
not: [valid, yaml, syntax
`;

const INVALID_YAML_MISSING_FIELDS = `
version: 1
name: incomplete-definition
`;

function makeDocument(text: string, uriPath = "/workspace/customer.paritylens") {
  return {
    getText: () => text,
    uri: { fsPath: uriPath, path: uriPath, toString: () => uriPath }
  } as never;
}

describe("ComparisonCodeLensProvider", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns 4 CodeLenses for a valid .paritylens document", async () => {
    const provider = new ComparisonCodeLensProvider({
      listRecentRuns: async () => []
    });

    const lenses = await provider.provideCodeLenses(makeDocument(VALID_YAML), undefined as never);

    expect(lenses).toHaveLength(4);
    const titles = lenses.map((lens) => (lens.command as { title: string }).title);
    expect(titles).toEqual(["Run Profile", "Run Schema Check", "Run Full Comparison", "Open Last Result"]);
  });

  it("returns zero CodeLenses for malformed YAML that parseDefinition cannot parse", async () => {
    const provider = new ComparisonCodeLensProvider({
      listRecentRuns: async () => []
    });

    const lenses = await provider.provideCodeLenses(makeDocument(INVALID_YAML_MALFORMED), undefined as never);

    expect(lenses).toEqual([]);
  });

  it("returns zero CodeLenses for YAML missing required fields (InvalidDefinitionError)", async () => {
    const provider = new ComparisonCodeLensProvider({
      listRecentRuns: async () => []
    });

    const lenses = await provider.provideCodeLenses(makeDocument(INVALID_YAML_MISSING_FIELDS), undefined as never);

    expect(lenses).toEqual([]);
  });

  it("never throws out of provideCodeLenses for an invalid document", async () => {
    const provider = new ComparisonCodeLensProvider({
      listRecentRuns: async () => []
    });

    await expect(provider.provideCodeLenses(makeDocument(INVALID_YAML_MALFORMED), undefined as never)).resolves.toEqual([]);
  });

  it("'Run Full Comparison' invokes paritylens.runComparison with only the document's uri (no check-subset override) -- routes through the same command as any other full run, no bypass", async () => {
    const provider = new ComparisonCodeLensProvider({
      listRecentRuns: async () => []
    });

    const lenses = await provider.provideCodeLenses(makeDocument(VALID_YAML), undefined as never);
    const fullRunLens = lenses.find((lens) => (lens.command as { title: string }).title === "Run Full Comparison");

    expect(fullRunLens).toBeDefined();
    const command = fullRunLens!.command as { command: string; arguments?: unknown[] };
    expect(command.command).toBe(RUN_COMPARISON_COMMAND_ID);
    expect(command.arguments).toHaveLength(1);
    expect((command.arguments![0] as { fsPath: string }).fsPath).toBe("/workspace/customer.paritylens");
  });

  it("'Run Profile' passes a check-subset override enabling only profile, via the same paritylens.runComparison command", async () => {
    const provider = new ComparisonCodeLensProvider({
      listRecentRuns: async () => []
    });

    const lenses = await provider.provideCodeLenses(makeDocument(VALID_YAML), undefined as never);
    const runProfileLens = lenses.find((lens) => (lens.command as { title: string }).title === "Run Profile");

    expect(runProfileLens).toBeDefined();
    const command = runProfileLens!.command as { command: string; arguments?: unknown[] };
    expect(command.command).toBe(RUN_COMPARISON_COMMAND_ID);
    expect(command.arguments).toHaveLength(2);
    expect(command.arguments![1]).toEqual({
      schema: { enabled: false },
      profile: { enabled: true }
    });
  });

  it("'Run Schema Check' passes a check-subset override enabling only schema, via the same paritylens.runComparison command", async () => {
    const provider = new ComparisonCodeLensProvider({
      listRecentRuns: async () => []
    });

    const lenses = await provider.provideCodeLenses(makeDocument(VALID_YAML), undefined as never);
    const runSchemaLens = lenses.find((lens) => (lens.command as { title: string }).title === "Run Schema Check");

    expect(runSchemaLens).toBeDefined();
    const command = runSchemaLens!.command as { command: string; arguments?: unknown[] };
    expect(command.command).toBe(RUN_COMPARISON_COMMAND_ID);
    expect(command.arguments).toHaveLength(2);
    expect(command.arguments![1]).toEqual({
      schema: { enabled: true },
      profile: { enabled: false }
    });
  });

  it("'Open Last Result' finds the most recent run matching the document's comparison name, not just any run", async () => {
    const runs: RunSummary[] = [
      { id: "run-other-2", name: "other-comparison", timestamp: "2026-08-02T12:00:00.000Z" },
      { id: "run-mine-2", name: "customer-migration-parity", timestamp: "2026-08-01T10:00:00.000Z" },
      { id: "run-other-1", name: "other-comparison", timestamp: "2026-07-30T09:00:00.000Z" },
      { id: "run-mine-1", name: "customer-migration-parity", timestamp: "2026-07-29T08:00:00.000Z" }
    ];
    // listRecentRuns's real contract returns most-recent-first; this mock
    // preserves that ordering exactly (see runHistory.ts's own doc comment)
    // -- run-mine-2 (2026-08-01) is the most recent entry actually named
    // "customer-migration-parity", even though run-other-2 (2026-08-02) is
    // more recent overall for a *different* comparison.
    const provider = new ComparisonCodeLensProvider({
      listRecentRuns: async () => runs
    });

    const lenses = await provider.provideCodeLenses(makeDocument(VALID_YAML), undefined as never);
    const openLastResultLens = lenses.find((lens) => (lens.command as { title: string }).title === "Open Last Result");

    expect(openLastResultLens).toBeDefined();
    const command = openLastResultLens!.command as { command: string; arguments?: unknown[] };
    expect(command.command).toBe(REOPEN_RUN_COMMAND_ID);
    expect(command.arguments).toEqual(["run-mine-2"]);
  });

  it("'Open Last Result' invokes the documented no-runs-yet command when no run matches the document's comparison name", async () => {
    const runs: RunSummary[] = [{ id: "run-other", name: "other-comparison", timestamp: "2026-08-02T12:00:00.000Z" }];
    const provider = new ComparisonCodeLensProvider({
      listRecentRuns: async () => runs
    });

    const lenses = await provider.provideCodeLenses(makeDocument(VALID_YAML), undefined as never);
    const openLastResultLens = lenses.find((lens) => (lens.command as { title: string }).title === "Open Last Result");

    expect(openLastResultLens).toBeDefined();
    const command = openLastResultLens!.command as { command: string; arguments?: unknown[] };
    expect(command.command).toBe(NO_RUNS_YET_COMMAND_ID);
  });

  it("T-51 item 4: never throws/rejects when listRecentRuns rejects -- falls back to the no-prior-run form of 'Open Last Result' instead of propagating the rejection", async () => {
    const provider = new ComparisonCodeLensProvider({
      listRecentRuns: async () => {
        throw new Error("extension-storage state is corrupted");
      }
    });

    const lenses = await provider.provideCodeLenses(makeDocument(VALID_YAML), undefined as never);

    expect(lenses).toHaveLength(4);
    const titles = lenses.map((lens) => (lens.command as { title: string }).title);
    expect(titles).toEqual(["Run Profile", "Run Schema Check", "Run Full Comparison", "Open Last Result"]);
    const openLastResultLens = lenses.find((lens) => (lens.command as { title: string }).title === "Open Last Result");
    const command = openLastResultLens!.command as { command: string };
    expect(command.command).toBe(NO_RUNS_YET_COMMAND_ID);
  });

  it("document text is unchanged after providing lenses (override is never written back)", async () => {
    const provider = new ComparisonCodeLensProvider({
      listRecentRuns: async () => []
    });
    const document = makeDocument(VALID_YAML);
    const textBefore = (document as { getText: () => string }).getText();

    await provider.provideCodeLenses(document, undefined as never);
    await provider.provideCodeLenses(document, undefined as never);

    const textAfter = (document as { getText: () => string }).getText();
    expect(textAfter).toBe(textBefore);
    expect(textAfter).toBe(VALID_YAML);
  });
});
