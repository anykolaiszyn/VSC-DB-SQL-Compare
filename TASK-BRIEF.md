# ParityLens — Task Brief T-17

## Objective

Implement `SqlServerConnector`, a `DataPlatformConnector` implementation
(`@paritylens/shared`) backed by the `mssql` package (Tedious driver),
targeting the local SQL Server 2022 test container already running via
`docker-compose.test.yml` at the repo root. Every method of the interface
must be implemented against a real SQL Server instance — this is the
project's first connector talking to an actual database server rather than
DuckDB.

Note to whoever dispatches an implementer against this brief: quote this
document's load-bearing requirements verbatim rather than paraphrasing
them. A paraphrase that loosens a requirement is a known failure mode from
this project's history (T-07's I-02 finding traced back to exactly this).

## Test environment (read this before starting)

- `docker-compose.test.yml` (repo root) defines a `sqlserver-test` service:
  SQL Server 2022, exposed on **port 14330** (not the default 1433),
  user `sa`, password `ParityLens_Test1!`, `MSSQL_PID=Developer`. Start it
  with `docker compose -f docker-compose.test.yml up -d` and wait for
  `docker compose -f docker-compose.test.yml ps` to report `(healthy)`.
- **Environment-specific constraint, confirmed by direct investigation
  (see `PROGRESS-LEDGER.md`'s 2026-07-31 blocker-resolution entry):** on
  this machine, Docker runs inside WSL2 (native Docker Engine, not Docker
  Desktop), and WSL2 does **not** forward these container ports back to
  Windows — not via `localhost`, not via WSL's mirrored LAN IP. The
  container is only reachable from **inside WSL**. Node v24.9.0 (matching
  `CLAUDE.md`'s documented version) is installed inside WSL via `nvm`
  (`~/.nvm`), and `npm install`/`npm run verify` both already run
  successfully there against this same repo via `/mnt/v/...` (confirmed:
  359/359 tests passing, matching the Windows-side baseline). **Run this
  task's implementation and test commands from inside WSL**, not from the
  Windows-side shell, and bring the container up within the same
  continuous WSL session as the test run — the WSL2 VM (and everything
  running in it) tears down when idle between separate `wsl.exe`
  invocations from Windows, so do not assume a container started earlier
  is still running in a later, separate invocation.
- Connection details must be read from environment variables at test-run
  time (e.g. `PARITYLENS_TEST_SQLSERVER_HOST=localhost`,
  `PARITYLENS_TEST_SQLSERVER_PORT=14330`,
  `PARITYLENS_TEST_SQLSERVER_USER=sa`,
  `PARITYLENS_TEST_SQLSERVER_PASSWORD=...` — choose exact names and
  document them in `IMPLEMENTATION-REPORT.md`), never hardcoded into test
  source, per `AGENTS.md`'s no-inline-credentials rule. The
  `docker-compose.test.yml` password is a disposable local-only test
  value, not a production secret, but the code must still read it from
  the environment as a matter of consistent practice, not because this
  specific value is sensitive.
- If the container is genuinely unavailable when a test runs (env vars
  unset, connection refused), the test **must be skipped explicitly and
  documented as such** — e.g. `describe.skipIf(!hasTestServerEnv())` with
  a visible log line — never silently pass or silently disappear. Per
  `IMPLEMENTATION-PLAN.md`'s T-17 review-gate column: "confirms no test
  skip hides a real failure."

## Dependencies

- **Required completed tasks:** T-03 (statement-safety parser — the
  `"sqlserver"` dialect already exists in
  `packages/engine/src/connector-sdk/safety/statement-safety.ts`), T-05
  (canonical type-mapping layer — `mapNativeType(nativeType, "sqlserver")`
  already handles SQL Server type strings including `MONEY`/`SMALLMONEY`).
  Both COMPLETE and APPROVED.
- **Required decisions or approvals:** NONE beyond the already-approved
  `IMPLEMENTATION-PLAN.md` T-17 row and the environment-blocker resolution
  recorded in `PROGRESS-LEDGER.md`.

## Files owned

- `packages/engine/src/connector-sdk/sqlserver/**` (new directory)

You will need to add `mssql` as a new runtime dependency of
`packages/engine` (not yet installed) — this is expected and in scope, not
a deviation to flag. Do not add any other new runtime dependency without
disclosing it explicitly in `IMPLEMENTATION-REPORT.md`.

Do not touch `packages/engine/src/connector-sdk/safety/**` (T-03's owned
file — consume `assertReadOnlyStatement`/`SqlDialect` read-only via
`import`), `packages/engine/src/comparison-core/type-mapping/**` (T-05's
owned file — consume `mapNativeType` read-only via `import`), or
`packages/engine/src/connector-sdk/fixture/**` (T-04's owned file — read
it for reference/pattern only, per the Interfaces table below, but do not
edit it or import from it).

## Interfaces

| Direction | Interface | Contract | Producer or consumer |
| --- | --- | --- | --- |
| Consumed | `DataPlatformConnector` (`packages/shared/src/connector.ts`) | Existing, complete interface. `SqlServerConnector` implements every method: `testConnection`, `getCatalogs`, `getSchemas`, `getObjects`, `getSchema`, `executeQuery`, `getCapabilities`, `quoteIdentifier`, `buildProfileQuery`. | T-02 (producer) |
| Consumed | `assertReadOnlyStatement(sql: string, dialect: SqlDialect): void` (`packages/engine/src/connector-sdk/safety/statement-safety.ts`) | Existing, complete, reviewed with 72 adversarial probes. Call with `dialect: "sqlserver"` on every SQL string before it reaches the `mssql` driver — both user-supplied `{ kind: "query" }`/`{ kind: "sqlFile" }` input and any SQL this connector generates itself (e.g. a `SELECT * FROM <table>` for `{ kind: "table" }` input), matching `FixtureConnector`'s existing pattern in `packages/engine/src/connector-sdk/fixture/fixture-connector.ts` exactly — read that file for the established pattern (do not import from it). Note the carried-forward finding M-05 below: `GO` batch-separator handling is explicitly this task's responsibility to address, not silently left as-is. | T-03 (producer) |
| Consumed | `mapNativeType(nativeType: string, platform): CanonicalTypeCategory` (`packages/engine/src/comparison-core/type-mapping/type-mapping.ts`) | Existing, complete, reviewed. Use for every column's `canonicalType` field in `getSchema`'s returned `ColumnDefinition[]`, passing SQL Server's native type name (e.g. `"varchar"`, `"money"`, `"uniqueidentifier"`) exactly as reported by `INFORMATION_SCHEMA.COLUMNS.DATA_TYPE` or `sys.types`. | T-05 (producer) |
| Produced | `SqlServerConnector` class (`packages/engine/src/connector-sdk/sqlserver/sqlServerConnector.ts` or similar) implementing `DataPlatformConnector`, constructed from connection details (host/port/user/password/database, or an equivalent options object) rather than a bare connection string with inline credentials embedded in source | Real, working connector validated against the local SQL Server 2022 test container: `testConnection()` succeeds against a live connection and fails gracefully (returns `{ success: false, message }`, never throws) against a bad one; `getSchema` returns correct `ColumnDefinition[]` for a real table (including at least one `MONEY` or `DECIMAL` column, exercising T-05's mapping); `executeQuery` streams `RecordBatch`es honoring `options.maxRows`; a mutating statement (e.g. `DROP TABLE`) attempted through `executeQuery` is rejected by `assertReadOnlyStatement` before reaching the driver. | This task (producer) |

## Carried-forward finding to address

- **M-05** (Minor, from T-03's review, `PROGRESS-LEDGER.md`): SQL Server's
  `GO` batch separator is not recognized as a statement boundary by
  `assertReadOnlyStatement` — `SELECT 1\nGO\nDROP TABLE x` does not throw
  for the `sqlserver` dialect. This was explicitly accepted as
  non-blocking for T-03 (defense-in-depth framing: read-only credentials
  are the primary control) and tracked for this task. Do not silently
  ignore it: either (a) have `SqlServerConnector` reject or strip `GO`
  batch separators itself before any SQL reaches `assertReadOnlyStatement`
  (documenting this as connector-level hardening, since `assertReadOnlyStatement`
  itself is T-03's owned file and off-limits here), or (b) explicitly
  document in `IMPLEMENTATION-REPORT.md` why it remains open and non-blocking
  for this task specifically (e.g. if the `mssql` driver's own query
  execution path never accepts multi-batch `GO`-separated scripts in the
  first place, making the gap unreachable through this connector — verify
  this claim if you make it, don't assume it). Either resolution is
  acceptable; silence is not.

## Prohibited changes

- Do not modify `packages/engine/src/connector-sdk/safety/**`,
  `packages/engine/src/comparison-core/type-mapping/**`, or
  `packages/engine/src/connector-sdk/fixture/**`.
- Do not modify `packages/shared/src/connector.ts` or any other shared
  type — if a genuine interface gap is found, stop and flag it as a
  blocker rather than editing it.
- Do not embed the test container's credentials (or any credential)
  directly in test source — read from environment variables, per the Test
  environment section above.
- Do not silently skip a test without a visible, explicit skip reason —
  per the review-gate requirement quoted above.
- Do not touch `docker-compose.test.yml` unless a genuine defect in it
  blocks this task (e.g. a port conflict) — flag and justify explicitly
  if so, rather than editing it as a matter of course.
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Test or check to add:** A connection test against the live SQL Server
  2022 test container asserting `testConnection()` returns
  `{ success: true }` — must fail because `SqlServerConnector` doesn't
  exist yet. A second red-state case: `getSchema` against a real table
  with a known `MONEY` column, asserting the returned `canonicalType`
  matches T-05's mapping — must fail for the same reason. A third:
  `executeQuery` attempting a `DROP TABLE` statement, asserting it throws
  via `assertReadOnlyStatement` — must fail (connector doesn't exist).
- **Command:** `npx vitest run packages/engine/src/connector-sdk/sqlserver`
  (run from inside WSL, per the Test environment section)
- **Expected failure reason:** Module/class does not exist yet.
- **Captured output:** Paste the actual failing command output and exit
  code into `IMPLEMENTATION-REPORT.md`, not a paraphrase. Also paste the
  exact `docker compose -f docker-compose.test.yml up -d` /
  `... ps` output showing the container reached `(healthy)` before tests
  ran.

## Green-state and full verification

- **Focused command:** `npx vitest run packages/engine/src/connector-sdk/sqlserver`
  (from inside WSL, container running in the same session)
- **Full command:** `npm run verify` (from inside WSL)
- **Expected evidence:** All three red-state cases now pass against the
  live container; a statement-safety rejection test genuinely exercises
  the real `mssql` driver path (not mocked); all of T-01–T-16's existing
  tests still pass unmodified; the previously-passing 359 tests (per
  `PROGRESS-LEDGER.md`'s T-16 entry) still pass with no regression;
  `npm run verify` exits 0 inside WSL. If the container is unavailable at
  any point during your session, explicitly re-run
  `docker compose -f docker-compose.test.yml up -d` and wait for healthy
  status rather than working around a connection failure — do not weaken
  a test to pass without a real connection.

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md`
- **Independent reviewer:** `reviewer` subagent (separate instance from
  whichever `implementer` subagent does this task)
- **Review report location:** `REVIEW-REPORT.md`
- **Commit or patch checkpoint:** Branch `task/T-17-sqlserver-connector`

**Note to reviewer:** per `IMPLEMENTATION-PLAN.md`'s T-17 review-gate
column, "confirms read-only enforcement and credential handling match
`AGENTS.md`; confirms no test skip hides a real failure." Specifically:
(1) independently attempt a mutating statement through `executeQuery`
against the live container yourself (don't just re-run the implementer's
test) and confirm it's genuinely rejected before reaching SQL Server —
check server-side that no table was actually affected, not just that an
exception was thrown client-side; (2) grep the diff for any hardcoded
password/connection string; (3) confirm the M-05 (`GO` separator)
resolution is real, not just claimed — if the implementer says the `mssql`
driver path makes it unreachable, verify that claim yourself rather than
accepting it at face value; (4) confirm any skipped test has a visible,
explicit reason, not a bare `.skip`; (5) run the full command yourself
inside WSL (per the Test environment section) rather than trusting the
implementer's reported numbers.