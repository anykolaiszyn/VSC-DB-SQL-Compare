# ParityLens — Task Brief T-15

## Objective

Extend the Orchestration API's planner (`runComparison`, T-09's file) to
execute Phase-2 checks — volume parity (T-13's `compareVolume`) and
row-level parity (T-14's `compareRows`) — honoring `checks.rowCount.enabled`
and `checks.rowLevel.enabled` from the parsed `ParityDefinition`, and
populate `ComparisonResult.rowCounts`, `.aggregateDifferences`, and
`.rowDifferences` from real results instead of the empty/default placeholder
values T-09 left in place.

Note to whoever dispatches an implementer against this brief: quote this
document's load-bearing requirements verbatim rather than paraphrasing them.
A paraphrase that loosens a requirement is a known failure mode from this
project's history (T-07's I-02 finding traced back to exactly this) — the
implementer treats the paraphrase as authoritative and a real requirement
quietly drops. If a dispatch prompt must summarize this brief for brevity,
it should still point back to this file as the sole authority wherever the
two could be read to disagree.

## Dependencies

- **Required completed tasks:** T-09 (orchestration planner, Phase 1),
  T-13 (volume parity), T-14 (row-level parity). All COMPLETE and APPROVED
  per `PROGRESS-LEDGER.md`.
- **Required decisions or approvals:** NONE beyond the already-approved
  `IMPLEMENTATION-PLAN.md` row for T-15.
- **Carried-forward findings to address:** T-13-01 (Minor, undocumented
  precedence when `ParityChecks.rowCount.tolerance` supplies both
  `percentage` and `absolute`) and T-14-02 (Minor, already resolved inside
  `compareRows` itself — no action needed here beyond passing `rules`
  through so the fallback actually engages) are both explicitly flagged in
  `PROGRESS-LEDGER.md` as relevant to this task. Do not silently ignore
  T-13-01 — either resolve the ambiguity explicitly in how you call
  `compareVolume` (document which of `percentage`/`absolute` wins when a
  definition supplies both, matching whatever `compareVolume`'s own
  `evaluateTolerance` already does — read `volume.ts` directly rather than
  guessing) or flag it as still-open in your report.

## Files owned

- `packages/engine/src/orchestration/planner/**` (extends T-09's
  ownership; T-09 is complete and merged, so this task now owns further
  changes to this directory)

Do not touch `packages/engine/src/comparison-core/volume/**` (T-13's owned
file, consume `compareVolume`/`VolumeDifference`/`VolumeTolerance` read-only
via `import`), `packages/engine/src/comparison-core/row-level/**` (T-14's
owned file, consume `compareRows`/`RowCompareOptions`/`RowSet` read-only via
`import`), `packages/engine/src/comparison-core/mapping/**` or
`.../normalization/**` (T-12's owned files), or
`packages/engine/src/orchestration/definition/definition.ts` (T-08's owned
file — `ParityChecks.rowCount`/`.rowLevel`, `ColumnMappingEntry`, `keys`,
and the per-column `rules` shape are all consumed read-only).

## Interfaces

| Direction | Interface | Contract | Producer or consumer |
| --- | --- | --- | --- |
| Consumed | `compareVolume(source, target, sourceInput, targetInput, tolerance?): Promise<VolumeDifference>` (`packages/engine/src/comparison-core/volume/volume.ts`) | Existing, already-implemented and reviewed. `VolumeDifference` is an alias for `AggregateDifference`. Call once per comparison run when `checks.rowCount?.enabled === true`, passing `definition.checks.rowCount.tolerance` straight through (the shape is structurally assignable to `VolumeTolerance` per that file's own header comment) and `{ kind: "table", object: definition.source.object }` / target equivalent as the `QueryInput` args, matching the exact pattern T-09 already uses for `getSchema` calls in this same file. | T-13 (producer) |
| Consumed | `compareRows(sourceRows, targetRows, keys, mapping, rules?, options?): RowDifference[]` (`packages/engine/src/comparison-core/row-level/row-level.ts`) | Existing, already-implemented and reviewed. Synchronous, not async — takes already-fetched row data (a `RecordBatch` for each side), not a connector. Call when `checks.rowLevel?.enabled === true`: fetch full row data for both sides via `source.executeQuery`/`target.executeQuery` (matching the pattern already used elsewhere in this file for schema/profile queries — build a plain `SELECT` over `definition.source.object`/`.target.object`, or reuse `definition.source.where`/`.target.where` if present, since `ParitySide.where` is an existing, already-parsed field this task may read), consume the resulting `AsyncIterable<RecordBatch>` fully into row sets, then call `compareRows` with `definition.keys`, `definition.columnMapping`, and `definition.rules` (all existing `ParityDefinition` fields from T-08, consumed read-only, same as T-09 already does for `columnMapping` in `runProfileChecks`). | T-14 (producer) |
| Produced | `ComparisonResult.rowCounts` (`packages/shared/src/result.ts`, existing shape, not owned by this task to redefine) | Populate from `compareVolume`'s returned `VolumeDifference.{sourceCount, targetCount, difference}` when `checks.rowCount.enabled`; leave at `{ source: 0, target: 0, difference: 0 }` (T-09's existing default) when the check is disabled — do not fabricate a value for a check that didn't run. | T-16 (webview), T-15 itself (planner) |
| Produced | `ComparisonResult.aggregateDifferences` / `.rowDifferences` (existing shapes, owned by T-13/T-14 respectively, not this task) | Populate `aggregateDifferences` with `[compareVolume's result]` (a single-element array — one row-count check per run, matching `AggregateDifference`'s array type) when row-count checking is enabled; populate `rowDifferences` with `compareRows`'s full returned array when row-level checking is enabled. Both stay empty when their respective check is disabled — this is the exact behavior T-09's existing "Phase 2/3 scope boundary" comment in `planner.ts` describes as deferred to this task. | T-16 (webview) |

## Prohibited changes

- Do not modify `AggregateDifference`, `RowDifference`, `SchemaDifference`,
  or `ProfileDifference` in `packages/shared/src/result.ts` — all four are
  complete, owned by their respective tasks (T-13, T-14, T-06, T-07). If a
  genuine shape gap is found, stop and flag it as a blocker rather than
  editing that file.
- Do not modify `compareVolume`/`compareRows` or any file under
  `comparison-core/volume/**`, `comparison-core/row-level/**`,
  `comparison-core/mapping/**`, or `comparison-core/normalization/**` —
  all are complete and reviewed; T-15 is integration-only.
- Do not modify `packages/engine/src/orchestration/definition/definition.ts`
  — T-08's owned file, consumed read-only.
- Do not change T-09's existing Phase-1 behavior (connectivity
  short-circuit, schema/profile check execution, `summary`/`status`
  derivation logic) except as strictly necessary to also fold in
  volume/row-level findings' severities into the same `summarizeFindings`/
  `deriveStatus` computation — read `planner.ts`'s existing
  `summarizeFindings`/`deriveStatus` functions directly and extend the
  `allFindings` array they already consume, rather than duplicating or
  reimplementing that logic for the new check types.
- Do not implement a distinct "informational-only" row-count tolerance mode
  beyond what `compareVolume` itself already supports — that gap (if it is
  one) belongs to `definition.ts`/T-13's territory, not this task's.
- Do not touch `packages/extension/**` — T-15 is engine-only.
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Test or check to add:** A test running `runComparison` against two
  fixture connectors with `checks.rowCount.enabled: true` and
  `checks.rowLevel.enabled: false` in the definition, asserting the
  returned `ComparisonResult.rowCounts` and `.aggregateDifferences` are
  populated (not the empty defaults) — must fail because the planner
  doesn't route to `compareVolume` yet. A second red-state case: the same
  with `checks.rowLevel.enabled: true` asserting `.rowDifferences` is
  populated — must also fail for the same reason (planner doesn't route to
  `compareRows` yet).
- **Command:** `npx vitest run packages/engine/src/orchestration/planner`
- **Expected failure reason:** Existing planner tests still pass (T-09's
  behavior is untouched), but the new red-state assertions fail because
  `rowCounts`/`aggregateDifferences`/`rowDifferences` remain at their
  Phase-1 empty defaults.
- **Captured output:** Paste the actual failing command output and exit
  code into `IMPLEMENTATION-REPORT.md`, not a paraphrase.

## Green-state and full verification

- **Focused command:** `npx vitest run packages/engine/src/orchestration/planner`
- **Full command:** `npm run verify`
- **Expected evidence:** Both new red-state cases pass; a test confirming
  that disabling a Phase-2 check in the definition actually skips it (no
  silent execution — e.g. `checks.rowCount.enabled: false` still yields
  the empty `{ source: 0, target: 0, difference: 0 }` default, not a
  real computed value) per `IMPLEMENTATION-PLAN.md`'s T-15 review-gate
  column; all of T-09's existing Phase-1 tests still pass unmodified
  (connectivity short-circuit, schema, profile); the previously-passing
  347 tests (per `PROGRESS-LEDGER.md`'s T-14 entry) still pass with no
  regression; `npm run verify` exits 0.

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md`
- **Independent reviewer:** `reviewer` subagent (separate instance from
  whichever `implementer` subagent does this task)
- **Review report location:** `REVIEW-REPORT.md`
- **Commit or patch checkpoint:** Branch `task/T-15-orchestration-phase2`

**Note to reviewer:** per `IMPLEMENTATION-PLAN.md`'s T-15 review-gate
column, "confirms disabling a check in the definition actually skips it (no
silent execution)" — construct your own test disabling each of
`checks.rowCount`/`checks.rowLevel` independently (not reusing the
implementer's own disabled-check test) and confirm no query is issued to
either connector for the disabled check (an easy way to verify: use a spy/
mock connector, similar to the "adversarial spy-connector probe" T-09's own
review already used for the connectivity short-circuit — check
`PROGRESS-LEDGER.md`'s T-09 decision-log entry for that precedent). Also
verify the `rowCounts`/`aggregateDifferences`/`rowDifferences` population
logic doesn't silently swallow a `compareVolume`/`compareRows` throw (should
the run fail loudly, or should it be caught similarly to how connectivity
failures short-circuit? — the brief does not prescribe this; check what the
implementer chose and whether it's reasonable and documented, not
unspecified-and-silent). Finally, confirm `summary`/`status` correctly
reflect a Phase-2 failure (e.g. a row-count check that fails tolerance
should be able to flip `status` to `"failed"` and increment
`summary.failed`, exactly as schema/profile findings already do) by
constructing a case where only a row-count/row-level finding fails, with
schema and profile both passing or disabled.
