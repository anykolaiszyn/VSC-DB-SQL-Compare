# ParityLens — Task Brief T-20

## Objective

Implement hash-based comparison, `IMPLEMENTATION-PLAN.md`'s T-20 row:
"table/partition/key-range/row/column hash levels, progressive narrowing
per idea doc 'Strategy C', as an alternative to full row-level pull for
large datasets."

`Idea Prompt.md`'s "Strategy C: Hash comparison" section (verbatim,
quote this rather than paraphrase it) describes the approach:

> Compute deterministic hashes over normalized values.
> `HASH(normalized_column_1, normalized_column_2, ...)`
> Possible levels: Entire table hash, Partition hash, Key-range hash, Row
> hash, Column hash.
> Whole-table hashes alone are limited: they prove something differs but
> do not explain what differs. The useful pattern is progressive
> narrowing: Table hash differs → Compare monthly partition hashes → June
> differs → Compare key-range hashes → IDs 5,000,000–5,100,000 differ →
> Run row-level comparison.

This task implements the **hash computation and comparison mechanics**
for these levels — it does not implement automatic progressive
"narrowing" orchestration logic (deciding to escalate from table → to
partition → to key-range → to row-level automatically) unless doing so
is trivial given the shapes you build; if it's not trivial, stop that
scope at "the caller can call `compareByHash` again at a narrower level
themselves using the returned mismatch information," and document that
choice explicitly rather than silently building less than the doc's
narrative implies. `IMPLEMENTATION-PLAN.md`'s literal Interfaces column
for T-20 is `compareByHash(source, target, level): HashComparisonResult`
— a single comparison at a given level, not an auto-escalating pipeline.
That literal signature is authoritative over the doc's narrative framing.

`ConnectorCapabilities.supportsNativeHashing` (`packages/shared/src/connector.ts`)
already exists and every current connector (`FixtureConnector`,
`SqlServerConnector`, `PostgresConnector`) already reports `true` for it
— you do not need to add a new connector method; build hash SQL against
the existing public `DataPlatformConnector` surface
(`executeQuery`/`quoteIdentifier`), the same pattern T-13's `compareVolume`
and T-14/T-15's row-fetching already use. DuckDB (the fixture connector's
backing engine) supports a `hash()` function; SQL Server and PostgreSQL
each have their own hash functions (`HASHBYTES`/`md5` respectively) —
since this task is fixture-only (see Dependencies), you do not need to
make it work against the live SQL Server/PostgreSQL containers, but do
not hardcode a DuckDB-only SQL dialect assumption into a function meant
to be platform-general either; if a truly platform-neutral hash
expression isn't achievable without per-dialect branching, disclose that
explicitly as a design tradeoff in `IMPLEMENTATION-REPORT.md` rather than
silently shipping a DuckDB-only implementation under a general-sounding
name.

Note to whoever dispatches an implementer against this brief: quote this
document's load-bearing requirements verbatim rather than paraphrasing
them — a paraphrase that loosens a requirement is a known failure mode
from this project's history (T-07's I-02 finding traced back to exactly
this).

## Dependencies

- **Required completed tasks:** T-14 (row-level parity, COMPLETE/APPROVED
  — per the plan row, this task consumes "Row-level matching contracts
  from T-14"; specifically, `compareByHash`'s row/column-level hash
  results should be usable as an input to `compareRows` or structured
  compatibly enough that a caller could hand off from hash-level
  detection to T-14's row-level classification, per the doc's progressive
  narrowing narrative — read `row-level.ts`'s `RowDifference`/
  `RowColumnDifference` shapes before designing `HashComparisonResult`,
  don't invent an incompatible parallel shape). T-05 (canonical type
  mapping, for normalizing values before hashing, consistent with
  "normalized_column_1" in the doc's `HASH(...)` example — reuse T-12's
  `applyNormalization` for this, do not reimplement normalization).
- **Required decisions or approvals:** NONE beyond the already-approved
  `IMPLEMENTATION-PLAN.md` T-20 row.
- **Environment:** this task is fixture-only (`FixtureConnector`/DuckDB
  in-process). It does not need the WSL/Docker live-database containers
  T-17/T-19 needed — work and test entirely from your normal shell.

## Files owned

- `packages/engine/src/comparison-core/hash-comparison/**` (new
  directory)

Do not touch `packages/engine/src/connector-sdk/safety/**` (T-03's owned
file), `packages/engine/src/comparison-core/type-mapping/**` (T-05's
owned file), `packages/engine/src/connector-sdk/fixture/**` (T-04's owned
file — consume `FixtureConnector` read-only via `import`, do not modify
it), `packages/engine/src/comparison-core/normalization/**` (T-12's owned
file — consume `applyNormalization` read-only via `import`),
`packages/engine/src/comparison-core/row-level/**` (T-14's owned file —
read it for the `RowDifference`/`RowColumnDifference` shapes and pattern
reference, do not edit it or import from its internals beyond its public
exports), `packages/engine/src/comparison-core/volume/**` (T-13's owned
file), `packages/engine/src/orchestration/planner/**` (T-09/T-15's owned
file — this task does not wire hash comparison into `runComparison`; that
is future integration work, out of scope here, matching the precedent
`IMPLEMENTATION-PLAN.md` already set of shipping a comparison-core
capability before its planner wiring in a later task — see T-13 landing
before T-15 wired it in), or any connector-sdk file
(`sqlserver/**`/`postgres/**`).

Do not modify `packages/shared/src/**` unless a genuine interface gap is
found — if so, stop and flag it as a blocker rather than editing it
directly; this task is expected to define its own result types locally
within `hash-comparison/**` (matching `RowDifference`'s own precedent of
being a `packages/shared` type only because T-14 needed it referenced
from `ComparisonResult` — `HashComparisonResult` has no such external
consumer yet since planner wiring is out of scope here, so it likely
belongs entirely within this task's own directory; if you judge otherwise,
disclose the reasoning).

