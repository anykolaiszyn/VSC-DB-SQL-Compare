# ParityLens — Implementation Report T-44

## Status and objective

- **Status:** COMPLETE (implementation and evidence only — not reviewed or approved)
- **Objective:** Replace `runComparisonCommand`'s passive `MIXED_CONNECTION_NOTICE`/
  `FIXTURE_ONLY_NOTICE` toast with a blocking confirmation requiring explicit
  acknowledgment before `runComparison` executes, whenever at least one side
  of the run is falling back to fixture data (Finding 9, silent
  fixture-fallback ambiguity).

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/extension/src/activation/activate.ts` | Added optional `confirmFixtureFallback?: (notice: string) => Promise<boolean>` to `RunComparisonCommandDeps`; changed the `buildRunNotice` call site to branch on whether the returned notice is `MIXED_CONNECTION_NOTICE`/`FIXTURE_ONLY_NOTICE` — if so, block on `confirmFixtureFallback` (default "proceed" when absent) instead of the passive toast, aborting cleanly (no error, `runComparison` never called) if declined; otherwise (no code path exists for this today — see Assumptions) fall through to the pre-existing `showInformationMessage` call. Added `createConfirmFixtureFallback()`, a real `vscode.window.showWarningMessage(notice, "Continue", "Cancel")`-backed implementation, and wired it into `registerRunComparisonCommand`'s deps. | TASK-BRIEF.md Scope items 1–5 |
| `packages/extension/src/activation/activate.test.ts` | Added a new `describe("runComparisonCommand (T-44 fixture-fallback confirmation)")` suite (8 tests) covering: blocking + no-`runComparison`-call on decline for both fixture-only and mixed cases; proceeding on confirm; the backward-compatible absent-dependency default; three composition tests with T-38's `confirmRun`; and a test documenting that both fixture-fallback variants positively trigger the gate (per Scope item 3's own allowance, since no all-real-profile case exists in `buildRunNotice` today to construct a negative test against). Also added a `showWarningMessage` mock to the file's `vi.mock("vscode", ...)` factory so the pre-existing T-39 end-to-end `registerRunComparisonCommand` suite (which invokes the real command callback, now wiring the real `createConfirmFixtureFallback`) keeps reaching its existing assertions. | TASK-BRIEF.md Red/Green-state evidence requirements |
| `packages/extension/src/activation/runComparisonCommand.test.ts` | Updated one pre-existing test, `"discloses the fixture-only limitation to the user on every run"`, which asserted the now-superseded passive-toast behavior for the fixture-only case. Renamed and rewritten to assert the correct post-T-44 behavior (run still proceeds via the default-"proceed" gate; `showInformationMessage` is correctly never called for a fixture-fallback notice). See "Deviation from declared file list" below — this file is not in TASK-BRIEF.md's literal "Files owned" list. | Necessitated by Scope item 2 ("call the new injected confirmation dependency instead of ... the passive `showInformationMessage`") |

## Behavior and interfaces

- **Behavior delivered:** Every run where `buildRunNotice(sourceProfile, targetProfile)`
  would return `MIXED_CONNECTION_NOTICE` or `FIXTURE_ONLY_NOTICE` now blocks
  on a `vscode.window.showWarningMessage` "Continue"/"Cancel" dialog before
  `runComparison` is ever called. Declining aborts the run cleanly (matching
  the pre-existing `confirmRun`/`proceed` cancellation pattern — no error
  shown, `planQueries`/`runComparison` never invoked). This gate composes
  independently with T-38's `confirmRun` SQL-preview gate — both fire in
  sequence (fixture-fallback gate first, matching the order `buildRunNotice`'s
  call site already precedes `planQueries`/`confirmRun`'s call site in the
  function body) and declining either one aborts the run.
- **Interfaces consumed:** `buildRunNotice`, `sourceProfile`/`targetProfile`
  resolution via `findProfileByName` (both read-only, unmodified).
- **Interfaces produced:** `RunComparisonCommandDeps.confirmFixtureFallback?:
  (notice: string) => Promise<boolean>` — a new, optional, injected
  dependency, distinct from T-38's `confirmRun`. Defaults to "proceed" (`true`)
  when absent, matching `confirmRun`'s own established default-when-absent
  convention.

## Key finding verified against live code (per brief's explicit request)

TASK-BRIEF.md asked the implementer to verify two premises before assuming
them:

1. **Is `buildRunNotice` called unconditionally, or only under some
   condition?** Confirmed: `runComparisonCommand`'s body called
   `deps.showInformationMessage(buildRunNotice(sourceProfile, targetProfile))`
   unconditionally on every run (pre-change line 429) — there was no
   surrounding `if`. So this task's trigger is "did `buildRunNotice` *return*
   a fixture-fallback notice," not "was it called," exactly as the brief
   anticipated as the fallback interpretation.
2. **Does `buildRunNotice` ever represent an all-real-profile case?**
   Confirmed: no. Its body is a straight binary —
   `sourceProfile !== undefined || targetProfile !== undefined ?
   MIXED_CONNECTION_NOTICE : FIXTURE_ONLY_NOTICE` — with no third branch.
   Both of its two possible return values are fixture-fallback cases. There
   is no code path today where an all-real-profile run reaches this call
   site and gets a distinguishable "no fallback" notice from it. The
   `isFixtureFallback` check at the call site is written explicitly
   (`runNotice === MIXED_CONNECTION_NOTICE || runNotice ===
   FIXTURE_ONLY_NOTICE`) rather than assumed to always be true, so a future
   `buildRunNotice` extension with a genuine all-real branch is handled
   correctly without further changes to this task's logic — but as of this
   implementation, that branch is unreachable in practice. Per Scope item 3's
   own allowance ("if today's code has no such case representable, the test
   should instead confirm the fixture-only/mixed cases correctly trigger the
   blocking gate ... per the brief's own 'your call' allowance"), the Green-state
   evidence for item 3 is the "both the fixture-only and mixed cases
   correctly trigger the blocking gate" test in `activate.test.ts`, which
   documents this finding directly in its own name and header comment rather
   than asserting an unreachable negative case.

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline (pre-change) | `npm run verify` | PASS — exit 0. 36 test files passed / 2 skipped (38); 659 tests passed / 27 skipped (686) | captured in this session's transcript before any edit |
| Red state | `npx vitest run packages/extension/src/activation/activate.test.ts -t "T-44"` | FAIL as predicted — 7 of 8 new tests failed with `expected "spy" to be called 1 times, but got 0 times` (`confirmFixtureFallback` never invoked, since the dependency did not exist yet); 1 passed trivially (the backward-compatible-default test, which doesn't assert on the new spy) | captured in this session's transcript, immediately after adding the test suite and before touching `activate.ts` |
| Focused green state | `npx vitest run packages/extension/src/activation/` | PASS — exit 0. 3 files, 52 tests passed (13 `hasNoContent.test.ts` + 8 `runComparisonCommand.test.ts` + 31 `activate.test.ts`, including the 8 new T-44 tests) | captured in this session's transcript, after implementing `activate.ts` and fixing the two pre-existing-test conflicts (one self-authored assertion error in the new suite, one genuine pre-existing-test update in `runComparisonCommand.test.ts`) |
| Full verification | `npm run verify` | PASS — exit 0. `typecheck` (tsc -b --force) clean, `lint` (eslint .) clean, `test` (vitest run): 36 test files passed / 2 skipped (38); **667 tests passed / 27 skipped (694)** | captured in this session's transcript |

**Before/after test count:** 659 → 667 passed (net +8: 8 new T-44 tests in
`activate.test.ts`; the one test rewritten in `runComparisonCommand.test.ts`
is a 1-for-1 replacement, not a net addition — same test count in that file,
8 before and 8 after).

## Assumptions and risks

- **Assumption (documented inline in `activate.ts`):** Because `buildRunNotice`
  has no all-real-profile branch today, the `isFixtureFallback` check at the
  call site is currently always `true` in practice — every run reaches the
  blocking gate. This is not a bug in this implementation; it is a faithful
  reflection of `buildRunNotice`'s own current logic (which this task is
  explicitly prohibited from modifying). If a future task extends
  `buildRunNotice` with a genuine all-real branch, this task's `===` check
  already handles that correctly without further changes here.
- **Deviation from declared file list — flagged explicitly, not folded in
  silently:** TASK-BRIEF.md's "Files owned" list names `activate.ts` and
  "`activate.test.ts` / the relevant `runComparisonCommand.test.ts`
  (whichever file actually holds `runComparisonCommand`'s own tests — check
  both, extend the correct one)" — phrasing that authorizes touching
  whichever of the two test files actually holds the relevant assertions,
  not necessarily excluding `runComparisonCommand.test.ts`. Implementing
  Scope item 2 exactly as written ("call the new injected confirmation
  dependency instead of ... the passive `showInformationMessage`") made the
  passive toast never fire for a fixture-fallback notice, which broke one
  pre-existing test in `runComparisonCommand.test.ts`:
  `"discloses the fixture-only limitation to the user on every run"`
  (asserted `showInformationMessage` was called with a string containing
  "fixture" for every run, including the fixture-only case this task
  changes). This test was renamed and rewritten in place (not deleted) to
  assert the correct post-T-44 behavior — the run still proceeds
  identically, only the notice-delivery mechanism changed for this deps
  shape. This is the one edit in this task outside the literal two files
  named for `activate.ts` itself; flagging it here per the "call it out
  explicitly and separately" instruction rather than silently expanding
  scope. A reviewer may reasonably judge this belonged in a revised brief
  instead — the change is mechanically forced by Scope item 2 as written,
  and is minimal (rename + reassert), but it is still outside the literal
  file list.
- **Judgment call — "instead of" vs. "in addition to":** Scope item 2 gave
  the implementer discretion ("instead of (or in addition to — implementer's
  call, but avoid double-prompting)"). Chose "instead of" — the passive
  toast never fires when the blocking gate does — since showing both a toast
  and a blocking warning with overlapping text for the same disclosure is
  the double-prompting the brief explicitly warns against.
- **Risks or limitations:** None identified beyond the documented assumption
  above. The gate does not weaken or remove the fixture-fallback path itself
  (declining just cancels the run, matching T-38's own decline behavior) —
  Prohibited Changes item 4 is satisfied.
- **Blockers:** None.

## Patch or commit identity

- **Patch or commit:** to be recorded after `git commit` (see below).
- **Branch or workspace:** `task/T-44-fixture-fallback-confirmation`

## Recommended next step

Independent review by a reviewer who did not author this change, per
AGENTS.md's "every implementation task receives an independent review by a
reviewer who did not author the task's change." The reviewer should
specifically re-verify the five points TASK-BRIEF.md's Handoff section
names, including the flagged `runComparisonCommand.test.ts` deviation above —
whether that edit was the correct minimal necessary change or should instead
have prompted a revised brief before proceeding.
