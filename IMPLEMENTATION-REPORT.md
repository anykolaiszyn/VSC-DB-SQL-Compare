# ParityLens — Implementation Report T-11

## Status and objective

- **Status:** COMPLETE (implementation only — not reviewed or approved)
- **Objective:** Implement the Phase-1-scope results webview and status bar
  summary: given a `ComparisonResult`, render its `schemaDifferences` and
  `profileDifferences` as tables in a VS Code webview panel, and show a
  `Parity: N passed | N warnings | N failed` summary in the status bar —
  using only the data passed into the rendering functions, with no direct
  connector or credential access from webview code. (Quoted verbatim from
  `TASK-BRIEF.md`'s Objective section.)

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/extension/src/webview/resultsWebview.ts` | New. `renderResultsHtml(result: ComparisonResult): string` — pure function rendering `schemaDifferences` and `profileDifferences` as HTML tables. `showResultsWebview(...)` — thin wrapper that takes an injected `createWebviewPanel` function and calls `renderResultsHtml` to set `panel.webview.html`. | Brief's "Produced" interface: "Webview panel render function... Must not read `vscode.workspace`, `SecretStorage`, or invoke any connector — the function's only input is the `ComparisonResult` object." |
| `packages/extension/src/webview/resultsWebview.test.ts` | New. Two tests: a `SchemaDifference` item renders as a table row (asserts `columnName`, `severity`, `kind` appear in output); a `ProfileDifference` item renders as a table row (asserts `columnName`, `severity`, `metric` appear). | Brief's Red-state evidence section. |
| `packages/extension/src/statusbar/parityStatusBar.ts` | New. `formatParitySummary(summary: ComparisonSummary): string` and `createParityStatusBarItem(): ParityStatusBarItem` (wraps `vscode.window.createStatusBarItem`, exposes `updateFromResult(result)`). | Brief's "Produced" interface: status bar text format `Parity: {summary.passed} passed \| {summary.warnings} warnings \| {summary.failed} failed`, updating "from a `ComparisonResult`'s `summary` field only." |
| `packages/extension/src/statusbar/parityStatusBar.test.ts` | New. Tests `formatParitySummary` against the brief's literal example (`summary: {passed: 18, warnings: 2, failed: 1}` → `"Parity: 18 passed \| 2 warnings \| 1 failed"`), and that `createParityStatusBarItem().updateFromResult(result)` sets `.text` to the same string. | Brief's Red-state evidence section (status bar case). |

No other files were changed. `packages/extension/src/activation/activate.ts`
was **not** touched — see "Assumptions and risks" below.

## Behavior and interfaces

- **Behavior delivered:**
  - `renderResultsHtml(result)` returns an HTML string with a `<table>` for
    `schemaDifferences` (columns: severity, column, kind, source type,
    target type, message) and a `<table>` for `profileDifferences`
    (columns: severity, column, metric, source value, target value,
    message), one `<tr>` per array item, plus a summary line and run
    metadata. Empty arrays render a "No … differences." placeholder instead
    of an empty table. All interpolated values are HTML-escaped.
    `aggregateDifferences`/`rowDifferences` are never read by this module.
  - `showResultsWebview(createWebviewPanel, viewColumn, result)` is a thin
    integration wrapper: it accepts an injected `createWebviewPanel`
    function (so `renderResultsHtml` itself never imports `vscode.window`
    or touches the live VS Code API) and sets `panel.webview.html` to
    `renderResultsHtml(result)`. This wrapper is exported but not currently
    invoked from `activate.ts` (no command was added to trigger it) — see
    "Assumptions and risks."
  - `formatParitySummary(summary)` returns the exact literal format string
    the brief specifies. `createParityStatusBarItem()` wraps
    `vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left)` and
    exposes `updateFromResult(result)`, `show()`, `dispose()`, and a `text`
    getter for testability.
- **Interfaces consumed:** `ComparisonResult`, `SchemaDifference`,
  `ProfileDifference`, `ComparisonSummary` from
  `packages/shared/src/result.ts` (read-only; not modified).
- **Interfaces produced:** `renderResultsHtml`, `showResultsWebview`
  (`packages/extension/src/webview/resultsWebview.ts`);
  `formatParitySummary`, `createParityStatusBarItem`, `ParityStatusBarItem`
  (`packages/extension/src/statusbar/parityStatusBar.ts`). Both are new
  exports; neither is yet wired into `activate.ts`.

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline (pre-change) | `npm run verify` | Exit 0. `Test Files 11 passed (11)`, `Tests 294 passed (294)`. | This session's transcript, captured before any new file was created. |
| Red state | `npx vitest run packages/extension` | 2 of 5 test files failed: `Error: Failed to load url ./resultsWebview (resolved id: ./resultsWebview) in .../resultsWebview.test.ts. Does the file exist?` and the equivalent `Failed to load url ./parityStatusBar ... Does the file exist?`. Summary line: `Test Files 2 failed | 3 passed (5)`, `Tests 11 passed (11)` (the 11 belong to the 3 pre-existing passing suites; the 2 new suites collected 0 tests each due to module resolution failure). Matches the brief's predicted failure reason exactly: "Module resolution failure — `webview/**` and `statusbar/**` do not exist under `packages/extension/src/` yet." | This session's transcript. |
| Focused green state | `npx vitest run packages/extension` | Exit 0. `Test Files 5 passed (5)`, `Tests 15 passed (15)` (11 pre-existing + 2 new webview tests + 2 new status-bar tests). | This session's transcript. |
| Full verification | `npm run verify` (typecheck → lint → test) | Exit 0. `tsc -b --force` clean, `eslint .` clean, vitest: `Test Files 13 passed (13)`, `Tests 298 passed (298)` — the previously-passing 294 tests unchanged plus 4 new (2 webview + 2 status bar); arithmetic: 294 + 4 = 298, matching the observed total exactly. | This session's transcript. |

## Assumptions and risks

- **Assumptions:**
  - No ready-made, importable `ComparisonResult` fixture literal exists
    that the extension package could reuse directly (the engine package's
    `planner.test.ts` only produces one asynchronously via `runComparison`
    against `FixtureConnector`, and the brief prohibits touching
    `packages/engine/**`). Per the brief's Green-state section ("a small
    hand-built literal matching the real interface is fine ... otherwise"),
    I hand-built a `ComparisonResult` literal in both test files, matching
    the real interface fields read directly from
    `packages/shared/src/result.ts` (including the brief's own
    `{passed: 18, warnings: 2, failed: 1}` example for the status-bar
    test). This is a judgment call under the brief's explicit permission,
    not an invented shortcut.
  - `showResultsWebview` takes an injected `createWebviewPanel` function
    rather than importing `vscode.window.createWebviewPanel` directly.
    This keeps `renderResultsHtml` (the function the brief's review note
    asks to be scrutinized hardest) trivially provable as pure and
    side-effect-free — it has no `vscode` runtime import at all, only
    `import type * as vscode` for parameter typing. Judgment call: this is
    slightly more indirection than a direct
    `vscode.window.createWebviewPanel` call would need, chosen
    specifically to make the "no connector/credential access" property
    structurally obvious rather than something a reviewer has to trust
    from reading control flow.
- **Risks or limitations:**
  - **`activate.ts` was not touched.** The brief permits a "minimal,
    mechanically-necessary companion change" to `activate.ts` *if* wiring
    the webview/status bar into activation is needed to make T-11's code
    reachable, but does not mandate a specific command or trigger, and
    `IMPLEMENTATION-PLAN.md`'s T-11 row does not name a required command
    ID. No command currently invokes `showResultsWebview` or
    `createParityStatusBarItem` from the running extension — both are
    exported, tested functions but are not yet reachable from a user
    action inside the real extension host. I judged that inventing a
    command registration (e.g. a `paritylens.showResults` command with no
    defined trigger/data source, since there is no run-triggering UI per
    the brief's own Prohibited Changes: "Do not add any
    connection-management, run-triggering... UI") would be scope
    invention beyond what the brief specifies, not a "mechanically
    necessary" edit. Flagging this explicitly for the reviewer/
    orchestrator to confirm this reading is correct — the alternative
    (wiring a command) would touch T-10's owned `activate.ts`, and the
    brief is explicit that such a change must stay minimal and be
    separately disclosed if made; I concluded the minimal-and-correct
    choice was not to touch it at all absent a concrete trigger
    requirement in the brief or plan.
  - `enableScripts: false` is hard-coded in `showResultsWebview`'s options
    — the Phase-1 tables need no client-side script, and disabling
    scripts narrows the webview's capability surface. A future phase
    adding interactivity would need to revisit this.
  - No CSS styling was added beyond bare HTML tables; visual polish is
    out of scope for a Phase-1 presentation-layer task with no
    design-spec styling requirement cited in the brief.
- **Blockers:** None.

## Patch or commit identity

- **Commit:** `308ad991a7b3f7a9a2c61e1e4947b9208f68f934` (subject: "T-11:
  Phase-1 results webview and status bar summary")
- **Branch:** `task/T-11-results-webview-phase1`

Note: `PROGRESS-LEDGER.md`, `TASK-BRIEF.md`, and `package-lock.json` showed
as modified in `git status` at the start of this task (pre-existing,
uncommitted changes from the Lead Orchestrator dispatching this task, not
from this implementation). Per this task's file ownership, they were left
untouched and were not staged or committed as part of this task's commit.

## Recommended next step

Independent review by the `reviewer` subagent (a separate instance from
this implementer), per the brief's Handoff section. The reviewer should, at
minimum: (1) confirm `renderResultsHtml` and `formatParitySummary` have no
reachable path to `vscode.workspace`, `SecretStorage`, or a connector —
only `import type * as vscode` appears in `resultsWebview.ts`, and
`parityStatusBar.ts`'s only `vscode` runtime usage is
`vscode.window.createStatusBarItem`/`vscode.StatusBarAlignment`; (2) confirm
the `activate.ts`-untouched decision above is the correct call, not a
silent scope gap; (3) re-run `npm run verify` independently rather than
trusting this report's captured output. This report does not constitute
review or approval of any kind.
