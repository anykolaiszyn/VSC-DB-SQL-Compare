// T-36: pure webview HTML renderer for the custom comparison editor
// (`comparisonEditorProvider.ts`'s `resolveCustomTextEditor`).
//
// `renderComparisonEditorHtml` has the same purity contract
// `resultsWebview.ts`'s `renderResultsHtml` has (see that file's header
// comment): deterministic output for the same input, no `vscode` API usage
// beyond a type-only import (none needed here at all). Unlike
// `renderResultsHtml`, this function legitimately embeds a `<script>`
// block, since this editor's `webviewPanel.webview.options.enableScripts`
// is `true` (a new, deliberate, file-scoped deviation from
// `resultsWebview.ts`'s `enableScripts: false` -- see TASK-BRIEF.md's
// Objective section for the disclosed reasoning: a form that must report
// collected values back to the extension host requires
// `acquireVsCodeApi().postMessage(...)`, which requires scripts). The
// embedded script is static, deterministic HTML-embedded JS -- the exact
// same script text on every render, reading/writing only DOM state that
// itself is not interpolated into the script body -- so it introduces no
// non-determinism of its own; every value from `draft` is escaped and
// placed only in HTML attribute/text positions, never spliced into the
// `<script>` body.
//
// Four tabs per TASK-BRIEF.md Scope item 3: Source, Target, Keys, Checks.
// The Column Mapping tab (T-37's scope) is deliberately NOT built here --
// this file's tab-strip/CSS leaves a 5th tab slot available (see
// `TAB_ORDER`/`renderTabStrip` below) for T-37 to extend without needing
// to restructure the strip.

/** One source/target side's editable state, mirroring
 * `NewComparisonAnswerSide`'s (`buildComparisonYaml.ts`, T-35b) 3-kind
 * discriminated union exactly -- this editor writes through
 * `buildComparisonYaml`, so the draft shape and the answer shape it
 * ultimately produces stay in lockstep. `connection` is a bare profile
 * *name* string only (never a nested/credential-shaped value) -- the same
 * invariant `buildComparisonYaml`'s own header comment documents for
 * `NewComparisonAnswers.sourceConnection`/`targetConnection`. */
export type ComparisonEditorSideDraft =
  | { kind: "table"; connection: string; object: string; where?: string }
  | { kind: "query"; connection: string; sql: string }
  | { kind: "sqlFile"; connection: string; filePath: string };

/** The four independent check-enabled toggles this task's Checks tab
 * exposes, matching `NewComparisonAnswerChecks` (`buildComparisonYaml.ts`).
 * Each key present means "the document currently has an explicit
 * enabled-state for this check"; a key's value is the current toggle
 * state. A key absent from this record means the parsed document had no
 * `checks.<name>` block at all -- the Checks tab still renders a toggle
 * for it (defaulting its checkbox to unchecked), but Apply only emits a
 * `checks.<name>` sub-block for toggles the user has actually interacted
 * with (see `comparisonEditorProvider.ts`'s Apply-message handling for how
 * the webview reports every toggle's current checkbox state regardless, so
 * "untouched" vs. "explicitly off" collapses to the same emitted YAML for
 * this task's scope -- an acceptable simplification per TASK-BRIEF.md
 * Scope item 3, which only requires "four independent booleans"). */
export interface ComparisonEditorChecksDraft {
  schema: boolean;
  rowCount: boolean;
  profile: boolean;
  rowLevel: boolean;
}

/** A single named connection profile, as surfaced to the connection picker
 * dropdowns on the Source/Target tabs. Only `name` is ever read by this
 * module -- deliberately not the full `ConnectionProfile` shape (T-29),
 * which also carries `host`/`port`/`user`/etc. -- so this module has no
 * way to accidentally render a credential-adjacent field into the
 * webview, mirroring TASK-BRIEF.md's "connection picker only ever emits a
 * bare connection name string" requirement. */
export interface ComparisonEditorConnectionOption {
  name: string;
}

