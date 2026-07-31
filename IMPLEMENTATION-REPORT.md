# ParityLens — Implementation Report T-14

## Status and objective

- **Status:** COMPLETE (implementation and evidence only — not reviewed or approved; see Recommended next step)
- **Objective:** Implement row-level parity per `Idea Prompt.md` section 2
  ("Layer 6: Row-Level Parity"): key-based matching between source and
  target record sets, classifying every row into one of the eight
  categories the idea doc names verbatim — Matching, Missing from source,
  Missing from target, Duplicate in source, Duplicate in target, Matched
  key with differing values, Unable to compare, Ignored by rule — and, for
  matched rows, comparing each mapped column using T-12's normalization.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/engine/src/comparison-core/row-level/row-level.ts` | New. `compareRows(sourceRows, targetRows, keys, mapping, rules?, options?)` and supporting helpers. | Files owned by this task per `TASK-BRIEF.md`. |
| `packages/engine/src/comparison-core/row-level/row-level.test.ts` | New. Six tests: classification categories, target-side-only duplicate, `ignoreColumns`, unable-to-compare, composite key, and the literal `ORDER_ID = 1008924` worked example. | Red-state evidence + green-state proof, per brief's Red-state/Green-state sections. |
| `packages/shared/src/result.ts` | Replaced the placeholder `export type RowDifference = DifferenceItem;` (old line 128) with a real `RowDifference` interface (extends `DifferenceItem`, adds `category: RowDifferenceCategory`, `keyValues: unknown[]`, `columnDifferences?: RowColumnDifference[]`), plus new `RowDifferenceCategory` and `RowColumnDifference` types. `SchemaDifference`/`ProfileDifference`/`AggregateDifference` are untouched (verified via `git diff` — see below). | Brief: "You must also refine `RowDifference` in `packages/shared/src/result.ts`... this is the ONE place in `result.ts` you may touch." |
| `packages/shared/src/types.test.ts` | One-line edit to the existing `rowDifferences: [{ severity: "Pass", message: "no differences" }]` literal in the `"constructs difference-array items with a severity field"` test, adding the now-required `category`/`keyValues` fields. | **Flagged separately per Implementer instructions, not folded in silently:** this file is outside T-14's declared ownership (`packages/engine/src/comparison-core/row-level/**` only). However, widening `RowDifference` from a `DifferenceItem` alias to a real interface with required fields is explicitly what the brief asks for, and that change mechanically breaks this pre-existing literal at typecheck time (`tsc -b --force` failed with `TS2739: Type '{ severity: "Pass"; message: string; }' is missing the following properties from type 'RowDifference': category, keyValues`). This is the identical situation T-13 faced and resolved the same way — `git log --oneline -- packages/shared/src/types.test.ts` shows commit `59adc9f "T-13: implement volume parity (compareVolume, AggregateDifference refinement)"` previously edited this same test file's `aggregateDifferences` literal for the same reason. The edit is the minimal one possible: two new required fields added to one array literal, nothing else in the file touched. |

## Behavior and interfaces

- **Behavior delivered:** `compareRows` classifies every row from a source
  and target row set into exactly one of the eight `RowDifferenceCategory`
  values. Composite keys are matched by concatenating all key-column values
  into one tuple key (via `JSON.stringify`), not by matching on the first
  key column only. A key value repeated more than once on one side marks
  every row sharing that key on that side as `"duplicate-in-source"`/
  `"duplicate-in-target"` (both sides independently — a key duplicated on
  *both* sides produces duplicate findings for every row on both sides and
  no `"matching"`/`"matched-key-differing-values"` finding for that key,
  since no reliable 1:1 pairing exists). For a uniquely-matched key pair,
  every mapped column (minus anything in `options.ignoreColumns`) is
  normalized via T-12's `applyNormalization` (using `rules[targetColumn]`
  if present) and compared via T-12's `valuesEqualWithinTolerance` (using
  `options.numericTolerance[targetColumn]` if present); any column
  difference after normalization produces `"matched-key-differing-values"`
  with a `columnDifferences` array naming every differing column and its
  normalized source/target values; zero differences produces `"matching"`.
  If normalizing/comparing a column throws, or a mapped column name isn't
  present on a row's side, the row is classified `"unable-to-compare"`
  rather than letting the error escape `compareRows` — verified by test
  (see below).