## Interfaces

| Direction | Interface | Contract | Producer or consumer |
| --- | --- | --- | --- |
| Consumed | `DataPlatformConnector` (`packages/shared/src/connector.ts`) | Existing, complete interface. Use `executeQuery`/`quoteIdentifier` only, matching T-13/T-14/T-15's established pattern of building SQL against the connector's public surface | T-02 (producer) |
| Consumed | `applyNormalization(value, rule): NormalizedValue` (`packages/engine/src/comparison-core/normalization/normalization.ts`) | Existing, complete, reviewed. Apply to column values before hashing, matching the doc's `normalized_column_1` framing in its `HASH(...)` example | T-12 (producer) |
| Consumed | `RowDifference`/`RowColumnDifference` (`@paritylens/shared`, refined by T-14) | Existing, complete shapes — read for compatibility reference when designing this task's own result types, per the Dependencies section above | T-14 (producer) |
| Produced | `compareByHash(source, target, level, options): HashComparisonResult` (new, `packages/engine/src/comparison-core/hash-comparison/hash-comparison.ts` or similar) | `level` is one of the five from the doc: `"table"`, `"partition"`, `"key-range"`, `"row"`, `"column"` (choose exact string literals, document them). Returns whether the hashes matched at that level and, when they didn't, enough structured information to identify *what* narrower unit to compare next (e.g. which partition, which key range, which row, which column) — this is the "progressive narrowing" payload the doc describes, even though this task doesn't auto-escalate itself | This task (producer) |

## Prohibited changes

- Do not modify any file outside `packages/engine/src/comparison-core/hash-comparison/**` except where explicitly authorized above (none currently — flag and stop if you believe you need to).
- Do not add automatic multi-level escalation/orchestration logic beyond a single `compareByHash` call at a given level, unless genuinely trivial — see Objective section for the exact boundary and required disclosure if you judge it's not trivial.
- Do not wire this into `runComparison`/the planner — that is explicitly out of scope for this task.
- Do not require or assume the live SQL Server/PostgreSQL test containers — this task is fixture-only.
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Test or check to add:** A test comparing two fixture partitions by
  hash, matching the plan row's own red-state description: "test
  comparing two fixture partitions by hash expecting a mismatch at
  partition 2 fails (function doesn't exist)." Build this against one of
  the existing seeded fixture pairs (`sqlserver-customer`,
  `snowflake-orders`, or `postgres-products` — whichever has, or can be
  most naturally partitioned into, a case with a known planted mismatch
  you can target; read `packages/engine/fixtures/**` first to pick the
  right one and document your choice) rather than inventing new fixture
  data, unless the existing fixtures genuinely can't support a
  partition-level mismatch case — if so, disclose why and what minimal
  fixture addition was needed.
- **Command:** `npx vitest run packages/engine/src/comparison-core/hash-comparison`
- **Expected failure reason:** Module/function does not exist yet.
- **Captured output:** Paste the actual failing command output into
  `IMPLEMENTATION-REPORT.md`, not a paraphrase.

## Green-state and full verification

- **Focused command:** `npx vitest run packages/engine/src/comparison-core/hash-comparison`
- **Full command:** `npm run verify`
- **Expected evidence:** The red-state case now passes, matching the
  plan row's acceptance framing ("matches idea doc's progressive-
  narrowing example structure"). Add a case proving hash comparison and
  full row-level comparison (T-14's `compareRows`) **agree** on the same
  fixture mismatch — i.e. wherever `compareByHash` reports a row-level or
  column-level hash mismatch, `compareRows` independently classifies that
  same row/column as differing, and wherever hashes match, `compareRows`
  reports no difference for that row — this directly anticipates the
  plan row's stated review-gate requirement ("independent reviewer
  confirms hash comparison and full row-level comparison agree on the
  same fixture mismatch case"), so make sure your own test suite already
  proves it, not just something the reviewer has to construct from
  scratch. All previously passing tests (368 as of T-16b) still pass with
  no regression. `npm run verify` exits 0.

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md`
- **Independent reviewer:** `reviewer` subagent (separate instance from
  whichever `implementer` subagent does this task)
- **Review report location:** `REVIEW-REPORT.md`
- **Commit or patch checkpoint:** Branch `task/T-20-hash-comparison`

**Note to reviewer:** per `IMPLEMENTATION-PLAN.md`'s T-20 review-gate
column verbatim: "Independent reviewer confirms hash comparison and full
row-level comparison agree on the same fixture mismatch case." Don't just
re-run the implementer's own agreement test — construct at least one
additional fixture scenario yourself (a different mismatch than the
implementer's chosen worked example, ideally including at least one case
where hashes match at a coarser level but a narrower level reveals a
planted mismatch, exercising the progressive-narrowing framing) and
independently verify `compareByHash` and `compareRows` agree on it. Also
verify: (1) hashing genuinely applies normalization first (construct a
case where two differently-formatted-but-equivalent values, e.g. "125.37"
vs "125.3700" or "Shipped" vs "SHIPPED", hash to the same value after
normalization — if hashing operates on raw unnormalized values, that's a
real defect against the doc's explicit "HASH(normalized_column_1, ...)"
requirement, not a nitpick); (2) confirm no file outside
`hash-comparison/**` was touched, and no planner-wiring scope creep
occurred; (3) confirm the level-escalation-scope judgment call (documented
in the Objective section above) was actually followed as declared in
`IMPLEMENTATION-REPORT.md`, not silently over- or under-built relative to
what was disclosed.
