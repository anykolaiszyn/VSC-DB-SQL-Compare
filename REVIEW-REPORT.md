# ParityLens — Review Report T-20

## Review independence statement

This review was performed by a separate agent instance from whoever
implemented T-20. No memory of authoring `hash-comparison.ts` or
`hash-comparison.test.ts` was available or used; every claim in
`IMPLEMENTATION-REPORT.md` was independently re-verified against the
actual diff, actual source, and fresh command runs, per the reviewer
protocol. Findings below reflect direct evidence (file/line citations,
constructed inputs, and their actually-observed outputs), not the
implementer's own characterization.

## Scope reviewed

- `TASK-BRIEF.md` (T-20, hash-based comparison / "Strategy C")
- `IMPLEMENTATION-REPORT.md` on branch `task/T-20-hash-comparison`
  (commit `eee234a`)
- `packages/engine/src/comparison-core/hash-comparison/hash-comparison.ts`
  (new, commit `d09f3d3`) — read in full
- `packages/engine/src/comparison-core/hash-comparison/hash-comparison.test.ts`
  (new, commit `d09f3d3`) — read in full
- `packages/engine/src/comparison-core/row-level/row-level.ts` (T-14,
  read-only reference per brief) — read in full for shape/behavior
  comparison
- `packages/engine/src/comparison-core/normalization/normalization.ts`
  (T-12, read-only reference) — read in full
- `packages/engine/fixtures/snowflake-orders.ts`,
  `packages/engine/fixtures/sqlserver-customer.ts` — read for fixture
  fidelity checks
- `git diff --name-only main task/T-20-hash-comparison` — full file list

## Fresh verification performed