/**
 * The full draft state `renderComparisonEditorHtml` renders, and the shape
 * `comparisonEditorProvider.ts` parses a `.paritylens` document's current
 * text into via `parseDefinition` before rendering. Intentionally NOT the
 * same shape as `ParityDefinition` (`@paritylens/engine`) -- this is a
 * *view* model shaped for the four tabs' form fields, not a parallel data
 * model of the whole document (per TASK-BRIEF.md's Objective: "this editor
 * is a friendlier view, not a parallel data model" -- `parseDefinition`/
 * `buildComparisonYaml` remain the sole parse/serialize authority; this
 * type only ever holds already-parsed-or-user-edited field values in
 * transit between the document and the webview form).
 *
 * T-37 will extend this type with column-mapping state (per TASK-BRIEF.md's
 * "Interfaces produced" section) -- keep new fields additive when doing so.
 */
export interface ComparisonEditorDraft {
  /** `ParityDefinition.name`, or `""` for a not-yet-named document. */
  comparisonName: string;
  source: ComparisonEditorSideDraft;
  target: ComparisonEditorSideDraft;
  /** One or more key column names (composite keys), matching
   * `ParityDefinition.keys`. Always at least conceptually a list, even if
   * currently empty (an empty list is a valid, if incomplete, draft state
   * -- Apply-time validation, not render-time, is what blocks saving it). */
  keys: string[];
  checks: ComparisonEditorChecksDraft;
  /** Every saved `ConnectionProfile.name` (T-29), passed in by the
   * provider so the webview never calls a `vscode` API directly for this
   * list -- per TASK-BRIEF.md Scope item 3's "route everything through the
   * provider" instruction. */
  connectionOptions: ComparisonEditorConnectionOption[];
  /** Set when the document's current text failed to parse (invalid YAML,
   * or YAML that fails `parseDefinition`'s validation) -- per
   * TASK-BRIEF.md Scope item 2: "show the raw text with a clear ... banner
   * rather than crashing or showing a blank/broken form." When set, the
   * form tabs still render (using whatever last-known-good or default
   * draft values were available), but a banner and the raw text are shown
   * above them so the user can see what's actually on disk. */
  parseError?: { message: string; rawText: string };
}

/** Escapes a value for safe inclusion in the webview's HTML body/attributes.
 * Identical implementation to `resultsWebview.ts`'s `escapeHtml` -- kept as
 * a separate copy (not imported) since that file is explicitly outside
 * this task's ownership (TASK-BRIEF.md's Prohibited changes: "Do not touch
 * `resultsWebview.ts`") and this module must not depend on it. */
function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escapes a JSON string for safe embedding directly as a JS expression
 * inside a `<script>` block (used only for the one genuinely dynamic value
 * the static script needs at load time: the initial draft). `<`/`>` are
 * escaped to their `\u003C`/`\u003E` Unicode-escape forms so a value
 * containing a literal `</script` substring cannot prematurely close the
 * surrounding `<script>` tag; this is safe inside a JSON/JS string literal
 * since `\uXXXX` is valid JSON string escape syntax. */
function escapeForScriptJson(json: string): string {
  return json.replace(/</g, "\\u003C").replace(/>/g, "\\u003E");
}

const TAB_ORDER = ["source", "target", "keys", "checks"] as const;
type TabId = (typeof TAB_ORDER)[number];

const TAB_LABELS: Record<TabId, string> = {
  source: "Source",
  target: "Target",
  keys: "Keys",
  checks: "Checks"
};

