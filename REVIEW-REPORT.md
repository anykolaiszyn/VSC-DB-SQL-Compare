# ParityLens — Review Report T-14 (Round 2 — follow-up fix)

## Review independence statement

This review was performed by a separate agent instance from whoever wrote
the round-1 review (`f8a72d9`) or the round-2 follow-up fix (`bcde56a`).
No memory of either exists in this session. Findings below are derived
solely from reading the actual diff, re-deriving the round-1 finding from
first principles, running `npm run verify` fresh myself, and constructing
an independent adversarial test file (not reusing any fixture from
`row-level.test.ts`) that was run and then deleted before this report was
finalized — confirmed via `git status --porcelain` showing only the
pre-existing, unrelated `package-lock.json` modification.

## Scope reviewed

- Branch `task/T-14-row-level`, commit `bcde56a`, on top of `f8a72d9`
  (round-1 review report, disposition CHANGES REQUIRED) on top of
  `d1bb88b` (original implementation) on `main` at `17b7aaa`.
- This round's diff (`git diff f8a72d9 bcde56a --stat`): exactly three
  files — `IMPLEMENTATION-REPORT.md`,
  `packages/engine/src/comparison-core/row-level/row-level.ts`,
  `packages/engine/src/comparison-core/row-level/row-level.test.ts`.
- Checked against `TASK-BRIEF.md` (sole authority, unchanged since round 1)
  and round 1's `T-14-01`/`T-14-02`/`T-14-03` findings as the object of
  this round's re-verification.

## Disposition of prior findings

| ID | Round 1 severity | Round 2 disposition |
| --- | --- | --- |
| T-14-01 | Important (blocking) | **RESOLVED — independently confirmed** |
| T-14-02 | Minor | **RESOLVED — independently confirmed** |
| T-14-03 | Minor | Left open, as explicitly directed by round 1's own disposition ("no action required"/non-blocking, not re-flagged) |

### T-14-01 — independent re-verification

**Claimed fix:** a new local `coerceNumericString(value)` helper in
`row-level.ts` (this task's own owned file) that converts a numeric-looking
string to a JS number, applied to both sides' normalized values immediately
before `valuesEqualWithinTolerance`, but *only* when a numeric tolerance
resolves truthy for that column (`tolerance = options.numericTolerance?.[col] ?? rule?.numericTolerance`).

**(a) `normalization.ts` genuinely untouched.** Ran
`git diff main..task/T-14-row-level -- packages/engine/src/comparison-core/normalization/`
myself: empty output. Also ran
`git diff f8a72d9 bcde56a -- packages/engine/src/comparison-core/normalization/ packages/shared/ packages/engine/src/orchestration/ packages/engine/src/comparison-core/mapping/ packages/extension/`
(the full set of prohibited-by-this-task paths): empty output. Confirmed —
T-12's, T-08's, and T-09's/T-15's owned files are all untouched by this
follow-up.

**(b) Doc's literal string forms now resolve as a match.** I wrote a fresh,
independent test file
(`packages/engine/src/comparison-core/row-level/__review-t14-round2.test.ts`,
deleted after use — see below) using my own column layout and mapping,
not the implementer's fixture object, and fed `compareRows` the exact
literal strings `"125.3700"` (source) vs `"125.37"` (target) with
`numericTolerance: { absolute: 0.01 }` configured for that column. Result:
`category: "matching"`, one result, no `columnDifferences`. **Confirmed
resolved** — this was the exact case round 1 found broken (previously
`matched-key-differing-values` with `ORDER_AMOUNT` incorrectly reported as
differing).

**(c) Coercion is narrowly scoped — no false matches, no regressions.**
Four additional independent probes, all passing:

1. Two genuinely different numeric-looking strings (`"100.00"` vs
   `"999.99"`) *with* tolerance configured (`absolute: 0.01`, far smaller
   than the actual difference): still correctly reported as
   `matched-key-differing-values` with `ORDER_AMOUNT` in
   `columnDifferences`. Tolerance-aware coercion does not turn into an
   unconditional fuzzy-string-match — the tolerance bound is still
   enforced after coercion.
2. Same literal strings (`"125.3700"` vs `"125.37"`) with **no** tolerance
   configured anywhere (`{}` for both `rules` and `options`): correctly
   reported as `matched-key-differing-values`, `ORDER_AMOUNT` differing.
   Confirms the coercion is gated on `tolerance` being truthy, not applied
   unconditionally to every numeric-looking string.
3. Two non-numeric strings (`"abc"` vs `"xyz"`) with tolerance configured
   for that column: correctly reported as differing, not coerced to `NaN`
   and short-circuited into a false "equal" or false "unequal" via a
   `NaN`-comparison artifact — `coerceNumericString`'s
   `Number.isFinite(parsed)` guard correctly leaves non-numeric strings
   as-is, and `valuesEqualWithinTolerance` falls through to `===` on the
   original strings.
4. `CUSTOMER_NAME`'s exact-string-difference case (`"Acme Inc."` vs
   `"Acme, Inc."`, no `NormalizationRule` configured for that column) still
   reports as a genuine `matched-key-differing-values` finding with exactly
   that one column in `columnDifferences`, even in a scenario where
   `ORDER_AMOUNT` on the same row *is* tolerance-configured and coerced —
   confirming the coercion is applied per-column (gated on that column's
   own resolved `tolerance`), not row-globally.