| Check | Command | My result | Matches report? |
| --- | --- | --- | --- |
| Full verify | `npm run verify` | Exit 0. `Test Files 19 passed \| 2 skipped (21)`, `Tests 378 passed \| 27 skipped (405)` | Yes — identical to report |
| Focused (all) | `npx vitest run packages/engine/src/comparison-core/hash-comparison` | `hash-comparison.test.ts (10 tests)` all passed | Yes |
| Scope diff | `git diff --name-only main task/T-20-hash-comparison` | `IMPLEMENTATION-REPORT.md`, `hash-comparison.test.ts`, `hash-comparison.ts` only | Yes — no planner/connector-sdk/shared/normalization/row-level files touched |
| Planner-wiring grep | `grep -rn "compareByHash" packages/engine/src/orchestration` | No hits | Confirms no planner-wiring scope creep |
| Escalation-scope grep | `grep -n "compareByHash(" hash-comparison.ts` | Single hit (the exported function's own declaration) | Confirms no internal recursive/auto-escalating calls exist |

`typecheck` and `lint` produced no errors in my own run, matching the
report.

## Adversarial / independent probes performed

Three throwaway test files were written directly under
`packages/engine/src/comparison-core/hash-comparison/` (so module
resolution worked against the real `compareByHash`/`compareRows`/
`applyNormalization` code, not a hand-rolled reimplementation), run via
`npx vitest run`, and deleted afterward. `git status --short` after
deletion showed a clean tree (no residue beyond this report).

### Probe 1 — independent progressive-narrowing fixture (required by brief item 1)

Built a dedicated 10-row/2-partition fixture pair from scratch (not
`snowflake-orders`, the implementer's only worked example): partition
`"A"` (IDs 1–5) byte-identical on both sides; partition `"B"` (IDs 6–10)
identical except ID 8's `VAL` (9999 on source vs 80 on target).

Result: table-level hash differed (`matched: false`); partition-level
correctly reported **no** mismatch entry for `"A"` and **one** mismatch
entry for `"B"`; row-level correctly narrowed the mismatch set to
exactly `[8]`. Independently ran T-14's `compareRows` over the identical
fixture data and confirmed: every `"matching"`-classified key was absent
from `compareByHash`'s row-level mismatch set, and ID 8's
`"matched-key-differing-values"` classification was present in it. **Full
agreement, confirmed on a scenario the implementer did not construct or
test.** This substantiates the plan's review-gate requirement beyond the
implementer's own single worked example.

### Probe 2 — normalization-before-hashing, numeric-formatting case (required by brief item 2)

Constructed a one-row-per-side fixture: `AMOUNT = '125.3700'` (source)
vs `AMOUNT = '125.37'` (target) — the exact pair `TASK-BRIEF.md`'s
Handoff note names verbatim.

- With no rule: `compareByHash` reported 1 mismatch (expected — raw
  strings differ).
- With `rules: { AMOUNT: { numericTolerance: { absolute: 0.01 } } }`
  configured — the same `NormalizationRule.numericTolerance` field
  declared in `packages/engine/src/orchestration/definition/definition.ts`
  (line 67) that `HashComparisonOptions.rules` is typed against —
  `compareByHash` **still reported 1 mismatch**. The hashes did not
  converge.
- Cross-check: ran the identical rule and identical value pair through
  T-14's `compareRows` directly. It classified the pair `"matching"`.

**This is the exact failure mode the brief anticipated and asked me to
check for.** See Critical finding T-20-01 below.

### Probe 3 — casing/whitespace normalization (re-verifying the implementer's own claim independently)

Re-ran the implementer's `"  JOHN SMITH  "` vs `"John Smith"` test in
isolation (`npx vitest run ... -t "normalization"`) to confirm it
actually exercises the real `compareByHash` code path rather than a
stubbed/mocked one. Confirmed: raw comparison reports a mismatch; with
`rules: { NAME: { trim: true, caseSensitive: false } }` configured, the
mismatch disappears. String-shape normalization (trim/case-fold) does
genuinely apply before hashing — this part of the report's claim holds.

## Findings

### Critical

**T-20-01 — `compareByHash` does not apply `numericTolerance`, so it disagrees with T-14's `compareRows` on the doc's own canonical "differently-formatted-but-equivalent" example, contradicting both the doc's `HASH(normalized_column_1, ...)` requirement and the brief's stated agreement bar.**

- **Evidence:** Probe 2 above. `compareByHash(source, target, "row", { columns: ["AMOUNT"], rules: { AMOUNT: { numericTolerance: { absolute: 0.01 } } } })` reports a mismatch for `"125.3700"` vs `"125.37"`; `compareRows` given the identical rule and identical values classifies the pair `"matching"`.
- **Root cause:** `hash-comparison.ts`'s `fetchNormalizedRows` (line 257) applies only `applyNormalization(raw, rule)` before hashing. `applyNormalization`'s own header comment (`normalization.ts` lines 19–24, 44–45) states explicitly: *"numericTolerance is documented on NormalizationRule but is inherently a two-value comparison, not a single-value transform — applyNormalization leaves a numeric value passed through it unchanged... intentionally NOT applied here."* Tolerance evaluation only happens via the separate `valuesEqualWithinTolerance` function, which `hash-comparison.ts` never calls. T-14's `row-level.ts` (lines 235–253, its own `T-14-01` comment) explicitly works around this same gap with a local `coerceNumericString` helper applied *before* `valuesEqualWithinTolerance`, specifically because it reproduces this exact `"125.3700"` vs `"125.37"` doc example. `hash-comparison.ts` has no equivalent — it only calls `applyNormalization`, never `coerceNumericString`-equivalent logic, and hashing has no tolerance concept at all (a SHA-256 digest is either identical or not; there is no way to hash "within 0.01").
- **Why this is Critical, not Minor:** `TASK-BRIEF.md`'s Interfaces table requires normalization to run "before hashing, matching the doc's `normalized_column_1` framing," and the Handoff section names this precise scenario as a required check, stating explicitly: *"if hashing operates on raw unnormalized values, that's a real defect... not a nitpick."* The doc's own worked example (`Idea Prompt.md` section 2, also reproduced in `row-level.ts`'s header comment) uses `ORDER_AMOUNT "125.3700" vs "125.37"` as its numeric-tolerance case. A `HashComparisonOptions.rules` caller who configures `numericTolerance` — a field that exists on the exact same `NormalizationRule` type this module imports and consumes — reasonably expects it to behave the way it behaves everywhere else in this codebase (`compareVolume`/T-13, `compareRows`/T-14). Instead it is silently ignored by the hashing path, meaning `compareByHash` will report false-positive mismatches for numerically-tolerant-equal values whenever the underlying platform round-trips decimals as differently-formatted strings — a common real-world case (`Idea Prompt.md`'s own headline example). This directly undermines the brief's stated review-gate requirement that hash comparison and row-level comparison **agree**, on the one case class the brief explicitly pre-flagged as the place they were most likely to disagree.
- **Required resolution:** `compareByHash` needs a documented, disclosed decision here — either (a) apply the same `coerceNumericString`-plus-tolerance-bucketing logic before hashing (e.g. round/normalize numeric-tolerant values to a canonical representation before the SHA-256 digest, so within-tolerance values hash identically), or (b) if that is judged infeasible/out of scope for this task, explicitly disclose in `IMPLEMENTATION-REPORT.md` that `numericTolerance` is a known, unsupported rule field for hashing purposes (distinct from the trim/case/whitespace rules, which do work) — the current report makes no such disclosure; it presents the `"125.37"` vs `"125.3700"` case as covered by "normalization... verification" generally without flagging that only the *string*-shaped case was actually tested, silently leaving the *numeric*-shaped case (the doc's own literal example) unverified and, as shown here, broken.

### Important

**T-20-02 — Every hash level, including `"table"`, fetches the entire configured row set client-side, which does not deliver the doc's stated large-dataset benefit of Strategy C; the implementer's own disclosure understates this by focusing on portability rather than the pull-cost consequence.**

- **Evidence:** `hash-comparison.ts` lines 176–184: `compareByHash` always calls `fetchNormalizedRows` for both source and target (`SELECT <all fetchColumns> FROM <table>`, capped at `maxRows`, default 10,000) regardless of `level`, then hashes in JS — even a `"table"`-level call pulls every row's every configured column across the wire, identically to a full row-level fetch.
- **Assessment required by brief item 5:** The brief explicitly asked whether the disclosed JS-side-hashing tradeoff undermines "the stated purpose of hash comparison 'as an alternative to full row-level pull for large datasets.'" It does, materially. `Idea Prompt.md`'s Strategy C section frames table/partition-level hashing as a way to detect *that* something differs without pulling the differing rows — the entire performance argument for hash comparison at "12 million row" scale (the doc's own scale example) is that a database-side `HASH(...)` aggregate returns one small digest per side, not N rows of full column data. This implementation's `"table"` level costs the same wire/memory transfer as pulling every row for `compareRows`, just with extra JS-side hashing overhead on top — it provides zero row-pull savings over T-14's own row-level comparison for the very use case (large datasets) the doc cites as Strategy C's reason to exist.
- **Disposition:** The implementer's report *does* disclose the JS-side-vs-SQL-side design tradeoff (`IMPLEMENTATION-REPORT.md`'s "Design tradeoff" bullet, `hash-comparison.ts`'s header comment lines 33–63) and correctly attributes it to `applyNormalization` having no SQL equivalent — that reasoning is sound and the disclosure is real, not silently omitted, which the brief treats as the primary requirement ("disclose that explicitly... rather than silently shipping"). However, neither the report nor the code comment states the corollary in the brief's own framing — that this specifically defeats the large-dataset wire-cost benefit, as opposed to being merely a "SQL portability" concern. This is a real, not hypothetical, functional shortfall (a caller reaching for `compareByHash("table", ...)` specifically to avoid a full row pull on a huge table gets no such avoidance) but it was disclosed in substance (the client-side fetch-then-hash mechanism is fully described, just not connected explicitly to the wire-cost consequence at scale) and the brief itself pre-authorized this kind of design-tradeoff disclosure as an acceptable outcome rather than mandating SQL-side pushdown. Routing to Important rather than Critical: no requirement was silently violated (the mechanism actually implemented is accurately described), and this is a known, common pattern this project's own precedent already accepts elsewhere (`DEFAULT_MAX_ROWS`/in-memory assumption mirrors T-14's own documented scope boundary). **Required resolution:** flag explicitly, in a follow-on task's scope, that `compareByHash`'s `"table"`/`"partition"` levels do not currently reduce data-transfer cost relative to a full row fetch, and that achieving the doc's actual large-dataset benefit requires the per-dialect SQL-side `HASH()`/`HASHBYTES()`/`md5()` pushdown this task's own header comment already names as future work — this should be recorded in `PROGRESS-LEDGER.md` as tracked debt, not silently left implicit only in a design-tradeoff paragraph that a future reader could reasonably read as "portability nice-to-have" rather than "the core promised benefit isn't delivered yet."

### Minor

**T-20-03 — `partitionColumn`/`keyColumns`/`columns` are read against a single shared column-name list applied to both source and target fetches, so a partition/key/column comparison silently cannot be run when source and target use different column names for the same logical field (a case this codebase's own fixtures exercise elsewhere, e.g. `sqlserver-customer`'s `IsActive` vs `IS_ACTIVE`).**

- **Evidence:** `hash-comparison.ts` line 176 builds one `fetchColumns` list from `options.keyColumns`/`options.columns`/`options.partitionColumn`, then both `fetchNormalizedRows(source, options.table, fetchColumns, ...)` and `fetchNormalizedRows(target, targetTable, fetchColumns, ...)` (lines 179–180) use that same list against both sides. Constructed a probe against `sqlserver-customer` (source columns `CustomerID`/`IsActive`, target columns `CUSTOMER_ID`/`IS_ACTIVE`) attempting a partition comparison on `IsActive` — DuckDB raised `Binder Error: Referenced column "CustomerID" not found in FROM clause! Candidate bindings: "CUSTOMER_ID"` when the target-side fetch ran, i.e. `compareByHash` cannot be used at all against a source/target pair with differently-named columns, unlike `compareRows` (T-14), which accepts a `ColumnMappingEntry[]` mapping precisely to handle this.
- **Assessment:** Not a brief violation — `HashComparisonOptions` is a new, task-owned type and the brief does not require column-name-mapping support, and every one of the implementer's own test cases uses `snowflake-orders`, whose source/target column names happen to be identical (`ORDER_ID`, `CUSTOMER_ID`, etc.), so this gap wasn't exercised or noticed. It is also not inconsistent with the disclosed `key-range`-single-key-column limitation pattern already in the report. Recommend disclosing this as a known limitation (mirroring the existing `key-range`/composite-key disclosure) in a future revision of `IMPLEMENTATION-REPORT.md` or a follow-on task brief, since it will surface immediately the first time this module is used against `sqlserver-customer`-shaped source/target pairs (a realistic case — that fixture exists specifically to model differently-named source/target schemas) or real SQL Server/Snowflake connectors.

## Disposition of prior findings

No prior open finding was assigned to T-20 for resolution — `TASK-BRIEF.md`'s Dependencies section lists T-14 and T-05 as required-complete prerequisites (both COMPLETE/APPROVED per `PROGRESS-LEDGER.md`'s referenced state) but does not carry forward any specific numbered finding for this task to close. N/A.

