# ParityLens — Implementation Report T-21

## Status and objective

- **Status:** COMPLETE (implementation and evidence only — not reviewed or approved; see Recommended next step)
- **Objective:** Implement `buildSampleQuery(strategy, input, connector, options): GeneratedQuery`, per `IMPLEMENTATION-PLAN.md`'s T-21 row (quoted verbatim in `TASK-BRIEF.md`): "Implement sampling strategies (first-N, random, deterministic hash, stratified, date-window, key-range per idea doc 'Strategy A') for use when row-level or profile checks are configured with a sample strategy." Per the brief's Objective section: "This task builds **query generation only**... It does not itself execute the query, does not wire sampling into the planner/`runComparison`, and does not modify any check (row-level/profile) to consume a sample automatically."

This session resumed a prior implementer session that was interrupted mid-work by a session/API limit. The checkpoint commit (`063fbfb`, WIP) already contained a substantially complete `sampling.ts` (all six strategies) and `sampling.test.ts`, but two tests were failing and the work was uncommitted-as-final. This report covers: investigating and resolving the two failing tests, confirming lint cleanliness (removing dead imports), and producing final verification evidence.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/engine/src/comparison-core/sampling/sampling.test.ts` | Rewrote the two failing injection-rejection tests to assert the correct safety property (safe quoting + inert-at-execution, not synchronous throw); removed unused `DuckDBInstance`/`DuckDBConnection`/`beforeAll`/`afterAll` imports | Investigation determined `quoteIdentifier` already escapes correctly (see Injection-test investigation below) — the tests' expectations, not the production code, were wrong. Unused imports were dead code from an earlier draft that would fail lint if a stricter unused-import rule were enabled, and are misleading (they imply a supplemental-table pattern this suite doesn't use) |
| `packages/engine/src/comparison-core/sampling/sampling.ts` | No change this session | Investigation confirmed the existing `quoteIdentifier`-based escaping (already documented in this file's own header comment) was correct; no production-code fix was needed |
| `IMPLEMENTATION-REPORT.md` | Overwritten with T-21's report (previously contained T-20's report) | Per `TASK-BRIEF.md`'s Handoff section, this is T-21's implementation report location |

No file outside `packages/engine/src/comparison-core/sampling/**` (plus this report) was touched, per `TASK-BRIEF.md`'s Files owned section.

## Behavior and interfaces

- **Behavior delivered:** `buildSampleQuery` generates SQL text (never executes it) for all six named strategies from `Idea Prompt.md`'s "Strategy A" section: `first-n`, `random`, `deterministic-hash`, `stratified`, `date-window`, `key-range`. Each strategy is a discriminated union member with its own parameter shape (see `sampling.ts` for full JSDoc per strategy). The function is pure and synchronous, never calls `connector.executeQuery`, and never accepts or threads an `ExecutionOptions`-shaped value — enforcing the brief's central correctness property that a sample's own `LIMIT`/`TOP`/`TABLESAMPLE` clause is always additive to, never a replacement for, the caller's `maxRows`/`timeoutMs`.
- **Interfaces consumed:** `DataPlatformConnector.quoteIdentifier` / `.getCapabilities().supportsTableSampling` (`packages/shared/src/connector.ts`, T-02); `QueryInput` discriminated union (`packages/shared/src/types.ts`, T-02). No `executeQuery` call is made by this module itself.
- **Interfaces produced:** `buildSampleQuery(strategy, input, connector, options): SampleGeneratedQuery` (`packages/engine/src/comparison-core/sampling/sampling.ts`). `SampleGeneratedQuery` (deliberately not named `GeneratedQuery`, to avoid colliding with the unrelated existing `GeneratedQuery` in `packages/shared/src/connector.ts` used for `buildProfileQuery`'s preview shape) carries `{ strategy, sql: { kind: "query"; sql: string }, parameters: Record<string, unknown> }` and never carries or overrides `ExecutionOptions`.

### Deterministic-hash reproducibility approach

`DeterministicHashStrategy` generates `WHERE abs(hash(<keyColumn>)) % <modulus> = <bucket>` using DuckDB's `hash()` function, which is a pure function of its input (no randomness, no session/connection state), so two independent calls to `buildSampleQuery` with identical strategy parameters produce byte-identical SQL text, and two independent executions of that SQL against the same underlying data produce an identical row set. This is proven in `sampling.test.ts` by two tests: one asserting `generated1.sql.sql === generated2.sql.sql` after two separate `buildSampleQuery` calls, then executing both and comparing sorted `ORDER_ID` sets; a second test executing the *same* generated query twice independently and comparing row sets a third time.

**Disclosed dialect limitation** (per the brief: "If a truly platform-neutral deterministic-hash SQL expression isn't achievable without per-dialect branching, disclose that explicitly"): this is DuckDB-only. DuckDB's `hash()`, SQL Server's `HASHBYTES('MD5', ...)` (returns `VARBINARY`, needs a `CONVERT` to an integer-comparable form), and PostgreSQL's `md5(...)` (returns hex text, needs a hash-to-integer conversion for a modulus predicate) are three non-interchangeable SQL surfaces with no single expression that runs unmodified on all three. A real SQL Server/PostgreSQL connector integration would need per-dialect hash-expression generation this module does not attempt — out of scope, since this task is fixture-only per the brief's Dependencies section ("this task is fixture-only (`FixtureConnector`/DuckDB in-process)"). Same category of disclosed gap as T-20's own hashing-approach header comment.

### `supportsTableSampling` branching judgment call

The brief authorized (did not mandate) branching the "random" strategy on `connector.getCapabilities().supportsTableSampling`, and required disclosure of the exact fallback SQL shape if taken. The implementation (from the prior session, verified unchanged this session) took this branch:

- **`supportsTableSampling === true`:** `SELECT * FROM <objectRef> TABLESAMPLE SYSTEM (100 PERCENT) LIMIT <sampleSize>`. `TABLESAMPLE SYSTEM (n PERCENT)` (or a close syntactic variant) is supported by DuckDB, SQL Server, PostgreSQL, and Snowflake alike, making it the one native sampling clause close enough to portable across all four target platforms to hardcode without violating the "do not hardcode a single dialect's sampling syntax" rule. The percentage is fixed at a conservative `100` rather than computed from `sampleSize` against an estimated table size, because deriving a meaningful percentage would require this module to query the table's row count first — which would require an `executeQuery` call, explicitly prohibited by the brief. The actual returned sample size is instead governed by the outer, disclosed `LIMIT <sampleSize>` (itself still additive to, never a replacement for, the caller's `maxRows`).
- **`supportsTableSampling === false`:** `SELECT * FROM <objectRef> ORDER BY RANDOM() LIMIT <sampleSize>` (DuckDB's `RANDOM()`; documented per-dialect equivalents in the header comment: SQL Server `NEWID()`, PostgreSQL/Snowflake `RANDOM()`).

Both branches are non-deterministic by design — the "Random sample" strategy is explicitly distinct from "Deterministic hash sample" in `Idea Prompt.md`'s own strategy list, so no reproducibility claim is made for `random`.

Fixture verification: `FixtureConnector.getCapabilities()` (`packages/engine/src/connector-sdk/fixture/fixture-connector.ts:210-227`, read for reference only, not modified) returns `supportsTableSampling: true` (confirmed by reading the file), so `sampling.test.ts`'s "random strategy" tests exercise the `TABLESAMPLE` branch, not the `ORDER BY RANDOM()` fallback. The fallback branch is exercised only by code inspection, not by a fixture-driven test, since no fixture/connector in this codebase currently reports `supportsTableSampling: false` — disclosed here as a coverage gap rather than silently left unmentioned.

## Injection-test investigation and resolution

**Issue as received:** two tests — "stratified strategy rejects/escapes an injection attempt in stratifyColumn..." and "date-window strategy rejects an injection attempt in dateColumn..." — asserted `buildSampleQuery(...)` throws synchronously when given a malicious identifier-shaped parameter (`'ORDER_STATUS"; DROP TABLE orders_source; --'` and `"event_date'); DROP TABLE orders_source; --"` respectively). Both tests failed: no throw occurred.

**Investigation performed:** read `FixtureConnector.quoteIdentifier` directly (`packages/engine/src/connector-sdk/fixture/fixture-connector.ts:230-232`):

```typescript
quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}
```

Constructed the exact malicious identifier and ran it through this literal expression in a standalone Node script:

```
input:  ORDER_STATUS"; DROP TABLE orders_source; --
output: "ORDER_STATUS""; DROP TABLE orders_source; --"
```

This confirms `quoteIdentifier` **does** correctly double every embedded `"` character — the standard SQL identifier-escaping rule — before wrapping the result in an outer pair of quotes. The output is a single, syntactically well-formed, closed quoted-identifier literal: there is no unescaped `"` anywhere in it, so it cannot terminate the quoted-identifier context early and expose `; DROP TABLE ...` as live SQL outside a string/identifier literal. I also reconstructed the full generated `stratified` SQL text by hand using this exact expression and confirmed the entire statement remains a single well-formed `SELECT`, with the malicious text sealed inertly inside the (nonexistent) column name.

**Conclusion: case (a).** `quoteIdentifier` already escapes correctly; the two tests' original expectations were wrong. A malicious string, once safely quoted, becomes an inert identifier-name string — one that would fail to resolve as a real column at execution time (a DuckDB binder "column not found"-class error), not something that should throw synchronously at SQL-generation time. Per the dispatch instructions, I fixed the tests' expectations rather than the production code, and am disclosing that reasoning here as required.

**Test fix applied:** both tests were rewritten (not deleted) to assert the actual safety property the brief's review gate cares about — "no mutating statement can be smuggled through" — rather than a synchronous-throw expectation the code was never designed to satisfy. Each rewritten test now:
1. Asserts the generated SQL contains the correctly quote-doubled literal (e.g. `"ORDER_STATUS""; DROP TABLE orders_source; --"`), proving no unescaped `"` breaks out of the identifier context.
2. Asserts `assertReadOnlyStatement(generated.sql.sql, "duckdb")` does not throw — the generated text is still a single, well-formed, read-only `SELECT` statement.
3. Executes the generated SQL through the real `FixtureConnector` and asserts it **rejects** (DuckDB binder error on the nonexistent malicious "column"), proving the injected text is never live SQL.
4. Re-queries `orders_source` afterward and asserts rows still exist, as direct proof no `DROP TABLE` was actually executed.

All 15 tests (13 original + the 2 rewritten) now pass. This resolution is consistent with — and does not weaken — the brief's "Note to reviewer" adversarial-injection requirement: "confirm it's either rejected or safely parameterized/escaped." The malicious input is safely escaped; execution against real data confirms it is inert, not merely "not synchronously thrown."

## Dead-import cleanup

`sampling.test.ts`'s original imports included `DuckDBInstance`, `DuckDBConnection` from `@duckdb/node-api` and `beforeAll`/`afterAll` from `vitest`, per a header comment describing a "supplemental table" setup. Reading the final test bodies confirmed none of these are used — date-window/stratified tests use `snowflake-orders`'s existing fixture data or inline `{ kind: "query" }` VALUES-based derived tables, never a separately seeded DuckDB instance/connection or `beforeAll`/`afterAll` lifecycle hooks. Removed all four unused imports and rewrote the header comment's "Fixture choice" paragraph to describe the actual (VALUES-based, no supplemental table) approach rather than the abandoned earlier draft's approach. `npm run lint` passes clean with these removed (see Verification evidence below).

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Red state | `npx vitest run packages/engine/src/comparison-core/sampling` (run with `sampling.ts` temporarily renamed to simulate its absence, to obtain fresh genuine red-state evidence since no prior red-state capture existed from the interrupted session) | 1 failed suite, 0 tests: `Error: Failed to load url ./sampling.js (resolved id: ./sampling.js) in .../sampling.test.ts. Does the file exist?` | Captured below |
| Focused green state | `npx vitest run packages/engine/src/comparison-core/sampling` | 1 file passed, **15/15 tests passed**, exit 0 | Captured below |
| Lint | `npm run lint` | `eslint .` — clean, exit 0, no output | Captured below |
| Full verification | `npm run verify` | typecheck + lint + test all pass. **396 passed, 27 skipped (423 total), exit 0** | Captured below |

### Red-state output (verbatim)

```
$ npx vitest run packages/engine/src/comparison-core/sampling
 ❯ packages/engine/src/comparison-core/sampling/sampling.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  packages/engine/src/comparison-core/sampling/sampling.test.ts [ packages/engine/src/comparison-core/sampling/sampling.test.ts ]
Error: Failed to load url ./sampling.js (resolved id: ./sampling.js) in V:/Secret Projects/VSC-DB-SQL-Compare/packages/engine/src/comparison-core/sampling/sampling.test.ts. Does the file exist?
 ❯ loadAndTransform ../../Secret%20Projects/VSC-DB-SQL-Compare/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  no tests
```

(`sampling.ts` was immediately restored, unmodified, after this capture — `git status` confirmed zero diff on `sampling.ts` before and after.)

### Focused green-state output (verbatim)

```
$ npx vitest run packages/engine/src/comparison-core/sampling
 ✓ packages/engine/src/comparison-core/sampling/sampling.test.ts (15 tests) 49ms

 Test Files  1 passed (1)
      Tests  15 passed (15)
```

### Lint output (verbatim)

```
$ npm run lint
> paritylens@0.0.1 lint
> eslint .
```
(no errors, exit 0)

### Full verification output (verbatim, relevant portion)

```
$ npm run verify
> paritylens@0.0.1 verify
> npm run typecheck && npm run lint && npm run test

> paritylens@0.0.1 typecheck
> tsc -b --force

> paritylens@0.0.1 lint
> eslint .

> paritylens@0.0.1 test
> vitest run

 ✓ packages/shared/src/types.test.ts (11 tests) 7ms
 ✓ packages/engine/src/comparison-core/row-level/row-level.test.ts (8 tests) 12ms
 ✓ packages/engine/src/comparison-core/type-mapping/type-mapping.test.ts (69 tests) 16ms
 ✓ packages/engine/src/comparison-core/normalization/normalization.test.ts (24 tests) 41ms
 ✓ packages/engine/src/comparison-core/mapping/mapping.test.ts (12 tests) 11ms
 ↓ packages/engine/src/connector-sdk/postgres/postgresConnector.test.ts (14 tests | 14 skipped)
 ✓ packages/engine/src/orchestration/definition/definition.test.ts (30 tests) 84ms
 ✓ packages/engine/src/connector-sdk/safety/statement-safety.test.ts (109 tests) 31ms
 ✓ packages/extension/src/webview/resultsWebview.test.ts (7 tests) 6ms
 ✓ packages/engine/src/comparison-core/schema-diff/schema-diff.test.ts (11 tests) 98ms
 ✓ packages/extension/src/views/parityTreeDataProvider.test.ts (5 tests) 7ms
 ✓ packages/extension/src/export/exporters.test.ts (6 tests) 21ms
 ✓ packages/engine/src/comparison-core/sampling/sampling.test.ts (15 tests) 114ms
 ✓ packages/extension/src/activation/activate.test.ts (3 tests) 9ms
 ✓ packages/extension/src/secrets/secretStore.test.ts (3 tests) 8ms
 ✓ packages/engine/src/comparison-core/volume/volume.test.ts (7 tests) 235ms
 ✓ packages/extension/src/statusbar/parityStatusBar.test.ts (2 tests) 4ms
 ✓ packages/engine/src/comparison-core/profiling/profiling.test.ts (13 tests) 367ms
 ✓ packages/engine/src/comparison-core/hash-comparison/hash-comparison.test.ts (13 tests) 512ms
 ✓ packages/engine/src/orchestration/planner/planner.test.ts (8 tests) 498ms
 ↓ packages/engine/src/connector-sdk/sqlserver/sqlServerConnector.test.ts (13 tests | 13 skipped)
 ✓ packages/engine/src/connector-sdk/fixture/fixture-connector.test.ts (40 tests) 1068ms

 Test Files  20 passed | 2 skipped (22)
      Tests  396 passed | 27 skipped (423)
   Start at  15:09:28
   Duration  2.33s
```

Arithmetic check: T-20's post-merge baseline was 381 passed. This task's suite has 15 tests. 381 + 15 = 396, matching the observed total exactly — no regression, and the delta is fully accounted for by this task's own new tests. Skipped count (27) is unchanged, consisting entirely of the pre-existing PostgreSQL (14) and SQL Server (13) live-container integration suites, which this task does not touch and which require Docker containers not provisioned in this environment (documented in `CLAUDE.md`'s Environment section).

## Assumptions and risks

- **Assumptions:** `snowflake-orders`'s `orders_source` table (5 rows, `ORDER_ID` 101–105, `ORDER_STATUS` column) is adequate to exercise all six strategies together with two inline VALUES-based derived tables for date-window testing — I did not add or edit fixture data, consistent with the brief's ownership boundary excluding `packages/engine/fixtures/**`.
- **Risks or limitations:**
  1. **Deterministic-hash is DuckDB-only** (disclosed above and in `sampling.ts`'s header comment) — a real SQL Server/PostgreSQL connector will need dialect-specific hash-expression generation this module does not provide.
  2. **`supportsTableSampling: false` fallback branch (`ORDER BY RANDOM()`) is untested against a real fixture/connector** — no connector in this codebase currently reports `false` for this capability, so that code path is verified only by reading the source, not by a passing test exercising it. This is a coverage gap, disclosed rather than hidden.
  3. **`TABLESAMPLE SYSTEM (100 PERCENT)` is a fixed, non-representative percentage** — as explained above, this is a deliberate tradeoff (querying real table size would require `executeQuery`, prohibited), and the effective sample size is instead governed by the outer `LIMIT`. A caller relying on `TABLESAMPLE`'s statistical-sampling semantics (as opposed to a deterministic `LIMIT`-bounded row count) should be aware the percentage argument itself carries no real sampling-density meaning in this implementation.
  4. **Not wired into the planner, profiling, or row-level checks** — by design, matching the brief's explicit Objective-section scope boundary and T-13/T-20 precedent. A future task must perform this integration.
- **Blockers:** None.

## Patch or commit identity

- **Patch or commit:** to be created by the commit step immediately following this report (see below) — branch `task/T-21-sampling`, on top of `8bb3a5c`.
- **Branch or workspace:** `task/T-21-sampling`

## Recommended next step

This implementation, including its investigation and resolution of the two previously-failing injection tests, is ready for **independent review** by a separate `reviewer` subagent instance, per `TASK-BRIEF.md`'s Handoff section. The reviewer should specifically re-probe the injection-test resolution independently (construct the malicious identifier itself, verify `quoteIdentifier`'s escaping behavior firsthand, and confirm my case-(a) conclusion rather than trusting this report), and follow the brief's "Note to reviewer" adversarial checklist in full (independent maxRows-cap probe, independent deterministic-hash reproducibility check, and confirmation the `supportsTableSampling` branching was followed as disclosed). I have not self-approved this work and do not have authority to mark T-21 complete in `PROGRESS-LEDGER.md` — that remains the Lead Orchestrator's action after review.
