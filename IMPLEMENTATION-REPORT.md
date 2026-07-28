# ParityLens — Implementation Report T-09

## Status and objective

- **Status:** COMPLETE (implementation and evidence only — not self-approved;
  see Recommended next step)
- **Objective:** Implement the Orchestration API's run planner for Phase-1
  checks only (connectivity, schema, profile):
  `runComparison(definition: ParityDefinition): Promise<ComparisonResult>`.
  It resolves a parsed `ParityDefinition`, obtains connectors for the named
  source/target connections, tests connectivity, runs schema comparison
  (T-06) and — if `checks.profile.enabled` is true — column profiling and
  profile comparison (T-07), and assembles a `ComparisonResult` matching the
  shape from `Idea Prompt.md` section 11. Volume and row-level checks
  (`checks.row_count`, `checks.row_level`) are recognized as valid fields but
  explicitly **not executed** in this task — that is T-15's job.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/engine/src/orchestration/planner/planner.ts` | New file (324 lines) | Implements `runComparison(definition, connectors)`, the `ConnectorRegistry` type, `UnresolvedConnectionError`, and the internal helpers (`runProfileChecks`, `buildFailedResult`, `summarizeFindings`, `deriveStatus`) that assemble the Phase-1 `ComparisonResult`. |
| `packages/engine/src/orchestration/planner/planner.test.ts` | New file (162 lines) | Focused Vitest suite proving the four brief-mandated behaviors: end-to-end schema-diff via the `sqlserver-customer` fixture pair, profile-check population, connectivity-failure short-circuit, and the Phase 1 scope boundary (Phase 2/3 fields stay empty even when their flags are enabled). |

Both files were added in a single prior commit (`5eb7f2e`), confirmed via
`git show 5eb7f2e --stat`:

```
 .../src/orchestration/planner/planner.test.ts      | 162 +++++++++++
 .../engine/src/orchestration/planner/planner.ts    | 324 +++++++++++++++++++++
 2 files changed, 486 insertions(+)
```

No other files were touched by T-09's implementation commit. This report
(`IMPLEMENTATION-REPORT.md`) is the only file added/changed by the present
commit — no implementation code was written or modified while preparing
this report.

## Behavior and interfaces

