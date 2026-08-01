# ParityLens — Implementation Report T-20

## Status and objective

- **Status:** COMPLETE (implementation and self-verification only — not
  reviewed or approved; see Recommended next step)
- **Objective:** Implement `compareByHash(source, target, level, options): HashComparisonResult`,
  per `IMPLEMENTATION-PLAN.md`'s T-20 row and `TASK-BRIEF.md`'s quoted
  excerpt of `Idea Prompt.md`'s "Strategy C: Hash comparison" section:
  "Compute deterministic hashes over normalized values.
  `HASH(normalized_column_1, normalized_column_2, ...)`. Possible levels:
  Entire table hash, Partition hash, Key-range hash, Row hash, Column
  hash." Per `TASK-BRIEF.md`'s Objective section, this task implements the
  hash computation and comparison mechanics for these levels only — not
  automatic progressive narrowing/escalation, per the literal Interfaces
  signature ("a single comparison at a given level, not an auto-escalating
  pipeline").

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/engine/src/comparison-core/hash-comparison/hash-comparison.ts` | New | `compareByHash` implementation, `HashComparisonLevel`/`HashComparisonOptions`/`HashMismatch`/`HashComparisonResult` types |
| `packages/engine/src/comparison-core/hash-comparison/hash-comparison.test.ts` | New | Focused test suite (10 tests) |

No file outside `packages/engine/src/comparison-core/hash-comparison/**`
was touched. `git status --short` immediately before committing showed
only this new directory as untracked; no other file was modified.

## Behavior and interfaces

- **Behavior delivered:** `compareByHash(source, target, level, options)`
  fetches the relevant column values from `source`/`target` via
  `executeQuery`/`quoteIdentifier` (matching T-13/T-14/T-15's established
  SQL-building pattern), applies `applyNormalization` (T-12) to every
  configured non-key column value per any supplied `rules`, then computes
  a SHA-256 digest over the normalized value tuple(s) for the requested
  granularity:
  - `"table"`: one hash per side over the full (sorted, so connector row
    order can't affect the result) row set. `mismatches` is always `[]`
    at this level (per the doc's own framing: "prove something differs
    but do not explain what differs").
  - `"partition"`: groups rows by `options.partitionColumn`'s value and
    hashes each partition's row set independently; reports a
    `HashMismatch` per partition whose source/target hash differs
    (including a partition present on only one side, hashed against a
    documented empty-set sentinel hash for the absent side).
  - `"key-range"`: sorts all observed numeric key values (source ∪
    target) and buckets them into fixed `options.rangeSize` windows,
    hashing each window's row set; reports a mismatch per window that
    differs. Only supports a single, numeric key column (documented
    limitation — a composite key has no unambiguous ordering to bucket
    on without inventing a combination rule).
  - `"row"`: hashes each row's normalized column tuple individually,
    matched by key; reports a mismatch per key whose hash differs
    (including a key present on only one side).
  - `"column"`: for each configured column, hashes the ordered list of
    that column's normalized value across every row whose key exists on
    both sides; reports a mismatch per column whose hash differs.
  - Every result also always returns a `"table"`-level summary hash pair
    (`sourceHash`/`targetHash`) regardless of `level`, since every level
    already fetches the full row set to derive its narrower-level
    hashes.
- **Interfaces consumed:**
  - `DataPlatformConnector` (`packages/shared/src/connector.ts`) — via
    `executeQuery`/`quoteIdentifier` only, per the brief's Interfaces
    table.
  - `applyNormalization(value, rule)` (`packages/engine/src/comparison-core/normalization/normalization.ts`,
    T-12, consumed read-only via import) — applied to every non-key
    column value before hashing.
  - `RowDifference`/`RowColumnDifference` (`@paritylens/shared`, T-14) —
    read for shape/pattern reference only, per the brief; not imported
    (see Assumptions/judgment calls below for why `HashMismatch` is a
    locally-defined, not shared, shape).
  - `ColumnMappingEntry`/`NormalizationRule` (`packages/engine/src/orchestration/definition/definition.ts`,
    T-08, consumed read-only via import for typing `options.rules`).
- **Interfaces produced:** `compareByHash(source, target, level, options): Promise<HashComparisonResult>`,
  `HashComparisonLevel`, `HashComparisonOptions`, `HashMismatch`,
  `HashComparisonResult` — all defined locally within
  `hash-comparison.ts`; none of these are exported from
  `packages/shared/src/**` (see judgment call below).

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline (pre-change) | `npm run verify` | Exit 0. `Test Files 18 passed \| 2 skipped (20)`, `Tests 368 passed \| 27 skipped (395)` | Captured below |
| Red state | `npx vitest run packages/engine/src/comparison-core/hash-comparison` | Failed: `Error: Failed to load url ./hash-comparison.js ... Does the file exist?` — `1 failed (1)` test file, `no tests` collected | Captured below |
| Focused green state | `npx vitest run packages/engine/src/comparison-core/hash-comparison` | Exit 0. `Test Files 1 passed (1)`, `Tests 10 passed (10)` | Captured below |
| Full verification | `npm run verify` | Exit 0. `Test Files 19 passed \| 2 skipped (21)`, `Tests 378 passed \| 27 skipped (405)` (368 baseline + 10 new = 378, no regression) | Captured below |

### Baseline (pre-change) `npm run verify`, tail

```
 Test Files  18 passed | 2 skipped (20)
      Tests  368 passed | 27 skipped (395)
   Start at  09:46:32
   Duration  2.33s (transform 1.55s, setup 0ms, collect 6.44s, tests 2.40s, environment 5ms, prepare 3.88s)
```

### Red state: `npx vitest run packages/engine/src/comparison-core/hash-comparison`

```
❯ packages/engine/src/comparison-core/hash-comparison/hash-comparison.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

FAIL  packages/engine/src/comparison-core/hash-comparison/hash-comparison.test.ts [ packages/engine/src/comparison-core/hash-comparison/hash-comparison.test.ts ]
Error: Failed to load url ./hash-comparison.js (resolved id: ./hash-comparison.js) in V:/Secret Projects/VSC-DB-SQL-Compare/packages/engine/src/comparison-core/hash-comparison/hash-comparison.test.ts. Does the file exist?
 ❯ loadAndTransform ../../Secret%20Projects/VSC-DB-SQL-Compare/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

 Test Files  1 failed (1)
      Tests  no tests
   Start at  09:47:45
   Duration  645ms (transform 87ms, setup 0ms, collect 0ms, tests 0ms, environment 0ms, prepare 128ms)
```

Matches the brief's predicted failure reason exactly: "Module/function
does not exist yet."

### Focused green state: `npx vitest run packages/engine/src/comparison-core/hash-comparison`

```
✓ packages/engine/src/comparison-core/hash-comparison/hash-comparison.test.ts (10 tests) 212ms

 Test Files  1 passed (1)
      Tests  10 passed (10)
   Start at  09:51:10
   Duration  881ms (transform 95ms, setup 0ms, collect 295ms, tests 212ms, environment 0ms, prepare 131ms)
```

### Full verification: `npm run verify`

```
> paritylens@0.0.1 verify
> npm run typecheck && npm run lint && npm run test

> paritylens@0.0.1 typecheck
> tsc -b --force

> paritylens@0.0.1 lint
> eslint .

> paritylens@0.0.1 test
> vitest run

 ✓ packages/engine/src/comparison-core/row-level/row-level.test.ts (8 tests) 12ms
 ✓ packages/shared/src/types.test.ts (11 tests) 7ms
 ✓ packages/engine/src/comparison-core/type-mapping/type-mapping.test.ts (69 tests) 18ms
 ✓ packages/engine/src/comparison-core/normalization/normalization.test.ts (24 tests) 39ms
 ✓ packages/engine/src/connector-sdk/safety/statement-safety.test.ts (109 tests) 36ms
 ✓ packages/engine/src/comparison-core/mapping/mapping.test.ts (12 tests) 10ms
 ↓ packages/engine/src/connector-sdk/postgres/postgresConnector.test.ts (14 tests | 14 skipped)
 ✓ packages/engine/src/orchestration/definition/definition.test.ts (30 tests) 56ms
 ✓ packages/extension/src/webview/resultsWebview.test.ts (7 tests) 6ms
 ✓ packages/engine/src/comparison-core/schema-diff/schema-diff.test.ts (11 tests) 86ms
 ✓ packages/extension/src/export/exporters.test.ts (6 tests) 16ms
 ✓ packages/extension/src/views/parityTreeDataProvider.test.ts (5 tests) 7ms
 ✓ packages/extension/src/statusbar/parityStatusBar.test.ts (2 tests) 4ms
 ✓ packages/extension/src/activation/activate.test.ts (3 tests) 9ms
 ✓ packages/extension/src/secrets/secretStore.test.ts (3 tests) 9ms
 ✓ packages/engine/src/comparison-core/volume/volume.test.ts (7 tests) 241ms
 ✓ packages/engine/src/comparison-core/profiling/profiling.test.ts (13 tests) 369ms
 ✓ packages/engine/src/comparison-core/hash-comparison/hash-comparison.test.ts (10 tests) 354ms
 ↓ packages/engine/src/connector-sdk/sqlserver/sqlServerConnector.test.ts (13 tests | 13 skipped)
 ✓ packages/engine/src/orchestration/planner/planner.test.ts (8 tests) 469ms
 ✓ packages/engine/src/connector-sdk/fixture/fixture-connector.test.ts (40 tests) 1003ms

 Test Files  19 passed | 2 skipped (21)
      Tests  378 passed | 27 skipped (405)
   Start at  09:51:55
   Duration  2.24s (transform 1.39s, setup 0ms, collect 6.70s, tests 2.75s, environment 5ms, prepare 3.57s)
```

`typecheck` and `lint` both completed with no errors (no output beyond
the npm script banner, meaning success). `npm run verify` exited 0.
368 previously-passing tests still pass (368 baseline → 378 total, +10
new, 0 regressions); the 2 skipped suites (SQL Server / PostgreSQL live
container integration tests) are unchanged from baseline and are
unrelated to this fixture-only task.

## Fixture choice

Per `TASK-BRIEF.md`'s Red-state evidence section ("read
`packages/engine/fixtures/**` first to pick the right one and document
your choice"): **`snowflake-orders`**
(`packages/engine/fixtures/snowflake-orders.ts`). Its header comment
documents the planted mismatches this test suite exercises directly:
"OrderID 103 exists in source but not target (missing-target row)"
and "OrderID 101's ORDER_TOTAL differs: source 250.00 vs target 199.99
(differing-value row)". `ORDER_STATUS` (values `SHIPPED`/`PENDING`/
`CANCELLED`) supplies a natural partition dimension without inventing
new fixture data:

- **PENDING** partition: source has OrderID 103 (`PENDING`), target has
  zero `PENDING` rows at all — a clean partition-hash mismatch with an
  empty target-side bucket.
- **SHIPPED** partition: source rows 101/102/105 vs target rows
  101/102/105 — identical row *membership* (same OrderIDs present) on
  both sides, but OrderID 101's `ORDER_TOTAL` differs, so the partition
  hash differs even though a naive "row count per partition" check would
  not catch it. This reproduces the doc's own progressive-narrowing
  story ("Table hash differs → Compare monthly partition hashes → June
  differs → …") end-to-end within a single fixture pair, without
  inventing new data.
- **CANCELLED** partition: source and target both contain exactly
  OrderID 104 with identical values — a partition-hash *match*, proving
  `compareByHash` does not just always report a mismatch regardless of
  input.

No fixture data was added or modified; `snowflake-orders.ts` was
consumed read-only.

## Assumptions and risks

- **Escalation-scope judgment call (required disclosure per
  `TASK-BRIEF.md`'s Objective section):** No automatic table → partition
  → key-range → row escalation pipeline was built. `compareByHash`
  performs exactly one comparison at the caller-supplied `level` and
  returns `mismatches: HashMismatch[]` with enough structured detail
  (partition value, key range bounds, row key values, or column name)
  for a caller to invoke `compareByHash` again at a narrower level
  themselves. Reasoning for judging this non-trivial: chaining levels
  automatically would require deciding, per level, which narrower unit
  to descend into next (which partition? which key sub-range?) and how
  to aggregate results from potentially many narrower calls back into
  one payload — a real orchestration decision, not a mechanical wrapper.
  This matches the brief's explicit statement that the plan's literal
  Interfaces signature ("a single comparison at a given level") is
  authoritative over the doc's narrative multi-step framing.

- **Design tradeoff (required disclosure per `TASK-BRIEF.md`): hashing is
  computed in JavaScript, not pushed into a SQL `HASH(...)` expression
  run inside the connector's own engine.** The brief anticipated this
  exact question ("if a truly platform-neutral hash expression isn't
  achievable without per-dialect branching, disclose that explicitly...
  rather than silently shipping a DuckDB-only implementation under a
  general-sounding name"). The reason is stronger than dialect
  portability alone: T-12's `applyNormalization` (the required
  normalization-before-hash step) is a pure JS function with no SQL
  equivalent — there is no portable way to express "trim, case-fold,
  collapse whitespace, truncate a timestamp to day precision" as SQL
  across DuckDB/SQL Server/PostgreSQL without either reimplementing
  per-dialect SQL normalization (T-12's owned responsibility, out of
  this task's file ownership) or normalizing client-side. This module
  therefore always: fetches raw column values via `executeQuery`
  (built with `quoteIdentifier`, matching the established pattern),
  applies `applyNormalization` in JS per column, then computes a
  SHA-256 digest (Node's built-in `crypto`, no new dependency) over the
  normalized value tuple(s). This is genuinely platform-neutral (works
  identically regardless of which connector produced the raw rows) but
  is **not** the doc's literal SQL-side `HASH(...)` pushdown. A future
  task wanting genuine SQL-side hash pushdown (for datasets too large to
  pull row values across the wire at all) would need per-dialect hash
  SQL **and** a per-dialect SQL translation of every `NormalizationRule`
  field, neither of which exists today. Flagged as a residual gap for a
  future task, not silently shipped as if it were the doc's literal SQL
  pushdown.

- **`HashComparisonResult`/`HashMismatch`/`HashComparisonOptions`/
  `HashComparisonLevel` are defined locally within
  `hash-comparison.ts`, not in `packages/shared/src/**`.** Per
  `TASK-BRIEF.md`'s Files owned section: "this task is expected to
  define its own result types locally within `hash-comparison/**`...
  `HashComparisonResult` has no such external consumer yet since planner
  wiring is out of scope here, so it likely belongs entirely within this
  task's own directory; if you judge otherwise, disclose the reasoning."
  Judgment: agreed with the brief's own suggested default — no code
  outside this task's directory currently needs to reference
  `HashComparisonResult` (planner wiring is explicitly out of scope),
  so there is no genuine interface gap requiring a `packages/shared`
  change. `RowDifference`/`RowColumnDifference` (T-14) were read for
  shape/pattern reference per the brief but not imported or extended —
  `HashMismatch` is a deliberately distinct, narrower shape (it reports
  *which unit differed and its two hashes*, not a full row
  classification into T-14's eight categories), which is why the
  cross-check test (below) compares by key rather than by trying to
  reuse `RowDifference`'s `category` field directly.

- **`key-range` level only supports a single, numeric key column.** A
  composite key has no unambiguous total ordering to bucket into ranges
  without inventing a combination rule this task did not attempt to
  invent (`resolveSingleKeyColumn` throws a clear error if
  `options.keyColumns` has more than one entry). This is a known,
  documented limitation, not a silent gap — flagged in both the
  function's doc comment and here.

- **Row/column-level duplicate-key handling is intentionally minimal.**
  `compareRowsByHash` compares duplicate keys on one side positionally
  against the same key's row(s) on the other side (first-vs-first,
  etc.) rather than replicating T-14's dedicated
  `duplicate-in-source`/`duplicate-in-target` classification. T-14's
  `compareRows` already owns that classification; this task's
  cross-check test (below) proves the two modules agree on the
  fixture's actual (non-duplicate) mismatches, which is what the brief's
  review-gate requirement calls for. None of the `snowflake-orders`
  fixture's rows are duplicated, so this limitation is not exercised by
  the current test suite — disclosed here rather than silently assumed
  irrelevant.

- **`maxRows` defaults to 10,000** (`DEFAULT_MAX_ROWS` in
  `hash-comparison.ts`), and there is no pagination — every level
  assumes both sides fit in memory, mirroring T-14's own documented
  "assume both sides fit in memory for now" scope boundary
  (`row-level.ts`'s header comment). This is appropriate for the
  fixture-scale data this task is scoped to (per `TASK-BRIEF.md`'s
  Dependencies section: "this task is fixture-only... it does not need
  the WSL/Docker live-database containers"), but a real large-dataset
  use of `compareByHash` (the doc's own "12 million row" scale example
  elsewhere in the product concept) would need explicit paging, which
  is out of scope here.

- **Blockers:** None.

## Cross-check: `compareByHash` and T-14's `compareRows` agree

Per `TASK-BRIEF.md`'s Green-state section ("Add a case proving hash
comparison and full row-level comparison (T-14's `compareRows`)
**agree** on the same fixture mismatch"), the test
`"compareByHash agrees with compareRows (T-14) on the same fixture
mismatch case"` in `hash-comparison.test.ts`:

1. Runs `compareByHash(source, target, "row", {...})` over the
   `snowflake-orders` fixture pair.
2. Independently fetches the full row sets for both sides (via a
   test-local `fetchAllRows` helper, deliberately not reusing any of
   `compareByHash`'s own internal fetch logic) and runs T-14's
   `compareRows` over them with the same key/column mapping.
3. Asserts, for every row `compareRows` classifies `"matching"`, that
   the same key is **not** in `compareByHash`'s `mismatches` list, and
   for every row `compareRows` classifies `"matched-key-differing-values"`
   or `"missing-from-target"`, that the same key **is** in
   `compareByHash`'s `mismatches` list.
4. Asserts the reverse: every key `compareByHash` reports as a mismatch
   corresponds to a non-`"matching"` `compareRows` classification for
   that key.

This directly anticipates the plan row's stated review-gate requirement
("Independent reviewer confirms hash comparison and full row-level
comparison agree on the same fixture mismatch case"). Per
`TASK-BRIEF.md`'s Handoff note to the reviewer, the reviewer is expected
to construct at least one **additional**, independent scenario beyond
this one (ideally exercising the partition→row narrowing story) rather
than only re-running this test.

## Normalization-before-hashing verification

A dedicated test (`"compareByHash applies normalization before
hashing"` in `hash-comparison.test.ts`) constructs a controlled,
unambiguous case: a single-row-per-side throwaway in-memory DuckDB
fixture pair (built directly via `@duckdb/node-api`, the same dependency
`FixtureConnector` itself uses, wrapped in a minimal local
`DataPlatformConnector`-shaped adapter exposing only `executeQuery`/
`quoteIdentifier`) with `NAME` = `"  JOHN SMITH  "` on the source side
and `"John Smith"` on the target side. It asserts:

1. With no normalization rule configured, `compareByHash` at `"row"`
   level reports a mismatch (differing hashes) for this key.
2. With `rules: { NAME: { trim: true, caseSensitive: false } }`
   configured, `compareByHash` reports **no** mismatch for the same key
   — proving normalization genuinely runs before hashing (raw-value
   hashing, per assertion 1, would never converge on its own).

This directly matches `TASK-BRIEF.md`'s Handoff note to the reviewer:
"confirm hashing genuinely applies normalization first (construct a
case where two differently-formatted-but-equivalent values... hash to
the same value after normalization — if hashing operates on raw
unnormalized values, that's a real defect... not a nitpick)."

## Patch or commit identity

- **Commit:** `d09f3d3` — "T-20: implement hash-based comparison
  (Strategy C)"
- **Branch:** `task/T-20-hash-comparison` (created off `main` at tip
  commit `7dd441b`)
- `git status --short` immediately before committing showed only the
  new `packages/engine/src/comparison-core/hash-comparison/` directory
  as untracked; nothing else in the working tree was modified.

## Recommended next step

Independent review by the `reviewer` subagent (separate instance from
this implementer), per `TASK-BRIEF.md`'s Handoff section. The reviewer
is specifically asked to: (1) construct an additional, independent
hash-vs-row-level agreement scenario beyond this report's worked
example (ideally including a coarser-level match with a narrower-level
mismatch, exercising the progressive-narrowing framing); (2) verify the
normalization-before-hashing property independently rather than only
re-running this task's own test; (3) confirm no file outside
`hash-comparison/**` was touched and no planner-wiring scope creep
occurred; (4) confirm the escalation-scope judgment call documented
above was actually followed, not silently over- or under-built. This
implementer does not have authority to mark this task complete/approved
or to update `PROGRESS-LEDGER.md`.

---

## Round 2 (T-20-01 fix)

### Status and objective

- **Status:** COMPLETE (implementation and self-verification only — not
  reviewed or approved; see Recommended next step). This section is
  appended, not a replacement for the round-1 content above, per this
  round's dispatch instructions.
- **Objective:** Resolve `REVIEW-REPORT.md`'s Critical finding
  **T-20-01**: `compareByHash` did not honor `numericTolerance`
  before hashing, causing it to disagree with T-14's `compareRows` on
  `Idea Prompt.md`'s own canonical numeric-formatting example
  (`"125.3700"` vs `"125.37"` with `rules: { AMOUNT: { numericTolerance:
  { absolute: 0.01 } } } }` configured).

### Changed files (round 2)

| File | Change | Reason |
| --- | --- | --- |
| `packages/engine/src/comparison-core/hash-comparison/hash-comparison.ts` | Modified | Added `canonicalizeForHash`, `coerceNumericForHash`, `roundToStep`, `roundToSignificantFigures`, `percentageToSignificantFigures`; wired into `fetchNormalizedRows` so a column with `rule.numericTolerance` configured is canonicalized (bucketed) before its value enters the hashed tuple. Extended header comment with full round-2 rationale, judgment calls, and boundary-risk disclosure. |
| `packages/engine/src/comparison-core/hash-comparison/hash-comparison.test.ts` | Modified | Added a `describe("compareByHash: numericTolerance (T-20-01 regression)")` block (3 tests) and a generalized `fixtureWithStringVariant` fixture-building helper (parallels the existing `fixtureWithCasingVariant`); widened `fetchAllRows`'s parameter type from `FixtureConnector` to the `DataPlatformConnector` interface so it can be reused with the new helper's ad hoc adapter connectors (round-1 helper is `FixtureConnector`-typed only because it happened to only ever be called with one; no behavior change, purely a type-signature widening within this task's own file, disclosed here per the implementer protocol's requirement to call out such minimal forced edits explicitly). |

No file outside `packages/engine/src/comparison-core/hash-comparison/**`
was touched. `git status --short` before committing showed only these
two modified files.

### Canonicalization approach chosen

A SHA-256 digest has no concept of "equal within tolerance" — two byte
strings either hash identically or they don't. `row-level.ts`'s
comparison-based pattern (`coerceNumericString` +
`valuesEqualWithinTolerance`, T-14-01) compares a *pair* of values; it
cannot be reused as-is because hashing needs a canonical single *value*
per side, computed independently, that happens to collide for
within-tolerance pairs.

`canonicalizeForHash(value, tolerance)` (new, in
`hash-comparison.ts`), called from `fetchNormalizedRows` only when
`rules[columnName].numericTolerance` is configured for that column
(mirroring T-14-01's own "only when a numeric tolerance is actually
configured" guard, so no other column's behavior changes):

1. `coerceNumericForHash(value)` — reuses `row-level.ts`'s
   `coerceNumericString` guard logic (trims, then `Number(...)`,
   rejecting empty strings and non-finite results) so genuinely
   non-numeric text is never corrupted into `NaN`; returns `undefined`
   for anything not numeric-looking, in which case the already-
   normalized value passes through unchanged.
2. **Absolute tolerance** (`{ absolute: X }`): `roundToStep(value, X)`
   rounds to the nearest multiple of `X`, then re-rounds to a fixed
   decimal-place count derived from `X` to avoid floating-point
   representation artifacts (e.g. `0.1 + 0.2 !== 0.3`) reintroducing
   spurious differences between values that rounded to the
   mathematically same bucket. Verified directly:
   ```
   > roundToStep(125.37, 0.01)   -> 125.37
   > roundToStep(125.3700, 0.01) -> 125.37   (both sides converge)
   ```
3. **Percentage tolerance** (`{ percentage: P }`, judgment call): there
   is no natural "round to nearest bucket" for a percentage tolerance
   the way there is for an absolute one, because the tolerance window's
   absolute width depends on the value's own magnitude. Chosen approach:
   round to a fixed number of significant figures, `sigFigs =
   clamp(round(2 - log10(P / 100)), 1, 15)` — e.g. `P = 1` (1%) → 4
   significant figures, `P = 50` → 2 significant figures. This is a
   disclosed approximation, not an exact reproduction of
   `valuesEqualWithinTolerance`'s relative-difference formula (`|a-b| /
   max(|a|,|b|) * 100 <= percentage`); see the boundary-risk disclosure
   below for how closely they actually agree.

If neither `absolute` nor `percentage` is set on a present
`numericTolerance` object, canonicalization is skipped and the
already-normalized value is used unchanged (equivalent to no tolerance
configured).

### Boundary-risk disclosure (required by this round's brief) — verified by direct computation

**Absolute tolerance:** because `roundToStep`'s bucket width equals
`tolerance.absolute` exactly, two values within tolerance of each
other can still straddle a bucket edge and land in *different* buckets
— a false **disagreement**, not a false agreement. Verified example
(`node -e`, pasted output):
```
> Math.abs(125.364 - 125.370)                    -> 0.006000000000000227  (within 0.01 tolerance)
> roundToStep(125.364, 0.01)                      -> 125.36
> roundToStep(125.370, 0.01)                      -> 125.37   (different bucket)
```
`compareRows` would call `125.364`/`125.370` "matching" (diff 0.006 ≤
0.01); `compareByHash` would report a hash mismatch for this specific
pair. This is a real, disclosed limitation. The converse — two values
*more* than `tolerance.absolute` apart landing in the same bucket (a
false hash-level **agreement**) — cannot occur for absolute tolerance:
by construction, any two values sharing a bucket differ by strictly
less than one bucket-width, i.e. strictly less than `tolerance.absolute`.

**Percentage tolerance:** searched directly (a brute-force scan across
tolerance percentages 1/5/10/25/50/100 and a wide range of value
magnitudes) for a false-agreement counterexample (two values more than
`percentage`% apart landing in the same significant-figure bucket) and
found none. A closed-form bound explains why: for a value of magnitude
class `10^(k-1)`, `sigFigs`-significant-figure rounding produces a
bucket width of `10^(k-sigFigs)`, so two values sharing a bucket differ
by strictly less than `10^(2-sigFigs)` percent of the larger value's
magnitude class. `percentageToSignificantFigures`'s formula is
constructed so `10^(2-sigFigs) <= P` empirically held for every tested
`P`. **This is not a mathematical proof for every possible P/value
combination** — `round()` in the sigFigs formula and edge effects near
exact powers of ten were not exhaustively proven, only empirically
checked across the ranges above — so percentage-tolerance
canonicalization is disclosed as *empirically safe within what was
tested, not formally guaranteed*, which is a materially weaker
assurance than the absolute-tolerance case's proof-by-construction.

**Practical implication (disclosed):** absolute-tolerance hashing can
under-report agreement (false mismatch near a bucket edge) but not
over-report it (no observed or provable false match); percentage-
tolerance hashing has the same empirically-observed property but
without a closed-form guarantee. A caller needing exact
tolerance-boundary fidelity, especially under percentage tolerance,
should use `compareRows` (T-14) directly rather than `compareByHash`.

### Red-state evidence (round 2)

**Command:**
```
npx vitest run packages/engine/src/comparison-core/hash-comparison
```

**Captured failing output (before the fix, both new regression tests
failing for the predicted reason — T-20-01 reproduced exactly):**
```
 ❯ packages/engine/src/comparison-core/hash-comparison/hash-comparison.test.ts (13 tests | 2 failed) 325ms
   × compareByHash: numericTolerance (T-20-01 regression) > hashes '125.3700' and '125.37' identically once numericTolerance: { absolute: 0.01 } is configured (previously reported a mismatch -- REVIEW-REPORT.md T-20-01) 38ms
     → expected { keyValues: [ 1 ], …(2) } to be undefined
   × compareByHash: numericTolerance (T-20-01 regression) > agrees with compareRows (T-14) on the identical numericTolerance scenario -- direct regression test for T-20-01 33ms
     → expected false to be true // Object.is equality

AssertionError: expected { keyValues: [ 1 ], …(2) } to be undefined
- Expected:
undefined
+ Received:
Object {
  "keyValues": Array [ 1 ],
  "sourceHash": "d203f2d04a8cbd48c8cca687f154131bb30aa66426e7084973834f25a28d48d5",
  "targetHash": "6541b06ad2b1d12b47afcd094ab0b1f4d3ef1bbcad06a1fb4d1b4e5de077bb7a",
}

 Test Files  1 failed (1)
      Tests  2 failed | 11 passed (13)
```
Note: the third new test (out-of-tolerance mismatch case) already
passed at red-state, since no canonicalization existed yet and an
out-of-tolerance mismatch is correctly reported either way — this
confirms that test alone was not vacuous.

### Green-state evidence (round 2)

**Focused command:**
```
npx vitest run packages/engine/src/comparison-core/hash-comparison
```
**Output:**
```
 ✓ packages/engine/src/comparison-core/hash-comparison/hash-comparison.test.ts (13 tests) 331ms

 Test Files  1 passed (1)
      Tests  13 passed (13)
```
All 13 tests pass (10 from round 1, unchanged and unmodified, plus 3
new T-20-01 regression tests).

**Full verification command:**
```
npm run verify
```
**Output (relevant tail):**
```
> paritylens@0.0.1 typecheck
> tsc -b --force
(no errors)

> paritylens@0.0.1 lint
> eslint .
(no errors)

> paritylens@0.0.1 test
> vitest run
...
 ✓ packages/engine/src/comparison-core/hash-comparison/hash-comparison.test.ts (13 tests) 490ms
 ✓ packages/engine/src/orchestration/planner/planner.test.ts (8 tests) 458ms
 ✓ packages/engine/src/connector-sdk/fixture/fixture-connector.test.ts (40 tests) 1019ms

 Test Files  19 passed | 2 skipped (21)
      Tests  381 passed | 27 skipped (408)
```
Exit code 0. 381 passed (378 round-1 baseline + 3 new), 27 skipped —
no regression in any previously passing test, matching the round-1
baseline exactly plus the 3 new tests. The 2 skipped test files are the
pre-existing SQL Server/PostgreSQL live-container integration suites,
unrelated to this task (same as round 1).

### Assumptions and judgment calls (round 2)

1. **Canonicalization applies only when `rule.numericTolerance` is
   present on that column's rule** — a column with no rule, or a rule
   with no `numericTolerance` field, is unaffected; behavior for every
   round-1 test (string casing/whitespace, progressive narrowing,
   table/partition/row/column/key-range levels) is unchanged, confirmed
   by all 10 round-1 tests still passing unmodified.
2. **Percentage-tolerance significant-figure formula** — documented
   above as a disclosed approximation, not an exact match to
   `valuesEqualWithinTolerance`'s formula. Empirically checked, not
   formally proven safe against false agreement for all inputs.
3. **`fetchAllRows`'s parameter type widened from `FixtureConnector` to
   `DataPlatformConnector`** in the test file — required so the new
   regression tests' ad hoc adapter connectors (built the same way
   round 1's `fixtureWithCasingVariant`/`buildConnector` already does)
   could reuse the existing helper rather than duplicating it. This is
   a test-file-only, same-task-owned-file change with no behavioral
   effect (the function's body is unchanged; only its parameter type
   annotation is widened to the interface `FixtureConnector` already
   implements), but is called out explicitly per the implementer
   protocol's instruction to disclose any edit not a literal 1:1 match
   to the brief's minimal description, even when fully within
   ownership.
4. **No changes to `row-level.ts`, `normalization.ts`, or any file
   outside `hash-comparison/**`** — confirmed by `git status --short`
   and `git diff --stat` before committing (see Patch or commit
   identity below).

### Patch or commit identity (round 2)

- **Branch:** `task/T-20-hash-comparison` (unchanged from round 1)
- **Round-1 commits (unchanged, preserved):** `d09f3d3` (implementation),
  `eee234a` (report), `8eb97ba` (reviewer's `REVIEW-REPORT.md` —
  historical record of round 1, not modified by this round)
- **Round-2 commit:** see `git log` on this branch after this report is
  committed — a new commit containing exactly
  `packages/engine/src/comparison-core/hash-comparison/hash-comparison.ts`,
  `packages/engine/src/comparison-core/hash-comparison/hash-comparison.test.ts`,
  and this updated `IMPLEMENTATION-REPORT.md`.

### Recommended next step (round 2)

Independent review by the `reviewer` subagent (a separate instance from
this implementer, and not assumed to be the same instance that reviewed
round 1). The reviewer should specifically: (1) independently re-derive
or spot-check the boundary-risk arithmetic above rather than trusting
it as asserted; (2) construct at least one additional numeric-tolerance
scenario beyond this round's worked example, ideally including a
percentage-tolerance case; (3) confirm the false-disagreement example
(125.364 vs 125.370) is reproducible against the shipped code; (4)
confirm no file outside `hash-comparison/**` was touched in this round;
(5) confirm `REVIEW-REPORT.md` was not modified (it is preserved as
round 1's historical record). This implementer does not have authority
to mark this task complete/approved or to update `PROGRESS-LEDGER.md`.
