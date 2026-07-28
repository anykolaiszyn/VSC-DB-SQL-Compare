# ParityLens — Task Brief T-06

## Objective

Implement schema diff: compare two `ColumnDefinition[]` sets (source and
target) across column count, name, order, native type, normalized/canonical
type, length, precision, scale, and nullability, and produce severity-scored
`SchemaDifference[]` findings, matching `Idea Prompt.md` section 2's worked
example.

## Dependencies

- **Required completed tasks:** T-05 (canonical type-mapping layer) —
  COMPLETE and APPROVED.
- **Required decisions or approvals:** `DESIGN-SPEC.md` acceptance
  criterion 1 (schema comparison against fixtures must produce a correct
  structural diff for a deliberately mismatched pair). This task must
  explicitly resolve open finding **M-07** from the T-05 review (see below)
  — this is not optional cleanup, it is part of this task's required scope.

### M-07 — required design decision (carried forward from T-05 review)

T-05's `compareCanonicalTypes` treats same-category Timestamp/Timestamp
(and Time/Time) pairs as `Review` instead of `Compatible`, specifically to
reproduce `Idea Prompt.md`'s DATETIME/TIMESTAMP_NTZ example. The T-05
reviewer confirmed this also flags two **genuinely identical** native
timestamp types (e.g. `DATETIME2` vs `DATETIME2` on both sides) as `Review`
when they should be `Compatible`. This task must resolve that: when this
task's schema-diff logic calls `compareCanonicalTypes` (from T-05,
consumed as-is — do not modify T-05's file), it must special-case an
identical native-type-string pair on both sides to short-circuit straight
to `Compatible` severity, before falling through to
`compareCanonicalTypes`'s category-level classification for genuinely
different native types. Document this decision and the reasoning in the
implementation report, and add a focused test proving identical native
types on both sides produce `Compatible`, not `Review`.

## Files owned

- `packages/engine/src/comparison-core/schema-diff/**`

Do not touch `packages/shared/**`, `packages/engine/src/connector-sdk/**`,
or `packages/engine/src/comparison-core/type-mapping/**` (T-05's files —
consume via its exported `mapNativeType`/`compareCanonicalTypes`, do not
modify).

## Interfaces

| Direction | Interface | Contract | Producer or consumer |
| --- | --- | --- | --- |
| Consumed | `ColumnDefinition[]` (T-02) | As defined in `packages/shared/src/types.ts` | `packages/shared` |
| Consumed | `mapNativeType`, `compareCanonicalTypes` (T-05) | As defined in `packages/engine/src/comparison-core/type-mapping/type-mapping.ts` | `packages/engine/src/comparison-core/type-mapping/**` |
| Consumed | `Severity` union, `SchemaDifference` shape (T-02) | `SchemaDifference` is currently a thin alias of `DifferenceItem{severity,message}` (tracked as open finding M-04) — this task should refine `SchemaDifference` with the specific fields a schema diff needs (e.g. columnName, sourceType, targetType, kind of mismatch) while keeping `severity` compatible with the `Severity` union | `packages/shared/src/result.ts` |
| Consumed | `FixtureConnector` + seed fixtures (T-04) | Used as test input: the `sqlserver-customer` fixture pair's documented schema mismatch (dropped `CreditLimit` column) is the primary acceptance-criterion-1 test case | `packages/engine/src/connector-sdk/fixture/**`, `packages/engine/fixtures/**` |
| Produced | `compareSchemas(source: ColumnDefinition[], target: ColumnDefinition[], expectations?: SchemaExpectations): SchemaDifference[]` | Compares column count, name, order, native+normalized type (via T-05), length, precision, scale, nullability. Each finding carries a severity (Pass/Informational/Warning/Failure/Error per `DESIGN-SPEC.md`'s severity model). A missing-target-column defaults to `Failure` severity per `Idea Prompt.md` section 12's example, unless overridden by `expectations` | Consumed by T-09 (orchestration planner) |

## Prohibited changes

- Do not implement profiling, volume, aggregate, or row-level comparison —
  schema diff only.
- Do not modify `packages/shared/**` directly — if refining
  `SchemaDifference` requires a shape change, make the change and document
  it clearly as this task's contribution to that shared type (this task IS
  the designated owner resolving M-04 for the schema-diff shape
  specifically, per `IMPLEMENTATION-PLAN.md`'s T-06 row), but do not touch
  `ProfileDifference`/`AggregateDifference`/`RowDifference` — those remain
  for T-07/T-13/T-14 to refine.
- Do not modify `packages/engine/src/comparison-core/type-mapping/**`
  (T-05's files).
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Test or check to add:** A focused Vitest test running `compareSchemas`
  against the T-04 `sqlserver-customer` fixture pair's actual schemas,
  asserting the dropped `CreditLimit` column produces a `Failure`-severity
  (or equivalent) finding — this directly proves `DESIGN-SPEC.md`
  acceptance criterion 1. A second test proves the M-07 resolution:
  identical native types on both sides produce no finding (or a
  `Compatible`/no-severity result), not a spurious `Review`.
- **Command:** `npx vitest run packages/engine`
- **Expected failure reason:** `compareSchemas` does not exist yet.
- **Captured output:** Exact command output and exit code, pasted into
  `IMPLEMENTATION-REPORT.md`.

## Green-state and full verification

- **Focused command:** `npx vitest run packages/engine`
- **Full command:** `npm run verify`
- **Expected evidence:** Focused command passes, including the fixture-based
  acceptance-criterion-1 test and the M-07 resolution test; a matching-schema
  case produces zero findings. Full command passes with exit code 0, no
  regression in the existing 229 tests.

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md` (project root)
- **Independent reviewer:** A separate Claude Code subagent instance, dispatched by the Lead Orchestrator, distinct from the T-06 implementer subagent. The reviewer must verify against `DESIGN-SPEC.md` acceptance criterion 1 using the actual T-04 fixture mismatch, and must specifically confirm M-07 is genuinely resolved (identical native types no longer produce a spurious Review finding) without breaking the original DATETIME/TIMESTAMP_NTZ Review example from T-05.
- **Review report location:** `REVIEW-REPORT.md` (project root)
- **Commit or patch checkpoint:** Branch `task/T-06-schema-diff`
