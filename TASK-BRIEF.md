# TASK-BRIEF.md — T-36: Custom comparison editor (Source/Target/Keys/Checks)

## Objective

Give `.paritylens` files a real, interactive authoring UI instead of
forcing every edit beyond T-32's minimal scaffold into raw YAML text.
Register a `vscode.CustomTextEditorProvider` for `.paritylens` files with
four tabs — **Source**, **Target**, **Keys**, **Checks** — backed by the
real on-disk YAML document (`buildComparisonYaml`/`parseDefinition` stay
the sole source of truth; this editor is a friendlier *view*, not a
parallel data model).

See `docs/superpowers/specs/2026-08-02-comparison-authoring-ui-design.md`
("Custom comparison editor" and "Column Mapping tab" sections — the
Column Mapping tab itself is T-37's scope, not this task's, but read that
section too so your tab layout leaves room for it) for the full design
context this task implements.

**Architecture decision made before this brief, disclosed here**: unlike
`resultsWebview.ts` (T-11/T-16/T-34), which is read-only and deliberately
keeps `enableScripts: false` with CSS-only tab switching, this editor is
genuinely interactive — text inputs, dropdowns, and an Apply action that
must send collected field values from the webview back to the extension
host. VS Code's webview API requires `postMessage`/`acquireVsCodeApi` for
a webview to communicate back to its provider, which requires
`enableScripts: true`. **This is a new, deliberate, and correct deviation
specific to this file** — it does not relax or contradict T-34's
`enableScripts: false` rule for `resultsWebview.ts`, which stays exactly
as it is. Do not attempt a CSS-only trick to avoid this; it cannot work
for a form that must report its collected values back to the host.

## Scope

1. **Register the custom editor** (`vscode.window.registerCustomEditorProvider`
   or an equivalent registration API) for the `.paritylens` file pattern,
   in `packages/extension/src/activation/activate.ts`, alongside this
   codebase's existing command-registration pattern. Confirm with VS
   Code's actual API surface (read `@types/vscode`'s
   `CustomTextEditorProvider` interface) what registration options are
   required — this codebase has never registered a custom editor before,
   so do not assume a shape; verify it.