function renderStyles(): string {
  return `<style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 24px 32px 48px;
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family, sans-serif);
      font-size: 13px;
    }
    .content { max-width: 720px; }
    h1 { font-size: 18px; font-weight: 500; margin: 0 0 4px; }
    .banner {
      margin: 12px 0 20px;
      padding: 10px 14px;
      border: 1px solid var(--vscode-inputValidation-errorBorder, #f14c4c);
      background: var(--vscode-inputValidation-errorBackground, rgba(241,76,76,0.1));
      color: var(--vscode-foreground);
      border-radius: 4px;
      font-size: 12.5px;
    }
    .banner pre {
      white-space: pre-wrap;
      font-family: var(--vscode-editor-font-family, monospace);
      margin: 8px 0 0;
      max-height: 260px;
      overflow: auto;
    }
    .tab-strip {
      margin-top: 18px;
      display: flex;
      gap: 6px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
    }
    .tab-strip button {
      appearance: none;
      background: transparent;
      border: none;
      padding: 8px 14px;
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      color: var(--vscode-descriptionForeground);
      border-bottom: 2px solid transparent;
    }
    .tab-strip button.active {
      color: var(--vscode-foreground);
      border-bottom-color: var(--vscode-focusBorder, var(--vscode-textLink-foreground));
    }
    .tab-strip .tab-placeholder {
      padding: 8px 14px;
      font-size: 12.5px;
      color: var(--vscode-disabledForeground, var(--vscode-descriptionForeground));
      opacity: 0.6;
    }
    .tab-panel { display: none; padding-top: 18px; }
    .tab-panel.active { display: block; }
    label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground); margin: 14px 0 4px; }
    label:first-child { margin-top: 0; }
    input[type="text"], select {
      width: 100%;
      padding: 6px 8px;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-panel-border, rgba(128,128,128,0.35)));
      border-radius: 3px;
      font-size: 12.5px;
      font-family: var(--vscode-font-family, sans-serif);
    }
    .field-error { color: var(--vscode-errorForeground, #f14c4c); font-size: 11.5px; margin-top: 4px; min-height: 14px; }
    .key-row { display: flex; gap: 6px; margin-bottom: 6px; }
    .key-row input { flex: 1; }
    .key-row button, .keys-add button { padding: 4px 10px; font-size: 12px; cursor: pointer; }
    .check-row { display: flex; align-items: center; gap: 8px; margin: 10px 0; }
    .check-row label { margin: 0; text-transform: none; font-size: 13px; letter-spacing: normal; color: var(--vscode-foreground); }
    .actions { margin-top: 24px; display: flex; align-items: center; gap: 12px; }
    button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 7px 16px;
      border-radius: 3px;
      font-size: 12.5px;
      cursor: pointer;
    }
    button.primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .apply-status { font-size: 12px; color: var(--vscode-descriptionForeground); }
    .apply-status.error { color: var(--vscode-errorForeground, #f14c4c); }
  </style>`;
}

function renderTabStrip(): string {
  const buttons = TAB_ORDER.map(
    (tab, index) =>
      `<button type="button" class="tab-button${index === 0 ? " active" : ""}" data-tab="${tab}">${escapeHtml(TAB_LABELS[tab])}</button>`
  ).join("\n      ");
  // Deliberate visible placeholder slot for T-37's Column Mapping tab (not
  // built by this task -- see this file's header comment and
  // TASK-BRIEF.md's Prohibited changes).
  return `<div class="tab-strip">
      ${buttons}
      <span class="tab-placeholder">Column Mapping (coming soon)</span>
    </div>`;
}

function renderSideModeOptions(selected: ComparisonEditorSideDraft["kind"]): string {
  const kinds: Array<{ value: ComparisonEditorSideDraft["kind"]; label: string }> = [
    { value: "table", label: "Table" },
    { value: "query", label: "Query" },
    { value: "sqlFile", label: "SQL File" }
  ];
  return kinds
    .map((k) => `<option value="${k.value}"${k.value === selected ? " selected" : ""}>${escapeHtml(k.label)}</option>`)
    .join("\n");
}

