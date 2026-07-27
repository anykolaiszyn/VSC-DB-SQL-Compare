# ParityLens — Review Report T-04

## Review independence

This review was performed by a separate Claude Code subagent instance,
distinct from the T-04 implementer. No implementation files, `TASK-BRIEF.md`,
or `IMPLEMENTATION-REPORT.md` were edited as part of this review. Only this
file (`REVIEW-REPORT.md`) was written. All verification commands below were
re-run fresh in this review session, not copied from the implementation
report. (This file previously held the stale T-03 re-review report; it has
been fully replaced with the T-04 review below.)

## Review scope

- **Task objective:** Implement the DuckDB-backed `FixtureConnector`
  implementing `DataPlatformConnector` (`@paritylens/shared`), plus three
  named seed fixture pairs (SQL Server-shaped, Snowflake-shaped,
  PostgreSQL-shaped), each with a deliberate schema, volume, and row-level
  mismatch, per `TASK-BRIEF.md` T-04.
- **Files and interfaces reviewed:**
  - `packages/engine/src/connector-sdk/fixture/fixture-connector.ts`
  - `packages/engine/src/connector-sdk/fixture/fixture-connector.test.ts`
  - `packages/engine/src/connector-sdk/fixture/type-mapping.ts`
  - `packages/engine/fixtures/sqlserver-customer.ts`
  - `packages/engine/fixtures/snowflake-orders.ts`
  - `packages/engine/fixtures/postgres-products.ts`
  - `packages/engine/fixtures/index.ts`
  - `packages/engine/tsconfig.json`, `packages/engine/package.json`,
    `package-lock.json` (companion changes, scope-checked)
  - `packages/shared/src/connector.ts` (`DataPlatformConnector` contract)
  - `packages/engine/src/connector-sdk/safety/statement-safety.ts` (T-03,
    consumed not modified)
- **Evidence reviewed:** `git show --stat 8e2e07b`, `git show 8e2e07b --
  packages/engine/tsconfig.json`, `git show 8e2e07b -- packages/engine/package.json`,
  `git diff main..task/T-04-fixture-connector --stat`,
  `git diff --name-only main..task/T-04-fixture-connector -- packages/shared
  packages/engine/src/connector-sdk/safety` (empty — confirms untouched),
  direct reading of all new/changed source, fresh `npx vitest run
  packages/engine`, fresh `npm run verify`, `npm ls @duckdb/node-api
  --workspace=@paritylens/engine`.

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

## Verification performed