2. **`comparisonEditorProvider.ts`** (new) — the `vscode`-touching glue:
   - Implements `resolveCustomTextEditor(document, webviewPanel, ...)`:
     parses the document's current text via `parseDefinition` (T-08) into
     a draft state; if parsing fails (invalid YAML or a definition that
     fails validation), show the raw text with a clear "this file has a
     parse error: {message}" banner rather than crashing or showing a
     blank/broken form — the user must still be able to see *something*
     useful.
   - `webviewPanel.webview.options = { enableScripts: true }`.
   - Renders the webview HTML via `comparisonEditorHtml.ts`'s pure
     render function (see item 3), passing the parsed draft state.
   - Listens for a `postMessage` from the webview carrying "Apply" data
     (the user's edited field values); on receipt, validates the data
     (client-side validation in the webview is a UX nicety, not a
     substitute — this provider-side check is the one that actually
     matters), builds YAML via `buildComparisonYaml` (T-35b, extended per
     item 5 below), and applies it via a single `vscode.WorkspaceEdit`
     replacing the full document range (`document.uri`, full-range
     `TextEdit.replace`), then `vscode.workspace.applyEdit(edit)`.
   - **Never write a document that would fail `parseDefinition`** — before
     calling `applyEdit`, round-trip the freshly-built YAML through
     `parseDefinition` yourself; if it throws, reject the Apply (send a
     failure message back to the webview with the validation error) and
     do not touch the document. This is the single most important
     correctness property in this task.
   - If the underlying document changes on disk while the editor is open
     (VS Code fires a document-change event for this), re-parse and
     re-render the draft — don't let the webview silently diverge from
     the file. A minimal, correct handling is acceptable; this doesn't
     need to be a full conflict-resolution UI.

3. **`comparisonEditorHtml.ts`** (new) — a **pure** render function,
   `renderComparisonEditorHtml(draft: ComparisonEditorDraft): string`
   (name your own draft-state type; document it clearly), with the exact
   same purity contract `resultsWebview.ts`'s `renderResultsHtml` has:
   deterministic output for the same input, no `vscode` API usage beyond
   a type-only import if any. This function differs from
   `renderResultsHtml` in one respect: it may legitimately embed a
   `<script>` block (since `enableScripts: true` here), but that script
   must be static, deterministic HTML-embedded JS (the same script text
   every time, just reading/writing DOM state and calling
   `acquireVsCodeApi().postMessage(...)`) — not itself a source of
   non-determinism. The four tabs:
   - **Source** / **Target**: a mode toggle (Table / Query / SQL File,
     matching `NewComparisonAnswerSide`'s 3-kind union from T-35b) with
     the appropriate field(s) shown per mode (`object`+optional `where`
     for Table; `sql` for Query; `filePath` for SQL File); a connection
     picker listing `ConnectionProfile.name` values (from T-29's
     `ConnectionProfileStore.list()`, passed in as part of the draft/
     initial data — do not have the webview call VS Code APIs directly,
     route everything through the provider).
   - **Keys**: a simple list editor for one or more key column names
     (composite keys).
   - **Checks**: toggles for `checks.schema.enabled` /
     `checks.rowCount.enabled` / `checks.profile.enabled` /
     `checks.rowLevel.enabled` (four independent booleans is sufficient
     for this task — do not build UI for `tolerance`/`strategy`/
     `maxDifferences`/`topValues` sub-fields; those stay hand-YAML-edited
     for now, out of this task's scope, since the design's Checks tab
     description only calls for the enabled toggles).
   - No Run History or Differences tab (per the design spec's explicit
     Non-goals).

4. **Apply validation UX**: client-side (in the rendered HTML/script),
   disable the Apply button or show inline errors when a required field
   is empty (no source object/sql/filePath for the selected mode, no key
   columns) — this is the nicety layer. The authoritative check remains
   provider-side (item 2). Document in your implementation report which
   validations are client-side-only vs. provider-enforced.

5. **Extend `buildComparisonYaml`/`NewComparisonAnswers`** (T-35b's file,
   now also owned by this task — see Files owned) to support emitting
   `checks` (`checks.schema.enabled`/`checks.rowCount.enabled`/
   `checks.profile.enabled`/`checks.rowLevel.enabled`), since this editor
   is the first caller that needs it and T-35b's brief explicitly did not
   include `checks`. Read `parseDefinition`'s `checks`-parsing logic in
   `definition.ts` (lines ~510-555 per this brief's own grep, confirm
   exactly) before writing the emitter — YAML keys are snake_case
   (`row_count`, `row_level`) while the TS/`ParityChecks` fields are
   camelCase, matching this codebase's established convention elsewhere.
   Omit a `checks:` block entirely when every check is left at its
   default (matching this file's existing omit-when-absent convention),
   or emit only the toggles that differ from `parseDefinition`'s defaults
   — your call, document which you chose.

## Dependencies

- T-08/T-35a (`parseDefinition`, `ParitySide`, `ParityChecks`) — complete.
- T-29 (`ConnectionProfileStore`, `ConnectionProfile`) — complete.
- T-35b (`buildComparisonYaml`, `NewComparisonAnswers`,
  `NewComparisonAnswerSide`) — complete, this task extends it (item 5).

## Files owned

- `packages/extension/src/authoring/comparisonEditorProvider.ts` (new)
- `packages/extension/src/authoring/comparisonEditorProvider.test.ts` (new)
- `packages/extension/src/authoring/comparisonEditorHtml.ts` (new)
- `packages/extension/src/authoring/comparisonEditorHtml.test.ts` (new)
- `packages/extension/src/authoring/buildComparisonYaml.ts` (extends
  T-35b — `checks` emission only, per Scope item 5)
- `packages/extension/src/authoring/buildComparisonYaml.test.ts` (extends
  T-35b — `checks` emission tests only)
- `packages/extension/src/activation/activate.ts` (extends
  T-10/T-22/T-29/T-33, custom-editor registration only — no other change)
- `packages/extension/package.json` (`contributes.customEditors` entry
  only, if VS Code's registration model requires a manifest declaration —
  confirm against the actual API; disclose either way)

## Prohibited changes

- Do not implement the Column Mapping tab (T-37's scope) — leave visible
  room for a 5th tab in your layout/CSS, but do not build it.
- Do not touch `packages/extension/src/webview/resultsWebview.ts` — its
  `enableScripts: false` contract is unrelated to and unaffected by this
  task's different (correctly different, see Objective) choice for the
  editor.
- Do not touch `packages/extension/src/authoring/newComparisonWizard.ts`
  or its test file — the scaffold wizard (T-32) stays as the initial
  file-creation path; this task only adds a richer *editing* surface for
  files that already exist.
- Do not touch `packages/engine/**` — `parseDefinition`/`ParitySide`/
  `ParityChecks` are pre-existing, approved shapes consumed read-only.
- Do not add the SQL preview / pre-execution confirmation (T-38's scope)
  or CodeLens (T-39's scope).
- Do not widen `ColumnMappingEntry`, `SchemaDifference`,
  `ProfileDifference`, or `AggregateDifference`.

## Interfaces consumed / produced

- Consumed (read-only): `parseDefinition`, `ParityDefinition`,
  `ParityChecks` (`@paritylens/engine`); `ConnectionProfileStore.list()`
  (T-29); `buildComparisonYaml`/`NewComparisonAnswers`/
  `NewComparisonAnswerSide` (T-35b, extended by this task per item 5).
- Produced: registered `CustomTextEditorProvider` for `.paritylens`;
  `renderComparisonEditorHtml(draft): string` (pure, exported); extended
  `buildComparisonYaml`/`NewComparisonAnswers` supporting `checks`.
  Document the exact draft-state type shape in your implementation report
  — T-37 will need to extend it with column-mapping state next.

## Red/Green/Full verification evidence required

- **Red**: a test opening a `.paritylens` file via the custom editor,
  editing a draft field (e.g. changing the source object name or toggling
  a check), sending an Apply message, and expecting the underlying
  document text to change accordingly, fails today (the provider doesn't
  exist). A separate red-state test for `checks` emission: calling
  `buildComparisonYaml` with `checks` answers today either fails to
  compile (no such field) or the emitted YAML has no `checks:` block even
  when checks were specified.
- **Green**:
  - The above test passes.
  - A test confirming Apply is rejected (document unchanged) when the
    built YAML would fail `parseDefinition` (e.g. simulate an internal
    validation bypass to prove the provider-side round-trip guard
    actually fires, not just that client-side validation prevented
    sending bad data in the first place).
  - A test confirming `renderComparisonEditorHtml` is pure (same draft
    input twice → identical output).
  - A test confirming `webviewPanel.webview.options.enableScripts` is
    `true` for this editor specifically (a positive-assertion mirror of
    T-34's negative `enableScripts: false` guard test for
    `resultsWebview.ts` — confirms the deliberate choice, not an
    accident).
  - `checks` round-trip tests through `parseDefinition` for at least 2
    of the 4 toggles (e.g. schema+rowCount enabled, profile+rowLevel
    disabled or absent).
  - A test confirming opening a file with invalid/unparseable YAML shows
    the disclosed fallback (error banner), not a crash.
- **Full**: `npm run verify` (typecheck + lint + test) green.

## Handoff note for the reviewer

Please adversarially confirm, independent of the implementation report:

1. **Apply-blocking validation is real, not just client-side**: construct
   a scenario that bypasses whatever client-side checks exist (e.g. call
   the provider's Apply-handling logic directly with data that would
   produce invalid YAML) and confirm the document is genuinely left
   unchanged, not just that the UI discouraged sending it.
2. **`enableScripts: true` is correctly scoped**: confirm
   `resultsWebview.ts`'s `showResultsWebview` call site is byte-for-byte
   unchanged (diff against `main`) — this task's different choice must
   not leak into that file.
3. **No credential-shaped field reachable**: confirm the connection
   picker only ever emits a bare connection *name* string (never
   host/port/user/password fields) into the document, mirroring T-32's
   original review depth.
4. **Purity of `renderComparisonEditorHtml`**: confirm same input twice
   produces identical output, and that any embedded `<script>` is static
   text (not built from live interpolated data in a way that could break
   determinism or introduce an XSS surface — walk every interpolation
   into the HTML for `escapeHtml` coverage, same as T-34's review did).
5. **`checks` round-trip fidelity**: confirm emitted `checks` YAML,
   parsed back through the real `parseDefinition`, produces the exact
   `ParityChecks` object expected — not just "no error was thrown."
6. **File-ownership diff**: confirm via `git diff --stat main..<branch>`
   that only the declared files changed, especially confirming
   `resultsWebview.ts`, `newComparisonWizard.ts`, and everything under
   `packages/engine/**` are untouched.

## Branch

`task/T-36-comparison-custom-editor`