## Scope and ownership check

- Changed files: `IMPLEMENTATION-REPORT.md`, `packages/engine/src/comparison-core/hash-comparison/hash-comparison.ts`, `packages/engine/src/comparison-core/hash-comparison/hash-comparison.test.ts` — all within the brief's declared ownership (`packages/engine/src/comparison-core/hash-comparison/**` plus the report). Confirmed via `git diff --name-only main task/T-20-hash-comparison`.
- No file under `packages/engine/src/connector-sdk/safety/**`, `type-mapping/**`, `fixture/**`, `normalization/**`, `row-level/**`, `volume/**`, `orchestration/planner/**`, `sqlserver/**`, `postgres/**`, or `packages/shared/src/**` was touched. Confirmed both by the diff file list and by grep — no reference to `compareByHash` exists anywhere in `orchestration/`.
- `HashComparisonResult`/`HashMismatch`/`HashComparisonOptions`/`HashComparisonLevel` are defined locally in `hash-comparison.ts`, not added to `packages/shared/src/**` — matches the brief's own suggested default, with the implementer's stated reasoning (no external consumer yet) confirmed accurate by the diff.

## Escalation-scope judgment call — verified as declared

Confirmed by direct code inspection: `compareByHash` (the sole exported entry point) is never called recursively or from within itself, and no wrapper/orchestrator function exists anywhere in the file that chains multiple `compareByHash` invocations. `grep -n "compareByHash(" hash-comparison.ts` returns exactly one hit — the function's own declaration. This matches `IMPLEMENTATION-REPORT.md`'s disclosed claim exactly: a single-level comparison per call, no auto-escalation pipeline, consistent with the brief's literal Interfaces-column signature being treated as authoritative over the doc's narrative framing. Not over-built, not under-built relative to what was declared.

