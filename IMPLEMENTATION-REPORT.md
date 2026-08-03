# ParityLens — Implementation Report T-36

## Status and objective

- **Status:** COMPLETE (implementation + evidence only — not reviewed or approved)
- **Objective:** Per `TASK-BRIEF.md`'s Objective section: give `.paritylens`
  files "a real, interactive authoring UI instead of forcing every edit
  beyond T-32's minimal scaffold into raw YAML text," by registering a
  `vscode.CustomTextEditorProvider` with four tabs — **Source**, **Target**,
  **Keys**, **Checks** — backed by `buildComparisonYaml`/`parseDefinition`
  as the sole source of truth, and extending `buildComparisonYaml` to emit
  `checks` (Scope item 5), which T-35b's brief explicitly did not include.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/extension/src/authoring/comparisonEditorProvider.ts` (new) | `vscode`-touching glue: `ComparisonEditorProvider` implementing `resolveCustomTextEditor`, `enableScripts: true`, Apply-message handling with the provider-side `parseDefinition` round-trip guard, re-render on out-of-band document change | TASK-BRIEF.md Scope items 1–2 |
| `packages/extension/src/authoring/comparisonEditorProvider.test.ts` (new) | Red/green tests for the provider, including the adversarial round-trip-guard-bypass simulation | TASK-BRIEF.md Red/Green evidence requirements |
| `packages/extension/src/authoring/comparisonEditorHtml.ts` (new) | Pure `renderComparisonEditorHtml(draft)`; `ComparisonEditorDraft` view-state type; four tabs (Source/Target/Keys/Checks) plus a visible, unbuilt Column Mapping tab slot for T-37 | TASK-BRIEF.md Scope item 3 |
| `packages/extension/src/authoring/comparisonEditorHtml.test.ts` (new) | Purity tests, XSS/escaping tests, script-determinism test, parse-error banner test | TASK-BRIEF.md Green-state evidence requirements |
| `packages/extension/src/authoring/buildComparisonYaml.ts` | Extended `NewComparisonAnswers` with optional `checks?: NewComparisonAnswerChecks`; added `renderChecks` emitting `checks.schema`/`row_count`/`profile`/`row_level` `enabled` toggles, omitted entirely when absent/empty | TASK-BRIEF.md Scope item 5 |
| `packages/extension/src/authoring/buildComparisonYaml.test.ts` | Added 5 tests covering `checks` emission and round-trip through `parseDefinition` | TASK-BRIEF.md Red/Green evidence requirements |
| `packages/extension/src/activation/activate.ts` | Added `registerComparisonEditorProvider` (binds `ComparisonEditorProviderDeps` to live `vscode.window`/`vscode.workspace` APIs) and one line registering it in `activate()`, alongside the existing command-registration pattern | TASK-BRIEF.md Scope item 1, Files owned |
| `packages/extension/package.json` | Added `contributes.customEditors` entry (`viewType: "paritylens.comparisonEditor"`, `selector.filenamePattern: "*.paritylens"`, `priority: "default"`) | Confirmed against `@types/vscode`'s `registerCustomEditorProvider`/`CustomTextEditorProvider` — VS Code requires a manifest `customEditors` contribution for `onCustomEditor:viewType` activation and view-type resolution |
| `packages/extension/src/activation/activate.test.ts` | **Outside T-36's declared "Files owned" list — disclosed deviation, see below.** Added `registerCustomEditorProvider`/`applyEdit` no-op mocks to the file's existing hoisted `vi.mock("vscode", ...)` factory | Mechanically required: every existing test in this file calls the real `activate()`, which now unconditionally calls `vscode.window.registerCustomEditorProvider`; without a mock, every existing test in the file failed with `TypeError: window.registerCustomEditorProvider is not a function`. No existing test's assertions were changed. |

### Disclosed scope-boundary note

