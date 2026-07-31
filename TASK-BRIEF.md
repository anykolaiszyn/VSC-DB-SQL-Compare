# ParityLens — Task Brief T-13

## Objective

Implement volume parity per `Idea Prompt.md` section 2 ("Layer 3: Volume
Parity") and section 12 ("Severity and Tolerance Model"): compare total row
count (and, where cheaply derivable from the same query, distinct/null key
counts) between source and target, evaluate the difference against a
configured tolerance (exact equality / absolute / percentage / informational
only), and classify the result per the severity model.

Note to whoever dispatches an implementer against this brief: quote this
document's load-bearing requirements verbatim rather than paraphrasing them.
A paraphrase that loosens a requirement is a known failure mode from this
project's history (T-07's I-02 finding traced back to exactly this) — the
implementer treats the paraphrase as authoritative and a real requirement
quietly drops. If a dispatch prompt must summarize this brief for brevity,
it should still point back to this file as the sole authority wherever the
two could be read to disagree.

## Dependencies

- **Required completed tasks:** T-12 (column mapping + normalization).
  COMPLETE and APPROVED per `PROGRESS-LEDGER.md`. (T-13 does not actually
  consume T-12's `suggestMappings`/`applyNormalization` output directly —
  volume parity compares row counts, not mapped column values — but
  `IMPLEMENTATION-PLAN.md`'s dependency-ordering lists T-12 as the
  prerequisite, satisfied.)
- **Required decisions or approvals:** NONE beyond the already-approved
  `IMPLEMENTATION-PLAN.md` row for T-13.

## Files owned

- `packages/engine/src/comparison-core/volume/**`

Do not touch `packages/engine/src/comparison-core/profiling/**` (T-07's
owned file — model your query-execution pattern on it for consistency, per
the Interfaces table below, but do not import from or edit it beyond a
normal read), `packages/engine/src/orchestration/**` (T-09's/T-15's owned
files — T-13 produces a comparison function; wiring it into the planner's
`runComparison` is explicitly T-15's job, not this task's), or
`packages/shared/src/result.ts` beyond the one refinement named below.

## Interfaces

| Direction | Interface | Contract | Producer or consumer |
| --- | --- | --- | --- |
| Consumed | `DataPlatformConnector` (`packages/shared/src/connector.ts`) | No dedicated row-count method exists on this interface. Follow T-07's established pattern in `packages/engine/src/comparison-core/profiling/profiling.ts` (`profileColumn`): build your own `SELECT COUNT(*) ...` SQL string, resolve the query object reference the same way `resolveObjectReference` does, quote identifiers via `connector.quoteIdentifier`, and execute via `connector.executeQuery(input, executionOptions)`, consuming the single-row `AsyncIterable<RecordBatch>` result. Do not add a new method to the shared `DataPlatformConnector` interface — that would be an unowned change to `packages/shared/src/connector.ts` outside this task's file ownership. | T-04 (FixtureConnector, the only connector available for testing) |
| Consumed | `ParityChecks.rowCount` (`packages/engine/src/orchestration/definition/definition.ts:85-91`) | Existing, already-implemented shape: `{ enabled: boolean, tolerance?: { percentage?: number, absolute?: number } }`. This is the tolerance configuration T-13 evaluates against. Consume read-only; do not modify `definition.ts`. Note the type only supports absolute/percentage tolerance and enabled/disabled — it has no explicit "exact equality" or "informational only" variant beyond what absolute/percentage-omitted or enabled:false already express; if you find a genuine gap, stop and flag it as a blocker rather than editing T-08's file. | T-08 (producer of the type) |
| Produced | `compareVolume(source: DataPlatformConnector, target: DataPlatformConnector, sourceInput: QueryInput, targetInput: QueryInput, tolerance?: { percentage?: number; absolute?: number }): Promise<VolumeDifference>` (exact signature/name your choice — document it precisely in the report) | Executes a row-count query against both connectors, computes `difference = targetCount - sourceCount` and `differenceRate` (percentage), and classifies the result against the supplied tolerance per `Idea Prompt.md` section 2's worked example: `Source rows: 12,405,128 / Target rows: 12,402,991 / Difference: -2,137 / Difference rate: -0.0172% / Tolerance: 0.0100% / Result: FAIL`. Reproduce this exact worked example as a literal test case. When `tolerance` is omitted, treat as exact-equality (any nonzero difference fails) — document this judgment call explicitly in the report since the idea doc lists "informational comparison only" as a distinct mode this type doesn't cleanly express (see the Interfaces row above); do not guess silently. | T-15 (wires into planner), T-16 (renders in webview) |
| Produced | `VolumeDifference` — new interface, extends or is assignable to the existing `AggregateDifference` placeholder alias in `packages/shared/src/result.ts:126` (`export type AggregateDifference = DifferenceItem;` — currently just an alias, explicitly reserved for T-13 to refine per that file's header comment and line 125's own doc comment: "Placeholder item shape for `ComparisonResult.aggregateDifferences`; refined by T-13") | Must report at minimum: `severity` and `message` (inherited from `DifferenceItem`), `sourceCount`, `targetCount`, `difference`, `differenceRate`, and the tolerance that was evaluated against. This is the ONE place `packages/shared/src/result.ts` may be edited by this task — refine `AggregateDifference` from the placeholder alias into a real interface, following the exact pattern `SchemaDifference` (T-06) and `ProfileDifference` (T-07) already established in that same file (extend `DifferenceItem`, add a doc comment explaining the shape, do not touch `SchemaDifference`/`ProfileDifference`/`RowDifference` in the same file). | T-15, T-16 |

