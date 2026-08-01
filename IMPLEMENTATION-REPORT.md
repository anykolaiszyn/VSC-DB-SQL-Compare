# ParityLens — Implementation Report T-17

## Status and objective

- **Status:** COMPLETE (implementation and evidence only — not reviewed or approved)
- **Objective:** Per `TASK-BRIEF.md`'s Objective section, quoted verbatim:
  "Implement `SqlServerConnector`, a `DataPlatformConnector` implementation
  (`@paritylens/shared`) backed by the `mssql` package (Tedious driver),
  targeting the local SQL Server 2022 test container already running via
  `docker-compose.test.yml` at the repo root. Every method of the interface
  must be implemented against a real SQL Server instance — this is the
  project's first connector talking to an actual database server rather
  than DuckDB." All nine `DataPlatformConnector` methods are implemented
  and exercised against a live SQL Server 2022 container (not stubbed or
  mocked).

## Environment note (critical for reproducing this report)

Per `TASK-BRIEF.md`'s Test environment section, this machine's Docker
container is only reachable from inside WSL2 — not from Windows/PowerShell
— and the WSL2 VM (and everything running in it, including the container)
tears down between separate `wsl.exe` invocations from Windows. All
implementation, red-state, green-state, and full-verification commands
below were run from inside WSL2 (confirmed via `uname -a` reporting a
`microsoft-standard-WSL2` kernel), with Node v24.9.0 activated via `nvm`
(`~/.nvm`), against the repo at `/mnt/v/Secret Projects/VSC-DB-SQL-Compare`.
Every command that needed the container brought the container up
(`docker compose -f docker-compose.test.yml up -d`, polled until
`(healthy)`) in the **same** `wsl.exe` invocation as the test run itself,
per the brief's explicit warning that containers do not survive between
separate invocations — this was directly confirmed during this task: a
`docker compose ps` run in a later, separate `wsl.exe` call showed an
empty container list even though the container had been healthy moments
earlier in a prior call.

