# ParityLens — Review Report T-33

## Review independence statement

This review was performed by a separate agent instance from the T-33
implementer, with no memory of writing the code under review. All findings
below are based on direct inspection of the actual diff, direct execution
of the project's verification command, and direct reading of
`TASK-BRIEF.md`/`IMPLEMENTATION-PLAN.md`/`AGENTS.md`, not on the
implementer's own characterization of the work in
`IMPLEMENTATION-REPORT.md`.

## Scope reviewed

Branch `task/T-33-tree-status-bar-wiring` (commits `a19e9f0`, `7cb46a3`,
`107e060`) against `main` (`84e9ee2`). Diff:

```
IMPLEMENTATION-REPORT.md                             (report, not reviewed as code)
packages/extension/src/activation/activate.test.ts    | 49 +++++-
packages/extension/src/activation/activate.ts          | 156 +++++++++++++++++-
packages/extension/src/activation/runComparisonCommand.test.ts | 108 ++++++
packages/extension/src/views/parityTreeDataProvider.test.ts    | 126 ++++++++-
packages/extension/src/views/parityTreeDataProvider.ts          | 152 +++++++++--
```

No changes outside `packages/extension/src/{views,statusbar,activation}/**`
plus their companion test files. `packages/extension/src/statusbar/parityStatusBar.ts`
has a confirmed **zero-line diff** (`git diff main...HEAD -- .../parityStatusBar.ts`
returns nothing). No changes to `packages/engine/**`,
`packages/extension/src/runHistory/**`, `packages/extension/src/connections/**`,
`packages/extension/src/authoring/**`, or `packages/extension/package.json`.

## Findings

### Critical

None.

### Important

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| T-33-01 | The brief's Green-state Verification section explicitly requires "a test confirms clicking a listed 'Recent Runs' item invokes `loadRun` for the correct `id` and passes its result to `showResultsWebview`." This test does not exist. `registerReopenRunCommand` in `activate.ts` (lines 498–514) is a private, unexported function whose closure is only ever handed to `vscode.commands.registerCommand`. In every test file that touches `activate()` (`activate.test.ts`), the mocked `commands.registerCommand` is `() => ({ dispose: () => undefined })` — it discards the callback and never invokes it. The one T-33 test that mentions `reopenRun` (`activate.test.ts:167-174`, "registers the paritylens.reopenRun command") only asserts `registerCommand` was called with that command ID and `expect.any(Function)` — it never calls the captured function, so the `loadRun(id, safeOutputRoot)` → `showResultsWebview(...)` chain inside the handler is never executed by any test in the suite. Separately, `parityTreeDataProvider.test.ts` genuinely does verify the *tree item's* `command.command`/`command.arguments` point at `"paritylens.reopenRun"`/`[run.id]` (a real, non-vacuous check, confirmed by reading the test), but that only proves the tree item is wired to invoke the right command ID — it says nothing about what that command's registered handler actually does once invoked, which is the specific risk the brief's Handoff note called out as adversarial-review-worthy ("not just that tree items render with plausible-looking labels/commands"). | `packages/extension/src/activation/activate.ts:498-514`; `packages/extension/src/activation/activate.test.ts:167-174`; grep confirms no test file calls `loadRun` from a path that originates in `registerReopenRunCommand`'s callback. | Extract the `registerReopenRunCommand` callback body into a directly-testable function (mirroring the existing `runComparisonCommand` extraction pattern this same file already uses), or capture-and-invoke the registered callback in a test via a `registerCommand` mock that records callbacks by ID (the codebase already has this exact pattern available — `activate.test.ts`'s own `registerCommandSpy` could be extended to invoke `.mock.calls`). Add an assertion that `loadRun` was called with the clicked run's `id` and that `showResultsWebview` receives that call's resolved `ComparisonResult`, plus a case confirming a `loadRun` failure produces `showErrorMessage` rather than an unhandled rejection. This is the literal brief-required green-state test; its absence is not a stylistic gap. |

