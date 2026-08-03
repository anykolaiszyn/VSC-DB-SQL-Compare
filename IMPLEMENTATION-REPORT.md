# ParityLens — Implementation Report T-48

## Status and objective

- **Status:** COMPLETE (implementation and evidence only — not reviewed or approved)
- **Objective:** Resolve finding T-34-02 (OPEN, accepted non-blocking cosmetic):
  the results webview's header meta line omitted the `source object → target
  object` segment that T-34's own header spec called for (`Run <runId> ·
  source→target · duration`) — only `Run <runId>` and the duration rendered.
  Per TASK-BRIEF.md's Scope, this required (1) widening `ComparisonResult`
  with two new optional, presentational-only fields (`sourceLabel`/
  `targetLabel`), (2) populating them at both `runComparison` construction
  sites in the planner (the Layer-1 connectivity-failure short-circuit and
  the full-run result) by deriving a short label from the corresponding
  `ParitySide`, and (3) rendering the `source→target` segment in
  `renderResultsHtml`'s header meta-line, only when both labels are present.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/shared/src/result.ts` | Added two new optional fields to `ComparisonResult`: `sourceLabel?: string`, `targetLabel?: string`, with a doc comment following `queriesUsed`'s existing pattern (optional, derived, purely presentational, not semantically authoritative). No other field or difference-array shape touched. | TASK-BRIEF.md Scope item 1 — the narrowly-scoped, explicitly authorized exception to the "don't touch `packages/shared/**`" default, mirroring T-16b's `queriesUsed` precedent. |
| `packages/engine/src/orchestration/planner/planner.ts` | Added `deriveSideLabel(side: ParitySide): string` (table → `object`; query → fixed `"(custom query)"` placeholder; sqlFile → file base name only, split on `/`/`\\`, never the full path). Populated `sourceLabel`/`targetLabel` at both `ComparisonResult` construction sites: `buildFailedResult` (Layer-1 connectivity-failure short-circuit, which already has `definition` in scope) and the main `runComparison` return statement. | TASK-BRIEF.md Scope item 2. |
| `packages/engine/src/orchestration/planner/planner.test.ts` | Added a `describe("T-48: sourceLabel/targetLabel derivation", ...)` block: one test per `QueryInput` kind (table/query/sqlFile) via `runComparison`'s full-run path, plus one test confirming the Layer-1 connectivity-failure short-circuit path also populates both labels when `definition.source`/`.target` are available. | TASK-BRIEF.md Scope item 4 / Green-state evidence item 2. |
| `packages/extension/src/webview/resultsWebview.ts` | Added `renderSourceTargetSegment(result): string`, returning the `<span>{sourceLabel}&rarr;{targetLabel}</span>` segment plus its trailing `meta-sep` separator, or `""` when either label is `undefined`. Spliced its return value into the header `meta-line`, between the `Run <runId>` span and the duration span. Both labels pass through the existing `escapeHtml` helper, matching every other interpolated value in this function. | TASK-BRIEF.md Scope item 3. |
| `packages/extension/src/webview/resultsWebview.test.ts` | Added a `describe("T-48: header meta-line source→target segment", ...)` block: segment renders in the correct position when both labels present; both labels are HTML-escaped (XSS-shaped payload test, mirroring this file's existing `queriesUsed` escaping test); segment is correctly omitted (no literal `"undefined"` text) when `sourceLabel` is absent, when `targetLabel` is absent, and when both are absent (today's baseline `SAMPLE_RESULT`, with no code change needed for that last case — see Assumptions). | TASK-BRIEF.md Scope item 4 / Green-state evidence item 2. |

## Behavior and interfaces

- **Behavior delivered:** The results webview header now renders `Run
  <runId> · <sourceLabel>→<targetLabel> · <duration>` when a
  `ComparisonResult` carries both `sourceLabel` and `targetLabel` (every run
  produced by the current `runComparison`, both the full-run path and the
  Layer-1 connectivity-failure short-circuit path). A `ComparisonResult`
  missing either label (e.g. a run persisted before this change, replayed
  via `reopenRunCommand`/`loadRun`, which naturally has no `sourceLabel`/
  `targetLabel` in its stored JSON) renders the header exactly as before —
  the segment is omitted entirely, with no literal `"undefined"` text and no
  partial/broken segment.
- **Interfaces consumed:** `ParitySide`/`QueryInput` (`@paritylens/shared`,
  read-only, no changes). `ParityDefinition.source`/`.target`, already
  available inside `runComparison` and passed through to `deriveSideLabel`
  and to `buildFailedResult`.