**Environment variable names chosen** (per the brief's "choose exact names
and document them" instruction):

```
PARITYLENS_TEST_SQLSERVER_HOST=localhost
PARITYLENS_TEST_SQLSERVER_PORT=14330
PARITYLENS_TEST_SQLSERVER_USER=sa
PARITYLENS_TEST_SQLSERVER_PASSWORD=ParityLens_Test1!
PARITYLENS_TEST_SQLSERVER_DATABASE=master   (optional, defaults to "master")
```

These are read only inside `sqlServerConnector.test.ts` (test source), via
`readTestServerEnv()`. `sqlServerConnector.ts` itself never reads
environment variables or hardcodes any credential — it is constructed from
an explicit `SqlServerConnectionOptions` object supplied by the caller.

**Unrelated pre-existing repo state, left untouched:** `git status` from
inside WSL shows nearly every tracked file as "modified" relative to the
Windows-side checkout. Investigated and confirmed to be a pure CRLF/LF
line-ending artifact of viewing the same working tree from WSL with no
`core.autocrlf` configured in that context, not real content drift —
`git diff --ignore-all-space --stat` across the whole repo shows zero
differences for every one of those files. This report's commit stages
only the files this task actually owns/mechanically needed
(`packages/engine/src/connector-sdk/sqlserver/**`,
`packages/engine/package.json`, `package-lock.json`), leaving all of that
unrelated pre-existing noise untouched in the working tree, per the "do
not disturb unrelated uncommitted work" rule.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/engine/src/connector-sdk/sqlserver/sqlServerConnector.ts` (new) | `SqlServerConnector` class implementing all 9 `DataPlatformConnector` methods against the `mssql` package (Tedious driver): `testConnection`, `getCatalogs` (`sys.databases`), `getSchemas` (`INFORMATION_SCHEMA.SCHEMATA`), `getObjects` (`INFORMATION_SCHEMA.TABLES`), `getSchema` (`INFORMATION_SCHEMA.COLUMNS` + `TABLE_CONSTRAINTS`/`KEY_COLUMN_USAGE` for real primary-key metadata, for `{kind:"table"}`; driver-reported recordset column metadata for `{kind:"query"}`/`{kind:"sqlFile"}`), `executeQuery` (streams a single `RecordBatch` capped via a `SELECT TOP (n) * FROM (...)` wrapper), `getCapabilities`, `quoteIdentifier` (`[...]` bracket quoting with `]]` escaping), `buildProfileQuery`. Constructed from an explicit `SqlServerConnectionOptions` object (host/port/user/password/database), never a bare connection string. `assertReadOnlyStatement(sql, "sqlserver")` (T-03) called on every SQL string before it reaches the driver, on every method that executes SQL — both caller-supplied and connector-generated, matching `FixtureConnector`'s pattern. `mapNativeType(nativeType, "sqlserver")` (T-05) used for every column's `canonicalType`. M-05 (`GO` batch separator) resolved via a connector-level `rejectGoBatchSeparator()` check that runs before `assertReadOnlyStatement` — see "M-05 resolution" section below. | Brief's Objective and Interfaces table (Produced row: `SqlServerConnector` class). |
| `packages/engine/src/connector-sdk/sqlserver/sqlServerConnector.test.ts` (new) | Integration test suite (13 tests) run against the live container, wrapped in `describe.skipIf(!hasTestServerEnv)` with a visible `console.log` skip reason when `PARITYLENS_TEST_SQLSERVER_HOST/PORT/USER/PASSWORD` are unset. `beforeAll`/`afterAll` seed and tear down a real table (`dbo.t17_parity_lens_customer`, with `MONEY` and `DECIMAL(5,2)` columns) via the driver directly (not through `executeQuery`, since `CREATE TABLE`/`INSERT`/`DROP TABLE` are themselves mutating and must not go through the read-only-enforced path this task tests). Covers: live `testConnection` success; graceful (non-throwing) failure against a bad password and an unreachable host; `getSchema` MONEY→Decimal and DECIMAL(5,2)→Decimal/precision/scale mapping (T-05); `executeQuery` row-capping via `maxRows`; `{kind:"query"}` execution; DROP/INSERT/UPDATE/DELETE rejection via `assertReadOnlyStatement`, each followed by a server-side re-query proving the table/rows were genuinely unaffected (not just a client-side throw); GO batch-separator rejection (M-05), also followed by server-side re-verification; `getCatalogs`/`getSchemas`/`getObjects` against real server metadata; `buildProfileQuery`; `quoteIdentifier`; `getCapabilities`. | Brief's Red-state evidence section (3 named cases) and Green-state section; `IMPLEMENTATION-PLAN.md`'s T-17 review-gate column ("confirms no test skip hides a real failure"). |
| `packages/engine/package.json` | Added `mssql: ^12.7.0` to `dependencies` and `@types/mssql: ^12.3.0` to `devDependencies`. | Brief explicitly authorizes `mssql` as a new runtime dependency ("this is expected and in scope, not a deviation to flag"); `@types/mssql` is disclosed here per the brief's "do not add any other new runtime dependency without disclosing it" instruction — it is a types-only devDependency (no runtime code shipped), added because `mssql@12.7.0` does not bundle its own `.d.ts` files, following the same mechanical-necessity precedent set by T-04 (which touched `packages/engine/tsconfig.json` outside its literal file list when strictly required for its owned files to build). |
| `package-lock.json` | Updated by `npm install` to record the two new dependencies and their transitive tree. | Mechanical consequence of the above, same as every prior task that added a dependency. |

**Files explicitly NOT touched**, confirming Prohibited Changes compliance: `packages/engine/src/connector-sdk/safety/**`, `packages/engine/src/comparison-core/type-mapping/**`, `packages/engine/src/connector-sdk/fixture/**`, `packages/shared/src/connector.ts`, `docker-compose.test.yml`.

## Behavior and interfaces

- **Behavior delivered:** A working `SqlServerConnector` validated end-to-end against a real, running SQL Server 2022 Docker container — not a mock or stub. `testConnection()` succeeds against the live container and fails gracefully (`{success:false, message}`, never throws) against both a wrong password and an unreachable host. `getSchema()` against a real table returns correct `ColumnDefinition[]` including a `MONEY` column mapped to canonical `Decimal` and a `DECIMAL(5,2)` column mapped to `Decimal` with `precision:5, scale:2`, exercising T-05's mapping for real. `executeQuery()` streams a `RecordBatch` honoring `options.maxRows` (verified: 3 seeded rows capped to 2). A `DROP TABLE` (and separately INSERT/UPDATE/DELETE) attempted through `executeQuery` is rejected by `assertReadOnlyStatement` before reaching the driver, with server-side re-verification proving no mutation occurred.
- **Interfaces consumed:** `DataPlatformConnector` (`packages/shared/src/connector.ts`, unmodified, all 9 methods implemented); `assertReadOnlyStatement(sql, "sqlserver")` (`packages/engine/src/connector-sdk/safety/statement-safety.ts`, unmodified, imported); `mapNativeType(nativeType, "sqlserver")` (`packages/engine/src/comparison-core/type-mapping/type-mapping.ts`, unmodified, imported).
- **Interfaces produced:** `SqlServerConnector` class and `SqlServerConnectionOptions` interface, both exported from `packages/engine/src/connector-sdk/sqlserver/sqlServerConnector.ts`.

## M-05 resolution (carried-forward finding)

Resolved via option (a) from the brief: connector-level hardening. A new
`rejectGoBatchSeparator(sqlText)` function runs inside `executeQuery`
*before* `assertReadOnlyStatement` is called, using the regex
`/^[ \t]*GO[ \t]*(?:\d+[ \t]*)?$/im` to detect a line whose only
non-whitespace content is the `GO` token (optionally with a repeat count,
e.g. `GO 5`) — matching sqlcmd/SSMS's own recognition rule that `GO` must
be alone on its line to be treated as a batch separator. If found, it
throws before either the safety parser or the `mssql` driver ever sees the
SQL string.

This was **not** left as "unreachable through this connector" without
verification — the claim was tested directly: a dedicated integration test
(`"executeQuery rejects a GO batch separator (M-05 connector-level
hardening)"`) sends `SELECT 1 AS ok\nGO\nDROP TABLE
dbo.t17_parity_lens_customer` through the live connector and asserts (a)
the call rejects with a message matching `/GO.*batch separator/i`, and (b)
a follow-up `getSchema` call proves the table still has all 4 columns
(i.e. the DROP genuinely never reached SQL Server). This test passed
against the live container (see Verification evidence below).

## Verification evidence

All commands below were run from inside WSL2, per the Test environment
constraint. `MSYS2_ARG_CONV_EXCL="*" wsl.exe -e bash <script>` was the
invocation mechanism from this session's own shell (Git-Bash on Windows,
confirmed via `uname -a` reporting `MINGW64_NT`/`Msys`, not WSL) — the
`MSYS2_ARG_CONV_EXCL` env var was needed to stop Git-Bash from mangling
the WSL-side script path before handing it to `wsl.exe`.

