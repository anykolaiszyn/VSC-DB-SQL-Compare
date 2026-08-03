// T-36: `vscode.CustomTextEditorProvider` glue for the custom comparison
// editor ("Source"/"Target"/"Keys"/"Checks" tabs). Registered against
// `.paritylens` files in `activation/activate.ts`.
//
// Architecture: `parseDefinition`/`buildComparisonYaml` remain the sole
// parse/serialize authority for the underlying `TextDocument` (real YAML
// on disk) -- this provider is a friendlier *view*, not a parallel data
// model, per TASK-BRIEF.md's Objective. The webview holds an in-memory
// draft (via `comparisonEditorHtml.ts`'s pure `renderComparisonEditorHtml`);
// edits stay local to the webview until the user clicks Apply, which posts
// a message back to this provider carrying the edited field values.
//
// SECURITY / CORRECTNESS (TASK-BRIEF.md: "the single most important
// correctness property in this task"): before ever calling
// `vscode.workspace.applyEdit`, `handleApplyMessage` below builds the
// candidate YAML via `buildComparisonYaml` and round-trips it through
// `parseDefinition` itself. If that throws, the Apply is rejected -- a
// failure message is posted back to the webview and the document is left
// completely untouched. Client-side validation in the rendered HTML/script
// (`comparisonEditorHtml.ts`'s `validate()` function) is a UX nicety only;
// it can be bypassed (e.g. by calling `handleApplyMessage` directly with
// data a modified/compromised webview script might send), and this
// provider-side check is what actually enforces the guarantee. See this
// file's test suite for a test that simulates exactly that bypass.
//
// `enableScripts: true` (see `resolveCustomTextEditor` below) is a new,
// deliberate, file-scoped deviation from `resultsWebview.ts`'s
// `enableScripts: false` contract -- disclosed and pre-approved in
// TASK-BRIEF.md's Objective section. It does not relax or affect
// `resultsWebview.ts`, which is untouched by this task.
import * as vscode from "vscode";
import { parseDefinition, type ParityDefinition, type ParitySide } from "@paritylens/engine";
import {
  renderComparisonEditorHtml,
  type ComparisonEditorDraft,
  type ComparisonEditorSideDraft,
  type ComparisonEditorChecksDraft,
  type ComparisonEditorConnectionOption
} from "./comparisonEditorHtml";
import { buildComparisonYaml, type NewComparisonAnswers } from "./buildComparisonYaml";

/** View type this provider is registered under -- matches
 * `package.json`'s `contributes.customEditors[].viewType`. */
export const COMPARISON_EDITOR_VIEW_TYPE = "paritylens.comparisonEditor";

/** The shape of an "apply" message the webview's static script posts back
 * (see `comparisonEditorHtml.ts`'s `CLIENT_SCRIPT`). Deliberately loose
 * (`unknown`-validated) at the boundary -- `handleApplyMessage` below
 * re-validates every field itself rather than trusting the shape, since a
 * malformed/malicious message must never be able to reach
 * `buildComparisonYaml`/`applyEdit` with unvalidated data. */
interface ApplyMessage {
  type: "apply";
  draft: {
    comparisonName: unknown;
    source: unknown;
    target: unknown;
    keys: unknown;
    checks: unknown;
  };
}

function isApplyMessage(message: unknown): message is ApplyMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === "apply" &&
    typeof (message as { draft?: unknown }).draft === "object" &&
    (message as { draft?: unknown }).draft !== null
  );
}

/** Narrows an untrusted `unknown` value into a `ComparisonEditorSideDraft`,
 * throwing a plain `Error` (caught by `handleApplyMessage`, converted into
 * an Apply-rejection message) if the shape doesn't match one of the three
 * known kinds. Never trusts the incoming message's `kind` discriminant
 * without checking every field the corresponding variant requires. */
function parseSideMessage(value: unknown, label: string): ComparisonEditorSideDraft {
  if (typeof value !== "object" || value === null) {
    throw new Error(`"${label}" must be an object.`);
  }
  const obj = value as Record<string, unknown>;
  const connection = typeof obj["connection"] === "string" ? obj["connection"] : "";

  if (obj["kind"] === "query") {
    const sql = typeof obj["sql"] === "string" ? obj["sql"] : "";
    return { kind: "query", connection, sql };
  }
  if (obj["kind"] === "sqlFile") {
    const filePath = typeof obj["filePath"] === "string" ? obj["filePath"] : "";
    return { kind: "sqlFile", connection, filePath };
  }
  // Default / "table" kind (including an unrecognized `kind` value --
  // treated as table-mode with empty/absent fields, which
  // `buildComparisonYaml`/`parseDefinition`'s round-trip guard will reject
  // if `object` ends up empty, rather than this function silently
  // accepting an unknown kind as valid).
  const object = typeof obj["object"] === "string" ? obj["object"] : "";
  const where = typeof obj["where"] === "string" && obj["where"].trim() !== "" ? obj["where"] : undefined;
  return where !== undefined ? { kind: "table", connection, object, where } : { kind: "table", connection, object };
}

