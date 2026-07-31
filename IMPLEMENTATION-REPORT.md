# ParityLens — Implementation Report T-14

## Status and objective

- **Status:** COMPLETE (implementation and evidence only — not reviewed or approved; see Recommended next step). Updated after `REVIEW-REPORT.md`'s CHANGES REQUIRED disposition — see "Follow-up fix: T-14-01 / T-14-02 (REVIEW-REPORT.md)" below for what changed in this revision and why.
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
| `packages/engine/src/comparison-core/row-level/row-level.ts` | New (this session's original commit), then revised (this follow-up) to add `coerceNumericString` and a `rules[column].numericTolerance` fallback inside `compareMatchedRow` — see the follow-up section below. `compareRows(sourceRows, targetRows, keys, mapping, rules?, options?)` and supporting helpers. | Files owned by this task per `TASK-BRIEF.md`. |
| `packages/engine/src/comparison-core/row-level/row-level.test.ts` | New (original commit: six tests), then revised (this follow-up) to add two tests: the doc's literal `ORDER_AMOUNT` decimal-string forms (`"125.3700"` vs `"125.37"`), and a `rules[column].numericTolerance`-only fallback case. Eight tests total: classification categories, target-side-only duplicate, `ignoreColumns`, unable-to-compare, composite key, the literal `ORDER_ID = 1008924` worked example (typed-number form), the literal-string-decimal form of the same example, and the tolerance-fallback case. | Red-state evidence + green-state proof, per brief's Red-state/Green-state sections; follow-up tests are T-14-01/T-14-02's own red/green evidence. |
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
| Full verification (original commit) | `npm run verify` | `tsc -b --force` — no errors. `eslint .` — no errors. `vitest run` — `Test Files 17 passed (17)`, `Tests 345 passed (345)`. Explicit exit-code check: `npm run verify > /tmp/verify_out.txt 2>&1; echo "EXIT CODE: $?"` printed `EXIT CODE: 0`. 345 = 339 previously-passing + 6 new; no regressions. | Captured directly from command output during this session. |

See "Follow-up fix: T-14-01 / T-14-02" below for this revision's own red/green/full-verification evidence (347 tests).

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
  - Per-column numeric tolerance is exposed as a `RowCompareOptions.numericTolerance`
    parameter (keyed by target column name), which now (as of this
    follow-up) falls back to `rules[targetColumn]?.numericTolerance` when
    absent — see "Follow-up fix: T-14-01 / T-14-02" below. `normalization.ts`'s
    own header comment documents that `applyNormalization` intentionally
    never applies `numericTolerance` itself (it's a two-value comparison
    concern, evaluated separately via `valuesEqualWithinTolerance`), so
    tolerance evaluation — including reading whichever of the two possible
    sources supplies it — is this task's responsibility at the comparison
    step. This is additive to `RowCompareOptions` (declared in this task's
    own owned file), not a change to `NormalizationRule` itself.
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

## Follow-up fix: T-14-01 / T-14-02 (REVIEW-REPORT.md)

`REVIEW-REPORT.md`'s disposition was **CHANGES REQUIRED**, blocked on one
Important finding, `T-14-01`. This section documents the fix, per that
review's own two suggested options.

### T-14-01 (Important, blocking) — resolved via option (a)

**Finding, quoted from `REVIEW-REPORT.md`:** the original `ORDER_AMOUNT`
test supplied "the same parsed JS number `125.37` on both sides, which is
`===`-equal by definition," so it never actually exercised numeric
tolerance/coercion, and feeding `compareRows` the doc's literal
decimal-string forms (`"125.3700"` vs `"125.37"`) produced a **false
difference** rather than "Match."

**Choice made: option (a)** — add genuine numeric-string coercion to the
comparison path, plus a real test using the doc's literal string forms.
Not option (b), because the review's own root-cause analysis is correct
and the gap is real, not a documentation mismatch: `Idea Prompt.md`
section 2's own worked-example table literally writes `125.3700` and
`125.37` as distinct textual representations (not two instances of the
same parsed number), and the brief's Interfaces table explicitly lists
`ORDER_AMOUNT: 125.3700 vs 125.37 → "Match"` as one of the four columns
to "reproduce ... as literal test cases." Declaring "values arrive
already-typed as JS numbers" as the intended contract (option b) would
require asserting that the doc's own literal example is out of scope for
this task to actually satisfy — that is not a defensible reading of a
brief that quotes the doc's exact numbers as a requirement.

Per the review's own conditional in option (a) — "but if this requires
editing `normalization.ts` ... do NOT edit it; instead do the coercion
locally within `row-level.ts`" — the fix is entirely local to
`row-level.ts` (this task's own owned file). `normalization.ts` (T-12's
owned file) is untouched; confirmed via `git diff main..task/T-14-row-level
-- packages/engine/src/comparison-core/normalization/` returning no
output.

**What changed in `row-level.ts`:**

- A new local helper, `coerceNumericString(value)`: converts a
  numeric-looking string (via `Number(trimmed)` + `Number.isFinite`) to a
  JS number; returns any non-string value, or a string that doesn't parse
  as a finite number, unchanged.
- In `compareMatchedRow`, immediately before calling
  `valuesEqualWithinTolerance`: `sourceForComparison`/`targetForComparison`
  are computed by applying `coerceNumericString` to the already-normalized
  values — but **only when a numeric tolerance actually applies to this
  column** (`tolerance` is truthy). This scoping is deliberate: a column
  with no configured tolerance is unaffected by this change at all, so
  every one of the six pre-existing tests (e.g. `CUSTOMER_NAME`'s "Acme
  Inc." vs "Acme, Inc." exact-string-difference case, which must NOT be
  coerced or fuzzy-matched) keeps its exact prior semantics. Only
  `columnDifferences`' reported values continue to use the
  *pre-coercion* `sourceNormalized`/`targetNormalized` values (not the
  coerced numbers), so a difference report still shows the caller's
  original representation, not an internal comparison artifact.

### T-14-02 (Minor, non-blocking) — folded in

Judgment call: **in scope**, not deferred to T-15. The suggested change
(`compareRows` falling back to `rules[targetColumnName]?.numericTolerance`
when `options.numericTolerance[targetColumnName]` is absent) is small,
additive, entirely within `row-level.ts` (already-owned file, and the
exact same function this follow-up is already editing for T-14-01), and
directly adjacent to the T-14-01 fix — the `tolerance` variable T-14-01's
coercion logic depends on is the same one this fallback affects. Fixing
both in the same pass avoided touching the same three lines twice for two
separate reviewer findings in the same function.

**What changed:** `const tolerance = options.numericTolerance?.[targetColumnName] ?? rule?.numericTolerance;`
— `options.numericTolerance` still takes precedence when both are
configured (documented in `RowCompareOptions`'s header comment); a caller
that only configured tolerance via the standard `NormalizationRule.numericTolerance`
field is no longer forced to duplicate it into `RowCompareOptions.numericTolerance`
as well.

T-14-03 (untested bare-array `RowSet` branch) was left untouched, per the
dispatch instruction ("accepted as non-blocking per the review").

### Red-state evidence (T-14-01)

**Command:** `npx vitest run packages/engine/src/comparison-core/row-level`
(run immediately after adding the new literal-string-decimal test, before
touching `row-level.ts`'s comparison logic):

```
 ❯ row-level.test.ts (7 tests | 1 failed)
   × compareRows > Idea Prompt.md section 2 worked example: ORDER_ID = 1008924 >
     reports Match for ORDER_AMOUNT using the doc's literal decimal-string forms (125.3700 vs 125.37)
     → expected [ { …(3) }, { …(3) } ] to deeply equal [ { …(3) } ]

AssertionError: expected [ { …(3) }, { …(3) } ] to deeply equal [ { …(3) } ]
- Expected
+ Received
  Array [
    Object {
+     "columnName": "ORDER_AMOUNT",
+     "sourceValue": "125.3700",
+     "targetValue": "125.37",
+   },
+   Object {
      "columnName": "CUSTOMER_NAME",
      "sourceValue": "Acme Inc.",
      "targetValue": "Acme, Inc.",
    },
  ]

 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)
```

Failed for exactly the predicted reason: `ORDER_AMOUNT` surfaced as a
false `columnDifferences` entry instead of being absent, confirming the
review's reproduction before any fix was applied.

### Green-state evidence (T-14-01 + T-14-02)

**Command:** `npx vitest run packages/engine/src/comparison-core/row-level`
(after the `coerceNumericString` fix and the `rules[column].numericTolerance`
fallback, and after adding the T-14-02 fallback test):

```
 ✓ packages/engine/src/comparison-core/row-level/row-level.test.ts (8 tests) 7ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
```

All 8 tests pass (the original 6, plus the T-14-01 literal-string-decimal
test, plus the T-14-02 fallback test).

### Full verification evidence (this follow-up)

**Command:** `npm run verify`

```
> tsc -b --force        (no output — clean)
> eslint .              (no output — clean)
> vitest run

 Test Files  17 passed (17)
      Tests  347 passed (347)
```

347 = 345 previously-passing (per the original `IMPLEMENTATION-REPORT.md`
entry above) + 2 new tests (T-14-01's literal-string-decimal case,
T-14-02's fallback case). No regressions — all 17 test files pass, `tsc`
and `eslint` both clean, exit 0.

### Scope check for this follow-up

`git diff --stat` (working tree, this follow-up only, before commit)
touches exactly two files:
`packages/engine/src/comparison-core/row-level/row-level.ts` and
`packages/engine/src/comparison-core/row-level/row-level.test.ts` — both
within `TASK-BRIEF.md`'s declared ownership
(`packages/engine/src/comparison-core/row-level/**`). `normalization.ts`,
`result.ts`, and every other file are untouched by this follow-up. The
pre-existing, unrelated `package-lock.json` modification already present
in the working tree before this session began was left alone.

## Patch or commit identity

- **Original commit:** `d1bb88b` (reviewed in `REVIEW-REPORT.md`).
- **This follow-up's commit:** see `git log -1 --format=%H task/T-14-row-level`
  after this report is committed (this report is included in that same
  commit, per the Implementer process's step 7/8 ordering). Built on top
  of `d1bb88b` and the review-report commit `f8a72d9`, on the same branch.
- **Branch:** `task/T-14-row-level` (unchanged — no new branch created for
  this follow-up, per dispatch instructions).

## Recommended next step

Independent review of this follow-up commit by the `reviewer` subagent (a
separate instance from this implementer and, ideally, from whoever
performed the original `REVIEW-REPORT.md` review, though the brief does
not require a *different* reviewer for a follow-up on the same task) —
specifically re-verify: (1) the doc's literal `"125.3700"`/`"125.37"`
string forms now genuinely resolve to "Match" via
`compareRows`, not merely via the new test's own assertions; (2) the
`coerceNumericString` scoping (applied only when `tolerance` is truthy)
does not silently change behavior for any column without a configured
numeric tolerance — in particular, re-confirm `CUSTOMER_NAME`'s
`"Acme Inc."` vs `"Acme, Inc."` still reports as a genuine difference,
not a false match; (3) the `rules[column].numericTolerance` fallback does
not change behavior when `options.numericTolerance` already has an entry
for that column (precedence order); (4) `normalization.ts` is genuinely
untouched by this follow-up. This report does not constitute review,
approval, or a claim of release-readiness — those are reserved for the
reviewer and the human release-approval gate respectively.
