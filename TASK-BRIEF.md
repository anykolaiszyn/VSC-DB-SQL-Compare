# ParityLens — Task Brief T-03

## Objective

Implement the statement-safety parser in the Connector SDK: given a raw SQL
statement and a target dialect, reject the statement if it contains
INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, MERGE, or an equivalent
platform-specific mutating construct, before any statement reaches a
database driver.

## Dependencies

- **Required completed tasks:** T-02 (canonical shared types) — COMPLETE and
  APPROVED.
- **Required decisions or approvals:** `DESIGN-SPEC.md` security section
  (approved): "hard block + parse check" query-safety posture. This task
  implements that approved decision; it does not revisit it.

## Files owned

- `packages/engine/src/connector-sdk/safety/**`

Do not touch `packages/shared/**`, `packages/extension/**`, or any other
`packages/engine/**` path. `packages/engine/src/index.ts` (the T-01
placeholder) may be updated only to re-export this module's public API if
needed — record if you do this.

## Interfaces

| Direction | Interface | Contract | Producer or consumer |
| --- | --- | --- | --- |
| Consumed | `QueryInput` (from `@paritylens/shared`) | Discriminated union on `kind`: `table` / `query` / `sqlFile`, as defined in T-02 | `packages/shared/src/types.ts` |
| Produced | `assertReadOnlyStatement(sql: string, dialect: SqlDialect): void` | Throws a typed error (e.g. `MutatingStatementError`) if `sql` contains a mutating statement for the given dialect; returns normally otherwise. Must handle SQL comments and multi-statement batches (a mutating statement hidden after a `--` comment or inside a later batched statement must still be caught). | Consumed by T-04 (Fixture connector), T-17/T-18/T-19 (real connectors) — every connector's `executeQuery` must call this before executing |
| Produced | `SqlDialect` type | At minimum covers `'sqlserver' \| 'snowflake' \| 'postgres' \| 'duckdb'` (the four platforms in scope per `DESIGN-SPEC.md`) | Consumed by connector implementations |

## Prohibited changes

- Do not implement any actual connector (SQL Server, Snowflake, PostgreSQL,
  or the DuckDB fixture connector) — this task is the safety-parsing
  primitive only, to be consumed by T-04/T-17/T-18/T-19.
- Do not modify `packages/shared/**` (if a shape gap is found, request a
  revised task brief rather than editing T-02's files directly).
- Do not add a database driver dependency.
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Test or check to add:** A focused Vitest test file asserting that
  `assertReadOnlyStatement` throws for a representative matrix of mutating
  statements across all four dialects (`DROP TABLE x`, `DELETE FROM x`,
  `UPDATE x SET y = 1`, `INSERT INTO x VALUES (1)`, `TRUNCATE TABLE x`,
  `ALTER TABLE x ADD y INT`, `MERGE INTO x ...`), plus at least one evasion
  attempt (a mutating statement preceded by a `--` line comment, and a
  multi-statement batch where the mutating statement is not first), and
  asserts it does NOT throw for representative safe statements (`SELECT * FROM x`, a CTE-wrapped `SELECT`, a `SHOW`/`DESCRIBE`-style
  statement).
- **Command:** `npx vitest run packages/engine`
- **Expected failure reason:** `assertReadOnlyStatement` does not exist yet.
- **Captured output:** Exact command output and exit code, pasted into
  `IMPLEMENTATION-REPORT.md`.

## Green-state and full verification

- **Focused command:** `npx vitest run packages/engine`
- **Full command:** `npm run verify`
- **Expected evidence:** Focused command passes with every matrix case
  (including the evasion attempts) correctly classified; full command
  passes with exit code 0 across all workspaces.

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md` (project root)
- **Independent reviewer:** A separate Claude Code subagent instance, dispatched by the Lead Orchestrator, distinct from the T-03 implementer subagent. Given this task's security-sensitive nature (it is the primary defense against accidental data mutation), the reviewer must specifically attempt to find a bypass the test matrix missed.
- **Review report location:** `REVIEW-REPORT.md` (project root)
- **Commit or patch checkpoint:** Branch `task/T-03-statement-safety`
