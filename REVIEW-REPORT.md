# ParityLens — Review Report T-17

## Review independence statement

This review was performed by a separate agent instance from whoever
implemented T-17, with no memory of writing this code. All findings below
are based on direct inspection of the actual diff/source at commit
`3ed921b` on branch `task/T-17-sqlserver-connector`, my own fresh
`npm run verify` run inside WSL2 against a freshly-started live SQL Server
2022 test container, and my own independently constructed adversarial
mutating-statement probes — none of which reuse the implementer's test
file. `IMPLEMENTATION-REPORT.md`'s claims were treated as assertions to
verify, not facts to accept.

## Scope reviewed

- `packages/engine/src/connector-sdk/sqlserver/sqlServerConnector.ts` (new, 588 lines)
- `packages/engine/src/connector-sdk/sqlserver/sqlServerConnector.test.ts` (new, 299 lines)
- `packages/engine/package.json` (added `mssql`/`@types/mssql`)
- `package-lock.json` (mechanical consequence of the above)
- `IMPLEMENTATION-REPORT.md`, `TASK-BRIEF.md`, `PROGRESS-LEDGER.md`, `AGENTS.md`

Diff against `main`: `git diff main task/T-17-sqlserver-connector --stat`
confirms exactly these five files changed, no others. Confirmed via
`git diff --ignore-all-space` that `packages/engine/package.json`'s
apparent full-file diff is a pure CRLF/LF line-ending artifact plus the two
authorized dependency-line additions — no unrelated content drift.

**Prohibited-file check:** `git diff main task/T-17-sqlserver-connector --
packages/engine/src/connector-sdk/safety/ packages/engine/src/comparison-core/type-mapping/
packages/engine/src/connector-sdk/fixture/ packages/shared/src/connector.ts docker-compose.test.yml`
produced zero output — none of the brief's prohibited files were touched.

## Verification performed (my own, fresh)

All commands run from inside WSL2 (`MSYS2_ARG_CONV_EXCL="*" wsl.exe -e bash -c '...'`,
confirmed via `uname -a` reporting `microsoft-standard-WSL2`; my own shell
is Git-Bash/MSYS, confirmed via `uname -a` reporting `MINGW64_NT`), Node
v24.9.0 activated via `nvm`, repo at `/mnt/v/Secret Projects/VSC-DB-SQL-Compare`.
Container brought up fresh in the same continuous WSL session as every test
run, per the brief's explicit warning.

- **Container health:** `docker compose -f docker-compose.test.yml up -d`
  then polled `... ps` — both `sqlserver-test` and `postgres-test` reached
  `(healthy)` within ~10s.
- **Full verification:** `npm install` (293 packages, clean) then
  `npm run verify` (typecheck + lint + test) with all four
  `PARITYLENS_TEST_SQLSERVER_*` env vars set and the container healthy in
  the same session.

  **My result: `Test Files 19 passed (19)`, `Tests 372 passed (372)`, exit 0.**
  This matches `IMPLEMENTATION-REPORT.md`'s claimed 372/372 exactly,
  including the 13 SQL Server integration tests genuinely executing (not
  skipped — confirmed by the per-test names appearing in output, e.g.
  `testConnection() fails gracefully against an unreachable host 3001ms`,
  a timing signature inconsistent with a mock).