The implementation itself is correct on inspection — `loadRun(id, safeOutputRoot)`
is called and its result is passed to `showResultsWebview` exactly as the
brief specifies, and a `loadRun` rejection is caught and surfaced via
`showErrorMessage` rather than propagating uncaught. This finding is about
the **missing test**, not a behavioral defect found by manual/adversarial
inspection — but per the brief's own Handoff note, this exact gap
("clicking a listed ... recent-run item genuinely invokes the correct
command and loads the correct result — not just that tree items render
with plausible-looking labels/commands") was flagged as something the
reviewer must specifically confirm, and independent confirmation surfaced
that the required confirmation itself is missing from the test suite.
`IMPLEMENTATION-REPORT.md`'s "Behavior delivered" section states this
chain as accomplished fact without disclosing that it is exercised only
by manual reasoning, not by an automated test — this is the kind of
undisclosed gap the review process exists to catch.

### Minor

| ID | Finding | Evidence | Suggested resolution |
| --- | --- | --- | --- |
| T-33-02 | `persistRun` failures and "no workspace open" always surface via `showErrorMessage` on every run when no workspace is open, which — as the implementer's own report discloses — could become repetitive for a user running many comparisons without a workspace folder open. Disclosed candidly in `IMPLEMENTATION-REPORT.md`'s Risks section; the brief explicitly left this as the implementer's call ("silently skip, or your call — document whichever"). No action required; noted for a future UX pass if it proves annoying in practice. | `packages/extension/src/activation/activate.ts:309-329`; `IMPLEMENTATION-REPORT.md` Risks section. | Optional future refinement (e.g., debounce/one-time notice) — not blocking. |
| T-33-03 | `ParityComparisonTreeItem`'s label uses `uri.path.split("/").pop()` rather than a VS Code-native basename helper (e.g. `vscode.workspace.asRelativePath`). Functionally correct given `vscode.Uri.path` is always forward-slash-normalized (including on Windows), and the codebase's established no-`@vscode/test-electron` testing constraint makes a richer native helper harder to mock. Disclosed candidly in the implementation report. | `packages/extension/src/views/parityTreeDataProvider.ts:67`. | No action required. |

## Disposition of prior findings

No prior findings were open against this task at start (T-33 is a new
task; T-31/T-32's findings were already closed per `PROGRESS-LEDGER.md`
and are out of this task's scope). No re-verification of prior findings
was required.

## Verification performed

### Fresh full verification (independently re-run, not trusted from the report)

```
npm run verify
```

Result: **exit 0**. `tsc -b --force` clean, `eslint .` clean,
`vitest run` → **462 passed, 27 skipped (30 files, 28 run)**. This
matches `IMPLEMENTATION-REPORT.md`'s claimed numbers exactly (462
passed / 27 skipped). The 27 skips are the pre-existing SQL
Server/PostgreSQL live-container integration tests, unrelated to this
task, consistent with every prior task's ledger entries.

### Scope / ownership check

- Diffed file list against `TASK-BRIEF.md`'s "Files owned": all
  non-test changes are confined to `parityTreeDataProvider.ts`,
  `activate.ts`. `parityStatusBar.ts` — confirmed zero diff via
  `git diff main...HEAD -- packages/extension/src/statusbar/parityStatusBar.ts`
  (no output). Test-file companions
  (`parityTreeDataProvider.test.ts`, `activate.test.ts`,
  `runComparisonCommand.test.ts`) are the expected, minimal-required
  companions for the owned production files and are not themselves
  prohibited.
- Confirmed via `git diff --stat` that `packages/engine`,
  `packages/extension/src/connections`,
  `packages/extension/src/authoring`,
  `packages/extension/src/runHistory`, and
  `packages/extension/package.json` are all **untouched** (empty diff
  output for each path).
- `runComparisonCommand.test.ts` is T-22-owned per prior ledger
  entries, not in T-33's "Files owned" list — it was extended, not
  newly created, to add T-33's persist/status-bar test coverage. This
  matches the same pattern the report itself discloses and is a
  minimal, mechanically-forced consequence of the brief's own Scope
  item 5 requiring green-state evidence for `runComparisonCommand`'s
  amendment — acceptable, not a scope violation.

### Adversarial confirmation #1 — tree item click behavior (per brief Handoff item 1)

Read `parityTreeDataProvider.test.ts` directly (not summarized).
Confirmed the following are real, non-vacuous assertions, not just
"renders with a plausible label":

- `"each comparison node's command invokes paritylens.runComparison with
  the file's URI as an argument"` — asserts
  `node.command.command === "paritylens.runComparison"` and
  `node.command.arguments === [uri]`. Genuine.
- `"each recent-run node's command invokes the reopen-run command with
  the run's id as the sole argument"` — asserts
  `first.command.command === "paritylens.reopenRun"` and
  `first.command.arguments === ["run-b"]` (the correct, most-recent
  run's id, not just any id). Genuine.

However, as detailed in Finding T-33-01 above, this only proves the
**tree item's declared command binding** is correct — it does not prove
the **registered command handler**, once actually invoked by VS Code,
performs `loadRun` → `showResultsWebview` correctly, because no test
invokes that handler. Manual inspection of `registerReopenRunCommand`
(lines 498–514) shows the implementation is correct: `loadRun(id,
safeOutputRoot)` is called and awaited, its resolved value is passed to
`showResultsWebview`, and a rejection is caught into `showErrorMessage`
rather than left unhandled. This is a **missing-test** finding, not a
behavioral defect — see Finding T-33-01 for the distinction and required
fix.

For the "Comparisons" section, the brief explicitly permits the current
behavior (click invokes `paritylens.runComparison` with the file URI as
an argument the command does not yet consume, falling back to the
existing open-dialog picker) — confirmed this matches the brief's exact
words: "if `runComparisonCommand`'s existing file-picking flow does not
accept a pre-selected URI as an argument, it is acceptable for the click
to just invoke the command." `runComparisonCommand`'s own picking logic
(lines ~365-380 of `activate.ts`, the `registerRunComparisonCommand`
wrapper) was confirmed unchanged (see diff below) and does not consume
the new tree-item argument — exactly the explicitly-permitted fallback,
not an oversight.

### Adversarial confirmation #2 — `activate.ts` amendment narrowness (per brief Handoff item 2)

Ran `git diff main...task/T-33-tree-status-bar-wiring -- packages/extension/src/activation/activate.ts`
directly and read the full diff (not a summary). Confirmed:

- `parseDefinition`, `findProfileByName`/`buildConnectorRegistry`
  resolution logic, and `buildRunNotice`/`showInformationMessage` calls
  inside `runComparisonCommand` are **byte-for-byte unchanged**.
- The **only** insertion inside `runComparisonCommand`'s try block is the
  new persist/status-bar block (lines 309–334), placed after
  `runComparison(...)` resolves and before `showResultsWebview(...)` is
  called — matching the brief's Scope item 5 exactly.
- This new block has its **own** `try`/`catch` around `persistRun`
  specifically (line 320–325) — a `persistRun` throw is caught locally
  and reported via a distinct `showErrorMessage` call
  (`"could not save this run to history — ..."`), and does **not**
  re-throw into the outer `catch` block (line ~336+) that reports
  parse/connection failures as `undefined`. Confirmed by reading the
  full function body: the outer `catch` is unreachable from the new
  block under any `persistRun` failure mode, since every throw inside
  the new block is caught before the function continues to
  `showResultsWebview` and `return result`.
- `showResultsWebview(...)` is called unconditionally after the new
  block, regardless of whether `persistRun` succeeded, failed, or was
  skipped (`resolveRunHistoryRoot` undefined) — confirmed by the absence
  of any `return`/`throw` inside the new block's branches.
- The outer function signature gained exactly two new **typed-optional**
  `deps` fields (`resolveRunHistoryRoot`, `statusBarItem`), following the
  existing `connectionProfileStore`/`secretStore` optional pattern — the
  pre-existing `runComparisonCommand.test.ts` suite (T-22's, unmodified
  except for the new `describe` block appended) passes unchanged without
  supplying either new field, confirming no existing caller is forced to
  change behavior.
- `registerRunComparisonCommand`'s signature gained one new required
  parameter (`statusBarItem`), and its one call site in `activate()` was
  updated to pass it — the only other change to that function's body is
  passing `resolveRunHistoryRoot`/`statusBarItem` through into the `deps`
  object it builds; its own file-picker/`defaultUri` logic (lines
  ~369–380) is unchanged.
- Two new standalone functions were added (`resolveRunHistoryRoot`,
  `registerReopenRunCommand`) and `activate()` gained the status-bar
  construction/disposal wiring and `ParityTreeDataProvider`'s real deps
  — all additive, matching Scope item 6.

**Conclusion: the amendment is genuinely narrow.** No existing
fixture-fallback, error-handling, or connector-resolution behavior for
the run itself changed. This confirms the implementation report's claim
on this specific point.

### Adversarial probe — reopened-run path safety

`registerReopenRunCommand` passes the tree item's `run.id` directly to
`loadRun(id, safeOutputRoot)`. `loadRun` (T-31, unmodified,
`runHistory.ts:139`) routes the `id` through `resolveRecordPath`, which
was independently adversarially tested during T-31's own review
(sibling-directory-prefix bypass, backslash traversal, dotted-traversal
variants — per `PROGRESS-LEDGER.md`'s T-31 entry) and confirmed to reject
all of them. T-33 does not re-derive or duplicate this containment logic
— it reuses `loadRun` as-is, which is the correct posture (the brief's
own Interfaces Consumed section marks `loadRun` "read-only," and T-33
does not modify `runHistory/**`). No new path-traversal surface was
introduced by this task.

### Red-state claims spot-check

The report's `git stash push -- <file> && vitest run <test>` red-state
methodology is a legitimate, reproducible technique (temporarily removing
the implementation file and re-running its own test suite against the
prior version). I did not reproduce these exact stash/pop cycles (not
required per the dispatch instructions), but independently confirmed the
new tests are **not vacuous** by reading them directly:

- `runComparisonCommand.test.ts`'s new `describe` block uses real
  temp directories (`mkdtempSync`/`rmSync`), calls the real `persistRun`/
  `listRecentRuns` from `runHistory.ts` (not mocked), and asserts
  `listRecentRuns` actually returns the persisted run afterward — this
  genuinely exercises real filesystem I/O end-to-end, not a mock
  assertion of "was called."
- The status-bar test asserts `statusBarItem.text ===
  formatParitySummary(result!.summary)` using the real
  `formatParitySummary` function (imported, not mocked) — a genuine
  behavioral check, not a call-count check alone.
- The `parityTreeDataProvider.test.ts` command/argument assertions
  (detailed above) are genuine value assertions on `command.command`/
  `command.arguments`, not existence checks.

## Final approval status (original round)

**CHANGES REQUIRED**

One Important finding (T-33-01) blocks approval: the brief's own
Green-state Verification section requires a test proving that clicking a
"Recent Runs" item invokes `loadRun` for the correct id and passes the
result to `showResultsWebview`, and this specific test does not exist —
only the tree item's command binding is tested, and only the command's
*registration* (not its *invocation*) is tested. The underlying
implementation is correct on manual inspection (confirmed above), so this
is a required-test-coverage gap rather than a functional defect, but per
`AGENTS.md` ("A task must not be marked complete while Critical or
Important findings remain open") and the brief's own explicit Handoff
instruction to adversarially confirm exactly this behavior, it must be
resolved — by extracting the reopen-run handler into a directly testable
function (matching this file's own `runComparisonCommand` precedent) and
adding the missing assertions — before this task can be marked
COMPLETE/APPROVED.

No residual test/scratch files were created during this review beyond
this report; `git status` confirms a clean working tree aside from
`REVIEW-REPORT.md` itself.

---

## Re-review (T-33-01 fix verification)

This re-review was performed independently from the prior review round —
same governing constraint (a separate agent instance from the T-33
implementer, no memory of having written any code under review), evaluating
only the actual diff and freshly re-run evidence, not the implementer's own
characterization of the fix in `IMPLEMENTATION-REPORT.md`'s "T-33-01 fix"
section.

### What was reviewed

Commits `2c8a14e` ("T-33-01 fix: extract reopenRunCommand for direct test
coverage") and `1fa9ea1` ("T-33-01 fix: record actual commit hash in
IMPLEMENTATION-REPORT.md"), applied on top of the already-reviewed
`107e060`, on the same branch `task/T-33-tree-status-bar-wiring`.

```
git diff 107e060 1fa9ea1 --stat -- . ':!IMPLEMENTATION-REPORT.md'
 packages/extension/src/activation/activate.test.ts | 86 +++++++++++++++++++-
 packages/extension/src/activation/activate.ts      | 91 +++++++++++++++++-----
 2 files changed, 158 insertions(+), 19 deletions(-)
```

Both files are within T-33's declared "Files owned"
(`packages/extension/src/activation/activate.ts` and its companion test
file). `git diff 84e9ee2 1fa9ea1 --name-only` (full branch diff against
`main`) confirms the complete file set touched by the whole task, fix
included, is still exactly: `IMPLEMENTATION-REPORT.md`, `PROGRESS-LEDGER.md`,
`TASK-BRIEF.md`, `activate.test.ts`, `activate.ts`,
`runComparisonCommand.test.ts`, `parityTreeDataProvider.test.ts`,
`parityTreeDataProvider.ts` — no new files, no scope expansion beyond what
the original review already validated.

### T-33-01 disposition — re-verified, not trusted

Read `activate.ts`'s actual diff for `2c8a14e` directly (not the report's
summary of it). Confirmed:

- A new exported function `reopenRunCommand(id, safeOutputRoot, deps)` now
  contains exactly the logic that previously lived inline inside
  `registerReopenRunCommand`'s `vscode.commands.registerCommand` callback:
  the same `safeOutputRoot === undefined` early-return with
  `showErrorMessage`, and the same `try { loadRun → showResultsWebview }
  catch { showErrorMessage }` shape — byte-for-byte the same control flow,
  only moved out of the closure and parameterized via an injected `deps`
  object (`loadRun`, `createWebviewPanel`, `viewColumn`, `showErrorMessage`,
  `showResultsWebview`).
- `registerReopenRunCommand` is now a thin wrapper: it resolves
  `safeOutputRoot` from the live `vscode.workspace.workspaceFolders` (same
  as before) and delegates to `reopenRunCommand`, binding the live `vscode`
  API into `deps` — this is the identical registration-vs-logic split
  `runComparisonCommand`/`registerRunComparisonCommand` already established
  earlier in the same file, so this is a consistent, not novel, pattern for
  this codebase. No externally observable behavior of the registered
  command changed.
- Read the four new tests in `activate.test.ts` (`describe("reopenRunCommand
  (T-33-01: recent-run click behavior)")`) directly, not summarized.
  Confirmed each is a genuine, non-vacuous assertion that actually invokes
  `reopenRunCommand`, not merely a registration/existence check:
  1. `"invokes loadRun with the clicked run's id and the resolved
     safeOutputRoot"` — calls `reopenRunCommand("run-b",
     "/workspace/.paritylens/runs", deps)` and asserts
     `deps.loadRun` was called `toHaveBeenCalledWith("run-b",
     "/workspace/.paritylens/runs")` — a real value assertion on both
     arguments, not `toHaveBeenCalled()` alone.
  2. `"passes loadRun's resolved ComparisonResult to
     showResultsWebview"` — asserts `deps.showResultsWebview` was called
     `toHaveBeenCalledWith(deps.createWebviewPanel, deps.viewColumn,
     SAMPLE_RESULT)`, i.e. the exact resolved object identity, plus
     `showErrorMessage` was *not* called. This is precisely the chain
     T-33-01 found missing.
  3. `"catches a loadRun rejection and surfaces it via showErrorMessage
     instead of propagating as an unhandled rejection"` — rejects
     `deps.loadRun`'s promise with `new Error("record not found")`,
     asserts the returned promise from `reopenRunCommand` still resolves
     (`resolves.toBeUndefined()`, i.e. no unhandled rejection escapes),
     asserts `showErrorMessage` was called with the exact interpolated
     message `'ParityLens: could not reopen run "run-missing" — record not
     found'`, and asserts `showResultsWebview` was *not* called. Genuine
     adversarial-path coverage, not just a happy-path check.
  4. `"surfaces a clear error via showErrorMessage, without calling
     loadRun, when no workspace folder is open"` — calls
     `reopenRunCommand("run-b", undefined, deps)` and asserts `loadRun` was
     **not** called (`not.toHaveBeenCalled()`) alongside the correct error
     message — this is the one case a lazier test could have gotten away
     with skipping (asserting only the message, not that `loadRun` was
     skipped); it doesn't skip it.

  I independently ran just this test file in isolation to confirm these
  pass for real, not only as part of the full suite:

  ```
  npx vitest run packages/extension/src/activation/activate.test.ts
  ```

  Result: `activate.test.ts (12 tests) ... Test Files 1 passed (1) / Tests
  12 passed (12)` — the pre-existing 8 tests plus the 4 new ones, all
  green.

- Confirmed the report's red-state claim is plausible and consistent with
  the fix's shape (a `git stash` of `activate.ts` would leave
  `reopenRunCommand` undefined, producing exactly the "not a function" /
  unhandled-rejection failure mode the report describes) — did not
  reproduce the stash/pop cycle myself since the live green-state run above
  already independently confirms the same four tests are real and passing
  against the actual (non-stashed) fix; a fabricated red-state log paired
  with a genuinely non-vacuous, independently-reproduced green state would
  not change the approval outcome here.

**T-33-01 is confirmed resolved.** The specific gap identified in the
original review — a brief-required test proving `loadRun` is invoked with
the correct `id` and its result passed to `showResultsWebview` — now
exists as four concrete, independently-reproduced, non-vacuous assertions
directly exercising the code path in question, with no change to the
registered command's externally observable behavior.

### Scope check on the fix itself

- No file outside `activate.ts`/`activate.test.ts` (plus
  `IMPLEMENTATION-REPORT.md`) was touched by the fix commits — confirmed by
  `git diff 107e060 1fa9ea1 --stat` above.
- No change to `runComparisonCommand`, `registerRunComparisonCommand`, the
  tree data provider, or the status bar module as part of this fix —
  confirmed by the diff being scoped entirely to the `reopenRunCommand`
  extraction and its new test block; the rest of `activate.ts` is
  unchanged by these two commits (the diff hunk context above begins
  immediately after `registerNewComparisonCommand`, which is untouched).
- No new files were created and no residual scratch/test artifacts are
  present from this fix.

### Fresh full verification (independently re-run)

```
npm run verify
```

Result: **exit 0**. `tsc -b --force` clean, `eslint .` clean, `vitest run`
→ **466 passed, 27 skipped (28 files run, 2 skipped, 30 total)**. This
matches `IMPLEMENTATION-REPORT.md`'s claimed post-fix numbers exactly (466
passed / 27 skipped, up from the pre-fix baseline of 462/27 — a net +4,
exactly the four new `reopenRunCommand` tests, no other test count
changed and no regressions). The 27 skips remain the pre-existing SQL
Server/PostgreSQL live-container integration tests, unrelated to this
task, consistent with every prior task's ledger entries.

### Disposition of prior findings

- **T-33-01 (Important):** **RESOLVED**, confirmed by independent
  re-verification above (diff inspection + isolated test run + full
  `npm run verify`), not accepted on the implementer's report alone.
- **T-33-02, T-33-03 (Minor):** Unchanged from the original review — both
  were already dispositioned "no action required" in the original round
  and this fix did not touch the files they concern
  (`activate.ts`'s persist-failure-messaging path and
  `parityTreeDataProvider.ts`'s label-formatting, respectively). Re-read
  both to confirm the fix commits left them untouched — confirmed (neither
  file's relevant lines appear in the `2c8a14e`/`1fa9ea1` diffs).

### New findings from this re-review

None. No new Critical, Important, or Minor issues were introduced by the
fix.

## Final approval status (after T-33-01 fix)

**APPROVED**

The sole blocking finding from the original review round (T-33-01) is
confirmed resolved by independent re-verification: the extracted
`reopenRunCommand` function is exercised by four genuine, non-vacuous
tests covering the success path (`loadRun` called with the correct
arguments, result passed to `showResultsWebview`), the rejection path
(caught into `showErrorMessage`, not left unhandled), and the
no-workspace path (`loadRun` never called), and `registerReopenRunCommand`
itself is unchanged in externally observable behavior. `npm run verify`
independently re-run shows exit 0 with 466 passed / 27 skipped, matching
the implementation report's claim exactly, with no regressions. Scope
remained fully within T-33's declared file ownership across both the
original implementation and this fix. 0 Critical, 0 Important, 2 Minor
(both previously accepted, no action required) findings stand as the
final disposition for this task.

No residual test/scratch files were created during this re-review beyond
edits to this report; `git status` confirms no other working-tree changes.
