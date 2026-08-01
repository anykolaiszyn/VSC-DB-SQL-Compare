# ParityLens — Task Brief T-19

## Objective

Implement `PostgresConnector`, a `DataPlatformConnector` implementation
(`@paritylens/shared`) backed by the `pg` package, targeting the local
PostgreSQL 16 test container already running via `docker-compose.test.yml`
at the repo root. Same requirements as T-17 (SQL Server connector,
COMPLETE and APPROVED) — every method of the interface implemented against
a real database server, following the same overall pattern.

Note to whoever dispatches an implementer against this brief: quote this
document's load-bearing requirements verbatim rather than paraphrasing
them. A paraphrase that loosens a requirement is a known failure mode from
this project's history (T-07's I-02 finding traced back to exactly this).

## Test environment (read this before starting)

- `docker-compose.test.yml` (repo root) defines a `postgres-test` service:
  PostgreSQL 16 (alpine), exposed on **port 54320** (not the default
  5432), user `paritylens`, password `ParityLens_Test1!`, database
  `paritylens_test`. Start it with
  `docker compose -f docker-compose.test.yml up -d` and wait for
  `docker compose -f docker-compose.test.yml ps` to report `(healthy)`.
- **Environment-specific constraint, already resolved by T-17 and
  confirmed a second time (see `PROGRESS-LEDGER.md`'s 2026-07-31
  blocker-resolution and T-17 entries):** on this machine, Docker runs
  inside WSL2 (native Docker Engine, not Docker Desktop), and WSL2 does
  **not** forward these container ports back to Windows — not via
  `localhost`, not via WSL's mirrored LAN IP. The container is only
  reachable from **inside WSL**. Node v24.9.0 (matching `CLAUDE.md`'s
  documented version) is installed inside WSL via `nvm` (`~/.nvm`), and
  the full toolchain (`npm install`, `npm run verify`) has now been
  confirmed working there twice — once during environment setup, once
  during T-17. **Run this task's implementation and test commands from
  inside WSL**, not from the Windows-side shell, and bring the container
  up within the same continuous WSL session as the test run — the WSL2
  VM (and everything running in it) tears down when idle between separate
  `wsl.exe` invocations from Windows, so do not assume a container
  started earlier is still running in a later, separate invocation. If
  your shell is Git-Bash on Windows rather than WSL bash, check with
  `uname -a` (WSL reports a Linux kernel with "microsoft-standard-WSL2";
  Git-Bash reports MSYS/MinGW) and invoke WSL explicitly if needed — T-17's
  `IMPLEMENTATION-REPORT.md` documents the exact invocation pattern that
  worked (`MSYS2_ARG_CONV_EXCL="*" wsl.exe -e bash <script>`), read it for
  reference.
- The SQL Server and PostgreSQL containers run simultaneously from the
  same `docker-compose.test.yml` — bringing one up brings up both (or you
  may target just `postgres-test` with
  `docker compose -f docker-compose.test.yml up -d postgres-test`). Either
  is fine.
- Connection details must be read from environment variables at test-run
  time (e.g. `PARITYLENS_TEST_POSTGRES_HOST=localhost`,
  `PARITYLENS_TEST_POSTGRES_PORT=54320`,
  `PARITYLENS_TEST_POSTGRES_USER=paritylens`,
  `PARITYLENS_TEST_POSTGRES_PASSWORD=...`,
  `PARITYLENS_TEST_POSTGRES_DATABASE=paritylens_test` — mirror T-17's
  naming convention, document the exact names chosen in
  `IMPLEMENTATION-REPORT.md`), never hardcoded into test source, per
  `AGENTS.md`'s no-inline-credentials rule. The `docker-compose.test.yml`
  password is a disposable local-only test value, not a production
  secret, but the code must still read it from the environment as a
  matter of consistent practice, not because this specific value is
  sensitive.
- If the container is genuinely unavailable when a test runs (env vars
  unset, connection refused), the test **must be skipped explicitly and
  documented as such** — e.g. `describe.skipIf(!hasTestServerEnv())` with
  a visible log line, mirroring T-17's pattern exactly — never silently
  pass or silently disappear. Per `IMPLEMENTATION-PLAN.md`'s T-19
  review-gate column: "confirms no test skip hides a real failure."

## Dependencies

