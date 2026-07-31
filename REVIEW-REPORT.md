# ParityLens — Review Report T-14

## Review independence statement

This review was performed by a separate agent instance from whoever
implemented T-14. No memory of writing `row-level.ts`/`row-level.test.ts`
or the `result.ts` diff exists in this session; findings below are derived
solely from reading the actual diff, running verification fresh, and
constructing independent adversarial fixtures not reused from the
implementer's test file (all deleted before this report was finalized —
confirmed via `git status --porcelain` after deletion showing only the
pre-existing, unrelated `package-lock.json` modification).

## Scope reviewed

- Branch `task/T-14-row-level`, commit `d1bb88b`, on top of `main` at
  `17b7aaa`.
- Files: `packages/engine/src/comparison-core/row-level/row-level.ts`
  (new), `packages/engine/src/comparison-core/row-level/row-level.test.ts`
  (new), `packages/shared/src/result.ts` (`RowDifference` refinement),
  `packages/shared/src/types.test.ts` (mechanical literal fix),
  `IMPLEMENTATION-REPORT.md`.
- Checked against `TASK-BRIEF.md` (sole authority per brief's own
  instruction) and `Idea Prompt.md` section 2 (lines 220-239) as the
  literal source of the eight-category list and the ORDER_ID = 1008924
  worked example.

## Findings

### Critical

NONE.

### Important

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| T-14-01 | The literal `ORDER_ID = 1008924` `ORDER_AMOUNT` test case does not actually exercise numeric-tolerance/normalization matching, and the underlying gap it masks is real: `compareRows` reports a **difference**, not "Match," when `ORDER_AMOUNT` is represented as the idea doc's own decimal-string forms (`"125.3700"` vs `"125.37"`). | `Idea Prompt.md` line 237 shows `125.3700` vs `125.37` as distinct string representations requiring tolerance/coercion to resolve to "Match" per the table's own `Result` column. The implementer's test (`row-level.test.ts:176-177`) instead supplies the **same parsed JS number** `125.37` on both sides, which is `===`-equal by definition — `valuesEqualWithinTolerance`'s first line (`if (a === b) return true;`, `normalization.ts:266`) short-circuits before `numericTolerance` is ever consulted. I independently reproduced this with a throwaway probe (deleted before finishing): removing `options.numericTolerance` entirely from the implementer's exact fixture still yields "Match" for `ORDER_AMOUNT`. I then fed `compareRows` the doc's actual string forms (`"125.3700"` vs `"125.37"`) with `numericTolerance: { absolute: 0.01 }` configured, and got `matched-key-differing-values` with `ORDER_AMOUNT` reported as differing — because `valuesEqualWithinTolerance` only applies tolerance to `typeof value === "number"` (`normalization.ts:270`), and `applyNormalization` never coerces numeric-looking strings to numbers. The brief's Interfaces table explicitly requires reproducing "this exact worked example (all four columns) as literal test cases," and lists `ORDER_AMOUNT: 125.3700 vs 125.37 → "Match"` as a load-bearing case, not an incidental one. | Either (a) add a genuine test using the doc's string-decimal forms and confirm/fix numeric-string coercion in the comparison path (likely needs a coercion step before `valuesEqualWithinTolerance`, which may implicate T-12's `normalization.ts` and would then need to be flagged as a blocker per the brief's own "stop and flag" instruction rather than edited directly), or (b) if the intended contract is that source/target values always arrive already-typed as JS numbers by the time they reach `compareRows` (plausible, given `RecordBatch.rows: unknown[][]` may already contain typed values from a real driver) — document that assumption explicitly in `row-level.ts`'s header comment and adjust the test/comment to make clear it is testing the *typed-number* case, not literally reproducing the doc's string forms, since as currently written the test reads as reproducing the string-form example but does not. |

### Minor

