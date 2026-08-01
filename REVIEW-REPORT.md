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
