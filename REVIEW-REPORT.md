# ParityLens — Review Report T-07 (re-review after I-02 fix)

## Review independence

This re-review was performed by a Claude Code Independent Reviewer subagent,
distinct from both the T-07 implementer subagent and the subagent that
authored the original T-07 review (the "CHANGES REQUIRED" pass recorded
below in "Prior-finding disposition"). No implementation file,
`TASK-BRIEF.md`, or `IMPLEMENTATION-REPORT.md` was edited during this review.
Only this file (`REVIEW-REPORT.md`) was written — it replaces the prior T-07
review report in place, per this project's one-report-per-task-per-round
convention (the prior review's full findings are preserved below under
"Prior-finding disposition" rather than deleted).

## Review scope

- **Task objective (unchanged from original review):** Implement
  `profileColumn` (general + type-family-specific column profiling metrics)
  and `compareProfiles` (source-vs-target profile comparison surfacing only
  meaningful changes), and refine `ProfileDifference` in
  `packages/shared/src/result.ts`.
- **This round's scope:** Verify the I-02 fix (commit `4246ce2`) is real,
  correct, and correctly scoped, and confirm no regression was introduced.
  The original review's already-accepted items (the `types.test.ts`
  mechanical edit, and `compareProfiles`'s meaningful-change filtering,
  both verified in the original review) were **not** re-litigated per
  instruction — they are carried forward as already-resolved in this
  report's scope.