### Docker container reaching healthy (same WSL session as the test run)

```
$ docker compose -f docker-compose.test.yml up -d
 Container vsc-db-sql-compare-postgres-test-1 Starting
 Container vsc-db-sql-compare-sqlserver-test-1 Starting
 Container vsc-db-sql-compare-sqlserver-test-1 Started
 Container vsc-db-sql-compare-postgres-test-1 Started

$ docker compose -f docker-compose.test.yml ps
NAME                                  IMAGE                                        COMMAND                  SERVICE          CREATED       STATUS                    PORTS
vsc-db-sql-compare-postgres-test-1    postgres:16-alpine                           "docker-entrypoint.s…"   postgres-test    2 hours ago   Up 10 seconds (healthy)   0.0.0.0:54320->5432/tcp, [::]:54320->5432/tcp
vsc-db-sql-compare-sqlserver-test-1   mcr.microsoft.com/mssql/server:2022-latest   "/opt/mssql/bin/laun…"   sqlserver-test   2 hours ago   Up 10 seconds (healthy)   0.0.0.0:14330->1433/tcp, [::]:14330->1433/tcp
CONTAINER_HEALTHY
```

(Confirmed multiple times across this session as separate `wsl.exe`
invocations tore down and were re-brought-up, per the brief's warning —
each subsequent `docker compose ps` in a fresh invocation showed an empty
container list until `up -d` was re-run in that same invocation.)