function parseKeysMessage(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((v): v is string => typeof v === "string" && v.trim() !== "");
}

function parseChecksMessage(value: unknown): ComparisonEditorChecksDraft {
  const obj = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    schema: Boolean(obj["schema"]),
    rowCount: Boolean(obj["rowCount"]),
    profile: Boolean(obj["profile"]),
    rowLevel: Boolean(obj["rowLevel"])
  };
}

/** Converts a webview Apply message's draft payload into the
 * `NewComparisonAnswers` shape `buildComparisonYaml` (T-35b, extended by
 * this task) expects, throwing a descriptive `Error` if any required field
 * is missing/empty -- this is the provider-side validation TASK-BRIEF.md
 * calls the authoritative check (Scope item 2). */
function buildAnswersFromApplyMessage(message: ApplyMessage): NewComparisonAnswers {
  const comparisonName = typeof message.draft.comparisonName === "string" ? message.draft.comparisonName.trim() : "";
  if (comparisonName === "") {
    throw new Error("Comparison name is required.");
  }

  const source = parseSideMessage(message.draft.source, "source");
  const target = parseSideMessage(message.draft.target, "target");
  if (source.connection.trim() === "") {
    throw new Error("Source connection is required.");
  }
  if (target.connection.trim() === "") {
    throw new Error("Target connection is required.");
  }
  if (source.kind === "table" && source.object.trim() === "") {
    throw new Error("Source object is required for Table mode.");
  }
  if (source.kind === "query" && source.sql.trim() === "") {
    throw new Error("Source SQL is required for Query mode.");
  }
  if (source.kind === "sqlFile" && source.filePath.trim() === "") {
    throw new Error("Source SQL file path is required for SQL File mode.");
  }
  if (target.kind === "table" && target.object.trim() === "") {
    throw new Error("Target object is required for Table mode.");
  }
  if (target.kind === "query" && target.sql.trim() === "") {
    throw new Error("Target SQL is required for Query mode.");
  }
  if (target.kind === "sqlFile" && target.filePath.trim() === "") {
    throw new Error("Target SQL file path is required for SQL File mode.");
  }

  const keys = parseKeysMessage(message.draft.keys);
  if (keys.length === 0) {
    throw new Error("At least one key column is required.");
  }

  const checks = parseChecksMessage(message.draft.checks);

  return {
    comparisonName,
    sourceConnection: source.connection,
    source,
    targetConnection: target.connection,
    target,
    keys,
    checks: {
      schema: { enabled: checks.schema },
      rowCount: { enabled: checks.rowCount },
      profile: { enabled: checks.profile },
      rowLevel: { enabled: checks.rowLevel }
    }
  };
}

/** Converts a parsed `ParitySide` (`@paritylens/engine`) into this
 * module's `ComparisonEditorSideDraft` view shape -- a structural
 * passthrough (both are the same 3-kind discriminated union with the same
 * field names per side), kept as an explicit named function rather than an
 * inline cast so a future `ParitySide` field addition is forced through
 * this single conversion point. */
function sideToDraft(side: ParitySide): ComparisonEditorSideDraft {
  if (side.kind === "query") {
    return { kind: "query", connection: side.connection, sql: side.sql };
  }
  if (side.kind === "sqlFile") {
    return { kind: "sqlFile", connection: side.connection, filePath: side.filePath };
  }
  return side.where !== undefined
    ? { kind: "table", connection: side.connection, object: side.object, where: side.where }
    : { kind: "table", connection: side.connection, object: side.object };
}

function checksToDraft(checks: ParityDefinition["checks"]): ComparisonEditorChecksDraft {
  return {
    schema: checks.schema?.enabled ?? false,
    rowCount: checks.rowCount?.enabled ?? false,
    profile: checks.profile?.enabled ?? false,
    rowLevel: checks.rowLevel?.enabled ?? false
  };
}

/** Default draft used when a document is empty/new (no content to parse
 * yet) -- an empty-but-valid-shaped starting point for the form, matching
 * `table`-kind defaults with no connection/object chosen. Apply-time
 * validation (both client-side and this provider's authoritative check)
 * will reject applying this default as-is until the user fills in the
 * required fields. */
function defaultSideDraft(): ComparisonEditorSideDraft {
  return { kind: "table", connection: "", object: "" };
}

/** Builds the `ComparisonEditorDraft` for a document's current text:
 * parses it via `parseDefinition` and maps the result into the view
 * shape, or -- on a parse failure -- returns a draft carrying
 * `parseError` (so the webview shows the disclosed error banner + raw
 * text per TASK-BRIEF.md Scope item 2, rather than crashing). Exported for
 * direct unit testing without going through a live `vscode.TextDocument`.
 */
export function buildDraftFromText(text: string, connectionOptions: ComparisonEditorConnectionOption[]): ComparisonEditorDraft {
  try {
    const definition = parseDefinition(text);
    return {
      comparisonName: definition.name,
      source: sideToDraft(definition.source),
      target: sideToDraft(definition.target),
      keys: definition.keys,
      checks: checksToDraft(definition.checks),
      connectionOptions
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      comparisonName: "",
      source: defaultSideDraft(),
      target: defaultSideDraft(),
      keys: [],
      checks: { schema: false, rowCount: false, profile: false, rowLevel: false },
      connectionOptions,
      parseError: { message, rawText: text }
    };
  }
}