function renderConnectionOptions(options: ComparisonEditorConnectionOption[], selected: string): string {
  // The currently-selected connection name is always included as an
  // option even if it doesn't match any saved profile (e.g. a fixture
  // pair name, or a name typed before any profile existed) -- otherwise
  // the <select> would silently discard the document's actual value.
  const names = Array.from(new Set([selected, ...options.map((o) => o.name)].filter((n) => n !== "")));
  if (names.length === 0) {
    return `<option value="" selected></option>`;
  }
  return names.map((name) => `<option value="${escapeHtml(name)}"${name === selected ? " selected" : ""}>${escapeHtml(name)}</option>`).join("\n");
}

function renderSideTab(side: "source" | "target", draft: ComparisonEditorSideDraft, options: ComparisonEditorConnectionOption[]): string {
  const prefix = side;
  const label = side === "source" ? "Source" : "Target";
  return `<div class="tab-panel${side === "source" ? " active" : ""}" data-panel="${side}">
      <label for="${prefix}-connection">Connection</label>
      <select id="${prefix}-connection" data-field="${prefix}.connection">
        ${renderConnectionOptions(options, draft.connection)}
      </select>

      <label for="${prefix}-kind">${escapeHtml(label)} mode</label>
      <select id="${prefix}-kind" data-field="${prefix}.kind">
        ${renderSideModeOptions(draft.kind)}
      </select>

      <div data-side-fields="${prefix}">
        <label for="${prefix}-object">Table / object name</label>
        <input type="text" id="${prefix}-object" data-field="${prefix}.object" value="${escapeHtml(draft.kind === "table" ? draft.object : "")}" />
        <div class="field-error" data-error="${prefix}.object"></div>

        <label for="${prefix}-where">WHERE clause (optional, Table mode only)</label>
        <input type="text" id="${prefix}-where" data-field="${prefix}.where" value="${escapeHtml(draft.kind === "table" ? (draft.where ?? "") : "")}" />

        <label for="${prefix}-sql">SQL (Query mode)</label>
        <input type="text" id="${prefix}-sql" data-field="${prefix}.sql" value="${escapeHtml(draft.kind === "query" ? draft.sql : "")}" />
        <div class="field-error" data-error="${prefix}.sql"></div>

        <label for="${prefix}-filePath">SQL file path (SQL File mode)</label>
        <input type="text" id="${prefix}-filePath" data-field="${prefix}.filePath" value="${escapeHtml(draft.kind === "sqlFile" ? draft.filePath : "")}" />
        <div class="field-error" data-error="${prefix}.filePath"></div>
      </div>
    </div>`;
}

function renderKeysTab(keys: string[]): string {
  const rows =
    keys.length > 0
      ? keys.map((key, index) => `<div class="key-row" data-key-row="${index}"><input type="text" data-key-index="${index}" value="${escapeHtml(key)}" /><button type="button" data-remove-key="${index}">Remove</button></div>`).join("\n")
      : "";
  return `<div class="tab-panel" data-panel="keys">
      <label>Key column(s)</label>
      <div data-keys-list>${rows}</div>
      <div class="keys-add"><button type="button" data-add-key>Add key column</button></div>
      <div class="field-error" data-error="keys"></div>
    </div>`;
}

function renderChecksTab(checks: ComparisonEditorChecksDraft): string {
  const rows: Array<{ id: keyof ComparisonEditorChecksDraft; label: string }> = [
    { id: "schema", label: "Schema check" },
    { id: "rowCount", label: "Row count check" },
    { id: "profile", label: "Profile check" },
    { id: "rowLevel", label: "Row-level check" }
  ];
  const rendered = rows
    .map(
      (row) =>
        `<div class="check-row"><input type="checkbox" id="check-${row.id}" data-field="checks.${row.id}"${checks[row.id] ? " checked" : ""} /><label for="check-${row.id}">${escapeHtml(row.label)}</label></div>`
    )
    .join("\n");
  return `<div class="tab-panel" data-panel="checks">
      ${rendered}
    </div>`;
}

