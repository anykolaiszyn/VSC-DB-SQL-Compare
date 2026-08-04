# ParityLens — Review Report T-44

## Review independence

This review was performed by an independent reviewer instance with no
memory of writing this code. All claims in `IMPLEMENTATION-REPORT.md` were
re-derived from the actual diff, the live source of the modified files, and
a fresh `npm run verify` run, not accepted on the implementer's word. No
implementation-owned file was edited by this review.

## Review scope

- **Task objective:** Replace `runComparisonCommand`'s passive
  `MIXED_CONNECTION_NOTICE`/`FIXTURE_ONLY_NOTICE` toast with a blocking
  confirmation gate requiring explicit acknowledgment before `runComparison`
  executes, whenever the run is (at least partly) falling back to fixture
  data (self-service gap-analysis Finding 9).
- **Files and interfaces reviewed:**
  `packages/extension/src/activation/activate.ts` (`RunComparisonCommandDeps`
  extension, the `buildRunNotice` call-site branch, `createConfirmFixtureFallback`,
  `registerRunComparisonCommand` wiring), `activate.test.ts` (new T-44
  describe block, `vi.mock("vscode", ...)` `showWarningMessage` addition),
  `runComparisonCommand.test.ts` (the one rewritten pre-existing test),
  `TASK-BRIEF.md`, `IMPLEMENTATION-REPORT.md`, `PROGRESS-LEDGER.md` (Phase 6
  context, no prior open finding targeted at T-44 to re-verify).
- **Evidence reviewed:** `git diff main..task/T-44-fixture-fallback-confirmation`
  (full, all 4 changed files), full read of the modified sections of
  `activate.ts` (lines 150-554, 640-745), full read of the new
  `activate.test.ts` T-44 suite and the `runComparisonCommand.test.ts` diff,
  fresh `npm run verify` on the task branch, fresh `npm run test` on `main`
  for baseline comparison, `git log`/`git status` for scope and residue
  checks.

## Critical findings

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| NONE | — | — | — |

## Important findings

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| NONE | — | — | — |

## Minor findings

| ID | Finding | Evidence | Suggested resolution |
| --- | --- | --- | --- |
| NONE | — | — | — |

No Minor findings either. The one file-list deviation (see Prior-finding-
style disclosure discussion below) was judged a necessary, correctly
disclosed, minimal consequence of the required behavior change rather than
an issue requiring a tracked row.

## Verification performed