/** Result of attempting to apply a webview's Apply message against a
 * document's current text -- returned by `handleApplyMessage` (pure,
 * `vscode`-free) so both the live provider and its unit tests can inspect
 * the outcome without needing a real `WorkspaceEdit`/`applyEdit`. */
export type ApplyOutcome = { ok: true; yamlText: string } | { ok: false; error: string };

/**
 * The core Apply-handling logic, deliberately kept `vscode`-free (pure
 * function of its inputs) so it can be unit-tested directly -- including
 * the adversarial "simulate an internal validation bypass" scenario
 * TASK-BRIEF.md's Handoff note asks the reviewer to probe -- without
 * mocking `vscode.workspace.applyEdit`.
 *
 * Builds YAML via `buildComparisonYaml`, then -- this is the guarantee --
 * round-trips the freshly-built YAML through `parseDefinition` itself
 * before returning `ok: true`. Any failure at either step (a message that
 * fails `buildAnswersFromApplyMessage`'s own validation, or YAML that
 * `buildComparisonYaml` produces but `parseDefinition` still rejects)
 * returns `ok: false` with a descriptive error, and never returns a
 * `yamlText` for the caller to write.
 */
export function handleApplyMessage(rawMessage: unknown): ApplyOutcome {
  if (!isApplyMessage(rawMessage)) {
    return { ok: false, error: "Malformed Apply message." };
  }

  let yamlText: string;
  try {
    const answers = buildAnswersFromApplyMessage(rawMessage);
    yamlText = buildComparisonYaml(answers);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }

  // The round-trip guard: never trust that `buildComparisonYaml`'s output
  // is valid just because it built without throwing. Re-parse it exactly
  // the way the document will be re-parsed the next time it's opened.
  try {
    parseDefinition(yamlText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Generated document failed validation, not saved: ${message}` };
  }

  return { ok: true, yamlText };
}

/** Everything the provider needs from `vscode`/the extension host, injected
 * for testability -- same pattern `runComparisonCommand`
 * (`activation/activate.ts`) and `NewComparisonWizardDeps`
 * (`newComparisonWizard.ts`) already use. */
export interface ComparisonEditorProviderDeps {
  /** Read-only consumption -- returns the current list of saved
   * `ConnectionProfile` names, per TASK-BRIEF.md's "connection picker
   * listing `ConnectionProfile.name` values". */
  listConnectionNames: () => string[];
  applyEdit: (edit: vscode.WorkspaceEdit) => Thenable<boolean>;
}

/**
 * The `vscode.CustomTextEditorProvider` implementation. `resolveCustomTextEditor`
 * sets `enableScripts: true` (see this file's header comment), renders the
 * initial draft, wires up `onDidReceiveMessage` for Apply handling (via
 * `handleApplyMessage` above), and re-renders whenever the underlying
 * document changes on disk while the editor stays open (a minimal, correct
 * handling per TASK-BRIEF.md Scope item 2 -- not a full conflict-resolution
 * UI).
 */
export class ComparisonEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly deps: ComparisonEditorProviderDeps;

  constructor(deps: ComparisonEditorProviderDeps) {
    this.deps = deps;
  }

  // `token` (the third `CustomTextEditorProvider.resolveCustomTextEditor`
  // parameter, per @types/vscode) is part of the interface's required
  // signature but unused by this implementation -- no cancellable async
  // work happens during resolve itself. Kept as a named, referenced
  // parameter (rather than an unused `_token`, which this codebase's
  // eslint config has no `argsIgnorePattern` allowance for) via the
  // no-op `void token` below.
  resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel, token: vscode.CancellationToken): void {
    void token;
    webviewPanel.webview.options = { enableScripts: true };

    const render = () => {
      const connectionOptions = this.deps.listConnectionNames().map((name) => ({ name }));
      const draft = buildDraftFromText(document.getText(), connectionOptions);
      webviewPanel.webview.html = renderComparisonEditorHtml(draft);
    };

    render();

    const changeSubscription = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() === document.uri.toString()) {
        render();
      }
    });

    const messageSubscription = webviewPanel.webview.onDidReceiveMessage(async (rawMessage: unknown) => {
      if (typeof rawMessage !== "object" || rawMessage === null || (rawMessage as { type?: unknown }).type !== "apply") {
        return;
      }

      const outcome = handleApplyMessage(rawMessage);
      if (!outcome.ok) {
        await webviewPanel.webview.postMessage({ type: "apply-result", ok: false, error: outcome.error });
        return;
      }

      const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, fullRange, outcome.yamlText);
      const applied = await this.deps.applyEdit(edit);

      await webviewPanel.webview.postMessage({
        type: "apply-result",
        ok: applied,
        ...(applied ? {} : { error: "The workspace edit could not be applied." })
      });
    });

    webviewPanel.onDidDispose(() => {
      changeSubscription.dispose();
      messageSubscription.dispose();
    });
  }
}
