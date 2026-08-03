# ParityLens — Implementation Report T-49

## Status and objective

- **Status:** COMPLETE (implementation and evidence only — not reviewed or approved)
- **Objective:** Resolve finding T-38-01 (recorded in `PROGRESS-LEDGER.md`'s Open findings table, OPEN/accepted non-blocking): `planQueries`'s Layer-1 `testConnection()` gate short-circuited to a bare `[]` both when a connection is genuinely unreachable and when a definition legitimately produces zero queries, making the two cases visually indistinguishable in the pre-execution confirmation panel (`runConfirmationWebview.ts`). Per TASK-BRIEF.md's recorded candidate resolution, `planQueries` now surfaces the connectivity-failure signal it already computes, and the confirmation panel renders a distinguishing message when it's set.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/engine/src/orchestration/planner/planQueries.ts` | Added exported `PlanQueriesResult { queries: string[]; connectionUnreachable: boolean }`; widened `planQueries`'s return type from `Promise<string[]>` to `Promise<PlanQueriesResult>`; the Layer-1 gate now returns `{ queries: [], connectionUnreachable: true }`, the normal path returns `{ queries: queriesUsed, connectionUnreachable: false }`. No other control flow changed. | TASK-BRIEF.md Scope item 1 |
| `packages/engine/src/orchestration/planner/planQueries.test.ts` | Updated all existing assertions to the new `{ queries, connectionUnreachable }` shape; added a new `UnreachableConnector` test double and two new tests proving `connectionUnreachable: true` when either side's `testConnection()` fails. | TASK-BRIEF.md Scope item 4 |
| `packages/extension/src/activation/activate.ts` | `confirmRun`'s type widened from `(queries: string[]) => Promise<boolean>` to `(result: PlanQueriesResult) => Promise<boolean>`; `PlanQueriesResult` imported from `@paritylens/engine`; `createWebviewConfirmRun`'s parameter/return type updated the same way, and its `panel.webview.html = renderRunConfirmationHtml(queries)` call updated to `renderRunConfirmationHtml(result.queries, result.connectionUnreachable)`. The `plannedQueries`/`deps.confirmRun(plannedQueries)` call site itself needed no textual change — `plannedQueries` already holds `planQueries`'s full return value, which is now `PlanQueriesResult` by construction. | TASK-BRIEF.md Scope item 2 (mechanically-forced follow-through of item 1) |
| `packages/extension/src/activation/activate.test.ts` | Imported `PlanQueriesResult`; updated both `createDeps(confirmRun: ...)` helper signatures and all `vi.fn<...>` mock type parameters to the new callback shape; updated 4 assertions that previously read `confirmRun.mock.calls[0]?.[0]` as a bare array to read `.queries`/compare against `{ queries: [], connectionUnreachable: false }` instead. | TASK-BRIEF.md Scope item 4 |
| `packages/extension/src/webview/runConfirmationWebview.ts` | `renderRunConfirmationHtml`'s signature widened from `(queries: string[])` to `(queries: string[], connectionUnreachable: boolean)`. Added a static `CONNECTION_UNREACHABLE_NOTICE` string, rendered in place of the normal "ParityLens will issue N queries..." notice when `connectionUnreachable` is true. `renderQueryPreviewSection(queries)` (still showing "No queries recorded for this run." for an empty list) is unchanged and always rendered underneath the notice, regardless of `connectionUnreachable`. | TASK-BRIEF.md Scope item 3 |
| `packages/extension/src/webview/runConfirmationWebview.test.ts` | Updated all 6 existing calls to pass the new second argument (`false` in every pre-existing case, preserving their original behavior); added a new `describe("connectionUnreachable (T-49, finding T-38-01)")` block with 4 tests: the distinguishing notice renders when `true`; Run/Cancel buttons and the empty-state query section still render when `true`; the original "no queries" notice (not the connectivity message) renders for the adversarial legitimately-zero-queries case (`connectionUnreachable: false`, empty `queries`); the normal query-count notice renders when `connectionUnreachable: false` with queries present. | TASK-BRIEF.md Scope item 4 + Handoff's reviewer note item 1 |

`planner.ts` and `resultsWebview.ts` were not touched (confirmed via `git diff --stat -- packages/engine/src/orchestration/planner/planner.ts packages/extension/src/webview/resultsWebview.ts`, which produced no output).

## Behavior and interfaces

- **Behavior delivered:** The confirmation panel now shows a distinct, non-alarmist message ("One or both connections could not be reached, so no queries could be planned for preview. Review your connection settings, or choose Run to see the full failure detail.") when either side's `testConnection()` failed during `planQueries`, instead of the same "No queries recorded for this run." empty state a legitimately-zero-queries definition also produces. Clicking Run in either case is unchanged — `runComparison`'s own existing Layer-1 check still produces the authoritative `"failed"`-status result, per the finding's own confirmed-safe framing.
- **Interfaces consumed:** `planner.ts`'s existing `testConnection()`-based Layer-1 pattern (read-only reference, not modified).
- **Interfaces produced:** `PlanQueriesResult` (new, exported from `packages/engine/src/orchestration/planner/planQueries.ts`, re-exported through `@paritylens/engine`'s existing `export * from "./orchestration/planner/planQueries.js"` wildcard in `packages/engine/src/index.ts` — that index file itself required no edit). `renderRunConfirmationHtml(queries: string[], connectionUnreachable: boolean): string` (signature change, second parameter added). `confirmRun?: (result: PlanQueriesResult) => Promise<boolean>` (signature change in `activate.ts`'s `RunComparisonCommandDeps`-shaped options object).

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline (pre-change) | `npm run verify` | PASS — 34 files, 615 passed, 27 skipped | captured in this session's transcript before any edit |
| Red state | `npx vitest run packages/engine/src/orchestration/planner/planQueries.test.ts` (run against the new test file, before `planQueries.ts` was edited) | FAIL — 7 of 8 tests failed: assertion errors reading `.queries`/`.connectionUnreachable` off the still-`string[]`-shaped return value (e.g. `expected undefined to be true`, `Cannot read properties of undefined (reading 'length')`) | captured in this session's transcript |
| Focused green state | `npx vitest run packages/engine/src/orchestration/planner/planQueries.test.ts packages/extension/src/webview/runConfirmationWebview.test.ts packages/extension/src/activation/activate.test.ts packages/engine/src/orchestration/planner/planner.test.ts` | PASS — 4 files, 67 tests passed | captured in this session's transcript |
| Typecheck | `npx tsc -b --force` | PASS — no output, exit 0 | captured in this session's transcript |
| Lint | `npx eslint .` | PASS — no output, exit 0 | captured in this session's transcript |
| Full verification (post-change) | `npm run verify` | PASS — 34 files (2 skipped: postgres/sqlserver integration suites, unrelated, same as baseline), **621 passed**, 27 skipped, 648 total | captured in this session's transcript |

Net test-count change: 615 → 621 passed (+6 new tests: 2 in `planQueries.test.ts` for the unreachable-source/unreachable-target cases, 4 in `runConfirmationWebview.test.ts` for the `connectionUnreachable` rendering states). No pre-existing test was deleted; no regression.

## Assumptions and risks

- **Assumptions:**
  - `PlanQueriesResult`'s exact field names/shape were the brief's own suggested shape (`{ queries: string[]; connectionUnreachable: boolean }`), used verbatim rather than an alternative naming, since the brief explicitly offered it as "a reasonable shape (your call on exact naming, document it)" and it required no deviation to satisfy the objective.
  - `renderRunConfirmationHtml`'s new parameter was added as a second positional `boolean` argument (`(queries, connectionUnreachable)`) rather than folding both fields into one options object — the brief explicitly allowed either ("or an additional `connectionUnreachable: boolean` parameter — your call on exact signature shape"). Chose the two-positional-argument form to minimize the diff against the existing single-argument call site and its existing test suite's structure.
  - The exact wording of `CONNECTION_UNREACHABLE_NOTICE` is my own judgment call per the brief's "exact wording is your call, keep it accurate and non-alarmist" — I used a close paraphrase of the brief's own suggested wording, adjusted only to fit the panel's existing sentence structure.
- **Risks or limitations:**
  - `activate.test.ts`'s test harness (fixture-registry-backed, no `connectionProfileStore`/`secretStore` supplied) has no way to simulate a genuinely-unreachable connection at the `runComparisonCommand` level — every fixture connector's `testConnection()` always succeeds. So `activate.test.ts` only proves `connectionUnreachable: false` plumbs through correctly end-to-end (via 3 updated assertions); the `connectionUnreachable: true` path is proven directly at the `planQueries` level (2 new tests in `planQueries.test.ts`) and at the rendering level (4 new tests in `runConfirmationWebview.test.ts`), but not as a single true end-to-end integration test through `runComparisonCommand`. This is a pre-existing test-harness limitation (fixture connectors are always reachable), not something this task's file ownership permits fixing, and the brief's own Handoff reviewer-note list does not ask for that specific end-to-end case — it asks for the two rendering states and the `planner.ts`/error-propagation/full-verify checks, all of which are covered.
  - No new `vscode` API surface was added to `runConfirmationWebview.ts` (confirmed: no `import` of `vscode` in that file, matching the Prohibited-changes constraint).
- **Blockers:** None.

## Patch or commit identity

- **Commit:** `2c0bf3c0230b6ad0eb6bf0884f14516d0cc76582` (message: "T-49: planQueries returns connectionUnreachable to disambiguate empty-queries states")
- **Branch:** `task/T-49-planqueries-unreachable-disambiguation`, repository `V:\Secret Projects\VSC-DB-SQL-Compare`.

## Recommended next step

Independent review by a separate reviewer agent, per this project's AGENTS.md ("Every implementation task receives an independent review by a reviewer who did not author the task's change") and TASK-BRIEF.md's Handoff section, which additionally asks the reviewer to specifically re-verify: (1) a genuinely legitimately-zero-queries definition (all checks disabled, reachable connections) still renders the original empty-state message; (2) an unreachable-connection case renders the new distinguishing message; (3) `planner.ts` has zero diff; (4) no `getSchema`/other-error propagation behavior changed past the Layer-1 gate; (5) a fresh full `npm run verify` is green. This report does not constitute review or approval of the change.