| Check | Exact command or inspection | Result |
| --- | --- | --- |
| Fresh full verify, task branch | `npm run verify` (typecheck, lint, test) | PASS, exit 0. `tsc -b --force` clean, `eslint .` clean, vitest: 36 test files passed / 2 skipped (38); **667 tests passed / 27 skipped (694)** — matches the implementer's reported count exactly |
| Fresh baseline, `main` | `git checkout main && npm run test` | PASS. 659 tests passed / 27 skipped (686) — confirms the claimed 659→667 (+8) delta independently, not just arithmetic taken on trust |
| `buildRunNotice` binary-claim trace | Direct read of `activate.ts:160-180` | Confirmed: `FIXTURE_ONLY_NOTICE`/`MIXED_CONNECTION_NOTICE` are the only two string constants; `buildRunNotice`'s body is exactly `sourceProfile !== undefined \|\| targetProfile !== undefined ? MIXED_CONNECTION_NOTICE : FIXTURE_ONLY_NOTICE` — a two-armed ternary with no third branch. There is no code path today where this function returns anything else. The implementer's claim is accurate, not just plausible. |
| Call-order / composition trace | Direct read of `activate.ts:456-513` | Confirmed order: `sourceProfile`/`targetProfile` resolved (456-463) → `buildRunNotice` called unconditionally (475) → `isFixtureFallback` check (476) → `confirmFixtureFallback` gate, `return undefined` on decline (477-485) → registry build (490-498) → `planQueries` (507) → `confirmRun` gate, `return undefined` on decline (508-513) → `runComparison` (515). Both gates are structurally independent `if`-blocks with their own early `return undefined`; neither can suppress or short-circuit the other's evaluation. |
| Adversarial decline-path trace | Static trace, not mock-count trust | Confirmed at the source level (not inferred from spy call counts) that declining `confirmFixtureFallback` returns from the function at line 484, strictly before `buildConnectorRegistry`/`buildFixtureRegistry` (490), `planQueries` (507), and `runComparison` (515) are even reached — there is no path for any connector-touching call to execute after that early return. Declining `confirmRun` similarly returns at line 512, before `runComparison` (515). |
| Backward-compatible default | `activate.ts:479`, `runComparisonCommand.test.ts` diff | `deps.confirmFixtureFallback !== undefined ? await deps.confirmFixtureFallback(runNotice) : true` — identical default-when-absent pattern to `confirmRun`'s existing `deps.confirmRun !== undefined ? ... : true` one line below. `runComparisonCommand.test.ts`'s `createDeps()` never supplies `confirmFixtureFallback`; all 8 tests in that file pass, including the rewritten one, confirming every pre-existing caller not extended by this task still proceeds. |
| Scope / file-ownership check | `git diff --name-only main..task/T-44-fixture-fallback-confirmation`, `git diff --stat` per file | 4 files changed: `activate.ts`, `activate.test.ts` (both explicitly owned), `runComparisonCommand.test.ts` (not in the literal "Files owned" list, but disclosed), `IMPLEMENTATION-REPORT.md` (handoff artifact, expected). No other file touched. `buildRunNotice`, `FIXTURE_ONLY_NOTICE`, `MIXED_CONNECTION_NOTICE`, `confirmRun`/`createWebviewConfirmRun`, `buildConnectorRegistry`/`buildFixtureRegistry`/`findProfileByName` all confirmed unmodified (Prohibited Changes items all satisfied). |
| Deviation-file diff review | `git diff main..task/T-44-fixture-fallback-confirmation -- .../runComparisonCommand.test.ts` | Exactly one hunk: the pre-existing test `"discloses the fixture-only limitation to the user on every run"` (asserted `showInformationMessage` called with a string containing "fixture" on every run) renamed and rewritten to assert `result` is defined and `showInformationMessage` is **not** called — this is the correct, updated behavior post-T-44 (the toast is genuinely replaced, not removed without replacement — disclosure now flows through `confirmFixtureFallback`'s `notice` argument, proven separately by `activate.test.ts`'s own suite). Not a weakened check: it asserts a specific new true fact (result reached, toast absent), not merely "doesn't throw." |
| No test residue | `git status --porcelain` (post-review) | Clean — no throwaway probe files left behind. |

## Disposition of the file-list deviation (Handoff item 5)

The brief's "Files owned" section lists `activate.ts` and "`activate.test.ts` /
the relevant `runComparisonCommand.test.ts` (whichever file actually holds
`runComparisonCommand`'s own tests — check both, extend the correct one)" —
this phrasing already anticipates the implementer may need to touch
`runComparisonCommand.test.ts`. The one edit made there is a minimal,
mechanically-forced, honestly-disclosed consequence of Scope item 2 as
literally written ("call the new injected confirmation dependency instead
of ... the passive `showInformationMessage`"): once the toast genuinely
stops firing for a fixture-fallback notice, the one pre-existing test
asserting the old toast-every-run behavior necessarily breaks, and rewriting
it in place (rather than deleting it) to assert the correct new behavior is
the right minimal fix, not scope expansion. Verdict: **acceptable,
non-blocking**, correctly disclosed rather than folded in silently.

## Prior-finding disposition

| Finding ID | Disposition | Evidence of resolution |
| --- | --- | --- |
| Finding 9 (self-service gap analysis, silent fixture-fallback ambiguity) | RESOLVED | `activate.ts`'s `runComparisonCommand` now blocks on an explicit `vscode.window.showWarningMessage(notice, "Continue", "Cancel")`-backed confirmation before `runComparison` for both fixture-fallback notice variants; declining aborts cleanly before any connector call is reached (traced above). No prior T-44-specific review-round finding existed to re-verify (this is T-44's first review round). |

## Approval status

- **Status:** APPROVED
- **Reviewer:** Claude Code Independent Reviewer subagent (Sonnet 5)
- **Date:** 2026-08-04
- **Release or dependency impact:** Closes T-44, the final task of Phase 6
  (self-service gap follow-ups, T-40–T-44). All 5 Phase 6 tasks are now
  implemented and independently reviewed. No further code changes required
  before this branch is merged.
