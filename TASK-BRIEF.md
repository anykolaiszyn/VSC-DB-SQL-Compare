# ParityLens — Task Brief T-14

## Objective

Implement row-level parity per `Idea Prompt.md` section 2 ("Layer 6:
Row-Level Parity"): key-based matching between source and target record
sets, classifying every row into one of the categories the idea doc names —
Matching, Missing from source, Missing from target, Duplicate in source,
Duplicate in target, Matched key with differing values, Unable to compare,
Ignored by rule — and, for matched rows, comparing each mapped column using
T-12's normalization.

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
  COMPLETE and APPROVED per `PROGRESS-LEDGER.md`. T-14 directly consumes
  `applyNormalization`/`valuesEqualWithinTolerance` from
  `packages/engine/src/comparison-core/normalization/normalization.ts` and
  `ColumnMappingEntry` from
  `packages/engine/src/orchestration/definition/definition.ts` (T-08's
  type, consumed read-only, same as T-12 does).
- **Required decisions or approvals:** NONE beyond the already-approved
  `IMPLEMENTATION-PLAN.md` row for T-14.

## Files owned

- `packages/engine/src/comparison-core/row-level/**`

Do not touch `packages/engine/src/comparison-core/mapping/**` or
`.../normalization/**` (T-12's owned files — consume their exports
read-only via `import`), `packages/engine/src/orchestration/**` (T-09's/
T-15's owned files — wiring `compareRows` into the planner is T-15's job,
not this task's), or
`packages/engine/src/orchestration/definition/definition.ts` (T-08's owned
file, defines `ColumnMappingEntry`/`keys` that this task consumes
read-only).

## Interfaces

| Direction | Interface | Contract | Producer or consumer |
| --- | --- | --- | --- |
| Consumed | `RecordBatch` (`packages/shared/src/types.ts:110-117`) | `{ columns: string[], rows: unknown[][], rowCount: number }` — row-oriented result shape every connector's `executeQuery` yields. T-14 does not call a connector directly; it operates on already-fetched source/target row sets (an in-memory array of rows, or an async-iterable of `RecordBatch`, your choice — document which in the report). Fetching/streaming policy for very large row sets is explicitly out of scope for this task (no pagination/chunking strategy required yet — assume both sides fit in memory for now, matching the fixture-scale data this task will be tested against). | T-04 (fixture connector), consumed indirectly |
| Consumed | `ColumnMappingEntry` / `keys: string[]` (`packages/engine/src/orchestration/definition/definition.ts:52-59,113`) | `keys` names the matching key column(s) (composite keys supported — an array, not a single string). `ColumnMappingEntry` names which source column maps to which target column, consumed read-only, same pattern as T-12. | T-08 (producer of the type) |
| Consumed | `applyNormalization(value, rule)` / `valuesEqualWithinTolerance(a, b, tolerance)` (`packages/engine/src/comparison-core/normalization/normalization.ts`) | Existing, already-implemented pure functions. For matched rows, apply the relevant `NormalizationRule` (if any is configured for that column) to both source and target values before comparing, per `Idea Prompt.md`'s worked example: `STATUS: Shipped vs SHIPPED → "Match after normalization"`, `ORDER_AMOUNT: 125.3700 vs 125.37 → "Match"` (via `numericTolerance`/type coercion), `SHIP_DATE: "2026-07-20 00:00:00" vs "2026-07-20" → "Match"` (via normalization), `CUSTOMER_NAME: "Acme Inc." vs "Acme, Inc." → "Difference"` (no normalization rule closes this gap — must correctly report a difference, not silently pass). Reproduce this exact worked example (all four columns) as literal test cases. | T-12 (producer) |
| Produced | `compareRows(sourceRows: RecordBatch \| unknown[][], targetRows: RecordBatch \| unknown[][], keys: string[], mapping: ColumnMappingEntry[], rules?: Record<string, NormalizationRule>): RowDifference[]` (exact signature your choice — document it precisely in the report) | Classifies every row from both sides into exactly one of the 8 categories named in the Objective, matching source-to-target by key (composite keys supported — multiple key columns concatenated/tupled for matching, not just the first). Duplicate detection: if a key value appears more than once on one side, classify all rows sharing that key on that side as "Duplicate in source"/"Duplicate in target" rather than attempting a 1:1 match. For matched (non-duplicate) key pairs, compare each mapped column per the Interfaces row above; if ANY mapped column differs after normalization, classify the row as "Matched key with differing values" and report which column(s) differed. "Unable to compare" is for a row where a mapped column's value cannot be normalized/compared (e.g. a normalization function throws, or a type is fundamentally incomparable) — do not let such an error crash `compareRows`; catch and classify instead. "Ignored by rule" is for a column-level or row-level exclusion the caller explicitly requests (a minimal `ignoreColumns?: string[]` parameter is sufficient scope for this — do not invent a full expression-based ignore-rule engine). | T-15 (wires into planner), T-16 (renders in webview), T-20 (future hash-comparison strategy, unscheduled) |
| Produced | `RowDifference` — refine the existing placeholder alias in `packages/shared/src/result.ts:128` (`export type RowDifference = DifferenceItem;` — explicitly reserved for T-14 per that file's header comment) | Must report at minimum: `severity`/`message` (inherited from `DifferenceItem`), the row's key value(s), the classification category, and (for "Matched key with differing values") which column(s) differed with their source/target values. This is the ONE place `packages/shared/src/result.ts` may be edited by this task — follow the exact pattern `SchemaDifference` (T-06), `ProfileDifference` (T-07), and `AggregateDifference` (T-13) already established (extend `DifferenceItem`, add a doc comment, do not touch the other three difference shapes in the same file). | T-15, T-16 |

## Prohibited changes

- Do not widen `SchemaDifference`, `ProfileDifference`, or
  `AggregateDifference` in `result.ts` as a side effect — only
  `RowDifference` is this task's to refine.
- Do not modify `packages/engine/src/comparison-core/mapping/**` or
  `.../normalization/**` — both are T-12's owned files; consume their
  exports read-only via `import`.
- Do not modify `packages/engine/src/orchestration/definition/definition.ts`
  — T-08's owned type. If a genuine gap is found (a field this task needs
  but the type doesn't have), stop and flag it as a blocker rather than
  editing T-08's file.
- Do not modify `packages/engine/src/orchestration/planner/**` — wiring
  `compareRows` into `runComparison` is T-15's explicitly scoped job, not
  T-14's. T-14 only produces the comparison function.
- Do not implement hash-based row comparison (SQL-side row hashing to avoid
  transferring full row data) — that is explicitly `IMPLEMENTATION-PLAN.md`
  T-20's scope, listed as a separate future task.
- Do not implement sampling strategies for row-level comparison on very
  large datasets — that is explicitly T-21's scope.
- Do not build a full expression-based ignore-rule engine — a minimal
  `ignoreColumns?: string[]` parameter satisfies "Ignored by rule" for this
  task; anything more elaborate is scope creep.
- Do not touch `packages/extension/**` — T-14 is engine-only.
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Test or check to add:** A test classifying a small hand-built fixture
  row set (constructed directly in the test file, not requiring a live
  connector) covering at least: one matching row, one missing-from-target
  row, one missing-from-source row, one duplicate-key row on one side, and
  one matched-key-with-differing-values row — must fail because
  `compareRows` doesn't exist yet. A second red-state case: the idea doc's
  literal `ORDER_ID = 1008924` worked example (all four columns) — must
  also fail for the same reason.
- **Command:** `npx vitest run packages/engine/src/comparison-core/row-level`
- **Expected failure reason:** Module resolution failure — the directory
  doesn't exist yet under `packages/engine/src/comparison-core/`.
- **Captured output:** Paste the actual failing command output and exit
  code into `IMPLEMENTATION-REPORT.md`, not a paraphrase.

## Green-state and full verification

- **Focused command:** `npx vitest run packages/engine/src/comparison-core/row-level`
- **Full command:** `npm run verify`
- **Expected evidence:** Both red-state cases pass with 100% correct
  classification against the hand-built expected set (per
  `DESIGN-SPEC.md`'s acceptance criterion 2, referenced in
  `IMPLEMENTATION-PLAN.md`'s T-14 row); the idea doc's `ORDER_ID = 1008924`
  worked example passes with the exact literal values/results shown
  (`STATUS` → "Match after normalization", `ORDER_AMOUNT` → "Match",
  `SHIP_DATE` → "Match", `CUSTOMER_NAME` → "Difference"); composite-key
  matching is exercised by at least one test using two key columns; the
  previously-passing 339 tests (per `PROGRESS-LEDGER.md`'s T-13 entry)
  still pass with no regression; `npm run verify` exits 0.

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md`
- **Independent reviewer:** `reviewer` subagent (separate instance from
  whichever `implementer` subagent does this task)
- **Review report location:** `REVIEW-REPORT.md`
- **Commit or patch checkpoint:** Branch `task/T-14-row-level`

**Note to reviewer:** per `IMPLEMENTATION-PLAN.md`'s T-14 review-gate
column, "independently re-verify the classification against the hand-built
expected set, not just re-running the same test" — construct your own
adversarial fixture row set (not reusing the implementer's) covering edge
cases: a key that is duplicated on BOTH sides simultaneously, a row where a
mapped column value throws during normalization (must classify "Unable to
compare," not crash), a composite key where the individual key columns
match but not in combination, and an `ignoreColumns`-excluded column that
genuinely differs (must NOT appear in "Matched key with differing values").
Also verify `RowDifference`'s refinement in `result.ts` is purely additive
(does not touch `SchemaDifference`/`ProfileDifference`/`AggregateDifference`),
matching the precedent T-06/T-07/T-13 already established.
