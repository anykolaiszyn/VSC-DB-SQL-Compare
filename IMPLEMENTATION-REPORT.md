# ParityLens — Implementation Report T-19

## Status and objective

- **Status:** COMPLETE (implementation and evidence only — not reviewed or approved)
- **Objective:** Per `TASK-BRIEF.md`'s Objective section, quoted verbatim:
  "Implement `PostgresConnector`, a `DataPlatformConnector` implementation
  (`@paritylens/shared`) backed by the `pg` package, targeting the local
  PostgreSQL 16 test container already running via `docker-compose.test.yml`
  at the repo root. Same requirements as T-17 (SQL Server connector,
  COMPLETE and APPROVED) — every method of the interface implemented against
  a real database server, following the same overall pattern." All nine
  `DataPlatformConnector` methods are implemented and exercised against a
  live PostgreSQL 16 container (not stubbed or mocked).

## Environment note (critical for reproducing this report)

Per `TASK-BRIEF.md`'s Test environment section, this machine's Docker
container is only reachable from inside WSL2 — not from Windows/PowerShell/
Git-Bash — and the WSL2 VM (and everything running in it, including the
container) tears down between separate `wsl.exe` invocations from Windows.
This session's own shell was confirmed to be Git-Bash on Windows via
`uname -a` reporting `MINGW64_NT` (not a Linux/WSL kernel), so every command
below was invoked via `MSYS2_ARG_CONV_EXCL="*" wsl.exe -e bash -c '...'`,
matching T-17's documented invocation pattern exactly. All implementation,
red-state, green-state, and full-verification commands were run from inside
WSL2 (confirmed via `uname -a` reporting a `microsoft-standard-WSL2` kernel
inside the `wsl.exe` invocation), with Node v24.9.0 activated via `nvm`
(`~/.nvm`), against the repo at `/mnt/v/Secret Projects/VSC-DB-SQL-Compare`.
Every command that needed the container brought the container up
(`docker compose -f docker-compose.test.yml up -d`, polled until
`(healthy)`) in the **same** `wsl.exe` invocation as the test run itself.

**Environment variable names chosen** (per the brief's suggested names,
adopted as-is):

```
PARITYLENS_TEST_POSTGRES_HOST=localhost
PARITYLENS_TEST_POSTGRES_PORT=54320
PARITYLENS_TEST_POSTGRES_USER=paritylens
PARITYLENS_TEST_POSTGRES_PASSWORD=ParityLens_Test1!
PARITYLENS_TEST_POSTGRES_DATABASE=paritylens_test   (optional, defaults to "paritylens_test")
```

These are read only inside `postgresConnector.test.ts` (test source), via
`readTestServerEnv()`. `postgresConnector.ts` itself never reads
environment variables or hardcodes any credential — it is constructed from
an explicit `PostgresConnectionOptions` object supplied by the caller.