/**
 * The static, deterministic embedded script: reads the initial draft from
 * `window.__PARITYLENS_DRAFT__` (a JSON blob interpolated once, outside
 * this string, at the call site below), wires up tab switching, keeps a
 * local in-memory copy of edited field values, runs the client-side "nicety
 * layer" validation described in TASK-BRIEF.md Scope item 4 (disables
 * Apply / shows inline errors for empty required fields), and posts an
 * `{ type: "apply", draft: {...} }` message via `acquireVsCodeApi()` when
 * Apply is clicked. This string itself never changes between renders --
 * only `window.__PARITYLENS_DRAFT__` (assigned separately, see
 * `renderComparisonEditorHtml`) varies, so the purity contract ("same
 * input twice -> identical output," meaning the same *rendered document
 * text*, including this fixed script) is preserved.
 */
const CLIENT_SCRIPT = `
(function () {
  var vscode = acquireVsCodeApi();
  var draft = window.__PARITYLENS_DRAFT__;

  function $(sel) { return document.querySelector(sel); }
  function $all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  // Tab switching.
  $all('.tab-button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var tab = btn.getAttribute('data-tab');
      $all('.tab-button').forEach(function (b) { b.classList.toggle('active', b === btn); });
      $all('.tab-panel').forEach(function (p) { p.classList.toggle('active', p.getAttribute('data-panel') === tab); });
    });
  });

  function currentSide(prefix) {
    var kindSel = $('#' + prefix + '-kind');
    var connSel = $('#' + prefix + '-connection');
    var kind = kindSel ? kindSel.value : 'table';
    var connection = connSel ? connSel.value : '';
    if (kind === 'query') {
      return { kind: 'query', connection: connection, sql: $('#' + prefix + '-sql').value };
    }
    if (kind === 'sqlFile') {
      return { kind: 'sqlFile', connection: connection, filePath: $('#' + prefix + '-filePath').value };
    }
    var where = $('#' + prefix + '-where').value;
    var side = { kind: 'table', connection: connection, object: $('#' + prefix + '-object').value };
    if (where) { side.where = where; }
    return side;
  }

  function currentKeys() {
    return $all('[data-key-index]').map(function (input) { return input.value; }).filter(function (v) { return v.trim().length > 0; });
  }

  function currentChecks() {
    return {
      schema: $('#check-schema').checked,
      rowCount: $('#check-rowCount').checked,
      profile: $('#check-profile').checked,
      rowLevel: $('#check-rowLevel').checked
    };
  }

  function clearErrors() {
    $all('.field-error').forEach(function (el) { el.textContent = ''; });
  }

  function validate(source, target, keys) {
    clearErrors();
    var ok = true;
    function fail(field, message) {
      var el = document.querySelector('[data-error="' + field + '"]');
      if (el) { el.textContent = message; }
      ok = false;
    }
    if (source.kind === 'table' && !source.object.trim()) { fail('source.object', 'Source object is required for Table mode.'); }
    if (source.kind === 'query' && !source.sql.trim()) { fail('source.sql', 'Source SQL is required for Query mode.'); }
    if (source.kind === 'sqlFile' && !source.filePath.trim()) { fail('source.filePath', 'Source SQL file path is required for SQL File mode.'); }
    if (target.kind === 'table' && !target.object.trim()) { fail('target.object', 'Target object is required for Table mode.'); }
    if (target.kind === 'query' && !target.sql.trim()) { fail('target.sql', 'Target SQL is required for Query mode.'); }
    if (target.kind === 'sqlFile' && !target.filePath.trim()) { fail('target.filePath', 'Target SQL file path is required for SQL File mode.'); }
    if (keys.length === 0) { fail('keys', 'At least one key column is required.'); }
    return ok;
  }

  function updateApplyState() {
    var source = currentSide('source');
    var target = currentSide('target');
    var keys = currentKeys();
    var ok = validate(source, target, keys);
    var applyBtn = $('#apply-button');
    if (applyBtn) { applyBtn.disabled = !ok; }
    return ok;
  }

  $all('select,input').forEach(function (el) {
    el.addEventListener('input', updateApplyState);
    el.addEventListener('change', updateApplyState);
  });

  var addKeyBtn = $('[data-add-key]');
  if (addKeyBtn) {
    addKeyBtn.addEventListener('click', function () {
      var list = $('[data-keys-list]');
      var index = $all('[data-key-index]').length;
      var row = document.createElement('div');
      row.className = 'key-row';
      var input = document.createElement('input');
      input.type = 'text';
      input.setAttribute('data-key-index', String(index));
      input.addEventListener('input', updateApplyState);
      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', function () { row.remove(); updateApplyState(); });
      row.appendChild(input);
      row.appendChild(removeBtn);
      list.appendChild(row);
    });
  }
  $all('[data-remove-key]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      btn.closest('.key-row').remove();
      updateApplyState();
    });
  });

  var applyButton = $('#apply-button');
  var statusEl = $('#apply-status');
  if (applyButton) {
    applyButton.addEventListener('click', function () {
      var source = currentSide('source');
      var target = currentSide('target');
      var keys = currentKeys();
      if (!validate(source, target, keys)) { return; }
      var comparisonNameEl = $('#comparison-name');
      var comparisonName = comparisonNameEl ? comparisonNameEl.value : draft.comparisonName;
      vscode.postMessage({
        type: 'apply',
        draft: {
          comparisonName: comparisonName,
          source: source,
          target: target,
          keys: keys,
          checks: currentChecks()
        }
      });
      if (statusEl) { statusEl.textContent = 'Applying...'; statusEl.className = 'apply-status'; }
    });
  }

  window.addEventListener('message', function (event) {
    var message = event.data;
    if (!message || typeof message !== 'object') { return; }
    if (message.type === 'apply-result') {
      if (statusEl) {
        if (message.ok) {
          statusEl.textContent = 'Applied.';
          statusEl.className = 'apply-status';
        } else {
          statusEl.textContent = 'Apply failed: ' + message.error;
          statusEl.className = 'apply-status error';
        }
      }
    }
  });

  updateApplyState();
})();
`;