### Red state

- **Command:** `npx vitest run packages/engine/src/connector-sdk/sqlserver` (run with `sqlServerConnector.ts` temporarily moved aside to `/tmp`, simulating "connector doesn't exist yet")
- **Expected failure reason (per brief):** Module/class does not exist yet.
- **Actual captured output:**

```
 FAIL  packages/engine/src/connector-sdk/sqlserver/sqlServerConnector.test.ts [ packages/engine/src/connector-sdk/sqlserver/sqlServerConnector.test.ts ]
Error: Failed to load url ./sqlServerConnector.js (resolved id: ./sqlServerConnector.js) in /mnt/v/Secret Projects/VSC-DB-SQL-Compare/packages/engine/src/connector-sdk/sqlserver/sqlServerConnector.test.ts. Does the file exist?
 ❯ loadAndTransform ../../Secret%20Projects/VSC-DB-SQL-Compare/node_modules/vite/dist/node/chunks/dep-BK...
 Test Files  1 failed (1)
      Tests  no tests
   Start at  22:45:07
   Duration  2.32s
RED_STATE_EXIT_CODE=1
```

Matches the brief's predicted failure reason exactly. The connector file
was restored immediately afterward and confirmed present (`ls` on the
directory showed both `sqlServerConnector.ts` and
`sqlServerConnector.test.ts` present, correct sizes) before any further
work continued.

### Focused green state

- **Command:** `npx vitest run packages/engine/src/connector-sdk/sqlserver` (container healthy, env vars set in the same WSL session)
- **Captured output:**

```
 ✓ packages/engine/src/connector-sdk/sqlserver/sqlServerConnector.test.ts (13 tests) 4153ms
   ✓ SqlServerConnector (live SQL Server 2022 container) > testConnection() fails gracefully against an unreachable host 3001ms
   ✓ SqlServerConnector (live SQL Server 2022 container) > getSchema returns correct ColumnDefinition[] for a real table, including MONEY and DECIMAL mapping (T-05) 452ms

 Test Files  1 passed (1)
      Tests  13 passed (13)
   Start at  22:38:43
   Duration  15.33s (transform 296ms, setup 0ms, collect 9.10s, tests 4.15s, environment 0ms, prepare 1.36s)

FOCUSED_EXIT_CODE=0
```

All 13 tests genuinely executed against the live container (not skipped —
`describe.skipIf` only triggers when the env vars are absent, and they
were set for this run), including the DROP/INSERT/UPDATE/DELETE/GO
rejection tests with server-side re-verification.

### Full verification

- **Command:** `npm run verify` (container healthy, env vars set, same WSL session)
- **Captured output (final run, after two fix iterations described below):**

