# ParityLens — Review Report T-19

## Review independence statement

This review was performed by a separate reviewer agent instance with no
memory of writing `PostgresConnector`. All findings below are based on
direct inspection of the actual diff/source, my own fresh command
execution inside WSL2 against a container I started myself in this
session, and adversarial probes I constructed independently (not
re-running the implementer's tests). `IMPLEMENTATION-REPORT.md`'s claims
were treated as things to verify, not trust.

## Scope reviewed

- Branch `task/T-19-postgres-connector`, commits `84b4928` (implementation)
  and `4118232` (commit-hash correction in the report), diffed against
  `main`.
- Files changed: `packages/engine/src/connector-sdk/postgres/postgresConnector.ts`
  (new, 547 lines), `packages/engine/src/connector-sdk/postgres/postgresConnector.test.ts`
  (new, 315 lines, 14 tests), `packages/engine/package.json` (+`pg`,
  +`@types/pg`), `package-lock.json` (mechanical), `IMPLEMENTATION-REPORT.md`.
- Confirmed via `git diff main task/T-19-postgres-connector -- <prohibited paths>`
  (statement-safety, type-mapping, fixture, sqlserver, `packages/shared/`)
  that **zero lines** touch any file `TASK-BRIEF.md` prohibits editing.
  `packages/engine/package.json`'s diff is exactly the two authorized
  dependency additions (`pg: ^8.16.0`, `@types/pg: ^8.11.0`), matching the
  brief's explicit pre-authorization. No unauthorized scope expansion
  found.

## Environment note

This machine's shell defaults to Git-Bash (`MINGW64_NT`, confirmed via
`uname -a`). All verification below was run via
`MSYS2_ARG_CONV_EXCL="*" wsl.exe -e bash -c '...'`, confirmed to reach a
real WSL2 kernel (`microsoft-standard-WSL2`). The test container had torn
down between my own separate `wsl.exe` invocations mid-review (observed
directly: a `docker compose ps` in a later invocation showed no running
container after an earlier invocation had it healthy) — exactly the
behavior the brief warns about. I restarted it fresh within the same
invocation as each subsequent test run, per the brief's instructions.

## Verification performed (my own, fresh)

### 1. `npm run verify` (full command, inside WSL2, live container healthy, env vars set)

```
Test Files  19 passed | 1 skipped (20)
     Tests  373 passed | 13 skipped (386)
VERIFY_EXIT=0
```

Matches `IMPLEMENTATION-REPORT.md`'s claimed 373 passed / 13 skipped
exactly. The 13 skipped are `sqlServerConnector.test.ts`'s own suite,
skipped with a visible `console.log` line
(`[sqlServerConnector.test.ts] SKIPPING all SqlServerConnector integration
tests: PARITYLENS_TEST_SQLSERVER_HOST/PORT/USER/PASSWORD are not all
set...`) because my session only set the PostgreSQL env vars — expected
per the brief, not a T-19 regression, and the SQL Server container was
independently confirmed running in the same session.

### 2. Focused T-19 suite

`npx vitest run packages/engine/src/connector-sdk/postgres` (implicitly
run as part of `npm run verify` above): 14/14 tests passed against the
live container, none skipped (env vars were set).

### 3. Independent mutating-statement + dollar-quote adversarial probe

I wrote a throwaway vitest file (`__reviewer_probe.test.ts`, deleted
before finishing — confirmed via `git status` showing a clean tree) that:
seeded its own table (`public.reviewer_probe_t19`) directly via the raw
`pg` driver (bypassing the connector, matching the implementer's own
pattern for avoiding a chicken-and-egg problem), then attempted the
following through `PostgresConnector.executeQuery`, and finally
re-queried the table via the raw driver to prove server-side state:

| Attempt | Result |
| --- | --- |
| Plain `DROP TABLE ...` | Rejected client-side, throws |
| `SELECT $$it's fine$$ AS x; DROP TABLE ...;` (exact T-03-demonstrated bypass) | Rejected client-side, throws |
| `SELECT $body$O'Brien's data$body$ AS x; DROP TABLE ...;` (my own tagged-delimiter + apostrophe variant) | Rejected client-side, throws |
| `SELECT $$'; DROP TABLE ...; --$$ AS x` (my own variant: mutating text embedded *inside* a dollar-quoted body, no actual second statement) | Rejected client-side, throws |
| `drop table ...` (lowercase, case-variant) | Rejected client-side, throws |
| `TRUNCATE TABLE ...` | Rejected client-side, throws |

