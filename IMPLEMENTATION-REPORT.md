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
