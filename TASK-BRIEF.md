# ParityLens — Task Brief T-05

## Objective

Implement the canonical type-mapping layer: map native database types
(observed from the T-04 fixture connector's `ColumnDefinition.nativeType`
values, and declared type catalogs for the three MVP real platforms) into
the canonical type-category enum defined in T-02 (`Integer`, `Decimal`,
`FloatingPoint`, `Boolean`, `String`, `Binary`, `Date`, `Time`, `Timestamp`,
`TimestampWithTimezone`, `JSON`, `Array`, `Object`, `Geospatial`,
`Unknown`), so that types like `INT`, `INTEGER`, `NUMBER(10,0)`, and
`BIGINT` can be compared intelligently rather than by name alone.

## Dependencies

- **Required completed tasks:** T-03 (statement-safety parser) — COMPLETE
  and APPROVED. T-04 (DuckDB fixture connector) — COMPLETE and APPROVED;
  its three fixture pairs (`sqlserver-customer`, `snowflake-orders`,
  `postgres-products`) are the primary test data for this task's mapping
  table.
- **Required decisions or approvals:** `DESIGN-SPEC.md` names this
  component ("Comparison Core", canonical type mapping) as approved scope.
  `Idea Prompt.md` section 2 gives the worked example this task must
  satisfy: `INT`/`NUMBER(38,0)`→Integer compatible, `VARCHAR(100)`/
  `VARCHAR(255)`→String compatible, `DATETIME`/`TIMESTAMP_NTZ`→Review,
  `BIT`/`BOOLEAN`→Boolean compatible, `MONEY`/`FLOAT`→Risk.

## Files owned

- `packages/engine/src/comparison-core/type-mapping/**`

Do not touch `packages/shared/**`,
`packages/engine/src/connector-sdk/**` (T-03/T-04's files), or any other
`packages/engine/src/comparison-core/**` subdirectory (those belong to
later tasks T-06/T-07/T-12/T-13/T-14/T-20/T-21).

## Interfaces

| Direction | Interface | Contract | Producer or consumer |
| --- | --- | --- | --- |
| Consumed | `ColumnDefinition`, canonical `CanonicalTypeCategory` enum (T-02) | As defined in `packages/shared/src/types.ts` | `packages/shared` |
| Consumed | `FixtureConnector` + seed fixtures (T-04) | Used as realistic test input: native types actually present in the three fixture pairs | `packages/engine/src/connector-sdk/fixture/**`, `packages/engine/fixtures/**` |
| Produced | `mapNativeType(nativeType: string, platform: SqlDialect): CanonicalTypeCategory` | Maps a native type string (e.g. `"NUMBER(38,0)"`, `"DATETIME2"`, `"VARCHAR(255)"`) plus its originating platform to exactly one canonical category. Must handle at least: integer variants (INT, INTEGER, BIGINT, SMALLINT, NUMBER(p,0)), decimal/numeric variants (DECIMAL, NUMERIC, MONEY, NUMBER(p,s) with s>0), floating-point variants (FLOAT, REAL, DOUBLE), boolean variants (BIT, BOOLEAN), string variants (VARCHAR, CHAR, TEXT, STRING), date/time/timestamp variants (DATE, TIME, DATETIME, DATETIME2, TIMESTAMP, TIMESTAMP_NTZ, TIMESTAMP_TZ), and a documented `Unknown` fallback for anything unrecognized (never throw on an unrecognized type) | Consumed by T-06 (schema diff), T-07 (profiling) |
| Produced | `TypeCompatibility` classification: `compareCanonicalTypes(source: CanonicalTypeCategory, target: CanonicalTypeCategory): 'Compatible' \| 'Review' \| 'Risk'` | Matches the three-tier classification from `Idea Prompt.md` section 2's worked example | Consumed by T-06 (schema diff severity assignment) |

## Prohibited changes

- Do not implement schema diff, profiling, or any other Comparison Core
  submodule — only the type-mapping/compatibility primitive.
- Do not modify `packages/shared/**` (if a shape gap is found in the
  `CanonicalTypeCategory` enum, request a revised task brief rather than
  editing T-02's files).
- Do not modify `packages/engine/src/connector-sdk/**`.
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Test or check to add:** A focused Vitest test asserting
  `mapNativeType("NUMBER(38,0)", "snowflake")` returns `Integer`, matching
  `Idea Prompt.md` section 2's worked example, plus a matrix covering the
  other four worked-example pairs (VARCHAR(100)/VARCHAR(255)→String,
  DATETIME/TIMESTAMP_NTZ→Timestamp category with Review compatibility,
  BIT/BOOLEAN→Boolean, MONEY/FLOAT→Decimal vs FloatingPoint with Risk
  compatibility).
- **Command:** `npx vitest run packages/engine`
- **Expected failure reason:** `mapNativeType` and `compareCanonicalTypes`
  do not exist yet.
- **Captured output:** Exact command output and exit code, pasted into
  `IMPLEMENTATION-REPORT.md`.

## Green-state and full verification

- **Focused command:** `npx vitest run packages/engine`
- **Full command:** `npm run verify`
- **Expected evidence:** Focused command passes, including all five worked
  examples from `Idea Prompt.md` section 2 reproduced exactly (Compatible/
  Review/Risk classifications matching the doc's table), plus test cases
  covering native types actually observed in the T-04 fixture pairs. Full
  command passes with exit code 0, no regression in the existing 160
  tests.

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md` (project root)
- **Independent reviewer:** A separate Claude Code subagent instance, dispatched by the Lead Orchestrator, distinct from the T-05 implementer subagent. The reviewer must independently re-derive at least the five `Idea Prompt.md` section 2 worked examples and confirm the classifications match exactly, not just trust the report's claim.
- **Review report location:** `REVIEW-REPORT.md` (project root)
- **Commit or patch checkpoint:** Branch `task/T-05-type-mapping`