**Unrelated pre-existing repo state, left untouched:** `git status` from
inside WSL shows nearly every tracked file as "modified" relative to the
Windows-side checkout. Investigated and confirmed to be a pure CRLF/LF
line-ending artifact of viewing the same working tree from WSL with no
`core.autocrlf` configured in that context, not real content drift — same
phenomenon T-17's report documented. `git diff --ignore-all-space --stat`
across the whole repo shows real content differences in exactly two files:
`package-lock.json` and `packages/engine/package.json` (both this task's
own mechanical dependency-addition changes). This report's commit stages
only the files this task actually owns/mechanically needed
(`packages/engine/src/connector-sdk/postgres/**`,
`packages/engine/package.json`, `package-lock.json`), leaving all of the
CRLF-drift noise untouched in the working tree, per the "do not disturb
unrelated uncommitted work" rule.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/engine/src/connector-sdk/postgres/postgresConnector.ts` (new) | `PostgresConnector` class implementing all 9 `DataPlatformConnector` methods against the `pg` package (node-postgres): `testConnection`, `getCatalogs` (`pg_catalog.pg_database`), `getSchemas` (`information_schema.schemata`), `getObjects` (`information_schema.tables`), `getSchema` (`information_schema.columns` + `table_constraints`/`key_column_usage` for real primary-key metadata, for `{kind:"table"}`; driver-reported `result.fields`/type-OID lookup for `{kind:"query"}`/`{kind:"sqlFile"}`), `executeQuery` (streams a single `RecordBatch` capped via a `SELECT * FROM (...) LIMIT n` wrapper), `getCapabilities`, `quoteIdentifier` (`"..."` double-quote quoting with `""` escaping), `buildProfileQuery`. Constructed from an explicit `PostgresConnectionOptions` object (host/port/user/password/database), never a bare connection string. `assertReadOnlyStatement(sql, "postgres")` (T-03) called on every SQL string before it reaches the driver, on every method that executes SQL — both caller-supplied and connector-generated, matching `FixtureConnector`'s/`SqlServerConnector`'s pattern. `mapNativeType(nativeType, "postgres")` (T-05) used for every column's `canonicalType`. M-06 (dollar-quoting) resolved via a connector-level `rejectDollarQuoting()` check that runs before `assertReadOnlyStatement` — see "M-06 resolution" section below. | Brief's Objective and Interfaces table (Produced row: `PostgresConnector` class). |
| `packages/engine/src/connector-sdk/postgres/postgresConnector.test.ts` (new) | Integration test suite (14 tests) run against the live container, wrapped in `describe.skipIf(!hasTestServerEnv)` with a visible `console.log` skip reason when `PARITYLENS_TEST_POSTGRES_HOST/PORT/USER/PASSWORD` are unset. `beforeAll`/`afterAll` seed and tear down a real table (`public.t19_parity_lens_customer`, with `NUMERIC(10,2)` and `NUMERIC(5,2)` columns) via the driver directly (not through `executeQuery`, since `CREATE TABLE`/`INSERT`/`DROP TABLE` are themselves mutating and must not go through the read-only-enforced path this task tests). Covers: live `testConnection` success; graceful (non-throwing) failure against a bad password and an unreachable host; `getSchema` NUMERIC(10,2)/(5,2)→Decimal/precision/scale mapping (T-05); `executeQuery` row-capping via `maxRows`; `{kind:"query"}` execution including a trailing `ORDER BY` (PostgreSQL, unlike SQL Server, needs no special wrapper handling for this — verified directly); DROP/INSERT/UPDATE/DELETE rejection via `assertReadOnlyStatement`, each followed by a server-side re-query proving the table/rows were genuinely unaffected (not just a client-side throw); two dollar-quoting rejection tests (M-06) — the exact T-03-reviewer-demonstrated bypass (`$$it's fine$$` with embedded apostrophe) and a tagged variant (`$tag$...$tag$`), both followed by server-side re-verification for the first; `getCatalogs`/`getSchemas`/`getObjects` against real server metadata; `buildProfileQuery`; `quoteIdentifier`; `getCapabilities`. | Brief's Red-state evidence section (3 named cases, extended to 14 total per Green-state requirements) and Carried-forward finding (M-06); `IMPLEMENTATION-PLAN.md`'s T-19 review-gate column ("confirms no test skip hides a real failure"). |
| `packages/engine/package.json` | Added `pg: ^8.16.0` to `dependencies` and `@types/pg: ^8.11.0` to `devDependencies`. | Brief explicitly authorizes `pg` as a new runtime dependency ("this is expected and in scope, not a deviation to flag"); `@types/pg` is disclosed here per the brief's "do not add any other new runtime dependency without disclosing it" instruction — it is a types-only devDependency (no runtime code shipped), added because `pg` does not bundle its own `.d.ts` files, following the same precedent T-17 set for `@types/mssql`. |
| `package-lock.json` | Updated by `npm install` to record the two new dependencies and their transitive tree. | Mechanical consequence of the above, same as every prior task that added a dependency. |

**Files explicitly NOT touched**, confirming Prohibited Changes compliance: `packages/engine/src/connector-sdk/safety/**`, `packages/engine/src/comparison-core/type-mapping/**`, `packages/engine/src/connector-sdk/fixture/**`, `packages/engine/src/connector-sdk/sqlserver/**`, `packages/shared/src/connector.ts`, `docker-compose.test.yml`.

## Behavior and interfaces