**Server-side verification (my own, not the implementer's):** after all
six attempts, a raw `pg` query (`SELECT * FROM reviewer_probe_t19`) showed
the table intact with its original single seeded row (`reviewer-seed`)
unchanged. This independently confirms both (a) `assertReadOnlyStatement`
genuinely blocks mutating statements before they reach the driver for the
`postgres` dialect, and (b) the M-06 connector-level `rejectDollarQuoting`
hardening genuinely blocks dollar-quoted content — including a tagged
variant and an apostrophe-containing variant I constructed myself, not
copied from the implementation report — before it reaches
`assertReadOnlyStatement` or the driver. All 7 probe tests (6 rejections +
1 server-side-state assertion) passed. The throwaway test file and its
companion `.mjs` draft were deleted; `git status` after cleanup shows
"nothing to commit, working tree clean."

I additionally reasoned about (rather than needing to execute) a possible
regex gap in `rejectDollarQuoting`'s
`/\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$/` pattern: tested in isolation
(`node -e`) against a Unicode tag (`$café$...$café$`) — the regex still
matches (it finds `$hello$` as a substring inside, since it doesn't
require anchoring to the true tag boundaries), so this is over-broad in
the *safe* direction, not a bypass. I could not construct an input where
PostgreSQL would accept a dollar-quote tag that this regex fails to
detect.

### 4. Skip-reason check

`postgresConnector.test.ts` uses `describe.skipIf(!hasTestServerEnv)` with
a `console.log` line printed only when env vars are absent — not a bare
`.skip`. Directly re-read the source (lines 41–50) to confirm.

### 5. Hardcoded credential grep

`git diff main task/T-19-postgres-connector -- packages/engine/src/connector-sdk/postgres/`
grepped for the literal password, port, and database name: all matches
were in comments describing environment-variable names/examples or in
`process.env[...]` reads — no literal credential value or connection
string appears anywhere in the diff. `postgresConnector.ts` itself never
reads `process.env` — confirmed by reading the full file; credentials
arrive solely via the caller-supplied `PostgresConnectionOptions`
constructor argument.

## Disposition of the M-06 carried-forward finding

**Confirmed resolved**, verified independently, not merely accepted on
the report's word. The exact bypass string the T-03 reviewer originally
demonstrated (`SELECT $$it's fine$$ AS x; DROP TABLE y;`) is rejected by
`PostgresConnector`'s connector-level `rejectDollarQuoting`, and I proved
server-side (my own re-query, not the implementer's) that no mutation
occurred. I went further than the brief's minimum ask and also tried a
tagged delimiter with an embedded apostrophe and a body containing literal
mutating-looking text — both correctly rejected.

**Judgment call assessment (blanket rejection vs. narrow fix):**
reasonable, not overly broad in a way that matters for this connector's
actual use. Dollar-quoting exists in PostgreSQL almost exclusively for
(a) function/procedure bodies — already blocked as DDL by
`assertReadOnlyStatement`'s keyword list regardless of M-06 — and (b) as
an alternative to `''`-escaping inside ordinary string literals, which is
never a functional necessity (any string expressible with `$$...$$` is
also expressible with standard single-quote escaping). Given this
connector's documented scope is read-only comparison queries
(`{kind:"table"}`/`{kind:"query"}`/`{kind:"sqlFile"}` feeding
schema/profile/row comparisons), not general-purpose SQL authoring, the
practical cost of blocking all dollar-quoted content is low, and the
implementer's own report discloses this tradeoff explicitly rather than
hiding it. Acceptable as implemented.

## Findings

### Critical

NONE.

### Important

NONE.

### Minor

NONE. No new minor findings identified. (The disclosed `getSchema`
`{kind:"query"}`/`{kind:"sqlFile"}` `nullable: true` default and the
hand-maintained `pgTypeOidToNativeTypeName` fallback table are both
genuine, explicitly disclosed limitations with sound reasoning — same
category of disclosed limitation T-17 carried for its SQL Server
equivalent, and not exercised in a way that produces incorrect behavior
for any currently-supported code path; not blocking, and not elevated to
a tracked finding since they mirror an already-accepted T-17 precedent.)

## Numbers claimed vs. observed

| Metric | Implementer's report | My own run |
| --- | --- | --- |
| Full verify exit code | 0 | 0 |
| Test files passed/skipped | 19 passed, 1 skipped (20) | 19 passed, 1 skipped (20) — match |
| Tests passed/skipped | 373 passed, 13 skipped (386) | 373 passed, 13 skipped (386) — match |
| Focused T-19 suite | 14/14 passed | 14/14 passed — match |

No discrepancy between claimed and observed numbers.

## Approval status

**APPROVED.**

All five specific reviewer checks named in `TASK-BRIEF.md`'s "Note to
reviewer" section were performed independently and passed: (1) mutating
statement attempted directly against the live container by me, confirmed
server-side unaffected; (2) no hardcoded credential/connection string
found in the diff; (3) M-06 dollar-quoting resolution independently
re-verified with the exact T-03 bypass plus two variants of my own
construction, all rejected, server-side state confirmed; (4) skip reason
is explicit and visible, not a bare `.skip`; (5) `npm run verify` run
fresh by me inside WSL2, numbers match the implementer's report exactly.
No files outside the brief's declared ownership were touched. No Critical
or Important findings. Task T-19 is complete and ready for the Lead
Orchestrator to reconcile and merge.