All 7 of my independent probes (4 above plus 3 for T-14-02, below) passed
on the first run with no code changes needed — see Verification section
for the exact command and output.

### T-14-02 — independent re-verification

**Claimed fix:** `const tolerance = options.numericTolerance?.[col] ?? rule?.numericTolerance;`
— `compareMatchedRow` now falls back to the standard
`NormalizationRule.numericTolerance` field when `RowCompareOptions.numericTolerance`
has no entry for that column, with `options` still taking precedence when
both are configured.

I constructed two independent probes:

1. Tolerance supplied **only** via `rules[col].numericTolerance`
   (`{ absolute: 0.5 }`), with `options` entirely `{}` (no
   `numericTolerance` key at all) — source `100.0`, target `100.3` (typed
   numbers, well within 0.5). Result: `category: "matching"`. **Confirmed
   resolved** — this is exactly the double-configuration trap round 1
   identified; it no longer requires the caller to duplicate the tolerance
   into `RowCompareOptions`.
2. Precedence check: `rules[col].numericTolerance = { absolute: 5 }`
   (would tolerate the 0.3 difference) *and*
   `options.numericTolerance.ORDER_AMOUNT = { absolute: 0.01 }` (would not)
   configured simultaneously. Result: `category: "matched-key-differing-values"`
   — confirms `options.numericTolerance` wins when both are present,
   matching the documented precedence in the interface's header comment
   and `IMPLEMENTATION-REPORT.md`'s claim.

### T-14-03 — left open, as directed

Per round 1's own disposition, this was explicitly non-blocking
("no action required beyond what's already tracked"). The follow-up's own
scope note confirms it was deliberately left untouched. I did not re-probe
it since nothing in this round's diff touches `resolveColumns` or the
bare-`unknown[][]` branch, and round 1 already recorded it as accepted,
tracked debt rather than an open blocker. Not re-flagged.

## New findings this round

### Critical

NONE.

### Important

NONE.

### Minor

NONE new. (T-14-03 carried forward, unchanged, per above — not a new
finding.)

## Adversarial verification performed (independent fixtures, not reused from implementer)

Constructed fresh in a throwaway file
(`packages/engine/src/comparison-core/row-level/__review-t14-round2.test.ts`),
using my own column ordering, mapping objects, and row values distinct
from every fixture in `row-level.test.ts`. Run via
`npx vitest run packages/engine/src/comparison-core/row-level/__review-t14-round2.test.ts`:
**7/7 passed** on first run. File deleted immediately after; confirmed via
`git status --porcelain` showing only the pre-existing unrelated
`package-lock.json` modification (no residue).