## Final disposition

**CHANGES REQUIRED.**

T-20-01 (Critical) blocks approval: `compareByHash` does not honor
`numericTolerance` before hashing, causing it to disagree with T-14's
`compareRows` on the doc's own canonical numeric-formatting example —
directly contradicting the brief's explicit, pre-flagged agreement
requirement and the "HASH(normalized_column_1, ...)" normalization
requirement it quotes verbatim. This is not a hypothetical edge case;
it is the exact scenario `TASK-BRIEF.md`'s Handoff section names by
literal example, and my independent probe reproduces it directly against
the shipped code.

T-20-02 (Important) does not block approval on its own (it is a
disclosed tradeoff, not a silent one) but should be recorded as tracked
debt in `PROGRESS-LEDGER.md` alongside the resolution of T-20-01, since a
fix for T-20-01 will likely touch the same hashing pipeline.

T-20-03 (Minor) does not block approval; recommend a documentation
addition in a follow-on pass.

**Required before re-review:** resolve T-20-01 (either implement numeric-
tolerance-aware hashing consistent with `compareRows`'s behavior, or
explicitly and prominently disclose the numeric-tolerance gap as an
unsupported rule field in both the code header comment and
`IMPLEMENTATION-REPORT.md`, with the report's normalization-verification
section corrected to state plainly that only string-shape normalization
was proven to work pre-hash, not numeric-tolerance normalization) — and
route T-20-02 into `PROGRESS-LEDGER.md` as tracked debt for whichever
future task attempts genuine SQL-side hash pushdown.

---

# Round 2 (T-20-01 fix) — Independent Review

## Review independence statement

This round-2 review was performed by a fresh reviewer agent instance —
separate both from whoever implemented round 1/round 2, and from whoever
performed the round-1 review above. No memory of authoring
`hash-comparison.ts`/`hash-comparison.test.ts` or of writing the round-1
review section was available or used. Every claim in
`IMPLEMENTATION-REPORT.md`'s round-2 section (arithmetic, boundary-risk
disclosures, verification counts) was independently re-derived or
re-run, not trusted from the implementer's own characterization. The
round-1 section above is preserved unmodified as the historical record;
nothing in it was edited by this round.