| ID | Finding | Evidence | Suggested resolution |
| --- | --- | --- | --- |
| T-14-02 | `RowCompareOptions.numericTolerance` duplicates configuration surface that already exists on `NormalizationRule.numericTolerance` (`definition.ts:67-70`), consumed via the same `rules: Record<string, NormalizationRule>` parameter `compareRows` already accepts, rather than reading `rule.numericTolerance` directly. | `row-level.ts:211-216`: `rule` (the resolved `NormalizationRule` for the column) is in scope at the exact point `valuesEqualWithinTolerance` is called, but only `options.numericTolerance?.[targetColumnName]` is read — `rule.numericTolerance` is never consulted. I confirmed by probe that supplying tolerance *only* via `rules[col].numericTolerance` (the mechanism `Idea Prompt.md` section 4 and `definition.ts` already define) has no effect — `compareRows` reports a false difference despite the value being within the configured tolerance, unless the caller *also* duplicates the same tolerance value into the new `RowCompareOptions.numericTolerance` map. The implementer's factual justification ("`applyNormalization` intentionally never applies `numericTolerance`") is accurate — verified directly in `normalization.ts` — but that's an argument for reading `rule.numericTolerance` separately at the comparison step (which `compareRows` already does, just from the wrong source), not an argument for inventing a second, differently-keyed config surface. T-13 (volume parity, the cited precedent) did not invent a parallel tolerance field; it consumed the tolerance already defined on its own owning type (`ParityChecks.rowCount.tolerance`). This is not a brief violation (the brief allows "your choice" on this interface shape, and `RowCompareOptions` is declared in this task's own owned file, not a prohibited edit), but it is an avoidable, disclosed judgment call that adds a footgun: a caller who populates `rules[column].numericTolerance` (the natural, already-documented place per Idea Prompt.md section 4) and doesn't know to *also* populate `RowCompareOptions.numericTolerance` gets silently stricter-than-intended results. Not blocking, since the implementer disclosed this exact tradeoff in the report rather than hiding it, and T-15 (which wires `compareRows` into the planner) can still choose to thread `rules[col].numericTolerance` through into `options.numericTolerance` at the call site, or this can be revisited with a follow-up task. | Recommend flagging this for the T-15 planner-integration task (or a small T-14 follow-up) to have `compareRows` read `rules[targetColumnName]?.numericTolerance` as a fallback when `options.numericTolerance[targetColumnName]` is absent, removing the double-configuration trap without any interface-breaking change. |
| T-14-03 | The bare-`unknown[][]` `RowSet` branch's positional column-naming convention is documented but genuinely untested. | `row-level.ts:271-278` (`resolveColumns`); implementer's own report, "Risks or limitations" section, first bullet. Confirmed real by code inspection — no test in `row-level.test.ts` uses a bare-array `RowSet` for either side (every test uses the `RecordBatch` form). | No action required beyond what's already tracked in the implementer's own report; recorded here because the brief asked the reviewer to independently verify disclosed risks are real, not just accept them at face value. |

## Adversarial verification performed (independent fixtures, not reused from implementer)

All six of the brief's/handbook's named adversarial scenarios were
constructed fresh in a throwaway file
(`packages/engine/src/comparison-core/row-level/__review-adversarial.test.ts`
plus a second throwaway probe file), run, observed, and then deleted
(confirmed via `git status --porcelain` after deletion — no residue
beyond this report and the pre-existing unrelated `package-lock.json`
diff).

1. **Key duplicated on BOTH source and target simultaneously.** Source has
   two rows with key `7`, target has two rows with key `7`. Result: 2×
   `duplicate-in-source` + 2× `duplicate-in-target`, zero `matching`/
   `matched-key-differing-values` findings for that key. Matches the
   documented behavior ("no reliable 1:1 pairing exists") and does not
   falsely match. **PASS.**

2. **A mapped column value that is fundamentally incomparable/throws
   during normalization.** First attempt (a nested-object value with a
   `truncateTo: "day"` rule) did NOT throw — `applyNormalization`/
   `valuesEqualWithinTolerance` degrade gracefully for non-string,
   non-date values (pass-through, then reference-inequality "differ"),
   so that particular case alone does not exercise `unable-to-compare`.
   I then constructed a genuine throw: a `NormalizationRule.timezone.source`
   of an invalid IANA zone name (`"Not/AZone"`), confirmed in isolation
   to cause `Intl.DateTimeFormat` inside `applyNormalization`
   (`normalization.ts`'s `getUtcOffsetMs`) to throw
   `RangeError: Invalid time zone specified`. Fed through `compareRows`,
   this correctly produced a single `unable-to-compare` finding with no
   exception escaping the function. **PASS** — the `try/catch` in
   `compareMatchedRow` is real, load-bearing code that catches genuine
   normalization throws, not merely a defensive no-op around the
   missing-column-name case.

3. **Composite key where individual key columns each match some row but
   not in the same combination.** Source `(100,1)`/`(200,2)`, target
   `(100,2)`/`(200,1)` — `order_id` values 100/200 and `line_number`
   values 1/2 both appear on both sides individually, but no row shares
   both simultaneously across sides. Result: all 4 rows classified
   `missing-from-target`/`missing-from-source`, zero false `matching`/
   `matched-key-differing-values`. Confirms composite-key tupling via
   `JSON.stringify([...keyValues])` is genuinely combination-based, not
   first-column-only. **PASS.**

4. **`ignoreColumns`-excluded column that genuinely differs.** Source/
   target rows differing in both `name` (ignored) and `amount` (not
   ignored). Result: `matched-key-differing-values` reporting only
   `amount` in `columnDifferences`; `name` is absent, confirmed by
   inspecting `row-level.ts:121-122` (`activeMapping` filters
   `ignoreColumns` out of the mapping array itself before any comparison
   runs, not merely out of the report afterward). **PASS** — the ignored
   column is excluded from comparison entirely, not just from the report.

5. (Additional probe, directly relevant to Finding T-14-02.) Supplying
   tolerance only via `rules[col].numericTolerance` without
   `options.numericTolerance` produces a false difference for values
   that should be within tolerance. Documented as T-14-02 (Minor) above.

6. (Additional probe.) Key value type mismatch (`1` vs `"1"`) across
   sides produces `missing-from-target` + `missing-from-source` rather
   than a false match — matching the implementer's own disclosed risk
   note in `IMPLEMENTATION-REPORT.md` ("would not distinguish ... a key
   value of the string `"1"` from the number `1`"). Confirmed as
   documented, non-silent behavior — fails safe (reports both as
   missing rather than silently merging them), not a new bug.

## Worked-example re-derivation (`Idea Prompt.md` section 2, lines 220-239)

Read the literal source text directly (not the implementer's
characterization): the eight-category list (lines 224-231) matches
`RowDifferenceCategory`'s eight string-literal union values verbatim,
kebab-cased consistently. The `ORDER_ID = 1008924` table (lines 233-239)
matches the test's reproduction verbatim for column names and claimed
results.

Independently re-checked whether each column genuinely requires
normalization to match (not strict equality), per the brief's explicit
instruction:

- **STATUS** `"Shipped"` vs `"SHIPPED"`: `"Shipped" === "SHIPPED"` is
  `false` in plain JS — genuinely requires `caseSensitive: false`
  normalization to match. Confirmed the test configures exactly this
  rule and the result is "Match after normalization." **Correct.**
- **ORDER_AMOUNT** `125.3700` vs `125.37`: see Finding T-14-01 above —
  the test's chosen representation (identical parsed JS numbers) makes
  this pairing trivially `===`-equal regardless of tolerance, which does
  not actually prove the tolerance path works for the doc's literal
  string-decimal forms. **Gap — see T-14-01.**
- **SHIP_DATE** `"2026-07-20 00:00:00"` vs `"2026-07-20"`: strict string
  equality is `false`; genuinely requires `truncateTo: "day"`
  normalization (both parse as the same UTC calendar day once
  normalized). Confirmed the test configures this rule and independently
  re-ran `applyNormalization` in isolation to confirm both values reduce
  to the same ISO string after day-truncation. **Correct.**
- **CUSTOMER_NAME** `"Acme Inc."` vs `"Acme, Inc."`: confirmed no
  `NormalizationRule` is configured for `CUSTOMER_NAME` in the test, and
  no existing `NormalizationRule` field (checked all seven fields in
  `definition.ts:63-77`: `trim`, `caseSensitive`, `collapseWhitespace`,
  `numericTolerance`, `timezone`, `truncateTo`, `nullEquivalents`) would
  incorrectly resolve a comma-insertion difference like this as equal —
  none of those transforms would touch internal punctuation. Confirmed
  the result is reported as a genuine `columnDifferences` entry, not
  silently passed. **Correct.**

## Scope and ownership check

- `git diff main..task/T-14-row-level --stat`: only the five files listed
  in Scope above changed. No changes under
  `packages/engine/src/orchestration/**`,
  `packages/engine/src/comparison-core/mapping/**`,
  `packages/engine/src/comparison-core/normalization/**`,
  `packages/engine/src/orchestration/definition/definition.ts`, or
  `packages/extension/**` — confirmed via targeted `git diff --stat`
  against each path, all empty.
- `result.ts` diff (`git diff main..task/T-14-row-level --
  packages/shared/src/result.ts`) is a single unified diff hunk touching
  only the `RowDifference` placeholder region (old line 128 onward) —
  `SchemaDifference`, `ProfileDifference`, and `AggregateDifference`
  definitions above that hunk are byte-for-byte absent from the diff,
  confirming they are untouched. **Purely additive, as required.**
- `types.test.ts` edit (`packages/shared/src/types.test.ts`, 2 lines) is
  outside T-14's declared `packages/engine/src/comparison-core/row-level/**`
  ownership, but is the minimal, mechanically-forced consequence of
  widening `RowDifference` from a type alias to a required-field
  interface (verified: `tsc -b --force` genuinely fails without this fix,
  since the `rowDifferences` literal in that test predates T-14 and
  lacked the new required `category`/`keyValues` fields). This is the
  same precedent T-13 already established for the identical situation
  (`AggregateDifference` widening forcing the same file's
  `aggregateDifferences` literal to be updated) — acceptable, not scope
  creep.
- No hash-based row comparison logic (T-20's scope) found —
  `grep -in "hash\|sample\|chunk" row-level.ts` returns nothing.
- No sampling/chunking strategy (T-21's scope) present.
- `ignoreColumns?: string[]` is the only ignore-rule mechanism —
  confirmed no expression parser, predicate DSL, or rule-engine code
  exists; it's a flat `Set<string>` membership filter
  (`row-level.ts:121-122`).

## Verification performed

| Check | Command | My result | Implementer's claim | Match? |
| --- | --- | --- | --- | --- |
| Full verify | `npm run verify` | `tsc -b --force` clean, `eslint .` clean, `vitest run`: **17 test files, 345 tests passed**, exit 0 | 17 test files, 345 tests passed, exit 0 | Yes |
| Focused (row-level) | `npx vitest run packages/engine/src/comparison-core/row-level` | Included in full run above: `row-level.test.ts (6 tests)` all passed | 6/6 passed | Yes |

Fresh run performed independently in this session (not reusing the
implementer's captured output).

## Disposition of prior findings this task was meant to resolve

None — T-14 is new work (row-level parity did not exist before this
task); there is no prior open finding in `PROGRESS-LEDGER.md` scoped to
`row-level/**` that this task was required to close.

## Judgment calls evaluated

- **`RowCompareOptions.numericTolerance` as a new surface vs. reusing
  `NormalizationRule.numericTolerance` vs. flagging a blocker:** the
  implementer's factual claim ("`applyNormalization` intentionally never
  applies `numericTolerance`") is verified TRUE by direct inspection of
  `normalization.ts` (header comment lines 19-24, and the field is never
  referenced inside `applyNormalization`'s body). However, the
  conclusion drawn from that fact — that a *new*, differently-keyed
  config surface was needed — does not follow, because
  `NormalizationRule.numericTolerance` was still available for
  `compareRows` to read directly at the comparison step, exactly where
  `valuesEqualWithinTolerance` is called with `rule` already in scope.
  This wasn't a genuine type gap requiring a blocker (the brief's "stop
  and flag" instruction is for when `definition.ts` is missing a field
  T-14 needs — it is not missing one here), so declining to flag a
  blocker was correct; but the chosen alternative (invent a parallel
  surface) was avoidable and creates the double-configuration trap in
  T-14-02. Downgraded to Minor rather than Important because: it's
  additive/non-breaking, fully disclosed by the implementer rather than
  hidden, does not violate any explicit brief prohibition, and is
  trivially fixable by whichever task next touches this function (T-15)
  without any interface break.
- **Severity-per-category mapping:** reviewed against the `Severity`
  enum (`Pass | Informational | Warning | Failure | Error | Skipped`,
  `result.ts:22`). The chosen mapping (`matching`→Pass,
  `missing-from-*`/`matched-key-differing-values`→Failure,
  `duplicate-in-*`→Warning, `unable-to-compare`→Error,
  `ignored-by-rule`→Skipped) uses only valid enum values, is internally
  consistent (genuine parity problems are Failure, data-quality smells
  are Warning, inability-to-evaluate is Error, explicit exclusions are
  Skipped), and is not arbitrary. Reasonable as a default; the
  implementer's own suggestion that this become configurable in T-15 is
  sound but out of this task's scope to build now.

## Final approval status

**CHANGES REQUIRED**

One Important finding (T-14-01) blocks approval: the brief's own
load-bearing instruction to "reproduce this exact worked example (all
four columns) as literal test cases" is not actually satisfied for the
`ORDER_AMOUNT` column as literally written in `Idea Prompt.md` (string
decimal forms `125.3700`/`125.37`) — the test as written proves a
different, easier case (identical typed JS numbers) and the harder case
the doc actually shows is unhandled or at least unverified. This does
not require reverting anything already built; it requires either a
correctness fix (if numeric-string coercion is genuinely needed here) or
an explicit, corrected test plus a documented assumption (if typed-number
input is the intended contract) before this task can be marked complete.

Two Minor findings (T-14-02, T-14-03) do not block approval but should be
tracked — T-14-02 in particular is worth flagging to whoever owns T-15's
planner-integration task, since it silently produces
stricter-than-configured comparisons if a caller relies on
`NormalizationRule.numericTolerance` alone.

All four adversarial scenarios named in the brief's Handoff note (key
duplicated on both sides, genuinely-throwing normalization value,
composite-key cross-match false positive, `ignoreColumns` genuine
exclusion) passed independent probing. `RowDifference`'s refinement in
`result.ts` is confirmed purely additive, with no changes to
`SchemaDifference`, `ProfileDifference`, or `AggregateDifference`. No
scope creep (hash-comparison, sampling/chunking, or an
expression-based ignore-rule engine) was found, and no edits exist
outside T-14's declared ownership beyond the same mechanically-forced
`types.test.ts` precedent T-13 already established. Fresh `npm run
verify` matches the implementer's claimed 345/345 tests, exit 0, exactly.