- **Skip-path verification (item 4 of the brief's reviewer checklist):**
  re-ran `npx vitest run packages/engine/src/connector-sdk/sqlserver` with
  the four env vars explicitly unset. Result: `1 skipped (1)` /
  `13 skipped (13)`, with a visible `stdout` line:
  `[sqlServerConnector.test.ts] SKIPPING all SqlServerConnector integration
  tests: PARITYLENS_TEST_SQLSERVER_HOST/PORT/USER/PASSWORD are not all
  set. Start the test container...`. This is `describe.skipIf` plus an
  explicit `console.log`, not a bare `.skip` — confirmed genuine, not
  claimed-only.

- **Credential grep (item 2):** `git diff ... -- packages/engine/src/connector-sdk/sqlserver/`
  piped through a case-insensitive grep for `password|pwd|secret|ParityLens_Test1|connectionstring`.
  Every hit is either a field/variable *name* (`password: string`, the
  `PARITYLENS_TEST_SQLSERVER_PASSWORD` env-var name, `this.options.password`)
  or a deliberately-wrong test literal (`"definitely-the-wrong-password-123!"`,
  used only to prove `testConnection()` fails gracefully against bad
  credentials). No real credential value, connection string, or the actual
  container password (`ParityLens_Test1!`) appears anywhere in the diff.
  `sqlServerConnector.ts` itself reads no environment variable and holds no
  literal credential — confirmed by reading the full file; credentials
  enter only via the caller-supplied `SqlServerConnectionOptions` at
  construction time, matching the Interfaces table's requirement.

- **Adversarial mutating-statement probes (item 1 and item 3 — my own,
  not the implementer's test file):** wrote a throwaway Vitest file
  (`__reviewer_probe.test.ts`, deleted before concluding this review;
  confirmed via `git status --short` showing no residue) that seeds its
  own table (`dbo.reviewer_probe_t17`, 2 rows) and attempts 6 mutating/
  bypass shapes distinct from the implementer's own 4 covered statements,
  through the real `executeQuery` against the live container:

  | Attempt | Result |
  | --- | --- |
  | `TRUNCATE TABLE ...` (keyword not in implementer's own test) | rejected |
  | `GO 1  ` (repeat count + trailing whitespace) then `DROP TABLE` | rejected |
  | `GO` then `EXEC sp_rename '...', 'reviewer_renamed'` (mutating stored proc via `EXEC`, not a bare DML keyword) | rejected |
  | lowercase, tab-indented `go` then `DELETE FROM ...` | rejected |
  | semicolon-chained `DELETE` with no `GO` at all | rejected |
  | paren-wrapped CTE `DELETE` — the exact historical I-01 bypass pattern from T-03's review, retested here against this connector's own call site | rejected |

  All 7 probe assertions passed (`✓ 7 tests`). Critically, I then verified
  **server-side**, via a fresh query against the live container issued
  directly (not through the connector's own `executeQuery`, to avoid
  trusting the same code path under test): `SELECT OBJECT_ID(...)` proved
  the table still exists, `SELECT COUNT(*)` returned exactly `2` (the
  seeded row count, unchanged), and `SELECT OBJECT_ID('dbo.reviewer_renamed', ...)`
  returned `NULL` (the `sp_rename` attempt never reached the server). This
  independently confirms rejection happens before the driver, not merely
  that a client-side exception was thrown after a mutation already landed.

  This also independently re-confirms the M-05 (`GO` batch separator)
  resolution genuinely closes the disclosed gap — using variants (repeat
  count, lowercase, tab-indentation, `EXEC`-based mutation after `GO`) the
  implementer's own single worked-example test did not cover, not merely
  re-running their exact case. Read `rejectGoBatchSeparator`
  (`sqlServerConnector.ts:511-523`) directly: the regex
  `/^[ \t]*GO[ \t]*(?:\d+[ \t]*)?$/im` runs unconditionally before
  `assertReadOnlyStatement` inside `executeQuery`, so this is a real
  code-path guarantee, not an artifact of the specific test string used.

- **Cross-check of `assertReadOnlyStatement`'s dialect table:** read
  `packages/engine/src/connector-sdk/safety/statement-safety.ts` directly
  (read-only, not edited) to confirm `EXEC`/`TRUNCATE` are already in the
  common/sqlserver-dialect mutating-keyword lists — my `EXEC sp_rename`
  and `TRUNCATE TABLE` probes were exercising real, already-covered
  behavior end-to-end through the live driver, not testing an
  accidentally-uncovered keyword.

## Disposition of the carried-forward finding (M-05)

**RESOLVED, independently confirmed.** `PROGRESS-LEDGER.md`'s M-05 entry
required either (a) connector-level rejection of `GO`, or (b) a verified
claim that the gap is unreachable through this connector. The implementer
chose (a): `rejectGoBatchSeparator()` runs before `assertReadOnlyStatement`
inside `executeQuery`. I independently reproduced the brief's own worked
example plus 4 additional variants the implementer's test didn't cover
(above), all rejected, all confirmed server-side to have caused zero
mutation. This is a genuine, verified fix, not a claim taken at face
value.

## Assessment of the three disclosed cross-platform bug fixes

All three are genuine, in-scope corrections discovered via real live-server
testing (not scope creep, not a sign of a rushed implementation):

1. **`getCatalogs()` excluding `master`:** the original `database_id > 4`
   filter is a defensible-looking convention borrowed from generic
   "user databases only" tooling, but it directly broke against this
   task's own test environment (default database is `master`). The fix
   (list all databases visible to the login) is strictly more correct for
   a read-only catalog-metadata method — there is no security rationale
   for hiding system databases from a connection that's already
   authenticated to the server, and the brief's Interfaces table doesn't
   ask for filtering. Confirmed sensible.
2. **`buildRowCappedSql`'s `ORDER BY`-in-derived-table fix:** this is a
   genuine SQL Server grammar constraint (verified: SQL Server does reject
   a bare `ORDER BY` inside a derived table without `TOP`/`OFFSET`/`FOR
   XML`), and the implementer's own test (`{kind:'query'}` + `ORDER BY
   CustomerId`) is an entirely ordinary query shape a real caller would
   supply — not a contrived edge case invented to justify the fix. The
   `TOP 100 PERCENT` injection is a standard, well-known no-op workaround
   for exactly this constraint and does not change row selection or
   order. The lexical detection heuristic's limitations are honestly
   disclosed as a residual risk in the report (false negative surfaces
   SQL Server's own grammar error rather than silently misbehaving) —
   reasonable given this codebase's established precedent of a lexical,
   not full-parser, safety scanner.
3. **`buildProfileQuery`'s duplicate `total_count` alias fix:** genuine
   SQL Server behavior difference from DuckDB (SQL Server rejects
   duplicate output-column aliases; DuckDB tolerates them), caught because
   this task's own multi-column profile test exercises more than one
   profiled column against a real server rather than a single-column
   happy path. The fix (emit `total_count` once) is the obviously correct
   resolution and doesn't change the aggregate's semantics.

All three read as real defects surfaced by testing against an actual
server rather than invented busywork — consistent with the brief's
stated purpose ("this is the project's first connector talking to an
actual database server rather than DuckDB").

## Findings

### Critical

NONE.

### Important

NONE.

### Minor

| ID | Description | Evidence | Required/suggested resolution |
| --- | --- | --- | --- |
| T-17-01 | `getSchema`'s `{kind:"table"}` path and `parseObjectRef` support only bare-name or exactly one `schema.table` segment; a 3- or 4-part reference (`database.schema.table`, `server.database.schema.table`) is treated as an unrecognized bare name with everything before the last `.` folded into "schema" (`sqlServerConnector.ts:435-444`). Not exercised by any test in this task. | Read `parseObjectRef` directly: `parts.length >= 2` always takes the last two segments regardless of how many segments precede them, so `"otherdb.dbo.customer"` would resolve to schema=`"dbo"`, table=`"customer"` but silently drop the `otherdb.` catalog qualifier from the identifier actually sent to the server, rather than erroring. Since the connector's `database` is fixed at construction time and the brief's scope is single-database comparisons, this is unlikely to bite in the MVP's actual usage pattern, but it is a silent narrowing rather than a fail-loud rejection. | Honestly disclosed by the implementer as an assumption in `IMPLEMENTATION-REPORT.md`. Non-blocking for this task's stated scope (single-database `{kind:"table"}` references); track as follow-up if/when a caller needs fully-qualified cross-database references (would need to be paired with a `getSchema` on a different `database` than the connector's own, which nothing in the current interface requests). |
| T-17-02 | `mssqlTypeToNativeTypeName` (the `{kind:"query"}`/`{kind:"sqlFile"}` `getSchema` path) is a hand-maintained switch over `mssql`'s runtime type-constructor names, not derived from the driver's own registry; an exotic type not in the table silently falls back to `"sql_variant"` → canonical `"Unknown"` rather than erroring, and no test exercises the fallback path itself (only the mapped types via `buildProfileQuery`'s `COUNT` aggregates, which are always integer/bigint). | Read the function directly (`sqlServerConnector.ts:533-587`); confirmed no dedicated test constructs a query returning an unmapped type (e.g. `XML`, `HIERARCHYID`, `GEOGRAPHY`) to prove the fallback path is reached and behaves as documented rather than throwing unexpectedly. | Honestly disclosed as a risk in the report. Non-blocking — consistent with `mapNativeType`'s own documented never-throw contract (T-05, approved), and no current test data exercises these exotic types. Suggested (not required) follow-up: a small dedicated test asserting the fallback path itself when a future task needs it. |

Both Minor findings were disclosed proactively by the implementer in
`IMPLEMENTATION-REPORT.md`'s "Assumptions and risks" section rather than
found independently by me — I verified each by reading the relevant code
directly and confirming the disclosed characterization is accurate, and
judge both as correctly non-blocking for this task's actual declared
scope (single-database table/query comparisons against a live SQL Server
instance, per the brief's Interfaces table).

## Scope and ownership check

Files changed exactly match the brief's declared ownership
(`packages/engine/src/connector-sdk/sqlserver/**`) plus the explicitly
pre-authorized `mssql` dependency addition to `packages/engine/package.json`
(brief: "You will need to add `mssql`... this is expected and in scope"),
the disclosed `@types/mssql` devDependency (brief: "disclosing it
explicitly... it is" — disclosed in the report's Changed Files table with
rationale), and the mechanical `package-lock.json` consequence. No
prohibited file was touched (verified above via `git diff`, zero output).

## Verification-claims cross-check

`IMPLEMENTATION-REPORT.md`'s reported counts (372/372 tests, 19 test
files, exit 0) match my own independent fresh run exactly, including the
same test-file list and the same 13-test SQL Server suite. No discrepancy
found between claimed and observed evidence.

## Cleanup confirmation

`git status --short` after removing my throwaway probe file
(`__reviewer_probe.test.ts`) shows no residue beyond this review report
itself.

## Approval status

**APPROVED**

No Critical or Important findings. Both Minor findings are implementer-
disclosed, independently confirmed accurate, and non-blocking for this
task's actual scope. Read-only enforcement was independently verified
against the live container with fresh, non-reused adversarial probes,
confirmed server-side (not just client-side) for every attempt. The
carried-forward M-05 finding is genuinely resolved, independently
reproduced with variants beyond the implementer's own test. Credential
handling matches `AGENTS.md`'s no-inline-credentials rule. No test skip
hides a real failure — the skip path is explicit, visible, and correctly
gated. Fresh `npm run verify` inside WSL2 matches the implementer's
claimed 372/372 exactly.
