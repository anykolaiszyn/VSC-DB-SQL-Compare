# ParityLens — Task Brief T-21

## Objective

Implement sampling strategies, `IMPLEMENTATION-PLAN.md`'s T-21 row (quoted
verbatim): "Implement sampling strategies (first-N, random, deterministic
hash, stratified, date-window, key-range per idea doc 'Strategy A') for use
when row-level or profile checks are configured with a sample strategy."

`Idea Prompt.md`'s "Strategy A: Sample comparison" section (verbatim):

> Best for quick development checks.
> First N rows
> Random sample
> Deterministic hash sample
> Stratified sample
> Date-window sample
> Key-range sample

This task builds **query generation only**: given a sampling strategy and a
`QueryInput`, produce the SQL text that would select the requested sample.
It does not itself execute the query, does not wire sampling into the
planner/`runComparison`, and does not modify any check (row-level/profile)
to consume a sample automatically — matching this project's established
precedent of a comparison-core capability landing before its planner
integration (T-13 before T-15's wiring; T-20's `compareByHash` still has no
planner wiring either).

`IMPLEMENTATION-PLAN.md`'s literal Interfaces column for T-21 is
`buildSampleQuery(strategy, input): GeneratedQuery` — a pure SQL-generating
function, not an execution function. `GeneratedQuery` is not defined
elsewhere in this codebase; design it yourself as a small local interface
(see Interfaces section below for the minimum it must carry) within this
task's owned directory, following `HashComparisonResult`'s own precedent
(T-20) of defining a new result shape locally when no existing consumer
requires it live in `packages/shared`.

