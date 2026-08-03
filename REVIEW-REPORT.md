# ParityLens — Review Report T-49

## Review independence

This review was performed by a separate agent instance from whoever
implemented T-49. No claim in `IMPLEMENTATION-REPORT.md` was taken at face
value — every factual claim (diff scope, test counts, adversarial-case
behavior, error-propagation) was independently re-derived from the actual
diff, actual source, and fresh command output captured during this review.
No implementation-owned file was edited by this review.

## Review scope

- **Task objective:** Resolve finding T-38-01 — `planQueries`'s Layer-1
  `testConnection()` gate short-circuited to a bare `[]` both when a
  connection is genuinely unreachable and when a definition legitimately
  produces zero queries, making the two cases visually indistinguishable
  in the pre-execution confirmation panel. Fix: widen `planQueries`'s
  return type to `PlanQueriesResult { queries: string[]; connectionUnreachable: boolean }`,
  thread it through `activate.ts`'s `confirmRun` plumbing, and render a
  distinguishing notice in `renderRunConfirmationHtml` when
  `connectionUnreachable` is true.
- **Files and interfaces reviewed:**
  `packages/engine/src/orchestration/planner/planQueries.ts` (new
  `PlanQueriesResult` export, widened `planQueries` return shape),
  `packages/engine/src/orchestration/planner/planQueries.test.ts`,
  `packages/extension/src/activation/activate.ts` (`confirmRun` signature,
  `createWebviewConfirmRun`, `plannedQueries` call site),
  `packages/extension/src/activation/activate.test.ts`,
  `packages/extension/src/webview/runConfirmationWebview.ts`
  (`renderRunConfirmationHtml` new second parameter, new
  `CONNECTION_UNREACHABLE_NOTICE`), `packages/extension/src/webview/runConfirmationWebview.test.ts`.
  Confirmed zero diff on the two explicitly prohibited files:
  `packages/engine/src/orchestration/planner/planner.ts` and
  `packages/extension/src/webview/resultsWebview.ts`.