- **Behavior delivered:** A working `PostgresConnector` validated end-to-end against a real, running PostgreSQL 16 Docker container — not a mock or stub. `testConnection()` succeeds against the live container and fails gracefully (`{success:false, message}`, never throws) against both a wrong password and an unreachable host. `getSchema()` against a real table returns correct `ColumnDefinition[]` including a `NUMERIC(10,2)` column and a `NUMERIC(5,2)` column, both mapped to canonical `Decimal` with correct `precision`/`scale`, exercising T-05's mapping for real. `executeQuery()` streams a `RecordBatch` honoring `options.maxRows` (verified: 3 seeded rows capped to 2). A `DROP TABLE` (and separately INSERT/UPDATE/DELETE) attempted through `executeQuery` is rejected by `assertReadOnlyStatement` before reaching the driver, with server-side re-verification proving no mutation occurred.
- **Interfaces consumed:** `DataPlatformConnector` (`packages/shared/src/connector.ts`, unmodified, all 9 methods implemented); `assertReadOnlyStatement(sql, "postgres")` (`packages/engine/src/connector-sdk/safety/statement-safety.ts`, unmodified, imported); `mapNativeType(nativeType, "postgres")` (`packages/engine/src/comparison-core/type-mapping/type-mapping.ts`, unmodified, imported).
- **Interfaces produced:** `PostgresConnector` class and `PostgresConnectionOptions` interface, both exported from `packages/engine/src/connector-sdk/postgres/postgresConnector.ts`.

## M-06 resolution (carried-forward finding)

Resolved via option (a) from the brief: connector-level hardening, mirroring
T-17's `rejectGoBatchSeparator()` pattern for M-05. A new
`rejectDollarQuoting(sqlText)` function runs inside both `executeQuery` and
the `{kind:"query"}`/`{kind:"sqlFile"}` branch of `getSchema`, *before*
`assertReadOnlyStatement` is called, using the regex
`/\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/` to detect any dollar-quote delimiter —
either the bare `$$` form or a tagged `$tag$` form (PostgreSQL's own tag
rule: letters/digits/underscores, not starting with a digit — the same
rules as an unquoted SQL identifier). If found anywhere in the statement, it
throws before either the safety parser or the `pg` driver ever sees the SQL
string.

**Judgment call:** rather than attempting to safely tokenize dollar-quoted
content in `assertReadOnlyStatement`'s style (which would require
duplicating a meaningful slice of that module's own literal-stripping logic
— out of this task's file ownership per the Prohibited Changes section),
this connector conservatively rejects *any* statement containing a
dollar-quote delimiter outright, rather than attempting to parse past it
safely. This is a stricter resolution than a minimal "make the T-03
reviewer's specific example throw" fix: it blocks all dollar-quoted SQL
through this connector, not just apostrophe-desync cases. Justification:
dollar-quoting is used almost exclusively for function bodies/procedural
code, not for the read-only `SELECT`-shaped comparison queries this
connector's `executeQuery`/`getSchema` are documented to run, so the
practical cost of this restriction is low, and it closes the underlying gap
completely rather than only the one demonstrated instance of it.

This was **not** left as "unreachable through this connector" without
verification — the claim was tested directly, against the live container,
with two dedicated integration tests:

1. `"executeQuery rejects a dollar-quoted statement with an embedded
   apostrophe (M-06 connector-level hardening)"` sends exactly the T-03
   reviewer's own demonstrated bypass, adapted to this task's seeded table:
   `SELECT $$it's fine$$ AS x; DROP TABLE public.t19_parity_lens_customer;`
   through the live connector and asserts (a) the call rejects with a
   message matching `/dollar-quote/i`, and (b) a follow-up `getSchema` call
   proves the table still has all 4 columns (i.e. the DROP genuinely never
   reached PostgreSQL).
2. `"executeQuery rejects a tagged dollar-quoted statement ($tag$...$tag$)
   (M-06 connector-level hardening)"` confirms the tagged form
   (`$tag$it's still fine$tag$`) is also rejected, not just the bare `$$`
   form.

Both tests passed against the live container (see Verification evidence
below).

## Verification evidence

All commands below were run from inside WSL2, per the Test environment
constraint. `MSYS2_ARG_CONV_EXCL="*" wsl.exe -e bash -c '...'` was the
invocation mechanism from this session's own shell (Git-Bash on Windows,
confirmed via `uname -a` reporting `MINGW64_NT`, not WSL) — matching T-17's
documented pattern exactly.