/**
 * Renders `draft` as the comparison editor webview's HTML content. Pure:
 * no side effects, no I/O beyond building a string, no `vscode` runtime
 * API usage. See this file's header comment for the purity/script
 * determinism contract.
 */
export function renderComparisonEditorHtml(draft: ComparisonEditorDraft): string {
  const banner =
    draft.parseError !== undefined
      ? `<div class="banner">
        <strong>This file has a parse error:</strong> ${escapeHtml(draft.parseError.message)}
        <pre>${escapeHtml(draft.parseError.rawText)}</pre>
      </div>`
      : "";

  const draftJson = escapeForScriptJson(
    JSON.stringify({
      comparisonName: draft.comparisonName,
      source: draft.source,
      target: draft.target,
      keys: draft.keys,
      checks: draft.checks
    })
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>ParityLens: ${escapeHtml(draft.comparisonName || "Comparison")}</title>
  ${renderStyles()}
</head>
<body>
  <div class="content">
    <h1>${escapeHtml(draft.comparisonName || "(untitled comparison)")}</h1>
    <label for="comparison-name">Comparison name</label>
    <input type="text" id="comparison-name" value="${escapeHtml(draft.comparisonName)}" />

    ${banner}

    ${renderTabStrip()}

    ${renderSideTab("source", draft.source, draft.connectionOptions)}
    ${renderSideTab("target", draft.target, draft.connectionOptions)}
    ${renderKeysTab(draft.keys)}
    ${renderChecksTab(draft.checks)}

    <div class="actions">
      <button type="button" class="primary" id="apply-button">Apply</button>
      <span class="apply-status" id="apply-status"></span>
    </div>
  </div>
  <script>window.__PARITYLENS_DRAFT__ = ${draftJson};</script>
  <script>${CLIENT_SCRIPT}</script>
</body>
</html>`;
}
