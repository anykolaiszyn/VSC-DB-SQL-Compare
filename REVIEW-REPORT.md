# ParityLens — Review Report T-11

## Review independence statement

This review was performed by a separate agent instance from whoever
implemented T-11. No implementation code was written or edited by this
reviewer; findings below are based on direct reading of the diff, direct
reading of the current source on `task/T-11-results-webview-phase1`, a
fresh independent `npm run verify` run, and a throwaway adversarial test
file that was deleted before finishing (confirmed via `git status`).

## Scope reviewed

- `TASK-BRIEF.md` (T-11, read in full).
- `IMPLEMENTATION-REPORT.md` (claims treated as unverified until checked
  against source).
- Commits `308ad99` (implementation) and `9086e76` (report hash
  correction) on `task/T-11-results-webview-phase1` vs `main`.
- Full contents of:
  - `packages/extension/src/webview/resultsWebview.ts`
  - `packages/extension/src/webview/resultsWebview.test.ts`
  - `packages/extension/src/statusbar/parityStatusBar.ts`
  - `packages/extension/src/statusbar/parityStatusBar.test.ts`
- `packages/shared/src/result.ts` (to confirm it is untouched and to
  confirm the hand-built fixtures in both test files match the real
  interface).
- `IMPLEMENTATION-PLAN.md`'s T-11 row (to check the `activate.ts`
  judgment call against the plan, not just the brief).
- `PROGRESS-LEDGER.md` (to confirm no prior open finding is routed to
  T-11; I-01/I-02 belong to T-03 and are unrelated).

## Findings

### Critical

NONE.

### Important

NONE.

### Minor

NONE.

No issues were found at any severity. Rationale for each area scrutinized
is in "Verification performed" below.

## Verification performed

### 1. Scope / file ownership

`git diff main..HEAD --name-only` on the branch shows exactly:

```
IMPLEMENTATION-REPORT.md
packages/extension/src/statusbar/parityStatusBar.test.ts
packages/extension/src/statusbar/parityStatusBar.ts
packages/extension/src/webview/resultsWebview.test.ts
packages/extension/src/webview/resultsWebview.ts
```

- `git diff main..HEAD -- packages/shared/src/result.ts` → empty. Confirmed
  the prohibited file is untouched.
- `git diff main..HEAD -- packages/engine` → 0 lines. Confirmed.
- `git diff main..HEAD -- packages/extension/src/activation packages/extension/src/views packages/extension/src/secrets` → 0 lines. Confirmed all three T-10-owned directories are untouched.
- All four new/changed source files fall inside the brief's declared
  ownership (`packages/extension/src/webview/**`,
  `packages/extension/src/statusbar/**`). No scope expansion.
- `PROGRESS-LEDGER.md`, `TASK-BRIEF.md`, `package-lock.json` show as
  modified in working-tree `git status` but are **not** part of either
  commit (`git show --stat` on both commits confirms neither touches
  these three files) — consistent with the report's note that these are
  pre-existing orchestrator-side uncommitted changes, not implementer
  output.

### 2. The security-relevant claim: no reachable path to `vscode.workspace`, `SecretStorage`, a connector, or I/O beyond `ComparisonResult`

Read `resultsWebview.ts` in full. Every `vscode` reference in the file is
one of: `import type * as vscode` (line 1), or a type annotation
(`vscode.ViewColumn`, `vscode.WebviewPanel`, `vscode.WebviewPanelOptions
& vscode.WebviewOptions`) inside `showResultsWebview`'s parameter/return
types. Grepped for `vscode\.|require\(|process\.|fs\.|readFile|SecretStorage|workspace`
— all matches are type-only or in comments; zero runtime `vscode` calls.
`renderResultsHtml` takes a single `ComparisonResult` parameter and
returns a template-string built purely from that object's fields
(`comparison`, `runId`, `status`, `summary`, `schemaDifferences`,
`profileDifferences`) via a private `escapeHtml` helper — no other
inputs, no imports beyond `type` imports. This independently confirms the
report's claim rather than trusting it.