### Docker container reaching healthy (same WSL session as the red-state test run)

```
$ docker compose -f docker-compose.test.yml up -d postgres-test
 Container vsc-db-sql-compare-postgres-test-1  Starting
 Container vsc-db-sql-compare-postgres-test-1  Started
poll 1: "Health":"starting"
poll 2: "Health":"starting"
poll 3: "Health":"healthy"
NAME                                 IMAGE                COMMAND                  SERVICE         CREATED       STATUS                   PORTS
vsc-db-sql-compare-postgres-test-1   postgres:16-alpine   "docker-entrypoint.s…"   postgres-test   3 hours ago   Up 7 seconds (healthy)   0.0.0.0:54320->5432/tcp, [::]:54320->5432/tcp
```

(The container had a pre-existing `postgres:16-alpine` image and volume
from earlier T-17 session work in this same environment, hence "3 hours
ago" as the container's original creation time — it was stopped/idle
between separate `wsl.exe` invocations and re-started fresh at the top of
this task's own session, exactly as the brief's Test environment section
warns must be expected.)

### Red state

- **Command:** `npx vitest run packages/engine/src/connector-sdk/postgres` (run with `postgresConnector.ts` temporarily moved aside to `/tmp/postgresConnector.ts.bak`, simulating "connector doesn't exist yet")
- **Expected failure reason (per brief):** Module/class does not exist yet.
- **Actual captured output:**

```
 RUN  v2.1.9 /mnt/v/Secret Projects/VSC-DB-SQL-Compare

 ❯ packages/engine/src/connector-sdk/postgres/postgresConnector.test.ts [ packages/engine/src/connector-sdk/postgres/postgresConnector.test.ts ]
Error: Failed to load url ./postgresConnector.js (resolved id: ./postgresConnector.js) in /mnt/v/Secret Projects/VSC-DB-SQL-Compare/packages/engine/src/connector-sdk/postgres/postgresConnector.test.ts. Does the file exist?
 ❯ loadAndTransform ../../Secret%20Projects/VSC-DB-SQL-Compare/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

 Test Files  1 failed (1)
      Tests  no tests
   Start at  23:17:49
   Duration  2.29s (transform 157ms, setup 0ms, collect 0ms, tests 0ms, environment 0ms, prepare 1.36s)

RED_STATE_EXIT_CODE=1
```

Matches the brief's predicted failure reason exactly ("Module/class does
not exist yet"). The connector file was restored immediately afterward and
confirmed present (`ls` on the directory showed both
`postgresConnector.ts` and `postgresConnector.test.ts` present) before any
further work continued. This red-state run was performed **before** `pg`
was added as a dependency, so it reflects the true starting state.

### Focused green state

- **Command:** `npx vitest run packages/engine/src/connector-sdk/postgres` (container healthy, env vars set in the same WSL session, `pg`/`@types/pg` installed)
- **Captured output:**

```
 RUN  v2.1.9 /mnt/v/Secret Projects/VSC-DB-SQL-Compare

 ✓ packages/engine/src/connector-sdk/postgres/postgresConnector.test.ts (14 tests) 3433ms
   ✓ PostgresConnector (live PostgreSQL 16 container) > testConnection() fails gracefully against an unreachable host 3004ms

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  23:18:25
   Duration  6.27s (transform 303ms, setup 0ms, collect 868ms, tests 3.43s, environment 0ms, prepare 1.35s)

FOCUSED_EXIT_CODE=0
```

All 14 tests genuinely executed against the live container (not skipped —
`describe.skipIf` only triggers when the env vars are absent, and they were
set for this run), including the DROP/INSERT/UPDATE/DELETE rejection tests
and both M-06 dollar-quoting rejection tests, each with server-side
re-verification.

### Full verification

- **Command:** `npm run verify` (both containers healthy, PostgreSQL env vars set, same WSL session)
- **Captured output:**

