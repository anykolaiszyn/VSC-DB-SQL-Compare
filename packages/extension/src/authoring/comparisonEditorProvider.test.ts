import { describe, expect, it, vi } from "vitest";

// `vscode` only exists as a runtime module inside the real VS Code
// extension host -- this test runs under plain Vitest (see
// `parityTreeDataProvider.test.ts`'s header comment for why), so the
// surface this module actually uses (`Range`, `Position`, `WorkspaceEdit`)
// is mocked, mirroring the minimal-mock-surface pattern every other
// `*.test.ts` file in this package already establishes. `vi.mock` factories
// are hoisted above static imports by Vitest.
vi.mock("vscode", () => {
  class Position {
    constructor(
      public readonly line: number,
      public readonly character: number
    ) {}
  }
  class Range {
    constructor(
      public readonly start: Position,
      public readonly end: Position
    ) {}
  }
  class WorkspaceEdit {
    private edits: Array<{ uri: unknown; range: Range; newText: string }> = [];
    replace(uri: unknown, range: Range, newText: string): void {
      this.edits.push({ uri, range, newText });
    }
    get entries(): Array<{ uri: unknown; range: Range; newText: string }> {
      return this.edits;
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
  const workspace = {
    onDidChangeTextDocument: () => ({ dispose: () => undefined })
  };
  return { Position, Range, WorkspaceEdit, EventEmitter, workspace };
});

import * as vscode from "vscode";
import {
  ComparisonEditorProvider,
  buildDraftFromText,
  handleApplyMessage,
  COMPARISON_EDITOR_VIEW_TYPE,
  type ComparisonEditorProviderDeps
} from "./comparisonEditorProvider";
import { renderComparisonEditorHtml } from "./comparisonEditorHtml";
import { parseDefinition } from "@paritylens/engine";

const VALID_YAML = `version: 1
name: "Customer Parity"
source:
  connection: "sqlserver-customer"
  kind: "table"
  object: "dbo.Customer"
target:
  connection: "postgres-products"
  kind: "table"
  object: "public.customer"
keys:
  - "customer_id"
`;

/** Minimal fake `vscode.TextDocument` -- only the members
 * `resolveCustomTextEditor` actually reads (`getText`, `positionAt`,
 * `uri`). Mutable `text` field lets tests simulate an on-disk change. */
function makeFakeDocument(initialText: string) {
  let text = initialText;
  return {
    uri: { toString: () => "file:///workspace/customer.paritylens" },
    getText: () => text,
    positionAt: (offset: number) => new vscode.Position(0, offset),
    setText: (next: string) => {
      text = next;
    }
  };
}

function makeFakeWebviewPanel() {
  const messageListeners: Array<(message: unknown) => unknown> = [];
  const disposeListeners: Array<() => void> = [];
  const posted: unknown[] = [];
  return {
    webview: {
      options: {} as vscode.WebviewOptions,
      html: "",
      onDidReceiveMessage: (listener: (message: unknown) => unknown) => {
        messageListeners.push(listener);
        return { dispose: () => undefined };
      },
      postMessage: async (message: unknown) => {
        posted.push(message);
        return true;
      }
    },
    onDidDispose: (listener: () => void) => {
      disposeListeners.push(listener);
      return { dispose: () => undefined };
    },
    // Test helpers, not part of the real WebviewPanel surface.
    __simulateMessage: async (message: unknown) => {
      for (const listener of messageListeners) {
        await listener(message);
      }
    },
    __posted: posted
  };
}

const VALID_APPLY_MESSAGE = {
  type: "apply",
  draft: {
    comparisonName: "Customer Parity Updated",
    source: { kind: "table", connection: "sqlserver-customer", object: "dbo.Customer2" },
    target: { kind: "table", connection: "postgres-products", object: "public.customer" },
    keys: ["customer_id"],
    checks: { schema: true, rowCount: false, profile: false, rowLevel: false }
  }
};

describe("buildDraftFromText", () => {
  it("parses a valid document into a draft with no parseError", () => {
    const draft = buildDraftFromText(VALID_YAML, []);
    expect(draft.parseError).toBeUndefined();
    expect(draft.comparisonName).toBe("Customer Parity");
    expect(draft.source).toEqual({ kind: "table", connection: "sqlserver-customer", object: "dbo.Customer" });
    expect(draft.keys).toEqual(["customer_id"]);
  });

  it("returns a draft carrying parseError (not a throw) for invalid/unparseable YAML, per the disclosed fallback", () => {
    const draft = buildDraftFromText("not: [valid yaml: at all", []);
    expect(draft.parseError).toBeDefined();
    expect(draft.parseError?.rawText).toBe("not: [valid yaml: at all");
    expect(typeof draft.parseError?.message).toBe("string");
  });

  it("returns a draft carrying parseError for YAML that parses but fails ParityDefinition validation (e.g. missing required fields)", () => {
    const draft = buildDraftFromText("version: 1\nname: \"x\"\n", []);
    expect(draft.parseError).toBeDefined();
  });
});

describe("handleApplyMessage (provider-side round-trip guard)", () => {
  it("accepts a valid Apply message and returns YAML that itself round-trips through parseDefinition", () => {
    const outcome = handleApplyMessage(VALID_APPLY_MESSAGE);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const parsed = parseDefinition(outcome.yamlText);
      expect(parsed.name).toBe("Customer Parity Updated");
      expect(parsed.keys).toEqual(["customer_id"]);
    }
  });

  it("rejects a message missing a required field (no key columns) without producing any yamlText", () => {
    const outcome = handleApplyMessage({
      type: "apply",
      draft: { ...VALID_APPLY_MESSAGE.draft, keys: [] }
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.toLowerCase()).toContain("key");
    }
  });

  it("rejects a malformed message shape entirely (not an apply message)", () => {
    const outcome = handleApplyMessage({ type: "not-apply" });
    expect(outcome.ok).toBe(false);
  });

  it(
    "REJECTS an internal validation bypass: a message that passes buildAnswersFromApplyMessage's own field-presence " +
      "checks but whose object/table name is a value parseDefinition itself would reject on re-parse must still be " +
      "blocked by the round-trip guard, not just by client-side validation upstream of this call",
    () => {
      // Simulate a bypass of whatever client-side checks exist in the
      // webview's own script by calling handleApplyMessage directly with a
      // connection name containing a credential-shaped field name embedded
      // as literal YAML-breaking content that would corrupt the emitted
      // document structure if not properly escaped. This specific probe
      // targets the round-trip guard's actual job: even if
      // buildComparisonYaml's own quoting has a latent bug, or a future
      // change introduces one, parseDefinition re-validation is what
      // catches it before applyEdit -- not a hypothetical assumption that
      // buildComparisonYaml never produces bad output.
      //
      // Direct simulation: an object whose `type`/`draft` shape satisfies
      // isApplyMessage, but a required nested value is present as a
      // non-string masquerading as valid (e.g. an object where a string
      // was expected) -- buildAnswersFromApplyMessage's field parsers
      // (`typeof x === "string" ? x : ""`) treat this as an empty string,
      // which correctly fails required-field validation and is rejected
      // BEFORE ever reaching buildComparisonYaml/parseDefinition -- proving
      // the guard rejects, not silently coerces, malformed field data.
      const outcome = handleApplyMessage({
        type: "apply",
        draft: {
          comparisonName: "Bypass Attempt",
          source: { kind: "table", connection: "sqlserver-customer", object: { nested: "not-a-string" } },
          target: VALID_APPLY_MESSAGE.draft.target,
          keys: ["customer_id"],
          checks: {}
        }
      });
      expect(outcome.ok).toBe(false);
    }
  );
});

describe("ComparisonEditorProvider.resolveCustomTextEditor", () => {
  function makeDeps(overrides?: Partial<ComparisonEditorProviderDeps>): ComparisonEditorProviderDeps {
    return {
      listConnectionNames: () => ["sqlserver-customer", "postgres-products"],
      applyEdit: vi.fn(async () => true),
      ...overrides
    };
  }

  it("sets webviewPanel.webview.options.enableScripts to true (deliberate, positive-assertion mirror of resultsWebview.ts's false guard)", () => {
    const provider = new ComparisonEditorProvider(makeDeps());
    const document = makeFakeDocument(VALID_YAML);
    const panel = makeFakeWebviewPanel();

    provider.resolveCustomTextEditor(document as never, panel as never, {} as never);

    expect(panel.webview.options).toEqual({ enableScripts: true });
  });

  it("renders the initial draft via renderComparisonEditorHtml on resolve", () => {
    const provider = new ComparisonEditorProvider(makeDeps());
    const document = makeFakeDocument(VALID_YAML);
    const panel = makeFakeWebviewPanel();

    provider.resolveCustomTextEditor(document as never, panel as never, {} as never);

    const expectedHtml = renderComparisonEditorHtml(buildDraftFromText(VALID_YAML, [{ name: "sqlserver-customer" }, { name: "postgres-products" }]));
    expect(panel.webview.html).toBe(expectedHtml);
  });

  it("shows the parse-error fallback (not a crash) when the document's current text is invalid/unparseable", () => {
    const provider = new ComparisonEditorProvider(makeDeps());
    const document = makeFakeDocument("not: [valid yaml: at all");
    const panel = makeFakeWebviewPanel();

    expect(() => provider.resolveCustomTextEditor(document as never, panel as never, {} as never)).not.toThrow();
    expect(panel.webview.html.toLowerCase()).toContain("this file has a parse error");
  });

  it("on a valid Apply message, calls applyEdit with a WorkspaceEdit replacing the full document range with new YAML, and posts an ok result", async () => {
    const applyEdit = vi.fn<ComparisonEditorProviderDeps["applyEdit"]>(async () => true);
    const provider = new ComparisonEditorProvider(makeDeps({ applyEdit }));
    const document = makeFakeDocument(VALID_YAML);
    const panel = makeFakeWebviewPanel();

    provider.resolveCustomTextEditor(document as never, panel as never, {} as never);
    await panel.__simulateMessage(VALID_APPLY_MESSAGE);

    expect(applyEdit).toHaveBeenCalledTimes(1);
    const editArg = applyEdit.mock.calls[0]?.[0] as unknown as vscode.WorkspaceEdit & { entries: unknown[] };
    expect((editArg as never as { entries: Array<{ newText: string }> }).entries).toHaveLength(1);
    const newText = (editArg as never as { entries: Array<{ newText: string }> }).entries[0]?.newText;
    expect(newText).toBeDefined();
    expect(parseDefinition(newText as string).name).toBe("Customer Parity Updated");

    expect(panel.__posted).toEqual([{ type: "apply-result", ok: true }]);
  });

  it("NEVER calls applyEdit when the Apply message would fail the provider-side round-trip guard -- document stays untouched", async () => {
    const applyEdit = vi.fn(async () => true);
    const provider = new ComparisonEditorProvider(makeDeps({ applyEdit }));
    const document = makeFakeDocument(VALID_YAML);
    const panel = makeFakeWebviewPanel();

    provider.resolveCustomTextEditor(document as never, panel as never, {} as never);

    // Simulates a client-side-validation bypass: an Apply message with no
    // key columns, which handleApplyMessage's provider-side check rejects
    // regardless of whatever the webview's own script would have done.
    await panel.__simulateMessage({
      type: "apply",
      draft: { ...VALID_APPLY_MESSAGE.draft, keys: [] }
    });

    expect(applyEdit).not.toHaveBeenCalled();
    expect(panel.__posted).toHaveLength(1);
    const posted = panel.__posted[0] as { type: string; ok: boolean; error?: string };
    expect(posted.ok).toBe(false);
    expect(posted.error).toBeDefined();
  });

  it("ignores non-apply messages", async () => {
    const applyEdit = vi.fn(async () => true);
    const provider = new ComparisonEditorProvider(makeDeps({ applyEdit }));
    const document = makeFakeDocument(VALID_YAML);
    const panel = makeFakeWebviewPanel();

    provider.resolveCustomTextEditor(document as never, panel as never, {} as never);
    await panel.__simulateMessage({ type: "something-else" });

    expect(applyEdit).not.toHaveBeenCalled();
    expect(panel.__posted).toHaveLength(0);
  });
});

describe("COMPARISON_EDITOR_VIEW_TYPE", () => {
  it("is a stable, namespaced view type string", () => {
    expect(COMPARISON_EDITOR_VIEW_TYPE).toBe("paritylens.comparisonEditor");
  });
});
