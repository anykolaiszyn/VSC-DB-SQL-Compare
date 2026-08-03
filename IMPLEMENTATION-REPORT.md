# ParityLens — Implementation Report T-33

## Status and objective

- **Status:** COMPLETE (implementation and evidence only — not
  reviewed/approved; see Recommended next step)
- **Objective:** Wire the "DATA PARITY" sidebar's `Comparisons` and
  `Recent Runs` tree sections to real data, wire `parityStatusBar.ts` to
  show `Parity: N passed | N warnings | N failed` after a run, and (per
  the brief's explicitly authorized narrow amendment) make
  `runComparisonCommand` actually call T-31's `persistRun` so `Recent
  Runs` is genuinely populatable — quoting `TASK-BRIEF.md`'s Objective:
  "`Recent Runs` is meaningless while nothing ever calls T-31's
  `persistRun`... Making `Recent Runs` genuinely populatable therefore
  requires one narrow, additive call to `persistRun` inside that existing
  command flow."

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/extension/src/views/parityTreeDataProvider.ts` | `ParityTreeDataProvider` now takes an optional `ParityTreeDataProviderDeps` constructor argument (`findComparisonFiles`, `listRecentRuns`, `runComparisonCommandId`, `reopenRunCommandId`). `getChildren` populates `Comparisons` with one `ParityComparisonTreeItem` per discovered `.paritylens` file (command = `paritylens.runComparison`, arg = file URI) and `Recent Runs` with one `ParityRecentRunTreeItem` per `RunSummary` (command = reopen-run command id, arg = run id). `getChildren` return type widened to `TreeItem[] \| Promise<TreeItem[]>` (sync for the top-level call, async for section children) — `TreeDataProvider<T>.getChildren`'s own contract (`ProviderResult<T>`) permits this. | Brief Scope items 1–3 |
| `packages/extension/src/views/parityTreeDataProvider.test.ts` | Added `Uri` to the mocked `vscode` module; added test coverage for both new sections (file discovery → tree items, run summaries → tree items, command/argument correctness on click, empty-state behavior with no deps); updated 3 pre-existing synchronous `getChildren()` call sites to cast `as ParityTreeItem[]` since the return type is now a union. | Red/green evidence for Scope items 1–3 |
| `packages/extension/src/activation/activate.ts` | **Amendment** (brief-authorized, Objective section): `runComparisonCommand`'s `deps` gained two new **typed-optional** fields, `resolveRunHistoryRoot` and `statusBarItem`, following the existing `connectionProfileStore`/`secretStore` optional-with-no-op-absent-state pattern. After a successful `runComparison` call and before `showResultsWebview`, the function now (a) resolves a safe output root and calls `persistRun`, catching and surfacing any failure via `showErrorMessage` without throwing, and (b) calls `statusBarItem.updateFromResult(result)` + `.show()` if supplied. Added `registerReopenRunCommand` (`paritylens.reopenRun`) which loads a run via `loadRun` and reopens it via `showResultsWebview`. Added `resolveRunHistoryRoot` helper (first workspace folder + `.paritylens/runs` convention). `activate()` now constructs the status bar item once via `createParityStatusBarItem`, registers it for disposal, builds `ParityTreeDataProvider`'s real deps (backed by `vscode.workspace.findFiles`/`listRecentRuns`), passes the status bar item into `registerRunComparisonCommand`, and registers `paritylens.reopenRun`. No change to parse/registry-resolution/error-handling logic in `runComparisonCommand` itself. | Brief Scope items 5–6 |
| `packages/extension/src/activation/activate.test.ts` | Extended the mocked `vscode` module with `StatusBarAlignment`, `window.createStatusBarItem`, `workspace.findFiles` (needed because `activate()` now constructs these at call time). Added tests: status bar constructed once and disposed via `context.subscriptions`; `paritylens.reopenRun` registered. Updated 1 pre-existing synchronous `getChildren()` call site to cast `as ParityTreeItem[]`. | Companion test file for the owned `activate.ts`; needed for green-state evidence of Scope item 6 |
| `packages/extension/src/activation/runComparisonCommand.test.ts` | Added a new `describe` block covering: `persistRun` is actually called (verified via `listRecentRuns` reading the same temp root back, red-state-first — see below); status bar `updateFromResult`/`.show()` called with the run's real result, text matches `formatParitySummary`; `showResultsWebview`/`createWebviewPanel` still called when `resolveRunHistoryRoot` returns `undefined` (no workspace open) or `persistRun` itself throws (unwritable root) — i.e. persistence failure never blocks the results webview. | Green-state evidence required by the brief |

No changes to `packages/engine/**`, `packages/extension/src/runHistory/**`,
`packages/extension/src/connections/**`, `packages/extension/src/authoring/**`,
or `packages/extension/src/statusbar/parityStatusBar.ts` (confirmed via
`git diff --stat` — zero diff on that file).

## Behavior and interfaces

- **Behavior delivered:**
  - Opening the "Comparisons" tree section in a workspace with
    `.paritylens` files now lists one node per file; clicking it invokes
    `paritylens.runComparison` with the file's URI as a command argument
    (the existing open-dialog flow is unmodified and still runs if the
    command doesn't consume the argument — per the brief's explicit
    fallback allowance).
  - Opening "Recent Runs" lists one node per persisted run
    (`name — timestamp`, most-recent-first, as `listRecentRuns` already
    sorts); clicking it invokes the new `paritylens.reopenRun` command
    with the run's `id`, which loads the full result via `loadRun` and
    reopens it via `showResultsWebview`.
  - After every successful `paritylens.runComparison` run, the run is
    persisted (`persistRun`) under `<first workspace folder>/.paritylens/runs`,
    and the status bar updates to `Parity: N passed | N warnings | N failed`
    and becomes visible.
  - A persistence failure (no workspace open, or an I/O error) is reported
    via a distinct `showErrorMessage` call but never prevents the run's
    results from displaying — the outer `catch` (which reports parse/
    connection failures as `undefined`) is untouched and not triggered by
    a persistence failure.
- **Interfaces consumed:** `listRecentRuns`, `loadRun`, `RunSummary`,
  `persistRun` (`packages/extension/src/runHistory/runHistory.ts`, T-31,
  read-only except for the one additive `persistRun` call point);
  `showResultsWebview` (T-11/T-16); `formatParitySummary`,
  `createParityStatusBarItem`, `ParityStatusBarItem` (T-11, consumed
  as-is, unmodified); `vscode.workspace.findFiles` (only via the injected
  `findComparisonFiles` dependency, never called directly inside
  `parityTreeDataProvider.ts`).
- **Interfaces produced:** `ParityTreeDataProviderDeps`,
  `ParityComparisonTreeItem`, `ParityRecentRunTreeItem` (all in
  `parityTreeDataProvider.ts`); `REOPEN_RUN_COMMAND_ID` and
  `resolveRunHistoryRoot`'s underlying `.paritylens/runs` convention
  (`activate.ts`); two new optional fields on `runComparisonCommand`'s
  `deps` parameter (`resolveRunHistoryRoot`, `statusBarItem`).

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline green (pre-change) | `npm run verify` | Exit 0 — 450 passed, 27 skipped (30 files, 28 run) | captured in this session before any edits |
| Red state 1 (tree sections) | `git stash push -- packages/extension/src/views/parityTreeDataProvider.ts && npx vitest run packages/extension/src/views/parityTreeDataProvider.test.ts` | 4 tests failed against the reverted (T-10 empty-state) provider: `expected undefined to be 'paritylens.runComparison'`, `expected "spy" to be called 1 times, but got 0 times`, `expected undefined to be 'paritylens.reopenRun'` — i.e. the old provider returns no children/commands for either section, exactly the brief's predicted red state | this session's transcript; `git stash pop` restored the implementation immediately after |
| Red state 2 (persist/status-bar) | `git stash push -- packages/extension/src/activation/activate.ts && npx vitest run packages/extension/src/activation/runComparisonCommand.test.ts` | 3 of 8 tests failed against the reverted (T-30) `runComparisonCommand`: `expected [] to have a length of 1 but got +0` (persistRun never called, so `listRecentRuns` stays empty), and two `expected "spy" to be called ... Number of calls: 0` (status bar / persistence-failure message never sent) — exactly the brief's predicted red state ("nothing ever calls `persistRun`") | this session's transcript; `git stash pop` restored the implementation immediately after |
| Focused green state (tree provider) | `npx vitest run packages/extension/src/views/parityTreeDataProvider.test.ts` | Exit 0 — 11 tests passed (was 5 before this task) | this session's transcript |
| Focused green state (persist/status-bar) | `npx vitest run packages/extension/src/activation/runComparisonCommand.test.ts` | Exit 0 — 8 tests passed (was 4 before this task) | this session's transcript |
| Focused green state (activate wiring) | `npx vitest run packages/extension/src/activation/activate.test.ts` | Exit 0 — 8 tests passed (was 6 before this task) | this session's transcript |
| Full verification | `npm run verify` (`tsc -b --force` → `eslint .` → `vitest run`) | Exit 0 — typecheck clean, lint clean, **462 passed, 27 skipped** (30 files, 28 run; the 27 skipped are the pre-existing SQL Server/PostgreSQL integration tests requiring a docker container, unrelated to this task) | this session's transcript |

## Assumptions and risks

- **Assumptions (judgment calls):**
  - **Safe output root convention:** `<first open workspace folder>/.paritylens/runs`.
    The brief explicitly invited "pick a straightforward convention and
    document it" since nothing previously wired a concrete value. Chosen
    to nest under a dedicated hidden subdirectory (matching `AGENTS.md`'s
    "isolated output paths under a safe output root (e.g. a project-local
    `work/` or `.paritylens/` directory)" language) rather than writing
    JSON run records into the workspace root directly.
  - **`paritylens.reopenRun` not added to `package.json`'s
    `contributes.commands`:** `package.json` is outside this task's
    declared "Files owned" list. A manifest entry is only required for
    command-palette visibility/activation events, not for
    `vscode.commands.registerCommand`/tree-item-triggered `command`
    bindings to function — `paritylens.reopenRun` is only ever invoked
    programmatically via a tree item click, never from the command
    palette, so this omission does not affect the described behavior.
    Flagged explicitly rather than silently expanding scope into
    `package.json`; a reviewer/future task should confirm this is
    acceptable or route a manifest update through its own brief.
  - **Comparison tree item command argument:** `ParityComparisonTreeItem`
    passes the file's `vscode.Uri` as a command argument to
    `paritylens.runComparison`. Per the brief, `runComparisonCommand`'s
    existing file-picking flow was *not* modified to consume this
    argument (that would have exceeded the narrow persist-only
    amendment) — today, clicking a comparison node still opens the
    existing file-picker dialog rather than pre-selecting the clicked
    file. This is the brief's own explicitly-allowed fallback ("if
    ... does not accept a pre-selected URI ... it is acceptable for the
    click to just invoke the command and let the existing open-dialog
    flow run"). A future task could wire the argument through without
    touching this task's files.
  - **`getChildren`'s return type widened to a union
    (`TreeItem[] | Promise<TreeItem[]>`)** rather than making it uniformly
    `async`: this preserves the pre-existing synchronous contract for the
    top-level (no-`element`) call, so the original "getChildren() with no
    element returns the three top-level section nodes" test needed only a
    type-level cast, not a behavioral change. `vscode.TreeDataProvider<T>.getChildren`'s
    own declared return type (`ProviderResult<T>` = `T[] | undefined |
    Thenable<T[] | undefined>`) explicitly permits either shape per call.
- **Risks or limitations:**
  - The `resolveRunHistoryRoot`/`persistRun` failure path is currently
    always surfaced via `showErrorMessage` (never silently skipped) — the
    brief left this as "your call, document whichever." A user running
    many comparisons with no workspace open will see a
    `showErrorMessage` every time; this was judged more honest than
    silent failure, but a reviewer may prefer a quieter default (e.g.
    silent skip, or a single one-time notice).
  - `ParityComparisonTreeItem`'s label is derived from `uri.path.split("/").pop()`
    rather than a VS Code-native basename helper — this is a plain-string
    operation matching the mocked-`vscode.Uri` test surface (no
    `@vscode/test-electron` in this codebase's test setup, per every
    existing test file's own header comment) rather than using
    `vscode.workspace.asRelativePath` or similar, which would need a
    richer mock. Functionally correct for both POSIX and (via `Uri.path`,
    always forward-slash-normalized in real VS Code) Windows paths.
  - `findComparisonFiles`'s glob (`"**/*.paritylens"`) is unbounded
    workspace-wide; no exclude pattern (e.g. `node_modules`) was added,
    matching the brief's silence on this detail. Unlikely to matter in
    practice (`.paritylens` is this project's own extension) but flagged
    for completeness.
- **Blockers:** None.

## T-33-01 fix (post-review, REVIEW-REPORT.md CHANGES REQUIRED)

Independent review returned one Important finding, T-33-01: the brief's
Green-state Verification section requires "a test confirms clicking a
listed 'Recent Runs' item invokes `loadRun` for the correct `id` and
passes its result to `showResultsWebview`," and no test actually did
this. `registerReopenRunCommand` inlined its handler directly inside the
`vscode.commands.registerCommand` callback, and every test touching
`activate()` mocks `registerCommand` as `() => ({ dispose: () =>
undefined })`, discarding the callback without invoking it — so the
`loadRun` → `showResultsWebview` chain, and the `loadRun`-rejection →
`showErrorMessage` catch, were never exercised by any test. The reviewer
confirmed by manual inspection that the underlying implementation logic
was already correct; this was a missing-test gap, not a functional
defect.

**Fix applied**, following the reviewer's suggested resolution and the
codebase's own precedent (`runComparisonCommand`'s existing
registration-vs-logic extraction split):

- `packages/extension/src/activation/activate.ts`: extracted a new,
  exported, directly-testable function `reopenRunCommand(id,
  safeOutputRoot, deps)` — where `deps` injects `loadRun`,
  `createWebviewPanel`, `viewColumn`, `showErrorMessage`, and
  `showResultsWebview` — containing exactly the logic that previously
  lived inline in `registerReopenRunCommand`'s `registerCommand`
  callback (no behavioral change: same `safeOutputRoot === undefined` →
  `showErrorMessage` early return; same `try { loadRun → showResultsWebview
  } catch { showErrorMessage }` shape). `registerReopenRunCommand` now
  just resolves `safeOutputRoot` from the live `vscode.workspace.
  workspaceFolders` and delegates to `reopenRunCommand`, binding the live
  `vscode` API into `deps` — mirroring exactly how
  `registerRunComparisonCommand` delegates to `runComparisonCommand`.
- `packages/extension/src/activation/activate.test.ts`: added a new
  `describe("reopenRunCommand (T-33-01: recent-run click behavior)")`
  block with four tests, calling the extracted function directly (no
  `registerCommand` mock involved): (1) `loadRun` is called with the
  clicked run's `id` and the resolved `safeOutputRoot`; (2)
  `showResultsWebview` receives `loadRun`'s resolved `ComparisonResult`
  (via `deps.createWebviewPanel`/`deps.viewColumn`) and `showErrorMessage`
  is not called; (3) a `loadRun` rejection is caught and surfaced via
  `showErrorMessage` (`'ParityLens: could not reopen run "run-missing" —
  record not found'`) rather than propagating as an unhandled rejection,
  and `showResultsWebview` is not called; (4) an `undefined`
  `safeOutputRoot` (no workspace open) surfaces the existing
  "no workspace folder is open" message without ever calling `loadRun`.

No other file was touched — this fix stays entirely within
`activate.ts`/`activate.test.ts`, both already within T-33's declared
"Files owned."

### Red-state evidence for the fix

`git stash push -- packages/extension/src/activation/activate.ts && npx
vitest run packages/extension/src/activation/activate.test.ts` (i.e. the
new tests against the pre-fix `activate.ts`, which had no `reopenRunCommand`
export):

```
FAIL packages/extension/src/activation/activate.test.ts (4 tests failed, 8 passed)
 × reopenRunCommand (T-33-01...) > invokes loadRun with the clicked run's id...
 × reopenRunCommand (T-33-01...) > passes loadRun's resolved ComparisonResult...
 × reopenRunCommand (T-33-01...) > catches a loadRun rejection...
 × reopenRunCommand (T-33-01...) > surfaces a clear error via showErrorMessage...
Unhandled Rejection: Error: record not found
 Test Files  1 failed (1)
      Tests  4 failed | 8 passed (12)
```

(The 3 non-rejection failures are `reopenRunCommand is not a function` /
`TypeError` from calling an undefined import — expected, since the
extraction didn't exist yet. The 4th surfaces as an unhandled promise
rejection rather than a clean assertion failure, which is itself exactly
the defect class this fix closes: without the extraction, a `loadRun`
rejection has no injectable catch path for a test to observe.)
`git stash pop` restored the fix immediately after.

### Green-state evidence for the fix

`npx vitest run packages/extension/src/activation/activate.test.ts`:

```
✓ packages/extension/src/activation/activate.test.ts (12 tests) 101ms
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

### Full verification after the fix

`npm run verify` (`tsc -b --force` → `eslint .` → `vitest run`): **exit
0**. `tsc -b --force` clean, `eslint .` clean, `vitest run` →
**466 passed, 27 skipped** (30 files, 28 run — up from the pre-fix
462/27; the +4 are exactly the new `reopenRunCommand` tests, no other
count changed). The 27 skips remain the pre-existing SQL Server/PostgreSQL
docker-container integration tests, unrelated to this task.

## Patch or commit identity

- **Original implementation commit:** `7cb46a3` — "T-33: wire tree view
  Comparisons/Recent Runs sections and status bar"
- **Report commit:** `107e060` — "T-33: add implementation report"
- **T-33-01 fix commit:** see the commit created immediately after this
  report update on this same branch (`git log -1` on
  `task/T-33-tree-status-bar-wiring` at handoff time).
- **Branch:** `task/T-33-tree-status-bar-wiring`

## Recommended next step

Independent re-review by a separate reviewer agent, per this project's
operating contract (`AGENTS.md`: "Every implementation task receives an
independent review by a reviewer who did not author the task's change").
The reviewer should confirm the T-33-01 fix above actually closes the
finding (the extracted `reopenRunCommand` is exercised directly, the four
new assertions are non-vacuous, and no existing behavior changed —
`registerReopenRunCommand`'s externally observable behavior is identical
before and after, only its internals were split for testability) before
re-considering the original Handoff-note adversarial checks. This report
does not constitute review or approval — no task in this codebase may be
marked complete/approved by the agent that implemented it.