- **Evidence reviewed:** full diff of every changed file (`git diff
  main..task/T-49-planqueries-unreachable-disambiguation`), a fresh full
  `npm run verify` run, `PROGRESS-LEDGER.md`'s T-38-01 finding text and
  T-38/T-48 history entries, and three independently-authored adversarial
  probe tests (constructed and deleted by this review, not part of the
  implementer's own test suite) exercising the exact three behaviors the
  brief's Handoff section calls out.

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

The implementer's own disclosed limitation (`activate.test.ts` cannot
exercise `connectionUnreachable: true` end-to-end through
`runComparisonCommand` because its fixture-backed test harness has no way
to make a registered connector's `testConnection()` fail) is real and
accurately described — confirmed by reading `activate.test.ts`'s `createDeps`
helper and fixture-registry setup, which only ever registers real
`FixtureConnector` instances (always reachable). This is not scored as a
finding: the brief's own Handoff reviewer-note list does not ask for that
specific end-to-end case, and the property it would prove is already
covered at both boundaries — directly at `planQueries` (two new tests) and
at rendering (four new tests) — which is sufficient to establish the
plumbing is correct given `activate.ts`'s change at the call site is a
single, mechanically-forced pass-through (`deps.confirmRun(plannedQueries)`,
textually unchanged) verified below.

## Verification performed

| Check | Exact command or inspection | Result |
| --- | --- | --- |
| Diff scope | `git diff --stat main..task/T-49-planqueries-unreachable-disambiguation` | Exactly 6 owned source/test files + `TASK-BRIEF.md`/`IMPLEMENTATION-REPORT.md`. No file outside the declared ownership list. |
| Prohibited-file check | `git diff main..task/T-49-planqueries-unreachable-disambiguation -- packages/engine/src/orchestration/planner/planner.ts packages/extension/src/webview/resultsWebview.ts` | Empty output — zero diff on both, confirming the brief's Prohibited-changes constraint held. |
| `planQueries.ts` change shape | Full file read + diff | Only the two `return` statements changed shape (`return []` → `return { queries: [], connectionUnreachable: true }` at the Layer-1 gate; `return queriesUsed` → `return { queries: queriesUsed, connectionUnreachable: false }` at the normal-path return), plus the new `PlanQueriesResult` interface and doc comments. Every other line (imports, control flow, `getSchema`/`resolveSideInput` calls, error-propagation) byte-for-byte unchanged from `main`. |
| Adversarial case 1: legitimately-zero-queries, reachable connections | Independently authored throwaway test (`__t49_reviewer_probe.test.ts`, deleted after use): all four `checks.*.enabled: false`, both sides real reachable `FixtureConnector`s | `planQueries` returned `{ queries: [], connectionUnreachable: false }` — NOT the connectivity-failure branch. Confirms the core correctness property: a false positive here would be worse than the original ambiguity, and none occurred. |
| Adversarial case 1 (rendering) | `runConfirmationWebview.test.ts` line 87: `renderRunConfirmationHtml([], false)` | Renders `"ParityLens will issue 0 queries"` (the original empty-state notice), and asserts `.not.toContain("could not be reached")`. Independently re-read the source of `renderRunConfirmationHtml` (lines 196–201) and confirmed the ternary genuinely branches on the `connectionUnreachable` parameter, not on `queries.length`, so this is not a coincidental pass. |
| Adversarial case 2: genuinely unreachable connector | Independently authored throwaway test: same all-disabled definition, source connector's `testConnection()` overridden to return `{ success: false }` | `planQueries` returned `{ queries: [], connectionUnreachable: true }`. Also independently re-ran the implementer's own two `UnreachableConnector` tests in `planQueries.test.ts` (source-unreachable and target-unreachable) — both pass. |
| Adversarial case 2 (rendering) | `runConfirmationWebview.test.ts` line 67: `renderRunConfirmationHtml([], true)` | Renders the new `CONNECTION_UNREACHABLE_NOTICE` text (`"could not be reached"`) and does not render `"ParityLens will issue"`. Read `CONNECTION_UNREACHABLE_NOTICE`'s definition directly — a `const` string literal with no template interpolation, confirming it is genuinely static. |
| Error-propagation unchanged past Layer-1 gate | Independently authored throwaway test: definition with `checks.schema.enabled: true` against a non-existent source object (forces a genuine `getSchema` rejection past the gate) | `planQueries(...)` rejected (threw), not swallowed into `{ connectionUnreachable: true }`. Also confirmed the pre-existing `activate.test.ts` test `"surfaces a planQueries failure via showErrorMessage without ever calling confirmRun or runComparison"` (present verbatim in `main` before this task, `git show main:...activate.test.ts` confirms identical test name pre-existed) still passes unmodified in behavior — only its `vi.fn<...>` type annotation changed, not its assertions or its outcome. |
| Pure-function contract / escaping | Read full `runConfirmationWebview.ts`; ran `runConfirmationWebview.test.ts`'s purity test (`renderRunConfirmationHtml(queries, false)` called twice, `toEqual`) and XSS-escaping test (`<script>` payload) | Both pass. `CONNECTION_UNREACHABLE_NOTICE` is a plain string constant built from two string literals concatenated with `+` — no `${...}` interpolation anywhere in it, confirming the brief's "static, not dynamic, no `escapeHtml` needed" claim is accurate, not just asserted. |
| `activate.ts` call-site mechanics | Read `activate.ts` lines 383–384 and the diff | `const plannedQueries = await planQueries(...)` then `deps.confirmRun(plannedQueries)` — textually unchanged from before this task (only the *type* the variable now flows through changed, mechanically forced by `planQueries`'s widened return type, exactly as the brief predicted and the report claimed). |
| Full fresh verification | `npm run verify` (typecheck + lint + `vitest run`, this review's own terminal, working tree clean per `git status --porcelain` before and after) | PASS — 34 files passed, 2 skipped (pre-existing live-DB-container integration suites, unrelated to this task); **621 passed, 27 skipped, 648 total**. Matches `IMPLEMENTATION-REPORT.md`'s claimed counts exactly, and matches the claimed baseline delta (615→621 passed, same 27 skipped, 642→648 total). |
| Scope/ownership | Read `TASK-BRIEF.md`'s Files owned list against `git diff --stat` | All 6 changed source/test files fall within declared ownership. No unauthorized scope expansion. |

## Prior-finding disposition

| Finding ID | Disposition | Evidence of resolution |
| --- | --- | --- |
| T-38-01 | RESOLVED | `planQueries` now returns `connectionUnreachable: true` distinctly from a legitimately-empty query list (verified directly, not merely via the implementer's tests — see the two independently-authored adversarial probes above), and `renderRunConfirmationHtml` renders a distinct, non-alarmist notice for that case while preserving the original empty-state message for the legitimately-zero-queries case. The finding's own recorded framing ("no correctness or security impact... `runComparison`'s own Layer-1 check will still produce the authoritative failed-status result") is preserved unchanged — `planner.ts` has zero diff, confirmed above. |

## Approval status

- **Status:** APPROVED
- **Reviewer:** Claude Code Independent Reviewer subagent (Sonnet 5)
- **Date:** 2026-08-03
- **Release or dependency impact:** None outside this task's own scope.
  T-38-01 can now be marked RESOLVED in `PROGRESS-LEDGER.md`'s open
  findings table. No other open finding or in-flight task is affected by
  this change; `planner.ts`'s `runComparison` behavior is provably
  untouched (zero diff), so no downstream consumer of `runComparison`
  is affected.
