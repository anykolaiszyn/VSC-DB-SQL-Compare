// T-38: pure webview HTML renderer for the pre-execution SQL preview +
// confirmation panel `runComparisonCommand` (activate.ts) shows before ever
// calling `runComparison`, per DESIGN-SPEC.md's "generated SQL is shown to
// the user for preview before execution" requirement.
//
// Follows the exact interactive-webview pattern T-36 established
// (`comparisonEditorHtml.ts`'s header comment): `enableScripts: true` is
// required because this panel must report the user's Run/Cancel choice back
// to the extension host via `acquireVsCodeApi().postMessage(...)`, which
// requires scripts -- a new, deliberate, file-scoped deviation from
// `resultsWebview.ts`'s `enableScripts: false` contract, disclosed here the
// same way T-36 disclosed its own identical deviation. The embedded script
// is static, deterministic HTML-embedded JS -- the exact same script text on
// every render; the only genuinely dynamic content is the SQL query list
// itself, which is rendered via `resultsWebview.ts`'s existing
// `renderQueryPreviewSection` (now exported for this reuse, per
// TASK-BRIEF.md's one narrowly-permitted change to that file) -- every SQL
// string it interpolates is already `escapeHtml`-sanitized there, so this
// module never needs its own SQL-escaping logic.
//
// `renderRunConfirmationHtml` is a pure function of its `queries: string[]`
// argument: no side effects, no I/O beyond building a string, no `vscode`
// runtime API usage beyond the type-only... (none needed here at all,
// unlike `comparisonEditorHtml.ts` which has none either). Same input twice
// -> identical output, verified by this file's own test suite.
import { renderQueryPreviewSection } from "./resultsWebview.js";

/** Escapes a value for safe inclusion in the webview's HTML body -- the
 * same fixed replacement sequence `resultsWebview.ts`/`comparisonEditorHtml.ts`
 * each already use, reimplemented here (not imported) since none of those
 * modules export their own `escapeHtml` as public surface; this project has
 * no shared HTML-escaping utility module (checked: neither `packages/shared`
 * nor a webview-common file exists), so every webview module already
 * carries its own tiny private copy of this exact function, and this file
 * follows that same established precedent rather than introducing a new
 * shared dependency out of scope for this task. */
function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The static, deterministic embedded script: posts `{ type: "run" }` or
 * `{ type: "cancel" }` via `acquireVsCodeApi().postMessage(...)` when the
 * corresponding button is clicked, then disables both buttons (a run/cancel
 * choice is a one-shot action -- there is no "undo" for either, and the
 * panel is expected to close or be replaced once the extension host acts on
 * the message). This string itself never changes between renders -- only
 * the SQL list embedded above it varies -- so the purity contract holds
 * (same rendered document text for the same `queries` input). */
const CLIENT_SCRIPT = `
(function () {
  var vscode = acquireVsCodeApi();

  function $(sel) { return document.querySelector(sel); }

  var runButton = $('#run-button');
  var cancelButton = $('#cancel-button');

  function disableButtons() {
    if (runButton) { runButton.disabled = true; }
    if (cancelButton) { cancelButton.disabled = true; }
  }

  if (runButton) {
    runButton.addEventListener('click', function () {
      disableButtons();
      vscode.postMessage({ type: 'run' });
    });
  }
  if (cancelButton) {
    cancelButton.addEventListener('click', function () {
      disableButtons();
      vscode.postMessage({ type: 'cancel' });
    });
  }
})();
`;

/** Fixed style block for this panel, following `resultsWebview.ts`'s own
 * `--vscode-*` theme-token convention (see that file's `renderStyles`
 * header comment) so this new panel visually matches the rest of the
 * extension's webviews rather than introducing a divergent look. Minimal --
 * only what this panel's own markup (header, SQL cards via
 * `renderQueryPreviewSection`, action buttons) needs. */
function renderStyles(): string {
  return `<style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 28px 36px 60px;
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family, sans-serif);
      font-size: 13px;
    }
    .content { max-width: 980px; }
    .eyebrow {
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 6px;
    }
    h1 { margin: 0; font-size: 22px; font-weight: 500; }
    p.notice { color: var(--vscode-descriptionForeground); }
    .card {
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
      border-radius: 6px;
      background: var(--vscode-editorWidget-background, transparent);
    }
    .sql-card { padding: 0; overflow: hidden; margin-bottom: 12px; }
    .sql-card-header {
      padding: 8px 14px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .sql-card pre {
      margin: 0;
      padding: 14px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12.5px;
      line-height: 1.6;
      white-space: pre-wrap;
      overflow-x: auto;
    }
    .empty-state { color: var(--vscode-descriptionForeground); }
    .actions { margin-top: 20px; display: flex; gap: 10px; }
    button {
      font-family: inherit;
      font-size: 13px;
      padding: 6px 16px;
      border-radius: 4px;
      border: 1px solid var(--vscode-button-border, transparent);
      cursor: pointer;
    }
    button:disabled { opacity: 0.6; cursor: default; }
    #run-button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    #cancel-button {
      background: var(--vscode-button-secondaryBackground, transparent);
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    }
  </style>`;
}

/**
 * Renders the pre-execution SQL preview + confirmation panel's HTML
 * content: a header, the exact SQL query list `planQueries` produced (via
 * the reused `renderQueryPreviewSection`), and Run/Cancel buttons wired to
 * `postMessage` via the static `CLIENT_SCRIPT` above.
 *
 * `queries` is the direct output of `planQueries(definition, registry,
 * baseDir)` -- this function never re-derives or reformats it beyond what
 * `renderQueryPreviewSection` already does, so the confirmation panel can
 * never show SQL that differs from what `planQueries` actually returned.
 */
export function renderRunConfirmationHtml(queries: string[]): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>ParityLens: Confirm Run</title>
  ${renderStyles()}
</head>
<body>
  <div class="content">
    <div class="eyebrow">Parity Run</div>
    <h1>Review queries before running</h1>
    <p class="notice">
      ParityLens will issue ${escapeHtml(queries.length)} quer${queries.length === 1 ? "y" : "ies"} against your
      configured source and target connections. Review the SQL below, then choose Run to proceed or Cancel to
      abort — no query is executed until you click Run.
    </p>
    ${renderQueryPreviewSection(queries)}
    <div class="actions">
      <button type="button" id="run-button">Run</button>
      <button type="button" id="cancel-button">Cancel</button>
    </div>
  </div>
  <script>${CLIENT_SCRIPT}</script>
</body>
</html>`;
}
