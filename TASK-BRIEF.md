# ParityLens — Task Brief T-07

## Objective

Implement column profiling: compute general, string-specific, numeric-specific,
date/timestamp-specific, and boolean/categorical metrics for a single column
(per `Idea Prompt.md` "Layer 4: Data Profiling"), and compare two profiles
(source vs target) to produce severity-scored `ProfileDifference[]` findings
that highlight meaningful changes rather than merely displaying two profiles
side by side.

## Dependencies

- **Required completed tasks:** T-05 (canonical type-mapping layer) —
  COMPLETE and APPROVED. Profiling logic branches by canonical type category
  (numeric metrics for Integer/Decimal/FloatingPoint, string metrics for
  String, etc.), consuming T-05's `mapNativeType`.
- **Required decisions or approvals:** `DESIGN-SPEC.md` names profiling as
  Comparison Core scope. `Idea Prompt.md`'s "Layer 4" section and its
  `STATUS` column worked example (distinct values, null percentage, most
  common value, new/missing target values) is the shape this task's
  comparison output must satisfy.

## Files owned

- `packages/engine/src/comparison-core/profiling/**`

Do not touch `packages/shared/**` except `ProfileDifference` in
`packages/shared/src/result.ts` (you are the designated owner of refining
that specific shape, per `IMPLEMENTATION-PLAN.md`'s T-07 row — same pattern
T-06 used for `SchemaDifference`). Do not touch
`packages/engine/src/connector-sdk/**` or
`packages/engine/src/comparison-core/type-mapping/**` or
`packages/engine/src/comparison-core/schema-diff/**` (T-05/T-06's files —
consume via their exports, do not modify).

## Interfaces

| Direction | Interface | Contract | Producer or consumer |
| --- | --- | --- | --- |
| Consumed | `ColumnDefinition`, `DataPlatformConnector.executeQuery` (T-02) | As defined in `packages/shared/src` | `packages/shared` |
| Consumed | `mapNativeType` (T-05) | Used to decide which metric family applies to a column (numeric vs string vs date vs boolean) | `packages/engine/src/comparison-core/type-mapping/type-mapping.ts` |
| Consumed | `FixtureConnector` + seed fixtures (T-04) | Test input: profile a fixture column with known null/distinct counts (e.g. `sqlserver-customer`'s duplicated/differing rows) and assert the computed profile matches hand-verified expected counts | `packages/engine/src/connector-sdk/fixture/**` |
| Produced | `profileColumn(connector: DataPlatformConnector, column: ColumnDefinition, options?: ProfileOptions): Promise<ColumnProfile>` | General metrics (row count, populated count, null count/percentage, distinct count, duplicate count) for every column; branches into string metrics (empty/whitespace-only counts, min/max/avg length, case distribution) for String-category columns, numeric metrics (min/max/mean/median/stddev, zero/negative/positive counts) for Integer/Decimal/FloatingPoint-category columns, date/timestamp metrics (earliest/latest, future-date count, null count) for Date/Time/Timestamp-category columns, and boolean/categorical metrics (count/percentage by value, cardinality) for Boolean-category columns | Consumed by T-09 (orchestration planner) |
| Produced | `compareProfiles(source: ColumnProfile, target: ColumnProfile): ProfileDifference[]` | Highlights meaningful changes (per `Idea Prompt.md`'s STATUS example: distinct-value-count change, null-percentage change, most-common-value change, new/missing categorical values) rather than a flat side-by-side dump. Each finding carries a severity | Consumed by T-09 |

## Prohibited changes

- Do not implement schema diff (T-06, done), volume/aggregate comparison
  (T-13), or row-level comparison (T-14).
- Only touch `ProfileDifference` in `packages/shared/src/result.ts` — leave
  `SchemaDifference` (T-06, now a real shape), `AggregateDifference`,
  `RowDifference`, and `Severity` untouched.
- Do not modify `packages/engine/src/comparison-core/type-mapping/**` or
  `packages/engine/src/comparison-core/schema-diff/**` (T-05/T-06's files).
- Do not modify `packages/engine/src/connector-sdk/**`.
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Test or check to add:** A focused Vitest test running `profileColumn`
  against a column from the T-04 `sqlserver-customer` fixture with known,
  hand-counted null/distinct values, asserting the computed profile matches
  exactly. A second test running `compareProfiles` on two profiles with a
  deliberately different most-common-value, asserting the comparison
  surfaces that specific change (mirroring `Idea Prompt.md`'s STATUS
  worked example structure) rather than just returning both profiles
  unexamined.
- **Command:** `npx vitest run packages/engine`
- **Expected failure reason:** `profileColumn` and `compareProfiles` do not
  exist yet.
- **Captured output:** Exact command output and exit code, pasted into
  `IMPLEMENTATION-REPORT.md`.

## Green-state and full verification

- **Focused command:** `npx vitest run packages/engine`
- **Full command:** `npm run verify`
- **Expected evidence:** Focused command passes: profile computation
  matches hand-verified counts for at least one fixture column per
  canonical type family (String, Integer/Decimal, Timestamp, Boolean);
  profile comparison correctly surfaces meaningful changes. Full command
  passes with exit code 0, no regression in the existing 240 tests.

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md` (project root)
- **Independent reviewer:** A separate Claude Code subagent instance, dispatched by the Lead Orchestrator, distinct from the T-07 implementer subagent. The reviewer must independently hand-verify at least one profile's counts against the actual fixture data, not trust the report's arithmetic.
- **Review report location:** `REVIEW-REPORT.md` (project root)
- **Commit or patch checkpoint:** Branch `task/T-07-profiling`