- **Interfaces consumed:**
  - `RecordBatch` (`packages/shared/src/types.ts`, read-only).
  - `ColumnMappingEntry` / `keys: string[]` from `packages/engine/src/orchestration/definition/definition.ts` (T-08's owned file, imported read-only — not edited).
  - `applyNormalization(value, rule)` / `valuesEqualWithinTolerance(a, b, tolerance)` from `packages/engine/src/comparison-core/normalization/normalization.ts` (T-12's owned file, imported read-only — not edited).

- **Interfaces produced:**
  - `compareRows(sourceRows: RowSet, targetRows: RowSet, keys: string[], mapping: ColumnMappingEntry[], rules: Record<string, NormalizationRule> = {}, options: RowCompareOptions = {}): RowDifference[]`
    where `RowSet = RecordBatch | unknown[][]` and
    `RowCompareOptions = { ignoreColumns?: string[]; numericTolerance?: Record<string, { absolute?: number; percentage?: number }> }`.
    **Judgment call, documented in the module's header comment:** for a
    `RecordBatch` input, its own `columns` array is used directly. For a
    bare `unknown[][]` input, this task had no independent column-name
    source, so column names are resolved positionally as `keys` followed by
    each mapping entry's source/target name, in that order — a caller using
    the bare-array form must lay out row values in that same order. All six
    tests in this task use the `RecordBatch` form (which has no such
    ordering constraint, since `columns` is explicit), so this positional
    convention is exercised only by the type signature, not by a test; it
    is documented as a judgment call in `row-level.ts`'s header comment for
    the reviewer to weigh.
  - `RowDifference`, `RowDifferenceCategory`, `RowColumnDifference` (`packages/shared/src/result.ts`).
  - `RowCompareOptions`, `RowSet` (`packages/engine/src/comparison-core/row-level/row-level.ts`).

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline (pre-change) | `npm run verify` | Exit 0. 16 test files, 339 tests passed. | Captured at session start, before any edit. |
| Red state | `npx vitest run packages/engine/src/comparison-core/row-level` (before creating any file under that directory) | `No test files found, exiting with code 0` — directory did not exist, matching the brief's predicted "module resolution failure" reason. After the test file was written (before `row-level.ts` existed): `Error: Failed to load url ./row-level.js ... Does the file exist?`, 1 failed suite, 0 tests run, non-zero exit. | Captured directly from command output during this session (not paraphrased). |
| Focused green state | `npx vitest run packages/engine/src/comparison-core/row-level` | `Test Files 1 passed (1)`, `Tests 6 passed (6)`. Exit 0. All 6 tests pass, including the literal `ORDER_ID = 1008924` worked example (STATUS → matches via `caseSensitive: false`; ORDER_AMOUNT → matches via `numericTolerance: { absolute: 0.01 }`; SHIP_DATE → matches via `truncateTo: "day"`; CUSTOMER_NAME → reported in `columnDifferences`, i.e. a difference, with no rule configured for it) and one composite-key test (`["order_id", "line_number"]`, two key columns). | Captured directly from command output during this session. |
| Full verification | `npm run verify` | `tsc -b --force` — no errors. `eslint .` — no errors. `vitest run` — `Test Files 17 passed (17)`, `Tests 345 passed (345)`. Explicit exit-code check: `npm run verify > /tmp/verify_out.txt 2>&1; echo "EXIT CODE: $?"` printed `EXIT CODE: 0`. 345 = 339 previously-passing + 6 new; no regressions. | Captured directly from command output during this session. |

## Assumptions and risks

- **Assumptions:**
  - `RowDifference.keyValues` is populated for every category, including
    `"missing-from-source"`/`"missing-from-target"` (the key value is known
    from whichever side the row actually came from) — a judgment call since
    the brief says "at minimum ... the row's key value(s)" without
    specifying whether a missing-side row still reports a key.
  - `columnDifferences` is `undefined` (not an empty array) for every
    category except `"matched-key-differing-values"`, so a consumer can
    branch on presence rather than length — mirrors the `sourceType`/
    `targetType` optional-field pattern already used in `SchemaDifference`.
  - Per-column numeric tolerance is exposed as a new `RowCompareOptions.numericTolerance`
    parameter (keyed by target column name) rather than reusing
    `NormalizationRule.numericTolerance` — `normalization.ts`'s own header
    comment documents that `applyNormalization` intentionally never applies
    `numericTolerance` (it's a two-value comparison concern, evaluated
    separately via `valuesEqualWithinTolerance`), so this task needed its
    own way to pass a per-column tolerance through to that function. This
    is additive to `RowCompareOptions` (declared in this task's own owned
    file), not a change to `NormalizationRule` itself.
  - Severity defaults per category (`matching` → Pass, `missing-from-*`/
    `matched-key-differing-values` → Failure, `duplicate-in-*` → Warning,
    `unable-to-compare` → Error, `ignored-by-rule` → Skipped) are a
    judgment call — the brief specifies the eight categories and the
    `severity`/`message` inheritance from `DifferenceItem` but does not
    prescribe severity-per-category. This mapping follows the existing
    `Severity` model's apparent intent (Pass for agreement, Failure for a
    genuine parity problem, Warning for a data-quality smell short of
    outright failure, Error for an inability to even evaluate) but a
    reviewer or T-15 (which wires this into the planner) may reasonably
    want this configurable instead of fixed.

- **Risks or limitations:**
  - The bare-`unknown[][]` `RowSet` branch's positional column-naming
    convention (`keys` then mapping names, in order) is documented but
    untested — every test in this task uses the `RecordBatch` form.
    Flagging this explicitly since the brief calls both forms "your
    choice" but expects the choice to be documented, not necessarily
    exhaustively tested for both branches.
  - Key values are tupled into a Map key via `JSON.stringify`. This is
    correct for the primitive key types Idea Prompt.md's examples use
    (numbers, strings) but would not distinguish, e.g., a key value of the
    string `"1"` from the number `1` if such a mismatch ever occurred
    across source/target key columns of different native types — not
    exercised by any test here, and not something `Idea Prompt.md`'s
    examples suggest is a real scenario, but worth a reviewer's attention
    given this is a correctness-sensitive matching mechanism.
  - No pagination/streaming — matches the brief's explicit scope
    ("assume both sides fit in memory for now").

- **Blockers:** None.

## Patch or commit identity

- **Commit:** see `git log -1 --format=%H task/T-14-row-level` after this
  report is committed (this report is included in that same commit, per
  the Implementer process's step 7/8 ordering).
- **Branch:** `task/T-14-row-level`

## Recommended next step

Independent review by the `reviewer` subagent (a separate instance from
this implementer), per `TASK-BRIEF.md`'s Handoff section — construct an
adversarial fixture set (a key duplicated on both sides simultaneously, a
mapped column that throws during normalization, a composite key whose
individual columns match but not in combination, an `ignoreColumns`-excluded
column that genuinely differs), and independently verify the `result.ts`
diff is purely additive to `RowDifference` only. This report does not
constitute review, approval, or a claim of release-readiness — those are
reserved for the reviewer and the human release-approval gate respectively.