| Check | Exact command or inspection | Result |
| --- | --- | --- |
| Scope — commit file list | `git show --stat 8e2e07b` | Touches only `packages/engine/src/connector-sdk/fixture/**`, `packages/engine/fixtures/**`, plus `packages/engine/tsconfig.json`, `packages/engine/package.json`, `package-lock.json`. `IMPLEMENTATION-REPORT.md` updated in a separate commit (`682ec88`). No files under `packages/shared/**` or `packages/engine/src/connector-sdk/safety/**` touched. |
| Scope — shared/safety untouched, confirmed against `main` | `git diff --name-only main..task/T-04-fixture-connector -- packages/shared packages/engine/src/connector-sdk/safety` | Empty output — confirmed untouched across the full branch, not just the two T-04 commits. |
| tsconfig diff content | `git show 8e2e07b -- packages/engine/tsconfig.json` | `rootDir: "src"` → `"."`, `include: ["src"]` → `["src", "fixtures"]`. `outDir` unchanged (`dist`). Minimum change needed for `fixtures/` (a new top-level directory this task owns) to type-check as part of the engine project; does not widen the include beyond `src` + `fixtures`, does not touch any other package's tsconfig, and does not affect compiled output location. No committed `dist/` artifacts in the branch (`git show 8e2e07b --stat` has no `dist` entries; `dist/` is gitignored). Assessed as legitimate, minimal, mechanically-necessary, not scope creep. |
| package.json diff content | `git show 8e2e07b -- packages/engine/package.json` | Single line added: `"@duckdb/node-api": "^1.5.5-r.2"` under `dependencies`, scoped to `packages/engine` only. Matches the brief's "DuckDB bindings only" constraint; no `mssql`/`snowflake-sdk`/`pg` added. `package-lock.json` diff is a pure lockfile update from this one install (142 lines, consistent with a single new dependency's transitive tree). |
| DuckDB binding sanity check | `npm ls @duckdb/node-api --workspace=@paritylens/engine` | Resolves to `@duckdb/node-api@1.5.5-r.2`, actually installed under `packages/engine`. Real, actively-maintained DuckDB Labs package (not hallucinated); a reasonable choice per the report's stated rationale (Promise-native API matching `AsyncIterable<RecordBatch>`). |
| `DataPlatformConnector` conformance | Direct read of `fixture-connector.ts` against `packages/shared/src/connector.ts` | All 9 interface methods implemented with real behavior: `testConnection` (round-trips `SELECT 1`, measures latency, catches failure), `getCatalogs`/`getSchemas`/`getObjects` (return the fixture's single catalog/schema/table — correct for a fixture connector, not a stub), `getSchema` (runs `DESCRIBE`, maps DuckDB types via `type-mapping.ts`, computes nullable/length/precision/scale), `executeQuery` (async generator, safety-gated, row-capped, real DuckDB round trip), `getCapabilities` (concrete flags), `quoteIdentifier` (real quoting/escaping), `buildProfileQuery` (generates real aggregate SQL). No method throws "not implemented" or returns silently-fake data. `{ kind: "sqlFile" }` correctly throws a descriptive error rather than silently returning empty/fake data — acceptable per the brief since no in-scope consumer needs file I/O. |
| T-03 integration — real, not vacuous | Direct read of `executeQuery` (lines 180-201 of `fixture-connector.ts`): `assertReadOnlyStatement(sql, FIXTURE_DIALECT)` is called synchronously inside the async-generator body, before `connection.runAndReadAll(cappedSql)`. Test at `fixture-connector.test.ts:81-89` manually obtains the async iterator and calls `.next()` (the only way to actually execute an async-generator body up to a throw), asserting `MutatingStatementError` is thrown. A second test (comment-hidden `DROP TABLE`, lines 91-99) and a third (`DELETE` rejected AND row count unchanged afterward, lines 101-119) reinforce this. This exercises the real `executeQuery` code path, not a mock — confirmed by reading the implementation directly, not by trusting the test name. |
| `getSchema` also safety-gated | Direct read, `fixture-connector.ts:144-151` | `DESCRIBE` statement is also routed through `assertReadOnlyStatement` before running, consistent defense in depth beyond the brief's minimum ask. |
| Fixture mismatch 1 — `sqlserver-customer` | Direct read of `packages/engine/fixtures/sqlserver-customer.ts` | `CreditLimit` column: present in `customer_source` `CREATE TABLE` (line 37), absent from `customer_target` (lines 57-61) — confirmed. Row counts: 6 `INSERT`s into source (lines 41-46), 7 into target (lines 65-71) — confirmed. `CustomerID` 4 ("Grace Hopper") present in source, absent from target inserts — confirmed. `CustomerID` 2: source "Jane Roe" vs target "Jane R. Doe" — confirmed. `CustomerID` 5 appears twice in target (lines 68-69), second copy has `IsActive` flipped to `false` vs source's single `true` row — confirmed. |
| Fixture mismatch 2 — `snowflake-orders` | Direct read of `packages/engine/fixtures/snowflake-orders.ts` | `DISCOUNT_PCT` present in source `CREATE TABLE` (line 28), absent from target (lines 46-51) — confirmed. `ORDER_TOTAL` `DECIMAL(12,2)` source vs `DECIMAL(10,2)` target — confirmed. Row counts: 5 source inserts (lines 33-37), 4 target inserts (lines 54-57) — confirmed. `ORDER_ID` 103 (PENDING) present in source, absent from target — confirmed. `ORDER_ID` 101: source total `250.00` vs target `199.99` — confirmed. |
| Fixture mismatch 3 — `postgres-products` | Direct read of `packages/engine/fixtures/postgres-products.ts` | `sku` `VARCHAR(20)` source vs `VARCHAR(10)` target — confirmed. `description` present in source (line 29), absent from target (lines 49-54) — confirmed. Row counts: 5 source inserts (lines 35-39), 6 target inserts (lines 57-62) — confirmed. `product_id` 3 present in source, absent from target — confirmed. `product_id` 6 present in target, absent from source — confirmed. `product_id` 2 appears twice in target (lines 58-59), prices `19.99` vs `24.99`, source has it once at `19.99` — confirmed. |
| Fixture mismatches — test-level cross-check | Direct read of `fixture-connector.test.ts` "deliberate mismatch verification" `describe` block (lines 122-240) | Each of the above is independently asserted via live `FixtureConnector`/DuckDB round trips (not hardcoded expectations against the fixture source), one test per documented mismatch, at least one schema/volume/row-level assertion per pair, matching the report's claim of 11 mismatch tests. |
| Fresh focused test run | `npx vitest run packages/engine` (re-run by this reviewer) | Exit 0. 2 test files, **149/149 tests** passed (109 pre-existing `statement-safety.test.ts` unchanged/passing + 40 new `fixture-connector.test.ts`). Matches the implementation report's claim exactly; no regression in T-03's suite. |
| Fresh full verification | `npm run verify` (re-run by this reviewer) | Exit 0. `tsc -b --force`: no errors. `eslint .`: no errors. `vitest run`: 3 test files, **160/160 tests** passed (11 shared + 109 statement-safety + 40 fixture-connector). Matches the implementation report's claim exactly. |

## Prior-finding disposition

| Finding ID | Disposition | Evidence of resolution |
| --- | --- | --- |
| T-01 M-01 | NOT APPLICABLE | T-04 does not touch T-01's scaffolding files; open status carried forward unrelated to this task. |
| T-01 M-02 | NOT APPLICABLE (already resolved prior to T-04) | No T-04 files intersect T-01's scope. |
| T-02 M-03 | NOT APPLICABLE | T-04 consumes `packages/shared/**` read-only via imports; confirmed zero diff against `main` for that path. |
| T-02 M-04 | NOT APPLICABLE (tracked) | Same as above; unrelated to fixture/connector-sdk fixture scope. |
| T-03 I-01 | NOT APPLICABLE (already resolved prior to T-04) | `statement-safety.ts` confirmed byte-for-byte untouched by this branch (`git diff --name-only` empty for that path); I-01's CTE-wrapped-mutation fix remains in place and is exercised transitively by T-04's integration tests without modification. |
| T-03 M-05 / M-06 | NOT APPLICABLE (tracked for T-17/T-19) | Concern real platform connectors' dialect handling, not the Fixture connector; T-04 explicitly does not implement real connectors. |

## Approval status

- **Status:** APPROVED
- **Reviewer:** Claude Code Independent Reviewer subagent
- **Date:** 2026-07-27
- **Release or dependency impact:** T-04 unblocks T-05 (type-mapping), T-06
  (schema diff), T-14 (row-level mismatch), and all later engine tasks
  (T-07-T-09, T-12-T-16, T-20, T-21) that depend on `FixtureConnector` as
  their standard test double. All three fixture pairs' claimed schema,
  volume, and row-level mismatches are verified real and independently
  re-derivable from live `FixtureConnector`/DuckDB queries, not merely
  asserted in prose — the load-bearing requirement for T-06/T-14's later
  acceptance criteria is satisfied. T-03's `assertReadOnlyStatement` is
  confirmed genuinely wired into `executeQuery` (and `getSchema`) on every
  code path, verified by direct code inspection plus a non-vacuous async-
  generator-level test. The `tsconfig.json`/`package.json`/`package-lock.json`
  changes outside the declared "files owned" list are minimal, mechanically
  necessary companions (new directory needs a type-check include path; one
  new dependency needs a manifest/lockfile entry) and do not constitute
  scope creep. Fresh verification reproduces the implementation report's
  claimed 149/149 focused and 160/160 full test results exactly, with no
  regression in T-03's 109 pre-existing tests.