```
> paritylens@0.0.1 verify
> npm run typecheck && npm run lint && npm run test

> paritylens@0.0.1 typecheck
> tsc -b --force

> paritylens@0.0.1 lint
> eslint .

> paritylens@0.0.1 test
> vitest run

 ✓ packages/engine/src/comparison-core/type-mapping/type-mapping.test.ts (69 tests) 13ms
 ✓ packages/engine/src/comparison-core/row-level/row-level.test.ts (8 tests) 10ms
 ✓ packages/engine/src/comparison-core/normalization/normalization.test.ts (24 tests) 23ms
 ✓ packages/engine/src/orchestration/definition/definition.test.ts (30 tests) 44ms
 ✓ packages/shared/src/types.test.ts (11 tests) 6ms
 ✓ packages/engine/src/comparison-core/profiling/profiling.test.ts (9 tests) 351ms
 ✓ packages/engine/src/connector-sdk/fixture/fixture-connector.test.ts (40 tests) 1457ms
 ✓ packages/engine/src/comparison-core/mapping/mapping.test.ts (12 tests) 9ms
 ✓ packages/engine/src/connector-sdk/safety/statement-safety.test.ts (109 tests) 24ms
 ✓ packages/engine/src/comparison-core/schema-diff/schema-diff.test.ts (11 tests) 312ms
 ✓ packages/extension/src/export/exporters.test.ts (6 tests) 8ms
 ✓ packages/extension/src/webview/resultsWebview.test.ts (5 tests) 8ms
 ✓ packages/extension/src/activation/activate.test.ts (3 tests) 6ms
 ✓ packages/extension/src/views/parityTreeDataProvider.test.ts (5 tests) 10ms
 ✓ packages/engine/src/orchestration/planner/planner.test.ts (7 tests) 775ms
 ✓ packages/extension/src/secrets/secretStore.test.ts (3 tests) 12ms
 ✓ packages/engine/src/comparison-core/volume/volume.test.ts (5 tests) 217ms
 ✓ packages/extension/src/statusbar/parityStatusBar.test.ts (2 tests) 5ms
 ✓ packages/engine/src/connector-sdk/sqlserver/sqlServerConnector.test.ts (13 tests) 4082ms

 Test Files  19 passed (19)
      Tests  372 passed (372)
   Start at  22:46:04
   Duration  21.07s (transform 4.78s, setup 0ms, collect 49.78s, tests 7.37s, environment 4ms, prepare 28.38s)

VERIFY_EXIT_CODE=0
```

372/372 tests (359 previously passing per `PROGRESS-LEDGER.md`'s T-16
entry + 13 new SQL Server integration tests), no regressions, exit 0.

**Real bugs found and fixed during this task, via genuine live-server
testing (not caught by typecheck/lint/mocked tests):**

1. `getCatalogs()`'s original `WHERE database_id > 4` filter excluded the
   `master` system database — but this task's own default test database
   *is* `master`, so the live test asserting `catalogs.length >
   0` failed with `expected 0 to be greater than 0`. Fixed by listing all
   databases visible to the connected login (system databases included);
   this is read-only catalog metadata, not a security boundary decision,
   so the filter was unnecessary.