- **Files and interfaces reviewed this round:**
  - `git show 4246ce2 -- packages/engine/src/comparison-core/profiling/profiling.ts` (full diff)
  - `git show 4246ce2 -- packages/engine/src/comparison-core/profiling/profiling.test.ts` (full diff)
  - `packages/engine/src/comparison-core/profiling/profiling.ts` (current full state)
  - `packages/engine/fixtures/postgres-products.ts` (full read, hand-recomputed from scratch, independent of the implementer's or the prior review's arithmetic)
  - `IMPLEMENTATION-REPORT.md`, including the "Addendum: I-02 fix" section in full
  - `TASK-BRIEF.md` line 44 (interfaces table row, re-read directly, not from any report's quotation)
  - `git show --stat 4246ce2` (scope check)
- **Evidence reviewed:** Fresh `npx vitest run packages/engine`, fresh `npm run verify`, independent hand-computed median/sample-stddev arithmetic performed from raw fixture literals (not copied from the implementation report or test comments).

## Critical findings

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| NONE | | | |

## Important findings

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| NONE | | | |

## Minor findings

| ID | Finding | Evidence | Suggested resolution |
| --- | --- | --- | --- |
| NONE | | | |

## I-02 fix verification

**1. The fix is real.** `git show 4246ce2 -- packages/engine/src/comparison-core/profiling/profiling.ts`
shows `MEDIAN(${quotedColumn}) AS median_value` and
`STDDEV_SAMP(${quotedColumn}) AS stddev_value` added to the same single-pass
`SELECT` query `computeNumericMetrics` already issues (alongside
`MIN`/`MAX`/`AVG`/the zero/negative/positive `CASE WHEN` sums), and the
returned object now includes `median: toNumber(row.median_value)` and
`stddev: toNumber(row.stddev_value)`. The `NumericMetrics` interface (current
`profiling.ts` lines 60-69) now declares `median: number` and
`stddev: number` as required (non-optional) fields, matching
`TASK-BRIEF.md` line 44's contract verbatim: "numeric metrics
(min/max/mean/median/stddev, zero/negative/positive counts)". Confirmed by
direct read of the current file, not just the diff.

**2. Independently redone arithmetic (from scratch, not checking the
implementer's math).** `packages/engine/fixtures/postgres-products.ts` lines
34-40, `products_source` table, `price` column values in row order: 9.99,
19.99, 49.99, 14.50, 89.00 (n = 5).

*Median:* sorted ascending = [9.99, 14.50, 19.99, 49.99, 89.00]. n = 5 (odd),
so the median is the 3rd (middle) value = **19.99**.

*Sample standard deviation:*

- Sum = 9.99 + 19.99 + 49.99 + 14.50 + 89.00 = 183.47
- Mean = 183.47 / 5 = 36.694
- Deviations from mean: 9.99 − 36.694 = −26.704; 19.99 − 36.694 = −16.704;
  49.99 − 36.694 = 13.296; 14.50 − 36.694 = −22.194; 89.00 − 36.694 = 52.306
- Squared deviations: (−26.704)² = 713.103616; (−16.704)² = 279.023616;
  (13.296)² = 176.783616; (−22.194)² = 492.573636; (52.306)² = 2735.917636
- Sum of squared deviations = 713.103616 + 279.023616 + 176.783616 +
  492.573636 + 2735.917636 = 4397.40212
- Sample variance (n − 1 = 4 denominator, matching `STDDEV_SAMP`) =
  4397.40212 / 4 = 1099.35053
- Sample standard deviation = √1099.35053 = **33.15645532924...**

**Result: my independently redone arithmetic matches the claimed values
exactly** — median = 19.99 (exact match), stddev ≈ 33.156455329241695
(matches to all shown digits). No discrepancy found.

**3. DuckDB function-name sanity check.** `MEDIAN(x)` (quantile-continuous
interpolation at p=0.5) and `STDDEV_SAMP(x)` (sample standard deviation,
n−1 denominator) are both real, correctly-spelled DuckDB built-in aggregate
functions — consistent with independent knowledge of DuckDB's aggregate
function library, which also exposes `STDDEV`/`STDDEV_POP` as siblings.
Stronger evidence: the new test (`profiling.test.ts`, "computes median and
stddev for price...") asserts *specific numeric values* against
`profile.numericMetrics?.median`/`?.stddev`, and it passes against a real,
locally-executed DuckDB instance via `FixtureConnector`. Had either function
name been misspelled or nonexistent, DuckDB would raise a SQL binder/catalog
error at query execution time (a thrown exception, failing the test with an
error, not a close-but-wrong-value assertion failure) rather than silently
returning a plausible wrong number — the fact that the test passes cleanly
with the exact hand-computed value is strong evidence the function names
resolve correctly against DuckDB's real catalog, not hallucinated.

**4. Red-state evidence is credible.** The implementation report's addendum
quotes the red-state failure as `expected undefined to be close to 19.99,
received difference is NaN` — consistent with `median`/`stddev` genuinely
being absent from the returned object prior to the fix (accessing an absent
property yields `undefined`, and `toBeCloseTo` against `undefined` produces
exactly this `NaN`-difference failure mode). This is internally consistent
with the claimed before/after state, not merely asserted.

## Fresh verification performed

| Check | Exact command | Result |
| --- | --- | --- |
| Engine tests (fresh) | `npx vitest run packages/engine` | `Test Files 5 passed (5)`, `Tests 238 passed (238)` — matches the addendum's claim exactly (237 pre-existing + 1 new I-02 regression test, 0 regressions) |
| Full verification (fresh) | `npm run verify` | Exit 0. `tsc -b --force` clean, `eslint .` clean, `vitest run`: `Test Files 6 passed (6)`, `Tests 249 passed (249)` — matches the addendum's claim exactly (248 pre-existing baseline + 1 new test) |
| Commit scope | `git show --stat 4246ce2` | 3 files changed: `IMPLEMENTATION-REPORT.md` (+108), `packages/engine/src/comparison-core/profiling/profiling.test.ts` (+31), `packages/engine/src/comparison-core/profiling/profiling.ts` (+40/−20 net). Nothing under `packages/shared/**` touched by this fix commit — consistent with the fix being confined to `NumericMetrics` (an engine-owned type), not `ProfileDifference` (the shared type T-07 owns a narrow slice of) |
| `NumericMetrics` shape (current state) | Direct read of `profiling.ts` lines 60-69 | `median: number` and `stddev: number` present as required fields, alongside `min`/`max`/`mean`/`zeroCount`/`negativeCount`/`positiveCount` |
| Median/stddev query wiring | Direct read of `computeNumericMetrics` (`profiling.ts` lines 259-290) | `MEDIAN(...)` and `STDDEV_SAMP(...)` added to the single existing aggregate `SELECT`; both mapped through `toNumber(...)` into the returned object, same pattern as the other five numeric fields |
| Independent median/stddev hand-arithmetic | Manual recomputation from `postgres-products.ts` lines 34-40 (see "I-02 fix verification" above), redone from scratch without reference to the implementer's or prior reviewer's numbers | Median = 19.99 (exact match to claim); sample stddev ≈ 33.15645532924 (matches claim to all shown digits) |
| DuckDB function-name validity | Knowledge check plus passing-test inference (see point 3 above) | `MEDIAN` and `STDDEV_SAMP` are real DuckDB aggregate functions; a wrong name would fail with a SQL error, not a values-close-but-wrong assertion failure — the clean pass is strong corroborating evidence |

## Prior-finding disposition

| Finding ID | Disposition | Evidence of resolution |
| --- | --- | --- |
| M-01 | NOT APPLICABLE | Unrelated to T-07 (T-01 devDependency vulnerabilities); no change in this task or this round |
| M-02 | NOT APPLICABLE | Unrelated to T-07 (T-01 build config); no change in this task or this round |
| M-03 | NOT APPLICABLE | Unrelated to T-07 (T-02 documentation citation); already resolved prior to T-07 |
| I-01 | NOT APPLICABLE | Unrelated to T-07 (T-03 read-only-gate regex fix); already resolved prior to T-07; T-07's SQL was confirmed read-only in the original T-07 review round and is unchanged in this round's diff (the I-02 fix only added two read-only aggregate functions to an existing `SELECT`) |
| M-04 | PARTIALLY RESOLVED (2 of 4 difference shapes done) — unchanged this round, carried forward | `SchemaDifference` resolved by T-06; `ProfileDifference` resolved by T-07 (original round, `packages/shared/src/result.ts`, not touched by this round's I-02 fix commit per the scope check above). `AggregateDifference` and `RowDifference` remain the placeholder `DifferenceItem` alias, deferred to T-13/T-14 respectively — out of scope for T-07's I-02 fix, no action taken or expected this round |
| M-05 | NOT APPLICABLE | Unrelated to T-07 (SQL Server `GO` batch separator, tracked for T-17); no change in this task or this round |
| M-06 | NOT APPLICABLE | Unrelated to T-07 (PostgreSQL dollar-quoted strings, tracked for T-19); no change in this task or this round |
| I-02 | **RESOLVED** | `git show 4246ce2` adds `MEDIAN(col)`/`STDDEV_SAMP(col)` to `computeNumericMetrics`'s query and to the returned `NumericMetrics` object; `median`/`stddev` are now required fields on `NumericMetrics`, matching `TASK-BRIEF.md` line 44's contract verbatim ("min/max/mean/median/stddev"). Independently redone hand arithmetic (this round, from scratch, not copied from any report) confirms median = 19.99 and sample stddev ≈ 33.156455329241695 for the `price` column — exact match to the claimed values. Fresh `npx vitest run packages/engine` reproduces 238/238 and fresh `npm run verify` reproduces exit 0 / 249/249, both matching the addendum's claims exactly. The fabricated task-brief quote that originally (mis)justified the omission has been removed from both `IMPLEMENTATION-REPORT.md` and `profiling.ts`'s doc comments, replaced with a correct citation to the brief's actual line 44 language. No new finding was introduced by this fix — the change is additive (two new SQL aggregate columns, two new interface fields, one new test), and the scope check confirms it touched only `profiling.ts`, `profiling.test.ts`, and `IMPLEMENTATION-REPORT.md`, nothing in `packages/shared/**` or elsewhere. |

## Approval status

- **Status:** APPROVED
- **Reviewer:** Claude Code Independent Reviewer subagent
- **Date:** 2026-07-27
- **Release or dependency impact:** The single blocker from the original
  review round (I-02: median/stddev omitted from `NumericMetrics`, justified
  by a fabricated task-brief quote) is resolved. The fix is genuine — DuckDB's
  native `MEDIAN`/`STDDEV_SAMP` aggregates were added to the existing
  single-pass numeric-metrics query, both fields are now populated on every
  numeric-column profile, and my own from-scratch hand computation against
  the raw `postgres-products.ts` fixture data (median = 19.99, sample
  stddev ≈ 33.15645532924) matches the claimed values exactly. Fresh
  `npx vitest run packages/engine` (238/238) and fresh `npm run verify`
  (exit 0, 249/249) both reproduce the implementation report's claimed
  counts with zero regressions. The fix commit's scope is confined to the
  three files the addendum claims — no drift into `packages/shared/**` or
  any other task's owned files. Combined with the original review round's
  already-verified items (hand-counted profile correctness for String/
  Decimal/Boolean fixture columns, `compareProfiles`'s genuine
  meaningful-change filtering including an adversarial float-noise probe,
  correctly-scoped `ProfileDifference` refinement, and a confirmed
  read-only-only SQL surface), T-07 now has no open Critical or Important
  findings. T-09 (orchestration planner) and other downstream consumers of
  `profileColumn`/`compareProfiles`/`NumericMetrics` are unblocked to
  proceed. `AggregateDifference`/`RowDifference` remaining placeholders
  (M-04) is expected, pre-scoped deferral to T-13/T-14, not a T-07 defect.
  Per `AGENTS.md`, this independent approval does not substitute for final
  human release approval.