`packages/extension/src/activation/activate.test.ts` is not in
`TASK-BRIEF.md`'s "Files owned" list, but extending `activate.ts` (which
**is** owned) broke every one of that file's pre-existing tests purely at
the mock-surface level (a missing function on the mocked `vscode.window`
object, not a behavioral assertion failure). This is the same category of
mechanically-forced edit the implementer contract calls out ("a test
literal elsewhere breaks because you widened a shared type the brief
explicitly authorized you to widen"), and `activate.ts`'s own prior task
briefs (T-22, T-30, T-33) establish the identical precedent of extending
this same mock file for the same reason. The diff is two mock-object
property additions (`registerCustomEditorProvider`, `applyEdit`) — no
existing assertion, test name, or test behavior changed. Flagging this
explicitly per the implementer contract rather than silently expanding
scope.

## Behavior and interfaces

- **Behavior delivered:**
  - Opening a `.paritylens` file now opens `ComparisonEditorProvider`'s
    custom editor by default (`priority: "default"` in `package.json`).
  - The editor renders four tabs (Source, Target, Keys, Checks) reflecting
    the document's current parsed state, with a visible but unbuilt
    Column Mapping tab-strip slot reserved for T-37.
  - Source/Target each support a Table/Query/SQL File mode toggle
    (matching `NewComparisonAnswerSide`'s 3-kind union) and a connection
    picker populated from `ConnectionProfileStore.list()` (bare `name`
    strings only — see Security note below).
  - Keys is a simple add/remove list editor for composite key columns.
  - Checks exposes four independent enabled toggles
    (`schema`/`rowCount`/`profile`/`rowLevel`) — no
    `tolerance`/`strategy`/`maxDifferences`/`topValues` UI, per
    TASK-BRIEF.md Scope item 3's explicit exclusion.
  - Clicking Apply posts the collected field values to the provider,
    which validates them, builds YAML via the extended
    `buildComparisonYaml`, round-trips the result through
    `parseDefinition` itself, and only then applies a single
    `WorkspaceEdit` replacing the full document range. Any failure at any
    step (missing required field, or — simulating a bypass of client-side
    validation — a built document that still fails `parseDefinition`)
    results in **zero** calls to `applyEdit` and a failure message posted
    back to the webview; the document is left completely unchanged. This
    is verified directly (not just inferred) by
    `comparisonEditorProvider.test.ts`'s
    `"NEVER calls applyEdit when the Apply message would fail the
    provider-side round-trip guard"` test, which calls
    `resolveCustomTextEditor` + simulates the message end-to-end and
    asserts `applyEdit` was never invoked.
  - Opening a document whose current text is invalid/unparseable YAML (or
    valid YAML failing `ParityDefinition` validation) shows a disclosed
    "this file has a parse error: {message}" banner plus the raw text,
    not a crash or blank form — verified by both
    `comparisonEditorHtml.test.ts` (render-level) and
    `comparisonEditorProvider.test.ts` (provider-level, asserting
    `resolveCustomTextEditor` does not throw).
  - If the underlying document changes on disk while the editor is open,
    `vscode.workspace.onDidChangeTextDocument` triggers a re-render from
    the fresh text (minimal handling, not a full conflict-resolution UI,
    per TASK-BRIEF.md's explicit "minimal, correct handling is
    acceptable").
  - `buildComparisonYaml` now emits a `checks:` block (snake_case YAML
    keys `row_count`/`row_level` matching `parseChecks`'s reads in
    `packages/engine/src/orchestration/definition/definition.ts` lines
    ~502–558, confirmed by direct read before writing the emitter) only
    for the toggles the caller actually supplies; an absent/empty
    `checks` answer omits the `checks:` key entirely (documented judgment
    call in `NewComparisonAnswers.checks`'s doc comment, matching this
    file's existing omit-when-absent convention for `where`/
    `column_mapping`).

- **Interfaces consumed (read-only):**
  - `parseDefinition`, `ParityDefinition`, `ParitySide`, `ParityChecks`
    (`@paritylens/engine`) — used exactly as-is; nothing under
    `packages/engine/**` was touched.
  - `ConnectionProfileStore.list()` (T-29) — only `.name` is ever read
    into `ComparisonEditorConnectionOption`; no other `ConnectionProfile`
    field (host/port/user/etc.) is ever read or rendered.
  - `buildComparisonYaml`/`NewComparisonAnswers`/`NewComparisonAnswerSide`
    (T-35b) — extended, not replaced; every pre-existing call site
    (`newComparisonWizard.ts`) keeps compiling and behaving unchanged
    since `checks` is an additive optional field.

- **Interfaces produced:**
  - Registered `CustomTextEditorProvider` for `.paritylens`
    (`COMPARISON_EDITOR_VIEW_TYPE = "paritylens.comparisonEditor"`,
    matching `package.json`'s new `contributes.customEditors` entry).
  - `renderComparisonEditorHtml(draft: ComparisonEditorDraft): string`
    (pure, exported from `comparisonEditorHtml.ts`).
  - **`ComparisonEditorDraft` shape** (documented in full in
    `comparisonEditorHtml.ts`'s header/type comments — summarized here
    per TASK-BRIEF.md's "document the exact draft-state type shape ...
    T-37 will need to extend it" instruction):
    ```ts
    interface ComparisonEditorDraft {
      comparisonName: string;
      source: ComparisonEditorSideDraft;   // { kind: "table"|"query"|"sqlFile", connection, ... }
      target: ComparisonEditorSideDraft;
      keys: string[];
      checks: ComparisonEditorChecksDraft; // { schema, rowCount, profile, rowLevel: boolean }
      connectionOptions: ComparisonEditorConnectionOption[]; // { name: string }[]
      parseError?: { message: string; rawText: string };
    }
    ```
    T-37 should extend this additively (e.g. a `columnMapping` field) per
    this file's own header comment, not restructure the existing fields.
  - Extended `buildComparisonYaml`/`NewComparisonAnswers` supporting an
    optional `checks?: NewComparisonAnswerChecks` field
    (`{ schema?, rowCount?, profile?, rowLevel?: { enabled: boolean } }`).

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline (pre-change) | `npm run verify` | Exit 0. 511 passed, 27 skipped, 30 files | Run before any edit, this session |
| Red state 1 (checks emission) | `npx vitest run packages/extension/src/authoring/buildComparisonYaml.test.ts` (after adding the 5 new `checks` tests, before touching `buildComparisonYaml.ts`) | **3 failed / 19 passed** — `expected {} to deeply equal {...}` for all three `checks`-asserting tests, confirming `checks` was silently absent from parsed output exactly as predicted | Command output captured this session |
| Red state 2 (provider doesn't exist) | Provider file did not exist prior to this task; `comparisonEditorProvider.test.ts` could not have run (import would fail) | N/A — file creation is the red state per TASK-BRIEF.md's own wording ("fails today (the provider doesn't exist)") | Confirmed via `git status`/directory listing before creating the file |
| Focused green (buildComparisonYaml) | `npx vitest run packages/extension/src/authoring/buildComparisonYaml.test.ts` | Exit 0. **22 passed** (17 pre-existing + 5 new) | Command output this session |
| Focused green (comparisonEditorHtml) | `npx vitest run packages/extension/src/authoring/comparisonEditorHtml.test.ts` | Exit 0. **13 passed**, including purity (identical-object and structurally-equal-copy variants), `enableScripts`-adjacent `<script>` presence, XSS/escaping, and script-determinism-across-different-drafts tests | Command output this session |
| Focused green (comparisonEditorProvider) | `npx vitest run packages/extension/src/authoring/comparisonEditorProvider.test.ts` | Exit 0. **14 passed**, including the `enableScripts: true` positive-assertion guard, the Apply-success end-to-end test, the "NEVER calls applyEdit" round-trip-guard-bypass test, and the parse-error-banner-not-crash test | Command output this session |
| Focused green (activate) | `npx vitest run packages/extension/src/activation` | Exit 0. **20 passed** (12 activate.test.ts + 8 runComparisonCommand.test.ts) — confirms the disclosed mock-only edit didn't change any existing assertion's outcome | Command output this session |
| Full verification | `npm run verify` (`tsc -b --force` && `eslint .` && `vitest run`) | **Exit 0.** typecheck clean, lint clean, **543 passed / 27 skipped / 32 test files** (up from the 511/27/30 baseline by exactly the 32 new tests added: 5 + 13 + 14 = 32) | Full transcript captured this session |

## Assumptions and risks

- **Assumptions:**
  - `priority: "default"` in the `customEditors` manifest entry is the
    correct choice to satisfy "give `.paritylens` files a real,
    interactive authoring UI" (Objective) — VS Code still lets a user
    reopen as plain text via "Reopen Editor With...", so this doesn't
    remove the raw-YAML editing path, it just changes what opens by
    default. Judgment call; a reviewer may prefer `"option"` (opens as
    plain text by default, custom editor available as a menu option) if
    the intent was more conservative. Documented here as a judgment call
    rather than silently picked.
  - `NewComparisonAnswerChecks`'s "omit unspecified toggles from the
    emitted `checks:` block" behavior (rather than "always emit all four
    toggles, defaulting unspecified ones to `false`") was the judgment
    call TASK-BRIEF.md Scope item 5 explicitly left to the implementer
    ("your call, document which you chose"). Chose omit-when-unspecified
    because it distinguishes "user never touched this check" from
    "user explicitly turned this check off" at the document level,
    matching `parseDefinition`'s own `checks.<x>` optional-key semantics.
  - The webview's Checks tab, per its own doc comment in
    `comparisonEditorHtml.ts`, currently reports **all four** checkbox
    states on every Apply (not just ones the user touched) — this
    collapses "untouched" and "explicitly set to the rendered default"
    into the same emitted YAML for this task's scope. This is disclosed
    as a documented limitation, not silently smoothed over: a toggle a
    user never interacts with still gets written into `checks:` at
    whatever its initial (parsed-from-document) state was, since the
    static client script has no separate "touched" tracking. Acceptable
    for this task's scope (four plain booleans, per Scope item 3) but
    worth a reviewer's attention if strict "never write a field the user
    didn't touch" semantics were expected.

- **Risks or limitations:**
  - The embedded client-side `<script>` in `comparisonEditorHtml.ts` is
    hand-written vanilla JS (no bundler/type-checking on that string) —
    consistent with this being the first genuinely interactive webview in
    this codebase, but it means any typo inside `CLIENT_SCRIPT` would only
    surface at runtime inside a real VS Code webview, not at `tsc -b`
    time. Mitigated by keeping the script's logic deliberately simple
    (DOM reads/writes and one `postMessage` call) and by the script being
    exercised structurally (presence, determinism-across-renders) by
    `comparisonEditorHtml.test.ts`, though not executed in a real DOM —
    no `jsdom`/browser-environment test actually runs this script's logic
    end-to-end. This is a real coverage gap, disclosed rather than hidden:
    the `postMessage`/Apply flow is verified end-to-end at the
    *provider* level (real `handleApplyMessage` logic, simulated message
    objects) but not at the *rendered-webview-script* level.
  - `resolveCustomTextEditor`'s out-of-band document-change handling
    (`vscode.workspace.onDidChangeTextDocument`) re-renders on *any*
    document change, including ones the editor's own `applyEdit` call
    itself causes — this means after a successful Apply, the webview gets
    re-rendered a second time from the just-written text (harmless — it's
    idempotent, re-parsing what was just written — but not verified by a
    dedicated test; only inferred from the code path).
  - `NewComparisonAnswerChecks`/`checks` emission was scoped strictly to
    the four `enabled` toggles per TASK-BRIEF.md's explicit
    exclusion — `tolerance`/`strategy`/`maxDifferences`/`topValues`
    remain hand-YAML-edited only, exactly as instructed, not a gap I
    introduced.

- **Blockers:** None.

## Patch or commit identity

- **Commit:** `4bcde212c57b17eb59f768fd84b8c2a9db6c4bbd` on branch
  `task/T-36-comparison-custom-editor`
- **Branch:** `task/T-36-comparison-custom-editor` (matches
  TASK-BRIEF.md's Branch section)

## Recommended next step

Independent review by a separate reviewer agent, per this project's
standing rule that a task is never self-approved. The reviewer should, at
minimum, work through TASK-BRIEF.md's own "Handoff note for the reviewer"
checklist (items 1–6): re-verify the Apply-blocking round-trip guard
adversarially, confirm `resultsWebview.ts` is byte-for-byte unchanged
(`git diff --stat main..task/T-36-comparison-custom-editor` — confirmed
in this report's own diff-stat check to touch only the declared files
plus the disclosed `activate.test.ts` mock addition), confirm no
credential-shaped field is reachable through the connection picker,
confirm `renderComparisonEditorHtml` purity and full `escapeHtml`
coverage, confirm `checks` round-trip fidelity against real
`parseDefinition`, and confirm the file-ownership diff. This report does
not constitute review, approval, or a completion claim beyond
implementation-and-evidence scope.