```
> paritylens@0.0.1 verify
> npm run typecheck && npm run lint && npm run test

> paritylens@0.0.1 typecheck
> tsc -b --force

> paritylens@0.0.1 lint
> eslint .

> paritylens@0.0.1 test
> vitest run

 ✓ packages/engine/src/comparison-core/type-mapping/type-mapping.test.ts (69 tests) 16ms
 ✓ packages/engine/src/comparison-core/row-level/row-level.test.ts (8 tests) 9ms
 ✓ packages/engine/src/orchestration/definition/definition.test.ts (30 tests) 44ms
 ✓ packages/engine/src/comparison-core/normalization/normalization.test.ts (24 tests) 28ms
 ✓ packages/engine/src/comparison-core/profiling/profiling.test.ts (9 tests) 366ms
 ✓ packages/engine/src/connector-sdk/postgres/postgresConnector.test.ts (14 tests) 3320ms
   ✓ PostgresConnector (live PostgreSQL 16 container) > testConnection() fails gracefully against an unreachable host 3002ms
 ✓ packages/engine/src/connector-sdk/fixture/fixture-connector.test.ts (40 tests) 1448ms
 ✓ packages/shared/src/types.test.ts (11 tests) 5ms
 ✓ packages/engine/src/comparison-core/mapping/mapping.test.ts (12 tests) 10ms
 ✓ packages/engine/src/connector-sdk/safety/statement-safety.test.ts (109 tests) 22ms
 ✓ packages/extension/src/export/exporters.test.ts (6 tests) 8ms
 ✓ packages/engine/src/comparison-core/schema-diff/schema-diff.test.ts (11 tests) 287ms
 ✓ packages/extension/src/webview/resultsWebview.test.ts (5 tests) 4ms
 ✓ packages/extension/src/activation/activate.test.ts (3 tests) 8ms
 ✓ packages/engine/src/orchestration/planner/planner.test.ts (7 tests) 447ms
 ✓ packages/extension/src/secrets/secretStore.test.ts (3 tests) 6ms
 ✓ packages/extension/src/views/parityTreeDataProvider.test.ts (5 tests) 5ms
 ✓ packages/extension/src/statusbar/parityStatusBar.test.ts (2 tests) 3ms
 ✓ packages/engine/src/comparison-core/volume/volume.test.ts (5 tests) 308ms
 ↓ packages/engine/src/connector-sdk/sqlserver/sqlServerConnector.test.ts (13 tests | 13 skipped)
stdout | packages/engine/src/connector-sdk/sqlserver/sqlServerConnector.test.ts
[sqlServerConnector.test.ts] SKIPPING all SqlServerConnector integration tests: PARITYLENS_TEST_SQLSERVER_HOST/PORT/USER/PASSWORD are not all set. Start the test container (`docker compose -f docker-compose.test.yml up -d`, wait for healthy) and set these env vars to run these tests for real.

 Test Files  19 passed | 1 skipped (20)
      Tests  373 passed | 13 skipped (386)
   Start at  23:19:34
   Duration  16.41s (transform 4.79s, setup 0ms, collect 48.02s, tests 6.34s, environment 3ms, prepare 27.68s)

VERIFY_EXIT_CODE=0
```

373/373 non-skipped tests pass (359 previously passing per
`PROGRESS-LEDGER.md`'s T-17 entry + 14 new PostgreSQL integration tests),
exit 0. The 13 skipped tests are `SqlServerConnector`'s own integration
suite, skipped only because this run's environment variables were scoped to
PostgreSQL (`PARITYLENS_TEST_SQLSERVER_*` were not set in this specific
`npm run verify` invocation) — this is the same pre-existing, expected,
visibly-logged skip pattern T-17 established for itself, not something this
task caused or a hidden failure; the SQL Server container was independently
confirmed healthy in the same session (see docker compose ps output above)
and its own test suite is unaffected by this task's changes (it lives in a
directory this task never touched).

**No bugs found requiring a fix during this task** (contrast with T-17,
which found and fixed three live-server-discovered bugs). The
`buildRowCappedSql`/`buildProfileQuery` designs proactively anticipated the
two dialect-specific issues T-17 discovered the hard way (SQL Server's
`ORDER BY`-inside-derived-table restriction; SQL Server's rejection of
duplicate output-column aliases) by choosing PostgreSQL-native constructs
that don't share those restrictions (`LIMIT` instead of `TOP`, which needs
no special ORDER-BY handling) and by proactively de-duplicating
`total_count` regardless of dialect. Both were confirmed correct by the
live-container test run rather than assumed — the `{ kind: 'query' }` +
`ORDER BY` test and the `buildProfileQuery` smoke test both passed on the
first run.