2. `executeQuery`'s original row-capping wrapper (`SELECT TOP n * FROM
   (<sql>) AS x`) failed against the live server with `RequestError: The
   ORDER BY clause is invalid in ... derived tables ... unless TOP, OFFSET
   or FOR XML is also specified` when the caller's own `{kind:"query"}`
   SQL ended in an `ORDER BY` (an entirely ordinary query shape — this
   task's own `"executeQuery works for a { kind: 'query' } SELECT input"`
   test uses `ORDER BY CustomerId`). Fixed with `buildRowCappedSql()`,
   which detects a trailing top-level `ORDER BY` via a lexical heuristic
   and injects `TOP 100 PERCENT` after the inner query's own `SELECT` to
   satisfy SQL Server's grammar requirement, without changing row
   selection or order.
3. `buildProfileQuery()`'s original aggregate query emitted `COUNT(*) AS
   total_count` once per column (copying `FixtureConnector`'s exact query
   shape), which DuckDB tolerates as duplicate output-column names but SQL
   Server rejects with `RequestError: The column 'total_count' was
   specified multiple times`. Fixed by emitting `total_count` exactly once
   at the start of the aggregate list.

All three were caught specifically because this task's tests run against
a genuine live server rather than a mock, and specifically because the
tests exercise realistic query shapes (an `ORDER BY`, more than one
profiled column, a connection scoped to a system database) rather than
only the minimal happy path.

## Assumptions and risks

- **Assumption:** `getSchema()`'s `{kind:"table"}` path assumes the object
  reference is either a bare table name or exactly one `schema.table`
  segment (e.g. `"dbo.customer_source"`) — three- or four-part names
  (`database.schema.table`, `server.database.schema.table`) are not
  parsed specially and would be treated as an unrecognized bare name with
  everything before the last `.` as "schema". Not exercised by any test in
  this task; flagged as a judgment call rather than silently handled, in
  case a caller ever needs fully-qualified cross-database references.
- **Assumption:** `getPrimaryKeyColumns()` reads only single-column and
  composite `PRIMARY KEY` constraints via `TABLE_CONSTRAINTS`/
  `KEY_COLUMN_USAGE`; a table with a unique index but no declared PRIMARY
  KEY constraint will report `isPrimaryKeyCandidate: false` for all
  columns, unlike `FixtureConnector`'s name-heuristic fallback (`/id$/i`
  on the first column). This is more accurate for a real server (which
  actually has this metadata) but means a keyless table can't fall back to
  a heuristic. Not flagged as a defect — this is the more correct behavior
  for a real connector, just different from the fixture connector's
  necessarily-heuristic approach.
- **Risk/limitation — `buildRowCappedSql`'s ORDER BY detection is a
  lexical heuristic, not a parser:** it detects a trailing `ORDER BY` via
  a regex that excludes matches followed by another `FROM (` (to avoid
  misfiring on an `ORDER BY` that's actually inside a nested subquery
  earlier in the caller's SQL). This is not a full SQL grammar and could
  in principle miss an `ORDER BY` in an unusual caller-supplied query
  shape (e.g. one hidden inside a CTE body that itself ends the whole
  statement). A false negative here does not cause incorrect results or a
  safety gap — it just means SQL Server's own grammar error would surface
  to the caller again, exactly as it did before this fix was made, rather
  than being silently worked around. Not exercised beyond the single
  top-level trailing-`ORDER BY` shape this task's own test covers.
- **Risk/limitation — `mssqlTypeToNativeTypeName` is a best-effort,
  hand-maintained mapping table**, not derived from the `mssql` package's
  own type registry, for the `{kind:"query"}`/`{kind:"sqlFile"}`
  `getSchema` path (where INFORMATION_SCHEMA isn't available for an ad hoc
  query shape). Falls back to `"sql_variant"` (maps to canonical
  `"Unknown"` via T-05) for any constructor not in the table, consistent
  with `mapNativeType`'s documented never-throw contract, but this means
  an exotic type used only in a raw query (not a persisted table) could be
  reported as `Unknown` even though SQL Server itself knows its real type.
  Not exercised by a dedicated test beyond the `buildProfileQuery`
  smoke test, which only exercises COUNT-aggregate integer/bigint output
  types.
- **Risk/limitation — GO-separator hardening is a lexical line-anchor
  check, not a full sqlcmd-compatible batch parser.** It correctly rejects
  the brief's own worked example (`SELECT 1\nGO\nDROP TABLE x`) and any
  `GO` appearing alone on its own line (with or without a repeat count),
  matching sqlcmd/SSMS's actual recognition rule. It does not attempt to
  handle every edge case a full sqlcmd scripting-variable/batch processor
  would (e.g. `GO` inside a string literal is not stripped first the way
  `assertReadOnlyStatement`'s own scanner strips literals before keyword
  matching) — though a `GO` inside a properly quoted SQL string literal
  would not match the "alone on its own line" pattern in the first place
  for any realistic literal content, this was not adversarially probed
  with a dedicated test beyond the brief's own worked example.
- **Blockers:** None. The environment blocker recorded in
  `PROGRESS-LEDGER.md` (WSL2-only container reachability) was resolved by
  running every command from inside WSL2 per the brief's Test environment
  section — this was directly reproducible and is documented above with
  captured evidence.

## Patch or commit identity

- **Branch:** `task/T-17-sqlserver-connector`
- **Commit:** `62fed961bbe46ccc10815d1c4f2fd550176c8b75`

## Recommended next step

Independent review by a separate `reviewer` subagent instance, per
`TASK-BRIEF.md`'s Handoff section and its specific note-to-reviewer
instructions: (1) independently attempt a mutating statement through
`executeQuery` against the live container and confirm server-side no
mutation occurred (not just that a client-side exception was thrown); (2)
grep the diff for hardcoded credentials; (3) independently verify the M-05
resolution is real (re-run the GO-separator test, or construct a fresh
variant); (4) confirm the `describe.skipIf` skip reason is visible and
genuine, not a bare `.skip`; (5) re-run `npm run verify` from inside WSL2
itself rather than trusting this report's numbers. This report does not
constitute review or approval — only implementation-and-evidence.