Covered: doc's literal string forms resolving to match (T-14-01b);
tolerance-bound still enforced after coercion, not an unconditional fuzzy
match (T-14-01c-1); no coercion at all when no tolerance is configured
anywhere (T-14-01c-2); non-numeric strings not silently coerced or
NaN-matched (T-14-01c-3); CUSTOMER_NAME's exact-difference case unaffected
even on a row where a sibling column is tolerance-coerced (T-14-01c-4);
`rules[col].numericTolerance`-only fallback honored (T-14-02-1);
`options.numericTolerance` precedence over `rules[col].numericTolerance`
when both configured (T-14-02-2).

## Scope and ownership check

- `git diff f8a72d9 bcde56a --stat`: exactly three files —
  `IMPLEMENTATION-REPORT.md`,
  `packages/engine/src/comparison-core/row-level/row-level.ts`,
  `packages/engine/src/comparison-core/row-level/row-level.test.ts`. Both
  source files are within T-14's declared ownership
  (`packages/engine/src/comparison-core/row-level/**`).
- No changes to `packages/shared/src/result.ts`,
  `packages/engine/src/orchestration/**`,
  `packages/engine/src/comparison-core/mapping/**`,
  `packages/engine/src/comparison-core/normalization/**`, or
  `packages/extension/**` — confirmed via targeted `git diff --stat`
  against each path (all empty) and directly by re-reading
  `normalization.ts` (unmodified from what round 1 already reviewed).
- No new interface signature break: `compareRows`'s exported signature is
  unchanged; `coerceNumericString` is a private, unexported helper.
- No scope creep beyond the two findings this follow-up was dispatched to
  fix — no hash-comparison, sampling, or ignore-rule-engine code
  introduced; `grep`-equivalent inspection of the diff shows only the
  `coerceNumericString` helper, its call site, and the `?? rule?.numericTolerance`
  fallback, plus doc-comment updates and two new tests.

## Verification performed

| Check | Command | My result | Report's claim | Match? |
| --- | --- | --- | --- | --- |
| Full verify | `npm run verify` | `tsc -b --force` clean, `eslint .` clean, `vitest run`: **17 test files, 347 tests passed**, exit 0 | 17 test files, 347 tests passed, exit 0 | Yes |
| Focused (row-level) | included in full run | `row-level.test.ts (8 tests)` all passed | 8/8 passed | Yes |
| Independent adversarial probe | `npx vitest run .../__review-t14-round2.test.ts` (throwaway, deleted after) | 7/7 passed | N/A — not part of implementer's evidence | New evidence, not a re-check |
| Residue check | `git status --porcelain` after deleting probe file | Only pre-existing unrelated `package-lock.json` diff | N/A | Clean |

Fresh run performed independently in this session (not reusing the
implementer's captured output, and not reusing round 1's captured output
either).

## Final approval status

**APPROVED**

T-14-01 (the sole blocking finding from round 1) is genuinely resolved,
confirmed via independent reproduction of the exact failing case (doc's
literal `"125.3700"`/`"125.37"` string forms) plus four additional
adversarial probes constructed fresh for this round, none of which reused
the implementer's fixtures. The fix is correctly and narrowly scoped: it
does not introduce false matches for genuinely different tolerance-bound
values, does not activate at all when no tolerance is configured, does not
mishandle non-numeric strings, and does not disturb `CUSTOMER_NAME`'s
exact-difference behavior even on a row where a sibling column is
coerced. `normalization.ts` (T-12's owned file) is confirmed untouched by
direct diff, satisfying the brief's "do not touch" constraint and the
round-1 review's own conditional guidance.

T-14-02 is also genuinely resolved: tolerance supplied only via
`rules[col].numericTolerance` is now honored without requiring duplication
into `RowCompareOptions.numericTolerance`, and `options.numericTolerance`
correctly retains precedence when both are configured.

T-14-03 remains open as non-blocking, tracked debt, per round 1's own
disposition — not re-flagged, not re-litigated.

No new Critical, Important, or Minor findings were identified in this
round. Scope is confirmed limited to `row-level.ts`/`row-level.test.ts`/
`IMPLEMENTATION-REPORT.md`, all within T-14's declared ownership. Fresh
`npm run verify` matches the implementer's claimed 347/347 tests, exit 0,
exactly.

**T-14 is approved and ready for reconciliation into `main`.**