`showResultsWebview` does perform one real `vscode` interaction, but only
via an injected `createWebviewPanel` function parameter supplied by the
(unwritten) caller — it never imports `vscode.window` itself. This is the
one function in the module that is not "pure," and it is exactly the
integration seam the brief anticipates ("plus whatever
`vscode.WebviewPanel`/webview API surface is needed to actually display
it"). It performs no credential, workspace, or connector access either —
its only side effect is setting `panel.webview.html` from
`renderResultsHtml(result)`.

Read `parityStatusBar.ts` in full. Its only runtime `vscode` usage is
`vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left)`
inside `createParityStatusBarItem`. `formatParitySummary` takes only a
`ComparisonSummary` and returns a template string — no `vscode` import
touches it at all. `updateFromResult` reads only `result.summary`, per
the brief's "Updates from a `ComparisonResult`'s `summary` field only."
No `vscode.workspace`, `SecretStorage`, or connector reference anywhere
in either file.

**Adversarial probe:** constructed a `ComparisonResult` fixture with
`<script>alert(...)</script>`, `"><script>...`, `<svg onload=alert(2)>`,
and `<img src=x onerror=alert(4)>` payloads in `comparison`, `runId`,
`columnName`, `message`, `sourceType`, `sourceValue`, and `targetValue`
(including the `unknown`-typed profile fields, which the brief explicitly
flags as needing `String(value)` handling). Ran this through
`renderResultsHtml` in a throwaway test
(`packages/extension/src/webview/__xss_probe.test.ts`, deleted after the
run — confirmed via `git status --short` that only the pre-existing,
out-of-scope `PROGRESS-LEDGER.md`/`TASK-BRIEF.md`/`package-lock.json`
working-tree diffs remain, no probe residue). Result: `escapeHtml`
correctly neutralized every payload — the rendered HTML contained none of
`<script>`, `<svg onload`, `"><script>`, or `<img src=x onerror`
unescaped. `escapeHtml`'s five-way replace (`&`, `<`, `>`, `"`, `'`)
covers the injection vectors that matter for this sink (element and
attribute-context breakout); there is no `javascript:`-URL sink or
`innerHTML`-from-unescaped-source path in this module to probe further,
since the module never touches the DOM directly — it only builds a string
handed to `panel.webview.html` by the (out-of-scope, uninvoked) caller.
`enableScripts: false` is hard-coded in `showResultsWebview`'s panel
options, which is a second, independent layer against any script
execution even if an escaping gap existed.

Both claims in the brief's Interfaces table and Prohibited Changes
section are satisfied: presentation-layer only, no I/O beyond the passed
object plus the webview display API.

### 3. `aggregateDifferences`/`rowDifferences` not rendered

`resultsWebview.ts` never reads `result.aggregateDifferences` or
`result.rowDifferences` anywhere — grepped and read the full file to
confirm. Matches the brief's explicit Phase-1 boundary.

### 4. `activate.ts` left untouched — judgment call review

Read the brief's Prohibited Changes section verbatim: "Do not add any
connection-management, run-triggering, or comparison YAML-editing UI —
that is unscheduled/future scope, not T-11," and the Files-owned section:
wiring `activate.ts` is permitted only as a "minimal,
mechanically-necessary companion change" if needed to make T-11's code
reachable, with no mandate that such wiring must happen.

Cross-checked `IMPLEMENTATION-PLAN.md`'s T-11 row directly (not just the
brief's paraphrase of it): the row's review-gate column reads "Independent
reviewer confirms the webview only renders data passed to it (no direct
connector/credential access from webview code)" — no command ID, trigger,
or activation-wiring requirement is named anywhere in the row. The
Sequencing section ("Extension lane: T-01 → T-10 → (waits for T-09 before
T-11...)") likewise specifies no activation deliverable for T-11.

T-16's row (`packages/extension/src/webview/**` "extends T-11's
ownership; sequenced after T-11 merges") confirms activation wiring is
expected to arrive with a future task, alongside the full diff
viewer/export/SQL-preview UI — not as part of T-11's own scope.

Given this, the implementer's reading is correct: no concrete
command/trigger is specified anywhere in the brief or plan for T-11 to
wire up, and inventing one (e.g. a `paritylens.showResults` command with
no defined data source) would itself be undisclosed scope invention,
arguably colliding with the "no run-triggering UI" prohibition. Leaving
`activate.ts` untouched is the minimal, correct reading, not a silent gap
— and the implementer disclosed it prominently rather than burying it,
which is the behavior the brief's own risk-disclosure framing asks for.
This does leave `showResultsWebview`/`createParityStatusBarItem` as
currently-unreachable-from-the-running-extension exports, but that is an
accurate reflection of an intentionally staged rollout (T-11 renders;
a later task, per T-16's ownership note, wires triggering), not a defect
in this task's own deliverable. Does not block approval.

### 5. Interface contract fidelity

- Status bar text format: `formatParitySummary({passed:18, warnings:2,
  failed:1})` → confirmed by direct code read to produce exactly
  `"Parity: 18 passed | 2 warnings | 1 failed"`, matching the brief's
  literal example character-for-character (verified by reading the
  template string in `parityStatusBar.ts` line 16, not just trusting the
  test assertion).
- `SchemaDifference`/`ProfileDifference` field consumption matches
  `packages/shared/src/result.ts`'s actual current shape exactly (both
  hand-built test fixtures were checked field-by-field against the real
  interface definitions read directly from `result.ts`; no drift).
- `sourceValue`/`targetValue` are correctly treated as `unknown` and
  rendered via explicit `String(...)` before escaping, per the brief's
  instruction not to assume a type at compile time.

### 6. Fresh verification run (independent, not trusting the report)

Ran `npm run verify` myself from a clean checkout of the branch:

```
> tsc -b --force            → clean, no errors
> eslint .                  → clean, no errors
> vitest run                → Test Files  13 passed (13)
                               Tests       298 passed (298)
```

This matches the report's claimed "Exit 0... Test Files 13 passed (13),
Tests 298 passed (298)" exactly — no discrepancy. Also independently
confirmed `packages/extension/src/webview/resultsWebview.test.ts` (2
tests) and `packages/extension/src/statusbar/parityStatusBar.test.ts` (2
tests) both appear and pass in this run, matching the brief's Red-state
evidence requirement (2 new focused tests, one per module).

Arithmetic check: baseline claimed 294 (per `PROGRESS-LEDGER.md`'s T-10
entry) + 4 new (2 webview + 2 status bar) = 298. Observed total is 298.
Consistent.

### 7. Report accuracy

Every material claim in `IMPLEMENTATION-REPORT.md` checked against source
or a fresh command was accurate: the "only `import type * as vscode`
appears in `resultsWebview.ts`" claim, the vscode-surface claim for
`parityStatusBar.ts`, the file list, the untouched-files list, the
verification numbers, and the `enableScripts: false` claim (confirmed at
`resultsWebview.ts` line 135). No overstatement or mischaracterization
found.

## Disposition of prior findings

No open finding in `PROGRESS-LEDGER.md` is routed to T-11. I-01/I-02 (the
project's two cited worked examples of the review gate catching real
bugs) both belong to T-03 (statement-safety parser) and are unrelated to
this task's scope. Nothing to re-verify here.

## Final approval status

**APPROVED**

No Critical or Important findings. The webview-rendering and status-bar
functions have no reachable path to `vscode.workspace`, `SecretStorage`,
a connector, or any I/O beyond the `ComparisonResult` object and the
injected webview display API, confirmed by direct source reading and an
adversarial XSS probe with results independently reproduced (not merely
trusted from the implementer's report). Scope and file ownership are
clean against the brief and against `packages/shared/src/result.ts`,
`packages/engine/**`, and T-10's owned directories. The `activate.ts`
non-edit is the correct minimal reading of the brief and
`IMPLEMENTATION-PLAN.md`'s T-11 row, disclosed rather than hidden, and
does not block approval. Fresh `npm run verify` independently reproduces
the report's claimed exit 0 / 298 tests with no discrepancy.