- **Required completed tasks:** T-03 (statement-safety parser — the
  `"postgres"` dialect already exists in
  `packages/engine/src/connector-sdk/safety/statement-safety.ts`), T-05
  (canonical type-mapping layer — `mapNativeType(nativeType, "postgres")`
  already handles PostgreSQL type strings). T-17 (SQL Server connector) is
  also complete and establishes the working pattern for this task to
  follow, though it is not a hard dependency (T-19 has no ownership
  overlap with T-17). All COMPLETE and APPROVED.
- **Required decisions or approvals:** NONE beyond the already-approved
  `IMPLEMENTATION-PLAN.md` T-19 row and the environment-blocker resolution
  recorded in `PROGRESS-LEDGER.md`.

## Files owned

- `packages/engine/src/connector-sdk/postgres/**` (new directory)

You will need to add `pg` (and likely `@types/pg`) as a new runtime/dev
dependency of `packages/engine` (not yet installed) — this is expected and
in scope, not a deviation to flag, mirroring T-17's addition of `mssql`/
`@types/mssql`. Do not add any other new runtime dependency without
disclosing it explicitly in `IMPLEMENTATION-REPORT.md`.

Do not touch `packages/engine/src/connector-sdk/safety/**` (T-03's owned
file — consume `assertReadOnlyStatement`/`SqlDialect` read-only via
`import`), `packages/engine/src/comparison-core/type-mapping/**` (T-05's
owned file — consume `mapNativeType` read-only via `import`),
`packages/engine/src/connector-sdk/fixture/**` (T-04's owned file), or
`packages/engine/src/connector-sdk/sqlserver/**` (T-17's owned file — read
it for reference/pattern only, it is the most directly comparable
already-built real connector in this codebase, but do not edit it or
import from it).

## Interfaces

| Direction | Interface | Contract | Producer or consumer |
| --- | --- | --- | --- |
| Consumed | `DataPlatformConnector` (`packages/shared/src/connector.ts`) | Existing, complete interface. `PostgresConnector` implements every method: `testConnection`, `getCatalogs`, `getSchemas`, `getObjects`, `getSchema`, `executeQuery`, `getCapabilities`, `quoteIdentifier`, `buildProfileQuery`. | T-02 (producer) |
| Consumed | `assertReadOnlyStatement(sql: string, dialect: SqlDialect): void` (`packages/engine/src/connector-sdk/safety/statement-safety.ts`) | Existing, complete, reviewed. Call with `dialect: "postgres"` on every SQL string before it reaches the `pg` driver — both user-supplied `{ kind: "query" }`/`{ kind: "sqlFile" }` input and any SQL this connector generates itself, matching `SqlServerConnector`'s established pattern in `packages/engine/src/connector-sdk/sqlserver/sqlServerConnector.ts` (read it for the pattern; do not import from it). Note the carried-forward finding M-06 below: dollar-quoting handling is explicitly this task's responsibility to address, not silently left as-is. | T-03 (producer) |
| Consumed | `mapNativeType(nativeType: string, platform): CanonicalTypeCategory` (`packages/engine/src/comparison-core/type-mapping/type-mapping.ts`) | Existing, complete, reviewed. Use for every column's `canonicalType` field in `getSchema`'s returned `ColumnDefinition[]`, passing PostgreSQL's native type name (e.g. `"varchar"`, `"numeric"`, `"uuid"`, `"timestamp"`) exactly as reported by `information_schema.columns.data_type` or `pg_catalog`. | T-05 (producer) |
| Produced | `PostgresConnector` class (`packages/engine/src/connector-sdk/postgres/postgresConnector.ts` or similar) implementing `DataPlatformConnector`, constructed from connection details (host/port/user/password/database, or an equivalent options object) rather than a bare connection string with inline credentials embedded in source | Real, working connector validated against the local PostgreSQL 16 test container: `testConnection()` succeeds against a live connection and fails gracefully (returns `{ success: false, message }`, never throws) against a bad one; `getSchema` returns correct `ColumnDefinition[]` for a real table (including at least one `NUMERIC`/`DECIMAL` column, exercising T-05's mapping); `executeQuery` streams `RecordBatch`es honoring `options.maxRows`; a mutating statement (e.g. `DROP TABLE`) attempted through `executeQuery` is rejected by `assertReadOnlyStatement` before reaching the driver. | This task (producer) |

## Carried-forward finding to address

- **M-06** (Minor, from T-03's review, `PROGRESS-LEDGER.md`): PostgreSQL
  dollar-quoted strings (`$$...$$`, or tagged `$tag$...$tag$`) are not
  stripped as literals by `assertReadOnlyStatement`, so an apostrophe
  inside a dollar-quoted body can desync the scanner — the reviewer
  demonstrated a concrete bypass:
  `SELECT $$it's fine$$ AS x; DROP TABLE y;` does not throw for the
  `postgres` dialect. This was explicitly accepted as non-blocking for
  T-03 (defense-in-depth framing: read-only credentials are the primary
  control) and tracked for this task. Do not silently ignore it: either
  (a) have `PostgresConnector` detect and reject (or safely neutralize)
  dollar-quoted content itself before any SQL reaches
  `assertReadOnlyStatement` (documenting this as connector-level
  hardening, mirroring T-17's `rejectGoBatchSeparator()` pattern for
  M-05, since `assertReadOnlyStatement` itself is T-03's owned file and
  off-limits here), or (b) explicitly document in
  `IMPLEMENTATION-REPORT.md` why it remains open and non-blocking for
  this task specifically, with genuine verification behind any such
  claim, not an assumption. Either resolution is acceptable; silence is
  not.

## Prohibited changes

- Do not modify `packages/engine/src/connector-sdk/safety/**`,
  `packages/engine/src/comparison-core/type-mapping/**`,
  `packages/engine/src/connector-sdk/fixture/**`, or
  `packages/engine/src/connector-sdk/sqlserver/**`.
- Do not modify `packages/shared/src/connector.ts` or any other shared
  type — if a genuine interface gap is found, stop and flag it as a
  blocker rather than editing it.
- Do not embed the test container's credentials (or any credential)
  directly in test source — read from environment variables, per the Test
  environment section above.
- Do not silently skip a test without a visible, explicit skip reason.
- Do not touch `docker-compose.test.yml` unless a genuine defect in it
  blocks this task (e.g. a port conflict) — flag and justify explicitly
  if so, rather than editing it as a matter of course.
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Test or check to add:** A connection test against the live PostgreSQL
  16 test container asserting `testConnection()` returns
  `{ success: true }` — must fail because `PostgresConnector` doesn't
  exist yet. A second red-state case: `getSchema` against a real table
  with a known `NUMERIC`/`DECIMAL` column, asserting the returned
  `canonicalType` matches T-05's mapping — must fail for the same reason.
  A third: `executeQuery` attempting a `DROP TABLE` statement, asserting
  it throws via `assertReadOnlyStatement` — must fail (connector doesn't
  exist).
- **Command:** `npx vitest run packages/engine/src/connector-sdk/postgres`
  (run from inside WSL, per the Test environment section)
- **Expected failure reason:** Module/class does not exist yet.
- **Captured output:** Paste the actual failing command output and exit
  code into `IMPLEMENTATION-REPORT.md`, not a paraphrase. Also paste the
  exact `docker compose -f docker-compose.test.yml up -d` /
  `... ps` output showing the container reached `(healthy)` before tests
  ran.

## Green-state and full verification

- **Focused command:** `npx vitest run packages/engine/src/connector-sdk/postgres`
  (from inside WSL, container running in the same session)
- **Full command:** `npm run verify` (from inside WSL)
- **Expected evidence:** All three red-state cases now pass against the
  live container; a statement-safety rejection test genuinely exercises
  the real `pg` driver path (not mocked); all of T-01–T-17's existing
  tests still pass unmodified; the previously-passing 372 tests (per
  `PROGRESS-LEDGER.md`'s T-17 entry) still pass with no regression;
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
- **Commit or patch checkpoint:** Branch `task/T-19-postgres-connector`

**Note to reviewer:** per `IMPLEMENTATION-PLAN.md`'s T-19 review-gate
column, "confirms read-only enforcement and credential handling match
`AGENTS.md`; confirms no test skip hides a real failure." Specifically,
mirroring T-17's review depth: (1) independently attempt a mutating
statement through `executeQuery` against the live container yourself
(don't just re-run the implementer's test) and confirm it's genuinely
rejected before reaching PostgreSQL — check server-side that no table was
actually affected, not just that an exception was thrown client-side;
(2) grep the diff for any hardcoded password/connection string;
(3) confirm the M-06 (dollar-quoting) resolution is real, not just
claimed — construct your own dollar-quoted bypass attempt (including at
least one with an embedded apostrophe, matching T-03's original
demonstrated bypass) against the live container rather than accepting the
report's claim; (4) confirm any skipped test has a visible, explicit
reason, not a bare `.skip`; (5) run the full command yourself inside WSL
(per the Test environment section) rather than trusting the implementer's
reported numbers.