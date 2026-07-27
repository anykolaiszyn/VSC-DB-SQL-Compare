# ParityLens — Task Brief T-04

## Objective

Implement the DuckDB-backed Fixture connector implementing
`DataPlatformConnector` (from `@paritylens/shared`), including seed fixture
datasets with deliberately mismatched schema, volume, profile, and row-level
cases standing in for SQL Server-shaped, Snowflake-shaped, and
PostgreSQL-shaped data. This is the primary development/testing target for
every later engine task, since no real database instances are available
(per `PROJECT-BRIEF.md`).

## Dependencies

- **Required completed tasks:** T-02 (canonical shared types) — COMPLETE and
  APPROVED. T-03 (statement-safety parser) — COMPLETE and APPROVED; the
  Fixture connector's `executeQuery` must call `assertReadOnlyStatement`
  before executing anything, per `DESIGN-SPEC.md`'s read-only enforcement.
- **Required decisions or approvals:** `DESIGN-SPEC.md` "DuckDB-backed
  fixture connectors" decision (approved 2026-07-27): fixtures implement the
  same interface real connectors will implement, so no rework is needed
  when real connectors are validated later.

## Files owned

- `packages/engine/src/connector-sdk/fixture/**`
- `packages/engine/fixtures/**`

Do not touch `packages/shared/**` or
`packages/engine/src/connector-sdk/safety/**` (T-03's files — consume via
its public API, do not modify).

## Interfaces

| Direction | Interface | Contract | Producer or consumer |
| --- | --- | --- | --- |
| Consumed | `DataPlatformConnector` interface (T-02) | Must implement every method: `testConnection`, `getCatalogs`, `getSchemas`, `getObjects`, `getSchema`, `executeQuery`, `getCapabilities`, `quoteIdentifier`, `buildProfileQuery` | `packages/shared/src/connector.ts` |
| Consumed | `assertReadOnlyStatement` (T-03) | `FixtureConnector.executeQuery` must call this before running any generated SQL against DuckDB | `packages/engine/src/connector-sdk/safety/statement-safety.ts` |
| Produced | `FixtureConnector` class | A working, installable DuckDB-backed connector; constructible with a path to a seeded fixture dataset or a named fixture-set identifier | Consumed by every later engine task's tests (T-05 through T-09, T-12 through T-16, T-20, T-21) as the standard test double for a "real" platform |
| Produced | Seed fixture datasets | At minimum three named fixture pairs (one per platform shape: SQL Server-like, Snowflake-like, PostgreSQL-like), each with a "source" and "target" side containing at least one deliberate schema mismatch, one deliberate row-count/volume mismatch, and one deliberate row-level mismatch (missing row, duplicate row, differing value) | Consumed by T-05 (type-mapping test cases), T-06 (schema-diff acceptance criterion 1), T-14 (row-level acceptance criterion 2) |

## Prohibited changes

- Do not implement any real platform connector (SQL Server, Snowflake,
  PostgreSQL) — those are T-17/T-18/T-19.
- Do not modify `packages/shared/**` or T-03's safety module.
- Do not add a real database driver dependency (`mssql`, `snowflake-sdk`,
  `pg`) — DuckDB bindings only.
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Test or check to add:** A focused Vitest test asserting
  `FixtureConnector.testConnection()` succeeds and `getSchema()` returns a
  non-empty `ColumnDefinition[]` for a seeded fixture.
- **Command:** `npx vitest run packages/engine`
- **Expected failure reason:** `FixtureConnector` does not exist yet.
- **Captured output:** Exact command output and exit code, pasted into
  `IMPLEMENTATION-REPORT.md`.

## Green-state and full verification

- **Focused command:** `npx vitest run packages/engine`
- **Full command:** `npm run verify`
- **Expected evidence:** Focused command passes: `testConnection`,
  `getSchema`, and `executeQuery` all work against seeded fixture data for
  all three platform-shaped fixture pairs, and at least one attempted
  mutating statement against a fixture is rejected via T-03's parser. Full
  command passes with exit code 0 across all workspaces.

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md` (project root)
- **Independent reviewer:** A separate Claude Code subagent instance, dispatched by the Lead Orchestrator, distinct from the T-04 implementer subagent. The reviewer must confirm at least one deliberate mismatch per fixture pair actually exists and is verifiable (this fixture data is load-bearing evidence for acceptance criteria 1 and 2 in `DESIGN-SPEC.md`).
- **Review report location:** `REVIEW-REPORT.md` (project root)
- **Commit or patch checkpoint:** Branch `task/T-04-fixture-connector`
