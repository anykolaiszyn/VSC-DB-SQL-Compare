# ParityLens — Task Brief T-09

## Objective

Implement the Orchestration API's run planner for Phase-1 checks only
(connectivity, schema, profile): `runComparison(definition: ParityDefinition): Promise<ComparisonResult>`.
It resolves a parsed `ParityDefinition`, obtains connectors for the named
source/target connections, tests connectivity, runs schema comparison
(T-06) and — if the definition's `checks.profile.enabled` is true — column
profiling and profile comparison (T-07), and assembles a `ComparisonResult`
matching the shape from `Idea Prompt.md` section 11.

## Dependencies

- **Required completed tasks:** T-06 (schema diff), T-07 (column
  profiling), T-08 (definition parser), T-08a (credential-blocklist
  hardening) — all COMPLETE and APPROVED.
- **Required decisions or approvals:** This is Phase 1 scope only per
  `IMPLEMENTATION-PLAN.md`'s T-09 row: **volume and row-level checks are
  explicitly out of scope** (that is T-15's job, once T-13/T-14 exist).
  `checks.row_count` and `checks.row_level` in the parsed definition must be
  recognized as valid fields (so parsing doesn't reject them) but this
  task's planner must NOT execute them yet — leave `rowCounts` and
  `rowDifferences` on the result empty/default and do not attempt volume or
  row-level logic.

### Connection resolution scope for this task (Phase 1 boundary)

`ParityDefinition.source.connection` and `.target.connection` are named
string references (per T-08). This task must resolve a connection name to
an actual `DataPlatformConnector` instance. For this task's scope, the only
connector implementation that exists is the **T-04 Fixture connector** —
real connectors (T-17/T-18/T-19) do not exist yet. Implement connection
resolution as an injectable/pluggable registry (e.g. a
`ConnectorRegistry`/`Map<string, DataPlatformConnector>` passed into
`runComparison` or constructed by the caller) so that real connectors can
be registered later without changing this task's core planning logic. Do
not hard-code Fixture-connector-specific behavior into the planner itself
— the planner must only depend on the `DataPlatformConnector` interface.

## Files owned

- `packages/engine/src/orchestration/planner/**`

Do not touch `packages/shared/**`,
`packages/engine/src/connector-sdk/**`,
`packages/engine/src/comparison-core/**`, or
`packages/engine/src/orchestration/definition/**` (T-03/T-04/T-05/T-06/T-07/T-08/T-08a's
files — consume via their exports, do not modify).

## Interfaces

| Direction | Interface | Contract | Producer or consumer |
| --- | --- | --- | --- |
| Consumed | `ParityDefinition`, `parseDefinition` (T-08/T-08a) | As defined in `packages/engine/src/orchestration/definition/definition.ts` | `packages/engine/src/orchestration/definition/**` |
| Consumed | `compareSchemas` (T-06) | As defined in `packages/engine/src/comparison-core/schema-diff/schema-diff.ts` | `packages/engine/src/comparison-core/schema-diff/**` |
| Consumed | `profileColumn`, `compareProfiles` (T-07) | As defined in `packages/engine/src/comparison-core/profiling/profiling.ts` | `packages/engine/src/comparison-core/profiling/**` |
| Consumed | `DataPlatformConnector`, `ComparisonResult` (T-02) | As defined in `packages/shared/src` | `packages/shared` |
| Consumed | `FixtureConnector` + seed fixtures (T-04) | Used as the connector implementation for this task's integration tests | `packages/engine/src/connector-sdk/fixture/**` |
| Produced | `runComparison(definition: ParityDefinition, connectors: ConnectorRegistry): Promise<ComparisonResult>` | Resolves `definition.source.connection`/`.target.connection` via the registry, tests connectivity (Layer 1 per `Idea Prompt.md` — a connectivity failure short-circuits the run with a `failed` status before schema/profile checks run), runs `compareSchemas` if `checks.schema.enabled`, runs `profileColumn`+`compareProfiles` per mapped column if `checks.profile.enabled`, and assembles the final `ComparisonResult` (`comparison`, `runId`, `status`, `summary.{passed,warnings,failed}` computed from the collected findings' severities, `schemaDifferences`, `profileDifferences`, `execution.{sourceDurationMs,targetDurationMs,comparisonDurationMs}`). `rowCounts`, `aggregateDifferences`, and `rowDifferences` remain empty/default (Phase 2/3 scope) | Consumed by T-11 (results webview), T-15 (extends this planner later) |

## Prohibited changes

- Do not implement volume, aggregate, or row-level checks — Phase 1 only
  (schema + profile).
- Do not modify `packages/shared/**`,
  `packages/engine/src/connector-sdk/**`,
  `packages/engine/src/comparison-core/**`, or
  `packages/engine/src/orchestration/definition/**`.
- Do not hard-code the Fixture connector into the planner's core logic —
  depend only on the `DataPlatformConnector` interface, with the Fixture
  connector wired in via the registry at the test/call-site level.
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Test or check to add:** A focused Vitest test running
  `runComparison` against a `ParityDefinition` parsed from a YAML string
  referencing the T-04 `sqlserver-customer` fixture pair (source and
  target both resolved via a `ConnectorRegistry` populated with
  `FixtureConnector` instances), with `checks.schema.enabled: true`,
  asserting the resulting `ComparisonResult.schemaDifferences` contains the
  known dropped-`CreditLimit`-column finding (same underlying fact T-06
  already proved, now proven end-to-end through the full pipeline).
- **Command:** `npx vitest run packages/engine`
- **Expected failure reason:** `runComparison` does not exist yet.
- **Captured output:** Exact command output and exit code, pasted into
  `IMPLEMENTATION-REPORT.md`.

## Green-state and full verification

- **Focused command:** `npx vitest run packages/engine`
- **Full command:** `npm run verify`
- **Expected evidence:** Focused command passes: the end-to-end schema-diff
  case from Red-state evidence passes; a second case with
  `checks.profile.enabled: true` produces populated `profileDifferences`;
  a connectivity-failure case (e.g. an unregistered connection name)
  produces a `failed`-status result without attempting schema/profile
  checks. Full command passes with exit code 0, no regression in the
  existing 279 tests.

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md` (project root)
- **Independent reviewer:** A separate Claude Code subagent instance, dispatched by the Lead Orchestrator, distinct from the T-09 implementer subagent. The reviewer must confirm the assembled `ComparisonResult` shape matches `Idea Prompt.md` section 11 exactly, that Phase 2/3 fields are genuinely left empty rather than partially/incorrectly populated, and that the planner has no Fixture-connector-specific coupling (only depends on `DataPlatformConnector`).
- **Review report location:** `REVIEW-REPORT.md` (project root)
- **Commit or patch checkpoint:** Branch `task/T-09-orchestration-phase1`
