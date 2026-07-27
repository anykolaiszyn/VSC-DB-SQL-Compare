# ParityLens — Implementation Report T-04

## Status and objective

- **Status:** COMPLETE
- **Objective:** Implement the DuckDB-backed Fixture connector implementing
  `DataPlatformConnector` (from `@paritylens/shared`), including seed fixture
  datasets with deliberately mismatched schema, volume, and row-level cases
  standing in for SQL Server-shaped, Snowflake-shaped, and PostgreSQL-shaped
  data, per `TASK-BRIEF.md` T-04.

## DuckDB binding choice

**Chosen: `@duckdb/node-api` (DuckDB Labs' official "Neo" Node client),
installed as a dependency of `packages/engine` only** (`npm install
@duckdb/node-api --workspace=@paritylens/engine`), not the legacy `duckdb`
npm package. Rationale:

- **Promise-native API.** `DuckDBInstance.create()`, `connection.run()`,
  `connection.runAndReadAll()` all return Promises directly. The legacy
  `duckdb` package's API is callback/EventEmitter-based and would need manual
  promisification to fit `DataPlatformConnector.executeQuery`'s
  `AsyncIterable<RecordBatch>` contract — `@duckdb/node-api` maps onto that
  contract with no adapter layer.
- **Actively maintained forward path.** `@duckdb/node-api` is DuckDB Labs'
  current recommended Node client; the legacy `duckdb` package is in
  maintenance mode upstream.
- **JS-native value extraction.** `DuckDBResultReader.getRowsJS()` returns
  plain JavaScript values (not DuckDB's internal value-wrapper types), and
  `columnNames()`/`columnTypes()` give exactly the metadata needed to build
  `RecordBatch.columns`/`RecordBatch.rows` and `ColumnDefinition[]` without an
  extra conversion step.
- **No added native-toolchain requirement.** Ships prebuilt native binaries
  per-platform via `@duckdb/node-bindings`, the same distribution model as
  the legacy package — no new build dependency for CI or contributors.
- **Version installed:** `@duckdb/node-api@^1.5.5-r.2` (resolved via `npm
  install`, recorded in `packages/engine/package.json` and the root
  `package-lock.json`).

Each `FixtureConnector` instance opens its own **in-memory** DuckDB database
(`DuckDBInstance.create(":memory:")`) and seeds exactly one side (source or
target) of one named fixture pair into it on first use. Nothing is ever
persisted to disk — the fixture data is disposable, test-only state that
disappears when the process/connector instance ends.

## Fixture data design

Fixture datasets are **generated in code** as TypeScript modules under
`packages/engine/fixtures/` — each module exports a `FixtureTableDefinition`
(`{ createTableSql, insertRowsSql }`) per side. This was chosen over
embedded CSV/SQL files because: (1) it keeps the mismatch documentation
directly adjacent to the data that encodes it (a comment block per file,
explicit and diffable), (2) it needs zero file-I/O or CSV-parsing code in
the connector itself — `FixtureConnector` just runs the SQL strings via
DuckDB, and (3) TypeScript catches shape mistakes (e.g. a typo'd column
list) at compile time. `packages/engine/fixtures/index.ts` is the registry
mapping a `FixtureSetId` (`"sqlserver-customer" | "snowflake-orders" |
"postgres-products"`) and `FixtureSide` (`"source" | "target"`) to the table
name and definition `FixtureConnector` should seed.

### Pair 1 — `sqlserver-customer` (SQL Server-shaped source → Snowflake-shaped target)

Mirrors `Idea Prompt.md` section 2's own worked example (SQL Server
`dbo.Customer` → Snowflake `ANALYTICS.CUSTOMER`). Source table
`customer_source`, target table `customer_target`.

- **Schema mismatch:** `CreditLimit` (`DECIMAL(19,4)`, standing in for SQL
  Server `MONEY`) exists on the source and is **entirely absent** from the
  target — a dropped/renamed column. Also `CreatedDate` (source) vs
  `CREATED_AT` (target) mirror the idea doc's own `DATETIME` vs
  `TIMESTAMP_NTZ` "Review"-severity example (both modeled here as
  `TIMESTAMP` since DuckDB has no native `MONEY`/`TIMESTAMP_NTZ` types, but
  the column presence/absence mismatch is the load-bearing, verifiable part).
  Verify: `source.getSchema(...)` contains `"CreditLimit"`;
  `target.getSchema(...)` does not.
- **Volume mismatch:** source has **6** rows, target has **7** rows. Verify:
  `collectRows(source, "customer_source").length === 6` and
  `collectRows(target, "customer_target").length === 7`.
- **Row-level mismatch (missing-target):** `CustomerID` 4 ("Grace Hopper")
  exists in source, has no corresponding row in target.
- **Row-level mismatch (differing value):** `CustomerID` 2's name differs —
  source `"Jane Roe"` vs target `"Jane R. Doe"`.
- **Row-level mismatch (duplicate-target):** `CustomerID` 5 ("Ada Lovelace")
  appears **twice** in target, with the second copy's `IS_ACTIVE` flipped to
  `false` (source has it once, `IsActive = true`).
- (Bonus, not required by the brief but present: `CustomerID` 7 exists in
  target only — a missing-source row.)

Source: `packages/engine/fixtures/sqlserver-customer.ts`.

### Pair 2 — `snowflake-orders` (Snowflake-shaped dev vs prod)

Models a same-platform dev-vs-prod `ORDERS` reconciliation (`Idea
Prompt.md` section 1's "Development versus production comparisons" use
case), using Snowflake-flavored native types (`DECIMAL(p,s)`, `VARCHAR`,
`DOUBLE`). Source table `orders_source`, target table `orders_target`.

- **Schema mismatch:** `DISCOUNT_PCT` (`DOUBLE`) exists on source, absent
  from target entirely. Also `ORDER_TOTAL` precision narrows from
  `DECIMAL(12,2)` (source) to `DECIMAL(10,2)` (target) — a
  compatible-but-different declared-precision mismatch.
- **Volume mismatch:** source has **5** rows, target has **4** rows.
- **Row-level mismatch (missing-target):** `ORDER_ID` 103 (`PENDING`) exists
  in source, absent from target.
- **Row-level mismatch (differing value):** `ORDER_ID` 101's `ORDER_TOTAL`
  differs — source `250.00` vs target `199.99`.

Source: `packages/engine/fixtures/snowflake-orders.ts`.

### Pair 3 — `postgres-products` (PostgreSQL-shaped source vs target)

Models a `PRODUCTS` catalog reconciliation (replication/ETL regression
scenario), using Postgres-flavored types (`NUMERIC`/`DECIMAL`, `VARCHAR`
with differing declared lengths, `BOOLEAN`). Source table
`products_source`, target table `products_target`.

- **Schema mismatch:** `sku` narrows from `VARCHAR(20)` (source) to
  `VARCHAR(10)` (target) — a declared-length mismatch. Also `description`
  (`VARCHAR(500)`) exists on source, absent from target entirely.
- **Volume mismatch:** source has **5** rows, target has **6** rows.
- **Row-level mismatch (missing-target):** `product_id` 3 exists in source,
  absent from target.
- **Row-level mismatch (missing-source):** `product_id` 6 exists in target,
  absent from source.
- **Row-level mismatch (duplicate-target):** `product_id` 2 appears
  **twice** in target, with a differing `price` on the second copy
  (`19.99` vs `24.99`); source has it once at `19.99`.

Source: `packages/engine/fixtures/postgres-products.ts`.

All three pairs' mismatches are additionally asserted directly by dedicated
tests in the "deliberate mismatch verification" `describe` block of
`packages/engine/src/connector-sdk/fixture/fixture-connector.test.ts`, so a
reviewer (or a later task like T-06/T-14) can re-run
`npx vitest run packages/engine` and see each mismatch independently
confirmed against live `FixtureConnector` output, not just asserted in this
report's prose.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/engine/src/connector-sdk/fixture/fixture-connector.ts` | New | `FixtureConnector` class implementing `DataPlatformConnector` against in-memory DuckDB |
| `packages/engine/src/connector-sdk/fixture/type-mapping.ts` | New | Best-effort DuckDB native-type-string → `CanonicalTypeCategory` mapping so `getSchema()` populates `canonicalType` without depending on T-05 |
| `packages/engine/src/connector-sdk/fixture/fixture-connector.test.ts` | New | Focused Vitest suite: red-state test, full 3-pair/2-side coverage, statement-safety integration proof, deliberate-mismatch verification |
| `packages/engine/fixtures/sqlserver-customer.ts` | New | Fixture pair 1 seed data (SQL Server-shaped source → Snowflake-shaped target) |
| `packages/engine/fixtures/snowflake-orders.ts` | New | Fixture pair 2 seed data (Snowflake-shaped dev vs prod) |
| `packages/engine/fixtures/postgres-products.ts` | New | Fixture pair 3 seed data (PostgreSQL-shaped source vs target) |
| `packages/engine/fixtures/index.ts` | New | Fixture-set registry: `FixtureSetId`/`FixtureSide` → table name + definition |
| `packages/engine/package.json` | Modified | Added `@duckdb/node-api` dependency, scoped to `packages/engine` |
| `packages/engine/tsconfig.json` | Modified | `rootDir` widened from `src` to `.` and `include` extended to `["src", "fixtures"]` so `packages/engine/fixtures/**` (owned by this task per `TASK-BRIEF.md`) type-checks as part of the engine project; `outDir` unchanged (still `dist`) |
| `package-lock.json` | Modified | Lockfile update from installing `@duckdb/node-api` |

No files under `packages/shared/**` or
`packages/engine/src/connector-sdk/safety/**` were modified — T-03's
`assertReadOnlyStatement` is consumed via its existing public export only.

## Behavior and interfaces

- **Behavior delivered:** `FixtureConnector` (constructed with a
  `FixtureSetId` and `FixtureSide`) implements every method of
  `DataPlatformConnector`: `testConnection`, `getCatalogs`, `getSchemas`,
  `getObjects`, `getSchema`, `executeQuery`, `getCapabilities`,
  `quoteIdentifier`, `buildProfileQuery`. `executeQuery` calls
  `assertReadOnlyStatement` on every SQL string — both caller-supplied
  (`{ kind: "query" }`) and connector-generated (`{ kind: "table" }` →
  `SELECT * FROM <table>`) — before it reaches DuckDB, and `getSchema`'s
  `DESCRIBE` statement is routed through the same gate for consistency.
- **Interfaces consumed:** `DataPlatformConnector` and its supporting types
  (`packages/shared/src/connector.ts`), `ColumnDefinition`/`QueryInput`/
  `ExecutionOptions`/`RecordBatch`/`CanonicalTypeCategory`
  (`packages/shared/src/types.ts`), `assertReadOnlyStatement`/
  `MutatingStatementError`/`SqlDialect`
  (`packages/engine/src/connector-sdk/safety/statement-safety.ts`).
- **Interfaces produced:** `FixtureConnector` class (constructible with
  `new FixtureConnector(fixtureSetId, side)`); the fixture-set registry
  (`getFixtureSet`, `fixtureTableName`, `FIXTURE_SET_IDS`,
  `FixtureSetId`, `FixtureSide`) for later tasks (T-05, T-06, T-14, etc.) to
  construct connectors against named, documented fixture pairs.

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline (pre-change) | `npm run verify` | Exit 0. 120/120 tests (`packages/shared/src/types.test.ts`: 11; `statement-safety.test.ts`: 109) | Captured in this session's transcript before any T-04 file was written |
| Red state | `npx vitest run packages/engine` (with only `fixture-connector.test.ts` importing the not-yet-created `FixtureConnector`) | 1 test file failed to load: `Error: Failed to load url ./fixture-connector.js ... Does the file exist?`; 109 pre-existing tests still passed; 0 new tests ran | Captured in this session's transcript |
| Focused green state | `npx vitest run packages/engine` | Exit 0. 2 test files passed, **149/149** tests (109 pre-existing statement-safety + 40 new fixture-connector tests, 0 skipped) | Captured in this session's transcript |
| Full verification | `npm run verify` (`tsc -b --force` && `eslint .` && `vitest run`) | Exit 0. `tsc -b --force`: no errors. `eslint .`: no errors. `vitest run`: 3 test files passed, **160/160** tests (11 shared + 109 statement-safety + 40 fixture-connector) | Captured in this session's transcript |

Full verification command's final run output (representative excerpt):

```text
> paritylens@0.0.1 verify
> npm run typecheck && npm run lint && npm run test

> tsc -b --force
(no output — success)

> eslint .
(no output — success)

> vitest run
 ✓ packages/shared/src/types.test.ts (11 tests)
 ✓ packages/engine/src/connector-sdk/safety/statement-safety.test.ts (109 tests)
 ✓ packages/engine/src/connector-sdk/fixture/fixture-connector.test.ts (40 tests)

 Test Files  3 passed (3)
      Tests  160 passed (160)
```

The 40 new tests cover: `testConnection`/`getSchema`/`executeQuery` for all
3 fixture pairs × 2 sides (source and target) = 6 connector instances, both
`{ kind: "table" }` and `{ kind: "query" }` input shapes, an
`executeQuery`-level rejection of a mutating statement
(`DELETE FROM customer_source`) proving `MutatingStatementError` propagates
through the async generator (integration proof T-03's parser is actually
wired into `executeQuery`, not just imported and unused), a second rejection
case for a comment-hidden mutation, a test confirming the rejected `DELETE`
never actually reduced the row count (no silent partial execution), and one
dedicated assertion per documented mismatch above (11 mismatch-verification
tests total, at least one schema/volume/row-level assertion per fixture
pair).

## Assumptions and risks

- **Assumptions:**
  - `packages/engine/tsconfig.json`'s `rootDir`/`include` needed to widen
    from `src`-only to also cover `fixtures/` because the task brief assigns
    `packages/engine/fixtures/**` as owned files consumed by TypeScript
    imports from `src/`; this is a config change within `packages/engine`'s
    own tsconfig (not `packages/shared` or the safety module), so it was
    made directly rather than treated as an out-of-scope interface change.
    `outDir` remains `dist`, so compiled output layout is unaffected beyond
    now also including a `dist/fixtures/` subtree.
  - `ExecutionOptions.signal` (typed as ambient `AbortSignal` in
    `@paritylens/shared`) resolves, under this workspace's `lib: ["ES2022"]`
    combined with no `@types/node`/DOM-lib configuration, to an ambient interface with
    zero accessible members (confirmed via a `keyof AbortSignal` probe
    resolving to `never`). `FixtureConnector.executeQuery` reads
    `options.signal?.aborted` through an `unknown` cast with an inline
    comment explaining why, rather than assuming a richer shape. This is a
    pre-existing characteristic of the shared type as declared by T-02, not
    something this task could fix without touching `packages/shared`.
  - DuckDB has no native `MONEY` or `TIMESTAMP_NTZ` types, so the
    SQL-Server-shaped and Snowflake-shaped fixture pairs use DuckDB
    `DECIMAL`/`TIMESTAMP` as realistic stand-ins; the *documented* mismatch
    (column presence/absence, declared precision/length) is what's
    load-bearing and verifiable, consistent with `DESIGN-SPEC.md`'s own
    acknowledged risk that "fixture behavior may not perfectly reflect every
    real-platform quirk."
  - `QueryInput.kind === "sqlFile"` is not implemented (throws a descriptive
    `Error` directing the caller to pass file contents via
    `{ kind: "query" }` instead) — no file-system access was added to keep
    this connector's footprint minimal and because no consumer in this
    task's scope needs it; a later task can extend this if a real need
    arises.
- **Risks or limitations:**
  - `type-mapping.ts`'s DuckDB-type → `CanonicalTypeCategory` mapping is
    intentionally narrow (a full native-type catalog per real platform is
    T-05's concern per `IMPLEMENTATION-PLAN.md`); it is sufficient for
    `FixtureConnector.getSchema()` to satisfy its own contract but should
    not be treated as T-05's deliverable.
  - Two stray build-artifact files were briefly generated directly inside
    `packages/engine/fixtures/` (`*.js`/`*.d.ts` alongside the `.ts`
    sources) during iteration on the `tsconfig.json` fix, before `outDir`
    was confirmed to route all build output to `dist/` correctly; these were
    deleted before commit and are not present in the committed tree (verify:
    `packages/engine/fixtures/` contains only `.ts` files in the commit).
- **Blockers:** None.

## Patch or commit identity

- **Patch or commit:** `8e2e07b`
- **Branch or workspace:** `task/T-04-fixture-connector` (created from
  `main` at commit `0af3b14`)

## Recommended next step

Independent review by a separate Claude Code subagent instance, distinct
from this implementer, per `TASK-BRIEF.md`'s handoff section. The reviewer
should specifically:

1. Confirm at least one deliberate mismatch per fixture pair is real and
   independently verifiable — re-run `npx vitest run packages/engine` and
   inspect the "deliberate mismatch verification" test block's output, and
   optionally query the fixture data directly via a throwaway script using
   `FixtureConnector` to hand-verify a couple of the documented mismatches
   (e.g. `CustomerID` 5's duplication in `sqlserver-customer`/target,
   `product_id` 2's differing price in `postgres-products`/target).
2. Confirm the statement-safety integration test
   (`"rejects a mutating statement supplied as query input, via T-03's
   parser, before it reaches DuckDB"`) genuinely exercises
   `assertReadOnlyStatement` inside `executeQuery` and is not vacuously
   passing.
3. Confirm no file under `packages/shared/**` or
   `packages/engine/src/connector-sdk/safety/**` was modified.
4. Record findings in `REVIEW-REPORT.md` per `TASK-BRIEF.md`'s handoff
   contract. Required owner for any Critical/Important finding: the T-04
   implementer (a new implementation pass), not self-resolved by the
   reviewer.