**The review gate is explicit and is the central correctness property of
this task, quoted verbatim from `IMPLEMENTATION-PLAN.md`'s T-21 row:**
"Independent reviewer confirms sampling never bypasses the row-cap/timeout
safety limits from `DESIGN-SPEC.md`." Concretely: `buildSampleQuery` returns
SQL text; when that text is actually executed (by a caller, not by this
task), it must still go through the connector's existing
`executeQuery(input, options: ExecutionOptions)` surface, where
`ExecutionOptions.maxRows`/`timeoutMs` are enforced exactly as they are for
every other query in this codebase (`DESIGN-SPEC.md`: default 100,000-row
cap, 60s timeout, both overridable). A sampling strategy must never
construct SQL that embeds its own unbounded row limit *in place of* the
caller-supplied `maxRows`, and must never claim to make the row cap
unnecessary (e.g. "TABLESAMPLE already limits rows so maxRows can be
skipped" is exactly the kind of reasoning this brief prohibits) — a sample
query is still subject to the same `ExecutionOptions` any other
`QueryInput`/`executeQuery` call is subject to. If a strategy's generated
SQL includes its own `LIMIT`/`TOP`/`SAMPLE` clause (e.g. first-N, or a
platform's native `TABLESAMPLE`), that is fine and expected — the sample
size itself is a query-shape concern — but it is additive to, never a
replacement for, the caller's own `maxRows`/`timeoutMs` enforcement at
execution time. Document this relationship explicitly in code comments and
in `IMPLEMENTATION-REPORT.md`, since the reviewer will specifically probe
it.

`ConnectorCapabilities.supportsTableSampling` (`packages/shared/src/connector.ts`)
already exists. Some fixture/connector implementations may report `false`
for it. Design `buildSampleQuery` to work for every strategy regardless of
`supportsTableSampling` (e.g. key-range/date-window/first-N samples are
expressible as ordinary `WHERE`/`ORDER BY`/`LIMIT` SQL with no native
`TABLESAMPLE` dependency; only decide whether "random sample" specifically
should branch on `supportsTableSampling` to prefer a platform-native
`TABLESAMPLE`/`TABLESAMPLE SYSTEM`-style clause when available, falling
back to an ORDER-BY-random-expression approach when not — if you take this
branching approach, disclose the exact fallback SQL shape used for each
case in `IMPLEMENTATION-REPORT.md` rather than silently picking one without
explanation). Do not hardcode a single dialect's sampling syntax as if it
were universal — this module works against the connector's public surface
(`quoteIdentifier`, not raw SQL dialect assumptions), the same pattern
T-13/T-14/T-15/T-20 already established.

**Deterministic hash sample** must be genuinely deterministic and
reproducible across two separate runs — this is the plan row's own
red-state acceptance criterion ("two runs producing identical sample
sets"). Reuse T-20's hashing approach where it makes sense (SHA-256 over a
normalized value, or a native SQL hash function per dialect) but do not
import from `hash-comparison/**` — that module computes hashes over fetched
rows in JS after execution; this task generates *query text*, before
execution, so a genuinely deterministic hash-based sample needs either a
SQL-side deterministic hash expression (`hash(col)` in DuckDB,
`HASHBYTES(...)` in SQL Server, `md5(...)` in PostgreSQL — same three
dialects T-20 already named) used in a `WHERE hash(col) % N = 0`-style
predicate, or an equivalent deterministic approach you design and disclose.
If a truly platform-neutral deterministic-hash SQL expression isn't
achievable without per-dialect branching, disclose that explicitly (same
disclosure requirement T-20's brief imposed, and the same category of
tradeoff — do not silently ship a DuckDB-only implementation under a
general-sounding name).

Note to whoever dispatches an implementer against this brief: quote this
document's load-bearing requirements verbatim rather than paraphrasing
them — a paraphrase that loosens a requirement is a known failure mode
from this project's history (T-07's I-02 finding traced back to exactly
this).

## Dependencies

- **Required completed tasks:** T-07 (column profiling, COMPLETE/APPROVED —
  per the plan row, sampling is "for use when row-level or profile checks
  are configured with a sample strategy"; read `profiling.ts` to understand
  how a profile check currently issues its queries, so `buildSampleQuery`'s
  output shape is compatible with being substituted in as a future
  `QueryInput`/pre-filter, even though wiring that substitution in is out
  of this task's scope).
- **Required decisions or approvals:** NONE beyond the already-approved
  `IMPLEMENTATION-PLAN.md` T-21 row.
- **Environment:** this task is fixture-only (`FixtureConnector`/DuckDB
  in-process). It does not need the WSL/Docker live-database containers —
  work and test entirely from your normal shell.

## Files owned

- `packages/engine/src/comparison-core/sampling/**` (new directory)

Do not touch `packages/engine/src/connector-sdk/safety/**` (T-03's owned
file), `packages/engine/src/comparison-core/type-mapping/**` (T-05's owned
file), `packages/engine/src/connector-sdk/fixture/**` (T-04's owned file —
consume `FixtureConnector` read-only via `import`, do not modify it),
`packages/engine/src/comparison-core/normalization/**` (T-12's owned file),
`packages/engine/src/comparison-core/row-level/**` (T-14's owned file),
`packages/engine/src/comparison-core/profiling/**` (T-07's owned file — read
for pattern reference only, do not edit),
`packages/engine/src/comparison-core/hash-comparison/**` (T-20's owned
file — read for pattern reference only per the Objective section above, do
not edit or import from it),
`packages/engine/src/comparison-core/volume/**` (T-13's owned file),
`packages/engine/src/orchestration/planner/**` (T-09/T-15's owned file —
this task does not wire sampling into `runComparison`; that is future
integration work, out of scope here, mirroring T-13's and T-20's own
precedent of a comparison-core capability landing before its planner
wiring), or any connector-sdk file (`sqlserver/**`/`postgres/**`).

Do not modify `packages/shared/src/**` unless a genuine interface gap is
found — if so, stop and flag it as a blocker rather than editing it
directly; this task is expected to define `GeneratedQuery` and any sampling
strategy types locally within `sampling/**`, following T-20's
`HashComparisonResult` precedent (no `packages/shared` type needed since no
external consumer exists yet, planner wiring being out of scope).

## Interfaces

| Direction | Interface | Contract | Producer or consumer |
| --- | --- | --- | --- |
| Consumed | `DataPlatformConnector` (`packages/shared/src/connector.ts`) | Existing, complete interface. Use `quoteIdentifier`/`getCapabilities().supportsTableSampling` only — this task does not call `executeQuery` itself, it only generates SQL text a future caller would execute | T-02 (producer) |
| Consumed | `QueryInput` (`packages/shared/src/types.ts`) | Existing, complete discriminated union (`table`/`query`/`sqlFile`). `buildSampleQuery` takes an already-resolved `QueryInput` describing the object/query to sample from | T-02 (producer) |
| Produced | `buildSampleQuery(strategy, input, connector, options): GeneratedQuery` (new, `packages/engine/src/comparison-core/sampling/sampling.ts` or similar) | `strategy` is a discriminated union over the six named strategies (`"first-n"`, `"random"`, `"deterministic-hash"`, `"stratified"`, `"date-window"`, `"key-range"` — choose exact string literals, document them, one options shape per strategy carrying whatever parameters that strategy needs, e.g. `n` for first-N, a hash modulus/bucket count for deterministic-hash, a stratification column for stratified, a date column + window bounds for date-window, a key column + range bounds for key-range). `GeneratedQuery` must carry at minimum the generated SQL text (as a `QueryInput`-compatible `{ kind: "query"; sql: string }` or equivalent) and enough metadata for a caller to understand what was sampled (strategy used, any parameters applied) — it does NOT carry or override `ExecutionOptions`; execution-time `maxRows`/`timeoutMs` remain entirely the caller's responsibility via the existing `executeQuery` contract, per the Objective section's central correctness property | This task (producer) |

## Prohibited changes

- Do not modify any file outside `packages/engine/src/comparison-core/sampling/**` except where explicitly authorized above (none currently — flag and stop if you believe you need to).
- Do not execute any query yourself (no `executeQuery` calls) — this task produces SQL text only.
- Do not wire this into `runComparison`/the planner, or into `profiling.ts`/`row-level.ts` — that is explicitly out of scope for this task.
- Do not generate SQL that embeds a row limit intended to replace, rather than compose with, the caller's `ExecutionOptions.maxRows`/`timeoutMs` — see the Objective section's central correctness property.
- Do not require or assume the live SQL Server/PostgreSQL test containers — this task is fixture-only.
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Test or check to add:** matching the plan row's own red-state
  description verbatim: "test requesting a deterministic-hash sample
  expecting reproducible row selection fails (function doesn't exist)."
  Build this against one of the existing seeded fixture pairs
  (`sqlserver-customer`, `snowflake-orders`, or `postgres-products` —
  document your choice) rather than inventing new fixture data.
- **Command:** `npx vitest run packages/engine/src/comparison-core/sampling`
- **Expected failure reason:** Module/function does not exist yet.
- **Captured output:** Paste the actual failing command output into
  `IMPLEMENTATION-REPORT.md`, not a paraphrase.

## Green-state and full verification

- **Focused command:** `npx vitest run packages/engine/src/comparison-core/sampling`
- **Full command:** `npm run verify`
- **Expected evidence:** matching the plan row's own acceptance framing
  verbatim: "same test passes with two runs producing identical sample
  sets" — for the deterministic-hash strategy specifically, generate the
  query twice (or execute it twice against the fixture connector) and
  confirm the resulting row selection is byte-identical both times. Add
  coverage for all six named strategies, not just deterministic-hash,
  proving each produces syntactically valid SQL that the fixture connector
  can actually execute without error (run it through
  `FixtureConnector.executeQuery` in the test to prove the generated SQL is
  real, executable SQL, not just a plausible-looking string) and returns a
  sensible result shape for that strategy (e.g. first-N returns at most N
  rows; date-window returns only rows within the configured bounds; key-range
  returns only rows within the configured key bounds). Add a specific test
  proving the safety-limit relationship from the Objective section: execute
  a generated sample query through `executeQuery` with a deliberately small
  `ExecutionOptions.maxRows` and confirm the cap is still honored (i.e. the
  sample query's own `LIMIT`/`TOP`/sample-size clause, if any, does not
  prevent the connector's own row cap from applying) — this is the concrete
  evidence for the review gate's required confirmation. All previously
  passing tests (381 as of T-20) still pass with no regression. `npm run
  verify` exits 0.

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md`
- **Independent reviewer:** `reviewer` subagent (separate instance from
  whichever `implementer` subagent does this task)
- **Review report location:** `REVIEW-REPORT.md`
- **Commit or patch checkpoint:** Branch `task/T-21-sampling`

**Note to reviewer:** per `IMPLEMENTATION-PLAN.md`'s T-21 review-gate column
verbatim: "Independent reviewer confirms sampling never bypasses the
row-cap/timeout safety limits from `DESIGN-SPEC.md`." Do not just re-run the
implementer's own safety-limit test — construct your own independent probe:
generate a sample query for at least one strategy whose SQL includes its own
size-limiting clause (e.g. first-N's `LIMIT`, or a `TABLESAMPLE`-based random
sample if implemented), execute it through the real `FixtureConnector`
with an `ExecutionOptions.maxRows` set *smaller* than the strategy's own
requested sample size, and confirm the connector's cap — not the sample
strategy's own clause — is what actually determines the final row count
returned. Also verify: (1) the deterministic-hash strategy's reproducibility
claim by generating/executing it yourself twice independently and diffing
the row sets; (2) that no strategy's generated SQL bypasses
`assertReadOnlyStatement` in a way that would let a mutating statement slip
through disguised as a "sample" (construct at least one adversarial
malformed-parameter case, e.g. attempting to inject SQL via a
stratification/date/key-range parameter, and confirm it's either rejected
or safely parameterized/escaped — this task doesn't call `executeQuery`
itself, but the SQL it generates will eventually be executed by a caller
that does go through `assertReadOnlyStatement`, so injected SQL text is
still a real risk surface even though this task's own tests use
`FixtureConnector` directly); (3) confirm no file outside `sampling/**` was
touched and no planner/profiling/row-level wiring scope creep occurred; (4)
confirm the `supportsTableSampling`-branching judgment call (if the
implementer took one) was actually followed and disclosed as declared in
`IMPLEMENTATION-REPORT.md`.