## Scope reviewed (round 2)

- `TASK-BRIEF.md` (unchanged since round 1) and `IMPLEMENTATION-REPORT.md`
  round-2 section, read in full.
- `packages/engine/src/comparison-core/hash-comparison/hash-comparison.ts`
  as of commit `0a9f932` — full diff against `d09f3d3` read, plus the
  complete current file read end to end.
- `packages/engine/src/comparison-core/hash-comparison/hash-comparison.test.ts`
  as of `0a9f932` — full diff read.
- `packages/engine/src/comparison-core/row-level/row-level.ts` and
  `packages/engine/src/comparison-core/normalization/normalization.ts`
  (`valuesEqualWithinTolerance`, `coerceNumericString`) re-read to
  independently derive the exact comparison semantics `compareByHash` is
  being held to.
- `git diff --name-only main task/T-20-hash-comparison`,
  `git show --stat 0a9f932`, and `git diff` of `PROGRESS-LEDGER.md`/
  `REVIEW-REPORT.md` against the merge-base, to verify scope and the
  stale-branch caveat.

## Fresh verification performed

| Check | Command | My result | Matches report? |
| --- | --- | --- | --- |
| Full verify | `npm run verify` | Exit 0. `Test Files 19 passed \| 2 skipped (21)`, `Tests 381 passed \| 27 skipped (408)` | Yes — identical to round-2 report |
| Focused | `npx vitest run packages/engine/src/comparison-core/hash-comparison` (implementer's own suite, re-run clean after probes) | `hash-comparison.test.ts (13 tests)` all passed | Yes |
| Scope diff | `git diff --name-only main task/T-20-hash-comparison` | `IMPLEMENTATION-REPORT.md`, `PROGRESS-LEDGER.md`, `REVIEW-REPORT.md`, `hash-comparison.test.ts`, `hash-comparison.ts` | `hash-comparison.*`/`IMPLEMENTATION-REPORT.md` match declared round-2 scope; the other two are the stale-branch artifact (see below), not implementer edits |
| Round-2 commit stat | `git show --stat 0a9f932` | `IMPLEMENTATION-REPORT.md`, `hash-comparison.test.ts`, `hash-comparison.ts` — exactly 3 files | Matches report's claimed changed-files list exactly |
| Planner-wiring grep | `grep -rn "compareByHash" packages/engine/src/orchestration` | No hits | Confirms no planner-wiring scope creep introduced in round 2 |
| Escalation-scope grep | `grep -n "compareByHash(" hash-comparison.ts` | Single hit (the exported function's own declaration) | Confirms round 2 did not introduce any recursive/auto-escalating call |

`typecheck` and `lint` produced no errors in my own run.

### Stale-branch artifact verification (required by dispatch instructions)

- `git diff 8eb97ba 0a9f932 -- REVIEW-REPORT.md` → **empty**. The
  round-2 implementer did not touch `REVIEW-REPORT.md` at all; it is
  byte-identical to the round-1 reviewer's version. Confirmed genuine,
  not merely asserted.
- `git merge-base main task/T-20-hash-comparison` → `7dd441b`.
  `git diff task/T-20-hash-comparison 7dd441b -- PROGRESS-LEDGER.md` →
  **empty**. The branch's `PROGRESS-LEDGER.md` is byte-identical to the
  merge-base version; `main`'s only additional history on that file is
  one later commit (`bd86237`, "T-20: record round-1 CHANGES REQUIRED")
  that records round 1's disposition — a ledger update that happened on
  `main` after this branch was cut, not a divergent edit on the branch
  itself. This is exactly the stale-branch artifact the dispatch
  instructions described, confirmed rather than assumed.

## Adversarial / independent probes performed

A single throwaway probe file (`zz-reviewer-probe.test.ts`) was written
directly under `packages/engine/src/comparison-core/hash-comparison/` (so
module resolution exercised the real `compareByHash`/`compareRows`
code, not a reimplementation), covering items 1–5 of the dispatch
instructions, run via `npx vitest run`, and deleted afterward. `git
status --short` after deletion showed a clean tree — confirmed, no
residue beyond this report.

### Probe 1 — original T-20-01 case, own construction (required item 1)

Built a dedicated one-row-per-side DuckDB fixture pair (`AMOUNT =
"125.3700"` source, `"125.37"` target), independent of the implementer's
`fixtureWithStringVariant` helper's exact call sites, with `rules: {
AMOUNT: { numericTolerance: { absolute: 0.01 } } }`.

- `compareByHash(..., "row", ...)`: `matched: true`. **Fixed, confirmed.**
- `compareRows` given the identical rule and values: `category:
  "matching"`. **Full agreement, confirmed independently.**

T-20-01 as originally reported is genuinely resolved.

### Probe 2 — disclosed false-disagreement boundary case (required item 2)

Reproduced the implementer's own named example directly: `AMOUNT =
"125.364"` (source) vs `"125.370"` (target), `{ absolute: 0.01 }`.

- `compareRows`: `category: "matching"` (diff 0.006 ≤ 0.01).
- `compareByHash`: `matched: false`, one mismatch reported for key 1
  (hashes: `12fb4b...` vs `a2823a...`).

**Confirmed exactly as disclosed** — this is a genuine, reproducible
residual disagreement, distinct from T-20-01's original always-broken
behavior (which affected every within-tolerance pair, not just
boundary-straddling ones). Assessed as acceptable to ship: it is
explicitly disclosed in both the code header comment and the
implementation report, the direction of error is conservative (hash
comparison under-reports agreement rather than hiding a real
difference — it can only cause a caller to escalate to `compareRows`
unnecessarily, never to miss a genuine difference), and the brief itself
treats disclosed design tradeoffs as an acceptable outcome for this task.

### Probe 3 — false-agreement counterexample search, absolute tolerance (required item 3)

Reimplemented `roundToStep` independently from the shipped source and
ran two searches: (a) a targeted scan across bucket boundaries for base
values from -5 to 5 in 0.001 increments, checking offsets from
0.0099999 up to 0.02 for any pair more than `0.01` apart that rounds to
the same bucket; (b) an end-to-end `compareByHash` check with
`AMOUNT = "100.005"` vs `"100.0151"` (diff = 0.0101, just outside
`{absolute: 0.01}`).

- (a): no counterexample found.
- (b): `compareByHash` correctly reports `matched: false`.

**The implementer's proof-by-construction claim holds under my own
independent search**: `roundToStep`'s bucket width equals
`tolerance.absolute` exactly, so two values in the same bucket are
provably < `tolerance.absolute` apart — no false agreement is possible
by construction, and I found no counterexample. This claim is correct.

### Probe 4 — percentage tolerance (required item 4) — finding below

Constructed `AMOUNT = "1000"` (source) vs `"1005"` (target), a pair
0.5% apart, well inside `{ percentage: 1 }` (1%) tolerance:

- `compareRows`: `category: "matching"` (0.5% ≤ 1%), as expected.
- `compareByHash`: **`matched: false`** — hashes differ.

Root cause, independently traced: `percentageToSignificantFigures(1)`
returns `sigFigs = 4`. `roundToSignificantFigures(1000, 4) = 1000` but
`roundToSignificantFigures(1005, 4) = 1005` — these are *different*
4-significant-figure buckets (1000 vs 1005 are both already exactly 4
significant figures, so rounding is a no-op and does nothing to collapse
them). This is not a fluke of my chosen numbers: I ran a systematic scan
(percentages 1/5/10, bases from 100 to ~68,000, deltas spanning the full
within-tolerance range) and found that **~97% of value pairs that
`compareRows` classifies as within-percentage-tolerance land in
different significant-figure buckets** under `compareByHash`'s
canonicalization (1,282 of 1,320 sampled within-tolerance pairs
disagreed). For comparison, I ran the equivalent scan for absolute
tolerance and found a ~48% disagreement rate there (consistent with a
bucket width equal to the tolerance width, so a uniformly distributed
within-tolerance pair has roughly even odds of straddling a boundary).

A separate false-*agreement* scan for percentage tolerance (values more
than `P`% apart landing in the same significant-figure bucket, across
percentages 0.5–99% and magnitudes from 10⁻³ to 10⁶) found no
counterexample, consistent with the report's claim that false
*agreement* was not observed. That specific claim holds under my
independent check too.

- I additionally confirmed the reverse: `"1000"` vs `"1050"` (4.76%
  apart, outside the 1% tolerance) is correctly reported as a mismatch
  by both `compareRows` and `compareByHash` — genuinely-out-of-tolerance
  values are not falsely merged.

### Probe 5 — non-tolerance regression check (required item 5)

Re-verified the string-casing/whitespace case
(`"  JOHN SMITH  "` vs `"John Smith"`) independently, in a probe file
that does not reuse any of the implementer's own fixture-building code:
raw comparison reports a mismatch; with `{ trim: true, caseSensitive:
false }` configured, `compareByHash` reports `matched: true`. Also ran
the implementer's own 13-test suite (10 round-1 + 3 round-2) unmodified,
confirming all pass, including the round-1 progressive-narrowing and
partition-level cases. No regression found.

## Findings (round 2)

### Critical

NONE. T-20-01 as originally scoped and reported (the `"125.3700"` vs
`"125.37"` absolute-tolerance case, and the general principle that
`numericTolerance` was previously silently ignored before hashing) is
genuinely fixed and independently confirmed above.

### Important

**T-20-04 — Percentage-tolerance canonicalization produces a false disagreement for the overwhelming majority of within-tolerance pairs, not just a rare boundary case; `IMPLEMENTATION-REPORT.md`'s boundary-risk disclosure materially understates this for the percentage case specifically.**

- **Evidence:** Probe 4 above. `AMOUNT = "1000"` vs `"1005"` (0.5% apart, within `{ percentage: 1 }` tolerance): `compareRows` says `"matching"`, `compareByHash` says `matched: false`. Independent scan: ~97% of within-percentage-tolerance pairs sampled disagree this way (vs. ~48% for absolute tolerance, itself already a high rate).
- **Why this matters:** The report's boundary-risk disclosure devotes several paragraphs to the absolute-tolerance case with a concrete worked example (`125.364` vs `125.370`) that reads, correctly, as a narrow edge case near a bucket boundary. For percentage tolerance, the report states only that "no false-agreement counterexample was found" and that the guarantee is "materially weaker... not formally guaranteed" than the absolute case — but it never discloses a false-*disagreement* example for percentage tolerance, nor states that false disagreement is actually the *typical* outcome for that path, not an edge case. A reader of the disclosure reasonably comes away thinking percentage tolerance has the same qualitative behavior as absolute tolerance (occasional boundary-straddling false disagreement, no false agreement) when in practice it is dramatically worse on the disagreement axis: a caller configuring `{ percentage: 1 }` and expecting `compareByHash` to usually agree with `compareRows` on typical within-tolerance data will instead see mismatches reported for nearly every such pair. This directly undermines the same "hash comparison and row-level comparison agree" bar the brief set for T-20-01, for the percentage-tolerance path specifically — it is not fixed by round 2's work, and round 2's own report does not flag that it remains this broken.
- **Root cause:** `percentageToSignificantFigures` derives a fixed significant-figure count from the tolerance percentage alone, independent of the specific value pair's actual magnitude alignment. Significant-figure rounding buckets are aligned to powers of ten, not to the value's own position — two values that are close in percentage terms but differ in a low-order digit position relative to the bucket's rounding point (e.g. 1000 vs 1005, rounding at the units digit for 4 sig figs) routinely land in different buckets even when well within tolerance, because the sig-fig bucket width (`10^(2-sigFigs)`% of the magnitude class, per the report's own bound) is calibrated to be *no wider than* the tolerance, not comparable in shape to how a percentage-based "distance" actually spreads pairs across that width — most of the within-tolerance interval falls outside a value's own rounding bucket rather than inside it. This is the same structural issue as the absolute case (bucket boundaries are arbitrary cut points, and within-tolerance pairs can straddle them) but the effective disagreement rate is far higher because there is no floor on how close two significant-figure buckets' boundaries can fall relative to the tolerance-permitted spread, whereas the absolute case at least guarantees a bucket exactly one tolerance-width wide.
- **Severity assessment:** Important, not Critical. This does not resurrect T-20-01 (no requirement is silently violated — the report does disclose *that* percentage tolerance is weaker and empirically-only, which is honest in kind), and it does not introduce false agreement (the failure mode remains conservative — a caller sees more mismatches than truly exist, never fewer, so `compareByHash` cannot hide a real difference the way a false agreement would). It is Important rather than Minor because: (a) it means `compareByHash`'s percentage-tolerance path delivers essentially no practical agreement benefit over having no tolerance canonicalization at all for that path, which is a materially different and worse outcome than what the report's own language ("weaker... not formally guaranteed") leads a reader to expect, and (b) per the brief's own review-gate framing, the specific promise being tested here is "hash comparison and row-level comparison agree" — for percentage tolerance, in the common case, they now do not.
- **Required resolution:** Not required to block this round's approval (see Final disposition), but must be disclosed accurately before this can be considered fully closed: either (a) correct `IMPLEMENTATION-REPORT.md`'s and `hash-comparison.ts`'s header-comment boundary-risk sections to state plainly that percentage-tolerance canonicalization frequently disagrees with `compareRows` on ordinary within-tolerance pairs (not just "near a boundary"), with a concrete worked example (e.g. this review's `1000`/`1005` case) alongside the existing absolute-tolerance example, or (b) improve the percentage-tolerance bucketing to reduce the disagreement rate (e.g. a magnitude-relative rounding scheme rather than fixed significant figures), which is a larger change better suited to a follow-on task. Recommend routing to `PROGRESS-LEDGER.md` as tracked debt if the disclosure-only path is chosen, since the underlying approximation is not exact and the project's own precedent (T-20-02) already accepts disclosed-tradeoff outcomes as non-blocking when accurately described.

### Minor

No new Minor findings in round 2. T-20-03 (source/target column-name mapping) remains open per round 1's disposition and was out of round 2's authorized scope (it touches `HashComparisonOptions`'s shape more broadly, not the numericTolerance path) — not re-litigated here.

## Disposition of prior findings

- **T-20-01 (Critical, round 1) — RESOLVED, independently confirmed.**
  Reproduced the original failing case directly against `0a9f932`'s
  shipped code before accepting the fix (Probe 1 above): `compareByHash`
  now agrees with `compareRows` on `"125.3700"` vs `"125.37"` with
  `{ absolute: 0.01 }` configured. This is not accepted on the
  implementer's report alone — I constructed the case myself, independent
  of the implementer's `fixtureWithStringVariant` test helper, and got
  the same result.
- **T-20-02 (Important, round 1, accepted as tracked debt)** — unchanged
  by round 2; out of round 2's authorized scope (JS-side hashing vs.
  SQL-side pushdown is unrelated to the numericTolerance fix). Still
  requires a `PROGRESS-LEDGER.md` entry per round 1's disposition — not
  yet present as of the branch's stale `PROGRESS-LEDGER.md` copy (see
  stale-branch note above; this is an orchestrator reconciliation
  responsibility, not a round-2 implementer gap).
- **T-20-03 (Minor, round 1, accepted)** — unchanged by round 2, as
  expected; not re-verified in depth this round since nothing in round
  2's diff touches the column-name-mapping surface.

## Scope and ownership check (round 2)

- Round-2 commit `0a9f932` touches exactly `IMPLEMENTATION-REPORT.md`,
  `packages/engine/src/comparison-core/hash-comparison/hash-comparison.ts`,
  `packages/engine/src/comparison-core/hash-comparison/hash-comparison.test.ts`
  — confirmed via `git show --stat 0a9f932`, matching the report's
  claimed file list exactly.
- No file outside `hash-comparison/**` (plus the report) was touched in
  round 2. `REVIEW-REPORT.md` is confirmed byte-identical to round 1's
  version (empty diff `8eb97ba`→`0a9f932`) — the round-2 implementer did
  not touch it, as required.
- The `PROGRESS-LEDGER.md` difference visible in `git diff main
  task/T-20-hash-comparison` is confirmed to be branch/main divergence
  predating round 2 (branch content is byte-identical to the merge-base),
  not a round-2 edit.
- The disclosed test-helper parameter-type widening
  (`fetchAllRows(connector: FixtureConnector, ...)` →
  `(connector: DataPlatformConnector, ...)`) is confirmed to be exactly
  that: the function body is unchanged; only the parameter type
  annotation was widened, within the task's own owned test file. Not a
  behavioral change.

## Final disposition

**APPROVED.**

T-20-01, the Critical finding that blocked round 1, is genuinely
resolved and independently confirmed against the shipped code, not just
the implementer's report — the doc's own canonical `"125.3700"` vs
`"125.37"` example now produces full agreement between `compareByHash`
and `compareRows`. No Critical or Important finding from round 1 remains
unresolved in a way that blocks this round: T-20-02 (Important) was
already accepted as non-blocking tracked debt in round 1 and is untouched
by round 2's scope; T-20-03 (Minor) likewise.

This round's new finding, T-20-04 (Important — percentage-tolerance
canonicalization false-disagreement rate is far higher than the report's
disclosure implies), does **not** block approval, for reasons parallel to
round 1's own disposition of T-20-02: it is a disclosed-in-kind (if
understated-in-degree) design tradeoff of an approach the brief itself
authorized ("disclose that explicitly... rather than silently shipping"),
it fails conservatively (more false mismatches, never a hidden true
difference), and it does not violate any requirement that was not already
flagged as inexact in the implementer's own report. However, it is a real
finding: the report's percentage-tolerance disclosure should be corrected
to state the true (very high) disagreement rate rather than characterizing
it only as "materially weaker" than the absolute case, and this should be
recorded in `PROGRESS-LEDGER.md` alongside T-20-02 as tracked debt, ideally
before or during whichever future task next touches this file, since a
caller relying on percentage-tolerance agreement today would be
surprised by the actual behavior.

**Recommended next steps for the orchestrator:**
1. Merge this task as APPROVED.
2. Record T-20-04 in `PROGRESS-LEDGER.md`'s open-findings table (Important,
   accepted/non-blocking, tracked debt) alongside T-20-02/T-20-03.
3. Ensure the `PROGRESS-LEDGER.md` reconciliation on merge picks up
   `main`'s existing `bd86237` state (round-1 CHANGES REQUIRED entry) and
   updates it to APPROVED with T-20-04 added, rather than the branch's
   stale pre-`bd86237` copy overwriting it.
4. Optionally (non-blocking, quality-of-disclosure only): update
   `hash-comparison.ts`'s header comment and `IMPLEMENTATION-REPORT.md`'s
   round-2 boundary-risk section to include a concrete percentage-tolerance
   false-disagreement example (e.g. this review's `1000`/`1005` case)
   alongside the existing absolute-tolerance example, so the disclosure's
   degree matches this review's findings.