- **Behavior delivered:** `runComparison(definition, connectors)` is the
  first task to wire the engine's pieces together end-to-end:
  1. **Connection resolution (Phase 1 boundary).** `definition.source.connection`
     and `.target.connection` are resolved by looking them up in an
     injectable `ConnectorRegistry` (`Map<string, DataPlatformConnector>`)
     passed in by the caller. `planner.ts` imports only
     `DataPlatformConnector` from `@paritylens/shared` (lines 36–45) — there
     is no `FixtureConnector` import anywhere in `planner.ts`, confirmed by
     direct inspection of the file's import block. The Fixture connector is
     wired in only at the test/call-site level, in `planner.test.ts`'s
     `fixtureRegistry()` helper (lines 100–105), matching the brief's
     "Connection resolution scope for this task" section verbatim: "Do not
     hard-code Fixture-connector-specific behavior into the planner itself —
     the planner must only depend on the `DataPlatformConnector` interface."
     A connection name with no registered connector is treated as a
     connectivity failure (not a thrown error) and short-circuits to a
     `failed`-status result (`planner.ts` lines 88–100).
  2. **Layer 1 connectivity short-circuit.** Both `source.testConnection()`
     and `target.testConnection()` are awaited and timed before any
     schema/profile work begins (`planner.ts` lines 106–128). If either call
     reports `success: false`, `runComparison` returns immediately with
     `status: "failed"`, `summary: { passed: 0, warnings: 0, failed: 1 }`,
     and every difference array (`schemaDifferences`, `profileDifferences`,
     `aggregateDifferences`, `rowDifferences`) empty via `buildFailedResult`
     (lines 249–268) — schema/profile checks are never attempted. This is
     exercised by the `"connectivity failure short-circuit"` test in
     `planner.test.ts` (lines 134–147), which registers only the source
     connection and asserts `result.status === "failed"` with both
     `schemaDifferences` and `profileDifferences` equal to `[]`.
  3. **Schema check.** If `definition.checks.schema?.enabled === true`, both
     sides' schemas are fetched and diffed via T-06's `compareSchemas`
     (`planner.ts` lines 140–146).
  4. **Profile check.** If `definition.checks.profile?.enabled === true`,
     every source column with a target-side counterpart (resolved via the
     definition's `columnMapping`, falling back to identical-name matching)
     is profiled on both sides via T-07's `profileColumn` and diffed via
     `compareProfiles` (`runProfileChecks`, lines 190–235).
  5. **Result assembly.** The final `ComparisonResult` is built with
     `comparison`, `runId`, `status` and `summary.{passed,warnings,failed}`
     derived from the collected findings' severities (`summarizeFindings`,
     lines 278–301; `deriveStatus`, lines 309–324), `schemaDifferences`,
     `profileDifferences`, and `execution.{sourceDurationMs,
     targetDurationMs, comparisonDurationMs}`.
  - **Phase 1 scope boundary, confirmed by dedicated test.** Regardless of
    `checks.rowCount`/`checks.rowLevel` being enabled in the parsed
    definition, `rowCounts` stays `{ source: 0, target: 0, difference: 0 }`
    and `aggregateDifferences`/`rowDifferences` stay `[]` (`planner.ts`
    lines 171–179). This is directly proven by the `"Phase 1 scope
    boundary"` describe block in `planner.test.ts` (lines 149–161), which
    parses a definition with both `row_count.enabled: true` and
    `row_level.enabled: true`, first asserts the parser accepted them
    (`definition.checks.rowCount?.enabled === true`,
    `definition.checks.rowLevel?.enabled === true` — proving T-08/T-08a's
    parser recognizes the fields as valid per the brief's requirement), then
    asserts the resulting `ComparisonResult.rowCounts` /
    `.aggregateDifferences` / `.rowDifferences` are still empty/default —
    i.e. the flags are recognized but never acted on by this planner.
- **Interfaces consumed:** `ParityDefinition`/`parseDefinition` (T-08/T-08a,
  `packages/engine/src/orchestration/definition/definition.ts`);
  `compareSchemas` (T-06,
  `packages/engine/src/comparison-core/schema-diff/schema-diff.ts`);
  `profileColumn`/`compareProfiles` (T-07,
  `packages/engine/src/comparison-core/profiling/profiling.ts`);
  `DataPlatformConnector`/`ComparisonResult` (T-02, `packages/shared/src`);
  `FixtureConnector` + seed fixtures (T-04,
  `packages/engine/src/connector-sdk/fixture/**`) — used only in
  `planner.test.ts`, never in `planner.ts` itself.
- **Interfaces produced:**
  `runComparison(definition: ParityDefinition, connectors: ConnectorRegistry): Promise<ComparisonResult>`
  and the `ConnectorRegistry` type
  (`Map<string, DataPlatformConnector>`), both exported from
  `packages/engine/src/orchestration/planner/planner.ts`, for consumption by
  T-11 (results webview) and T-15 (which extends this planner with Phase
  2/3 checks later).

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Red state | `npx vitest run packages/engine` (against the pre-T-09 tree, i.e. before `planner.ts`/`planner.test.ts` existed) | Would fail: `runComparison` does not exist / cannot be imported. Not physically re-run against a reverted tree in this report-writing pass (implementation code is frozen per this task's instructions); instead confirmed via `git show 5eb7f2e --stat` (reproduced below), which shows both `planner.ts` and `planner.test.ts` were added together in a single commit with no earlier partial version on this branch — there is no prior commit where `runComparison` existed before the commit that introduces it. | `git show 5eb7f2e --stat` output: `.../planner/planner.test.ts \| 162 +++++++++++` / `.../planner/planner.ts \| 324 +++++++++++++++++++++` / `2 files changed, 486 insertions(+)` — captured directly in this report-writing session. |
| Focused green state | `npx vitest run packages/engine` | Exit code 0. `Test Files 7 passed (7)`, `Tests 272 passed (272)`. `packages/engine/src/orchestration/planner/planner.test.ts (4 tests)` passed in 187ms, covering all four brief-mandated cases (end-to-end schema diff, profile-check population, connectivity-failure short-circuit, Phase 1 scope boundary). | Re-run fresh in this session; full console output captured below. |
| Full verification | `npm run verify` (= `npm run typecheck && npm run lint && npm run test`) | Exit code 0. `typecheck` clean, `lint` clean, `vitest run` (all packages): `Test Files 8 passed (8)`, `Tests 283 passed (283)` — 279 pre-existing baseline tests + 4 new T-09 planner tests. No regressions. | Re-run fresh in this session; full console output captured below. |

**Focused command output (`npx vitest run packages/engine`):**

```
 ✓ packages/engine/src/comparison-core/type-mapping/type-mapping.test.ts (69 tests) 11ms
 ✓ packages/engine/src/connector-sdk/safety/statement-safety.test.ts (109 tests) 23ms
 ✓ packages/engine/src/orchestration/definition/definition.test.ts (30 tests) 53ms
 ✓ packages/engine/src/comparison-core/schema-diff/schema-diff.test.ts (11 tests) 49ms
 ✓ packages/engine/src/comparison-core/profiling/profiling.test.ts (9 tests) 138ms
 ✓ packages/engine/src/orchestration/planner/planner.test.ts (4 tests) 187ms
 ✓ packages/engine/src/connector-sdk/fixture/fixture-connector.test.ts (40 tests) 930ms

 Test Files  7 passed (7)
      Tests  272 passed (272)
   Duration  1.67s
EXIT_CODE=0
```

(272 = 283 full-suite total minus the 11 `packages/shared/src/types.test.ts`
tests, which fall outside the `packages/engine` path filter.)

**Full verification output (`npm run verify`):**

```
> paritylens@0.0.1 verify
> npm run typecheck && npm run lint && npm run test

> paritylens@0.0.1 typecheck
> tsc -b --force

> paritylens@0.0.1 lint
> eslint .

> paritylens@0.0.1 test
> vitest run

 ✓ packages/shared/src/types.test.ts (11 tests) 7ms
 ✓ packages/engine/src/comparison-core/type-mapping/type-mapping.test.ts (69 tests) 13ms
 ✓ packages/engine/src/connector-sdk/safety/statement-safety.test.ts (109 tests) 29ms
 ✓ packages/engine/src/orchestration/definition/definition.test.ts (30 tests) 68ms
 ✓ packages/engine/src/comparison-core/schema-diff/schema-diff.test.ts (11 tests) 55ms
 ✓ packages/engine/src/comparison-core/profiling/profiling.test.ts (9 tests) 145ms
 ✓ packages/engine/src/orchestration/planner/planner.test.ts (4 tests) 192ms
 ✓ packages/engine/src/connector-sdk/fixture/fixture-connector.test.ts (40 tests) 879ms

 Test Files  8 passed (8)
      Tests  283 passed (283)
   Duration  1.64s
```

`typecheck` and `lint` both completed with no output (clean pass — `tsc -b
--force` and `eslint .` print nothing on success), and the overall `npm run
verify` command exited 0.

## Assumptions and risks

- **Assumptions:** The implementation code in `planner.ts`/`planner.test.ts`
  (commit `5eb7f2e`) is frozen and out of scope for this report-writing
  pass — this report only documents and independently verifies that
  existing code, per explicit instruction. The literal red-state re-run
  (reverting to a pre-`5eb7f2e` tree and re-running `npx vitest run
  packages/engine`) was not physically repeated in this session; instead
  the red-state claim is substantiated by `git show 5eb7f2e --stat`, which
  shows both files were added together in one commit with no earlier
  partial commit on this branch, so no working `runComparison` existed
  before this commit.
- **Risks or limitations:** None beyond what was already disclosed in
  `planner.ts`'s own header comment and the brief itself: `rowCounts`,
  `aggregateDifferences`, and `rowDifferences` are intentionally left at
  empty/default values in this task (Phase 2/3, T-15's job). The
  `buildFailedResult` helper does not surface the connectivity-failure
  reason string anywhere on the `ComparisonResult` object itself (documented
  in `planner.ts` lines 237–248) — this was a deliberate scope decision
  because `Idea Prompt.md` section 11's shape has no dedicated
  result-level error-message field, and adding one would be a shape change
  beyond the task's "assemble the final `ComparisonResult` ... matching
  Idea Prompt.md section 11's shape exactly" contract.
- **Blockers:** None.

## Patch or commit identity

- **Patch or commit:** Implementation: `5eb7f2e10edb321ad37bb02b45b17b29e00a5758`
  ("T-09: implement Phase-1 orchestration run planner"). This report is
  committed as a separate, subsequent commit on the same branch (see the
  commit hash recorded by whoever dispatched this report-writing pass,
  immediately after this file is committed).
- **Branch or workspace:** `task/T-09-orchestration-phase1`

## Recommended next step

Independent review of the actual code change (commit `5eb7f2e`) is already
complete: a separate reviewer subagent inspected `planner.ts` and
`planner.test.ts` directly and found the implementation sound, with zero
code-level findings — confirming the `ConnectorRegistry` has no
Fixture-connector coupling, the Layer 1 connectivity short-circuit behaves
as specified, and the Phase 2/3 fields are genuinely left empty rather than
partially/incorrectly populated. The only gap that review identified was
that this `IMPLEMENTATION-REPORT.md` had never been written after the
implementation commit landed. This report closes that gap with fresh,
independently-reproduced verification evidence (283/283 passing, exit code
0). The task should be ready for the orchestrator to reconcile this report
against the existing `REVIEW-REPORT.md` and, if reconciliation confirms no
outstanding Critical/Important findings, proceed to marking T-09 complete
in `PROGRESS-LEDGER.md` — that reconciliation and ledger update is the
orchestrator's call, not this implementer's.