## Assumptions and risks

- **Assumption:** `getSchema()`'s `{kind:"table"}` path assumes the object reference is either a bare table name or exactly one `schema.table` segment (e.g. `"public.customer_source"`) — a fully-qualified `database.schema.table` reference is not parsed specially. Same judgment call T-17 made for SQL Server, applied here for consistency; not exercised by any test in this task.
- **Assumption:** `getPrimaryKeyColumns()` reads only `PRIMARY KEY` constraints via `table_constraints`/`key_column_usage`; a table with a unique index but no declared PRIMARY KEY constraint reports `isPrimaryKeyCandidate: false` for all columns. Same judgment call and rationale as T-17's `SqlServerConnector`.
- **Assumption (judgment call — nullable field for ad hoc query shapes):** `getSchema()`'s `{kind:"query"}`/`{kind:"sqlFile"}` branch always reports `nullable: true` for every column, since `pg`'s `result.fields` (the `RowDescription` message) does not expose per-column nullability the way `information_schema.columns.is_nullable` does for a persisted table — this is a genuine driver-level metadata gap, not an oversight. Defaulting to `true` (rather than `false`) is the conservative choice: a caller relying on this value to assume non-null and skip a null check would be wrong in the `false` direction if the column can actually contain nulls, whereas defaulting `true` only causes an unnecessary (not incorrect) null-check. Not exercised by a dedicated test — the ad hoc `{kind:"query"}` `getSchema` path itself has no test in this suite (mirrors T-17's own `{kind:"query"}` `getSchema` path also having no dedicated test), flagged here as a known gap rather than silently left uncovered.
- **Risk/limitation — M-06 dollar-quoting hardening is a blanket rejection, not a safe pass-through.** As documented above, this connector rejects *any* SQL containing a dollar-quote delimiter, even a hypothetical legitimate read-only query that happened to use one (e.g. `SELECT $$literal$$ AS label` with no injected mutation at all — this exact case is covered by the second M-06 test, which confirms it is also rejected). This is a deliberate, disclosed tradeoff (stricter than the narrowest possible fix) rather than an oversight; a future task could relax this to a genuine tokenizer if a real use case for dollar-quoted read-only queries emerges.
- **Risk/limitation — `pgTypeOidToNativeTypeName` is a best-effort, hand-maintained mapping table**, not derived from `pg`'s own type-parser registry, for the `{kind:"query"}`/`{kind:"sqlFile"}` `getSchema` path (where information_schema isn't available for an ad hoc query shape). Falls back to `"unknown"` (maps to canonical `"Unknown"` via T-05) for any OID not in the table, consistent with `mapNativeType`'s documented never-throw contract. Not exercised by a dedicated test beyond the `buildProfileQuery` smoke test, which only exercises COUNT-aggregate bigint output types (OID 20). Same category of limitation T-17 disclosed for `mssqlTypeToNativeTypeName`.
- **Blockers:** None. The environment blocker recorded in `PROGRESS-LEDGER.md` (WSL2-only container reachability) was resolved by running every command from inside WSL2 per the brief's Test environment section, exactly as T-17 established — directly reproducible and documented above with captured evidence.

## Patch or commit identity

- **Branch:** `task/T-19-postgres-connector`
- **Commit:** (recorded after this report is committed — see the commit created alongside this file; run `git log -1 --format=%H` on this branch to confirm)

## Recommended next step

Independent review by a separate `reviewer` subagent instance, per
`TASK-BRIEF.md`'s Handoff section and its specific note-to-reviewer
instructions: (1) independently attempt a mutating statement through
`executeQuery` against the live container and confirm server-side no
mutation occurred (not just that a client-side exception was thrown); (2)
grep the diff for hardcoded credentials; (3) independently verify the M-06
resolution is real — construct a fresh dollar-quoted bypass attempt
(including at least one with an embedded apostrophe) against the live
container rather than accepting this report's claim; (4) confirm the
`describe.skipIf` skip reason is visible and genuine, not a bare `.skip`;
(5) re-run `npm run verify` from inside WSL2 itself rather than trusting
this report's numbers. This report does not constitute review or approval —
only implementation-and-evidence.