## Prohibited changes

- Do not widen `SchemaDifference`, `ProfileDifference`, or `RowDifference`
  in `result.ts` as a side effect — only `AggregateDifference` is this
  task's to refine, per that file's own ownership comments.
- Do not modify `packages/engine/src/orchestration/definition/definition.ts`
  — `ParityChecks.rowCount` is T-08's owned type; T-13 consumes it
  read-only. If a genuine gap is found, stop and flag it as a blocker
  rather than editing T-08's file.
- Do not modify `packages/engine/src/orchestration/planner/**` — wiring
  `compareVolume` into `runComparison` is T-15's explicitly scoped job
  (`IMPLEMENTATION-PLAN.md` T-15 row), not T-13's. T-13 only produces the
  comparison function; it does not call it from the planner.
- Do not implement distinct-key-count, duplicate-key-count, null-key-count,
  count-by-partition/date/segment, or min/max-key comparisons — `Idea
  Prompt.md` section 2 lists these as part of "Layer 3: Volume Parity," but
  `IMPLEMENTATION-PLAN.md`'s T-13 row scopes this task to row count with
  tolerance evaluation only ("row count, distinct count, duplicate/null key
  counts, tolerance evaluation" is the plan row's language — if you
  implement more than total row count, document exactly what additional
  metrics you added and why they were cheap/safe to include without scope
  creep; when in doubt, implement row count only and flag the rest as
  deferred rather than guessing at unspecified additional query shapes).
- Do not touch `packages/extension/**` — T-13 is engine-only.
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Test or check to add:** A test reproducing `Idea Prompt.md` section 2's
  worked example almost exactly (source rows, target rows, and a
  0.0100% tolerance producing a `FAIL` result with the difference/rate
  computed correctly) — must fail because `compareVolume` doesn't exist
  yet. A second red-state case: an in-tolerance pair of counts expected to
  produce a `PASS`/non-failing result — must also fail for the same
  reason.
- **Command:** `npx vitest run packages/engine/src/comparison-core/volume`
- **Expected failure reason:** Module resolution failure — the directory
  doesn't exist yet under `packages/engine/src/comparison-core/`.
- **Captured output:** Paste the actual failing command output and exit
  code into `IMPLEMENTATION-REPORT.md`, not a paraphrase.

## Green-state and full verification

- **Focused command:** `npx vitest run packages/engine/src/comparison-core/volume`
- **Full command:** `npm run verify`
- **Expected evidence:** Both red-state cases pass; the worked example from
  `Idea Prompt.md` section 2 is exercised with the exact literal numbers
  from that example; an in-tolerance case passes; a percentage-tolerance
  case and an absolute-tolerance case are each exercised separately; the
  previously-passing 334 tests (per `PROGRESS-LEDGER.md`'s T-12 entry)
  still pass with no regression; `npm run verify` exits 0.

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md`
- **Independent reviewer:** `reviewer` subagent (separate instance from
  whichever `implementer` subagent does this task)
- **Review report location:** `REVIEW-REPORT.md`
- **Commit or patch checkpoint:** Branch `task/T-13-volume-parity`

**Note to reviewer:** scrutinize hardest (a) whether the percentage-rate
arithmetic matches the idea doc's worked example exactly (`-2,137 /
12,405,128 = -0.01722...%`, rounding/sign conventions matter — re-derive
this independently rather than trusting the implementer's own test
assertion), (b) whether `AggregateDifference`'s refinement in `result.ts`
followed the same additive, non-breaking pattern `SchemaDifference`/
`ProfileDifference` used (no changes to sibling difference shapes), and (c)
whether the implementer silently expanded scope into distinct/duplicate/
null-key counts, count-by-partition, or min/max-key comparisons beyond
plain row count — check the actual diff against the Prohibited Changes
section above, not just the report's own characterization of scope.
