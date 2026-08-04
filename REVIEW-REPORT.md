# ParityLens — Review Report T-51

## Review independence

This review was performed by a separate agent instance from the implementer,
with no memory of writing the code under review. All conclusions below are
derived from reading the actual diff on `task/T-51-batch-a-trivial-fixes`
(compared against `main`), running fresh verification commands myself, and
constructing an independent adversarial probe for item 4 rather than reusing
the implementer's own test. `IMPLEMENTATION-REPORT.md`'s claims were treated
as assertions to verify, not facts to accept.

## Review scope

- **Task objective:** Resolve four independent, low-risk, non-functional
  findings from `PROGRESS-LEDGER.md`'s Open findings table (T-26-03,
  T-12-01, T-36-01, T-39-01) in one batched task-loop cycle, per
  `TASK-BRIEF.md`.
- **Files and interfaces reviewed:**
  - `packages/extension/media/icon.svg` (T-26-03)
  - `packages/engine/src/comparison-core/mapping/mapping.test.ts` (T-12-01)
  - `packages/extension/src/authoring/comparisonEditorProvider.test.ts`
    (T-36-01)
  - `packages/extension/src/codelens/comparisonCodeLensProvider.ts` and
    `comparisonCodeLensProvider.test.ts` (T-39-01)
  - Confirmed untouched: `packages/engine/src/comparison-core/mapping/mapping.ts`,
    `packages/extension/src/authoring/comparisonEditorProvider.ts`
  - Confirmed the only files outside the five brief-owned paths that differ
    from `main` are `IMPLEMENTATION-REPORT.md` (implementer's own report)
    and `PROGRESS-LEDGER.md`/`TASK-BRIEF.md` — both traced via `git show`
    to the orchestrator's separate activation commit (`c4003f0`), not the
    implementer's commit (`6f87b3f`), consistent with "the orchestrator
    updates [the ledger] during reconciliation, not the implementer."
- **Evidence reviewed:** `TASK-BRIEF.md`, `IMPLEMENTATION-REPORT.md`, the
  full `git diff main..task/T-51-batch-a-trivial-fixes`, `PROGRESS-LEDGER.md`'s
  Open findings table entries for all four finding IDs, and a fresh full
  `npm run verify` run plus a standalone `vitest run` of the codelens test
  file with a self-authored adversarial probe (added, run, then removed;
  `git status` confirmed clean afterward).

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

No new findings. One pre-existing, out-of-scope observation is noted for
context only (not a T-51 finding, since T-51's brief explicitly prohibits
touching this test and it is unrelated to any of the four items): the
"internal validation bypass" test at
`comparisonEditorProvider.test.ts:215-251` has the same title/body mismatch
pattern as the T-36-01 test T-51 just fixed — its own inline comment
(lines 235-238) admits the constructed input "correctly fails required-field
validation and is rejected BEFORE ever reaching
buildComparisonYaml/parseDefinition," i.e. it also exercises the
required-field precheck, not the round-trip guard its title claims. This is
pre-existing (present on `main`, untouched by this branch) and out of
T-51's declared scope; flagging only so a future backlog sweep can consider
it, not as a T-51 blocker.

## Verification performed

| Check | Exact command or inspection | Result |
| --- | --- | --- |
| Item 1 diff scope | `git diff main..task/T-51-batch-a-trivial-fixes -- packages/extension/media/icon.svg` | Single-line change, comment text only (`fill="currentColor"` → `stroke="currentColor"`/`fill="none"`). All three shapes (lines 5-7, unchanged) genuinely use `stroke="currentColor" ... fill="none"` — comment now accurately matches actual rendering technique. No rendering-relevant attribute touched. |
| Item 2 diff scope | `git diff main..task/T-51-batch-a-trivial-fixes -- packages/engine/src/comparison-core/mapping/mapping.test.ts` | All three `if (match) {...}` wrappers removed; each replaced with unconditional `expect(match).toBeDefined();` followed by unconditional `expect(match?.strategy).not.toBe(...)` × 3. `toBeDefined()` throws first if `match` is `undefined`, so a future regression that stopped `suggestMappings` from producing a match for any of the three fixture pairs would fail loudly, not silently pass. Inline reasoning comments preserved verbatim. |
| Item 2 — mapping.ts untouched | `git diff main..task/T-51-batch-a-trivial-fixes -- packages/engine/src/comparison-core/mapping/mapping.ts \| wc -l` | `0` — confirmed untouched. |
| Item 3 diff scope | `git diff main..task/T-51-batch-a-trivial-fixes -- packages/extension/src/authoring/comparisonEditorProvider.test.ts` | Only the test title (line 313) and its immediately preceding inline comment changed; body/assertions (lines 328-337) are byte-identical to `main`. New title accurately describes what the body exercises: an empty `keys` array caught by `handleApplyMessage`'s required-field precheck, not the round-trip guard. |
| Item 3 — adjacent test untouched/distinct | Read `comparisonEditorProvider.test.ts:215-251` (the "internal validation bypass" test) and diffed against `main` | Byte-identical to `main` — untouched, as the brief prohibits. Still distinct from the renamed test: it constructs an object-shaped field value rather than an empty array. (See out-of-scope observation above re: its own title's accuracy — unaffected by this task and not a regression it introduces.) |
| Item 3 — comparisonEditorProvider.ts untouched | `git diff main..task/T-51-batch-a-trivial-fixes -- packages/extension/src/authoring/comparisonEditorProvider.ts \| wc -l` | `0` — confirmed untouched. |
| Item 4 diff scope | `git diff main..task/T-51-batch-a-trivial-fixes -- packages/extension/src/codelens/comparisonCodeLensProvider.ts` | New `try/catch` wraps exactly `listRecentRuns()`, `findMostRecentRunForComparison`, and `buildLensesForValidDocument(document.uri, lastRun)` — the pre-existing `parseDefinition` try/catch (lines 166-171) is untouched and separate. On catch: `console.error(...)` then `return buildLensesForValidDocument(document.uri, undefined)`. No retry logic, no new dependency. |
| Item 4 — implementer's own test | `npx vitest run packages/extension/src/codelens/comparisonCodeLensProvider.test.ts` | 12 tests, all pass. The new test (rejecting with `new Error(...)`) resolves with 4 lenses, "Open Last Result" routed to `NO_RUNS_YET_COMMAND_ID`. `console.error` output visible in stderr as expected. |
| Item 4 — independent adversarial probe | Authored a temporary test (not the implementer's): `listRecentRuns: () => Promise.reject("plain string rejection, not an Error instance")` — a non-`Error` rejection value, a case the implementer's own test did not cover. Ran via `npx vitest run packages/extension/src/codelens/comparisonCodeLensProvider.test.ts`, then removed the test and confirmed `git status --short` was empty. | Passed: `provideCodeLenses` resolved cleanly with all 4 lenses, correct titles, "Open Last Result" in its no-prior-run form (`NO_RUNS_YET_COMMAND_ID`). `console.error` logged the plain-string reason without crashing (the `catch (err)` binding logs whatever value was thrown/rejected, not just `Error` instances). Confirms the fix is robust to non-`Error` rejection shapes, not just the implementer's one scripted case. |
| Full fresh verify (post-change) | `npm run verify` | Exit 0. `tsc -b --force` and `eslint .` both completed with no errors. Test stage: **34 test files passed, 2 skipped (36); 624 tests passed, 27 skipped (651)** — matches the implementer's claimed post-change numbers exactly, and is exactly baseline (623/27, confirmed against the report's stated pre-change baseline) + 1 new test (the item-4 rejection test), with no regressions. |
| Scope/ownership check | `git diff main..task/T-51-batch-a-trivial-fixes --name-only`; `git show 6f87b3f --stat`; `git show c4003f0 --stat` | Implementer's commit (`6f87b3f`) touches exactly the five brief-owned files plus `IMPLEMENTATION-REPORT.md`. `PROGRESS-LEDGER.md`/`TASK-BRIEF.md` changes are isolated to the orchestrator's separate prior commit (`c4003f0`, task activation) — not implementer scope creep. |

## Prior-finding disposition

| Finding ID | Disposition | Evidence of resolution |
| --- | --- | --- |
| T-26-03 | RESOLVED | `icon.svg` header comment now reads `stroke="currentColor"`/`fill="none"`, matching the actual technique used by all three shapes (lines 5-7, unchanged). Verified by direct diff and reading the current file. |
| T-12-01 | RESOLVED | All three `if (match) {...}` guards in `mapping.test.ts` removed; assertions are now genuinely unconditional (preceded by an unconditional `expect(match).toBeDefined();`), so a future regression producing `match === undefined` would fail the test rather than silently skip the assertions. Verified by diff and re-running the test file green (12/12). |
| T-36-01 | RESOLVED | Test title at line 313 renamed to accurately describe the required-field precheck it actually exercises; body/assertions unchanged (byte-identical). The adjacent "internal validation bypass" test (~line 215) remains untouched and still tests a structurally distinct input (an object-shaped value vs. an empty array), matching the brief's requirement that it stay distinct. Note: that adjacent test's own title has a pre-existing, separate accuracy gap (documented above) — out of T-51's scope, not introduced by this task, and not a regression. |
| T-39-01 | RESOLVED | `provideCodeLenses` now wraps `listRecentRuns` and its two consumers in a dedicated `try/catch`, separate from the pre-existing `parseDefinition` catch, falling back to `buildLensesForValidDocument(document.uri, undefined)` and logging via `console.error` on rejection. Verified both via the implementer's own test and my own independently-constructed adversarial probe (non-`Error` rejection value) — in both cases `provideCodeLenses` resolved cleanly with all four lenses and the correct no-prior-run fallback for "Open Last Result." The method now genuinely fulfills its documented "never throws" contract. |

## Approval status

- **Status:** APPROVED
- **Reviewer:** Claude Code Independent Reviewer subagent (Sonnet 5)
- **Date:** 2026-08-03
- **Release or dependency impact:** None blocking. All four changes are
  either pure comment/title corrections or a narrowly-scoped defensive
  `try/catch` addition with no interface changes. No downstream task
  depends on anything that changed here beyond the four now-resolved
  findings. `PROGRESS-LEDGER.md`'s Open findings table entries for
  T-26-03, T-12-01, T-36-01, and T-39-01 can be marked resolved during
  reconciliation.