- **Interfaces produced:** `ComparisonResult.sourceLabel?: string`,
  `ComparisonResult.targetLabel?: string` (`packages/shared/src/result.ts`),
  optional and additive — no existing caller or test constructing a
  `ComparisonResult` object literal needed to change to keep compiling.

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline (pre-change) | `npm run verify` | Pass — 606 tests passed, 27 skipped, exit 0 | Captured in this session's terminal output before any edit |
| Red state | `npx vitest run packages/extension/src/webview/resultsWebview.test.ts` (after adding the new T-48 test block, before touching `resultsWebview.ts`) | **Fail as predicted** — 2 of 21 tests failed: `"renders the source→target segment ..."` and `"escapes sourceLabel/targetLabel through escapeHtml"` both failed with `expect(html).toContain(...)` assertion errors (segment text absent from unmodified rendering); the 3 omission tests passed trivially (already true of the pre-change baseline). Exit code 1. | This session's terminal output |
| Focused green state (webview) | `npx vitest run packages/extension/src/webview/resultsWebview.test.ts` (after implementing `renderSourceTargetSegment`) | Pass — 21/21 tests, exit 0 | This session's terminal output |
| Focused green state (planner) | `npx vitest run packages/engine/src/orchestration/planner/planner.test.ts` | Pass — 26/26 tests (22 pre-existing + 4 new T-48 tests), exit 0 | This session's terminal output |
| Typecheck | `npx tsc -b --force` | Pass — no output, exit 0 | This session's terminal output |
| Full verification | `npm run verify` (typecheck + lint + test) | Pass — 34 test files passed, 2 skipped (36 total); 615 tests passed, 27 skipped (642 total); exit 0. `615 - 606 = 9` new passing tests (5 new webview assertions + 4 new planner assertions), no regression against the 606-test baseline. | This session's terminal output |

## Assumptions and risks

- **Assumptions:**
  - `kind: "query"`'s label placeholder wording (`"(custom query)"`) is my
    own judgment call, as the brief explicitly delegated: "your call on
    exact wording, keep it short and clearly not a table name."
  - `kind: "sqlFile"`'s base-name extraction uses a plain
    `split(/[\/\\]/)` rather than `node:path`'s `basename`, since
    `filePath` is a definition-authored string that may use either
    separator regardless of the host OS running the comparison, and
    `deriveSideLabel` otherwise has no I/O dependency — documented inline
    in `planner.ts`'s doc comment on `deriveSideLabel`.
  - The Layer-1 connectivity-failure short-circuit path (`buildFailedResult`)
    does have `definition` in scope at both of its call sites in
    `runComparison` (missing-connector-registration case and
    connectivity-test-failure case) — confirmed by reading the code before
    writing this report (also independently reconfirmed here, per the
    brief's "check the actual code before assuming" instruction) — so both
    labels are populated on that path, not left `undefined`.
- **Risks or limitations:**
  - Per the brief's Prohibited Changes section, the
    `reopenRunCommand`/persisted-run-replay path is deliberately *not*
    touched — a run persisted before this change has no `sourceLabel`/
    `targetLabel` in its stored JSON, so `loadRun` naturally returns
    `undefined` for both on old records, and the header correctly omits the
    segment for those old runs. This is expected behavior per the brief,
    not a defect, and required no code change to achieve (verified by the
    "omits ... when both ... are absent" test against the pre-existing
    `SAMPLE_RESULT` fixture, which carries neither field).
  - `queriesUsed` uses a conditional spread (`...(queriesUsed.length > 0 ?
    {queriesUsed} : {})`) to omit the key entirely when empty, matching its
    own "optional and omitted (not an empty array)" doc-comment contract.
    `sourceLabel`/`targetLabel` are instead always assigned directly (not
    conditionally spread) at both construction sites, since `deriveSideLabel`
    always returns a real string once `definition.source`/`.target` exist —
    there is no "nothing to derive" case analogous to `queriesUsed`'s "no
    check ran" case for either construction site reached in this codebase
    today. This is a deliberate asymmetry with `queriesUsed`'s pattern, not
    an oversight.
- **Blockers:** None.

## Patch or commit identity

- **Patch or commit:** captured after this report is committed — see the
  final `git log -1` output; committed on branch
  `task/T-48-results-webview-header-line` in the same commit as this report
  and the 5 owned-file diffs.
- **Branch or workspace:** `task/T-48-results-webview-header-line`,
  repository `V:\Secret Projects\VSC-DB-SQL-Compare`.

## Recommended next step

Independent review by a separate Reviewer agent, per this project's
lifecycle kit (`AGENTS.md`: "Every implementation task receives an
independent review by a reviewer who did not author the task's change").
This report and its author have no authority to mark T-48 complete/approved
or to update `PROGRESS-LEDGER.md`. Per TASK-BRIEF.md's Handoff section, the
reviewer should specifically re-verify: (1) `ComparisonResult`'s widening is
genuinely additive/optional; (2) no difference-array shape was touched; (3)
the header segment is correctly omitted (not rendered with literal
`"undefined"` text) when either label is absent, including on the Layer-1
connectivity-failure short-circuit path; (4) `escapeHtml` covers both new
interpolations; (5) a fresh full `npm run verify` is green.
