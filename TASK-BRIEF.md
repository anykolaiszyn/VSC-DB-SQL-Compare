# ParityLens — Task Brief T-02

## Objective

Define the canonical shared TypeScript types in `packages/shared`: the
`DataPlatformConnector` interface, `ConnectorCapabilities`,
`ColumnDefinition`, `QueryInput`, `ExecutionOptions`, `RecordBatch`, the
canonical type-category enum (Integer, Decimal, FloatingPoint, Boolean,
String, Binary, Date, Time, Timestamp, TimestampWithTimezone, JSON, Array,
Object, Geospatial, Unknown), and the `ComparisonResult` shape (and its
sub-shapes: schema/profile/aggregate/row differences, execution timing, and
summary counts). No runtime logic — types and interfaces only.

## Dependencies

- **Required completed tasks:** T-01 (npm workspaces monorepo, TypeScript
  strict, `npm run verify`) — COMPLETE and APPROVED (see
  `PROGRESS-LEDGER.md`).
- **Required decisions or approvals:** `IMPLEMENTATION-PLAN.md` approved
  2026-07-27, T-02 row. `DESIGN-SPEC.md` Architecture and component
  contracts section (approved) defines which components consume/produce
  these types.

## Files owned

- `packages/shared/src/**` (all files under this path; may organize into
  submodules, e.g. `connector.ts`, `types.ts`, `result.ts`, `index.ts`
  re-exporting the public surface — implementer's choice, record the
  structure chosen in the implementation report)

Do not touch `packages/engine/**`, `packages/extension/**`, or any root
config file from T-01.

## Interfaces

| Direction | Interface | Contract | Producer or consumer |
| --- | --- | --- | --- |
| Consumed | `npm run verify` (T-01) | Must continue to pass unmodified in meaning after this task's changes | Root tooling from T-01 |
| Produced | `DataPlatformConnector` interface | Matches `Idea Prompt.md` section 9 exactly: `testConnection()`, `getCatalogs()`, `getSchemas()`, `getObjects()`, `getSchema()`, `executeQuery()` returning `AsyncIterable<RecordBatch>`, `getCapabilities()`, `quoteIdentifier()`, `buildProfileQuery()` | Consumed by T-03 (safety parser wraps `executeQuery`), T-04 (Fixture connector implements it), T-17/T-18/T-19 (real connectors implement it) |
| Produced | `ConnectorCapabilities` interface | Matches `Idea Prompt.md` section 9: `supportsApproximateDistinct`, `supportsNativeHashing`, `supportsTableSampling`, `supportsQueryCancellation`, `supportsArrowResults`, `supportsInformationSchema`, `supportsTemporaryTables`, `supportsServerSideProfiling`, optional `maximumParameters` | Consumed by every connector implementation (T-04, T-17, T-18, T-19) |
| Produced | Canonical type-category enum | The 15 categories listed in the Objective above, matching `Idea Prompt.md` section 2 | Consumed by T-05 (type-mapping layer) |
| Produced | `ColumnDefinition` | Native type, normalized/canonical type, length, precision, scale, nullability, name, ordinal position, primary-key-candidate flag | Consumed by T-05, T-06, T-07, T-08, T-12 |
| Produced | `QueryInput`, `ExecutionOptions`, `RecordBatch` | Shapes needed by `DataPlatformConnector.executeQuery` and `buildProfileQuery` | Consumed by T-03, T-04, T-07, T-17, T-18, T-19 |
| Produced | `ComparisonResult` and sub-shapes | Matches `Idea Prompt.md` section 11 exactly: `comparison`, `runId`, `status`, `summary` (passed/warnings/failed), `rowCounts`, `schemaDifferences`, `profileDifferences`, `aggregateDifferences`, `rowDifferences`, `execution` (durations) | Consumed by T-09 (planner assembles it), T-11/T-16 (webview renders it) |

## Prohibited changes

- Do not implement any connector, parser, or comparison logic — types and
  interfaces only. A type-check test may exercise the shapes, but no
  business logic belongs in `packages/shared`.
- Do not modify `packages/engine/**` or `packages/extension/**`.
- Do not modify any T-01-owned root config file (`package.json`,
  `tsconfig*.json`, `eslint.config.mjs`, `vitest.config.ts`, `.gitignore`)
  except to add `packages/shared` as a normal workspace member if not
  already wired (it already is, from T-01 — verify, don't re-scaffold).
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Test or check to add:** A focused Vitest test file in
  `packages/shared/src/**.test.ts` that imports `DataPlatformConnector`,
  `ConnectorCapabilities`, `ColumnDefinition`, the canonical type enum, and
  `ComparisonResult`, and asserts on their shape (e.g. constructs a minimal
  conforming object literal for each and checks required fields exist).
- **Command:** `npm run verify` (or a more focused `npx vitest run packages/shared` if the implementer wants a narrower focused command before the full one — record whichever is used)
- **Expected failure reason:** The types do not exist yet in
  `packages/shared/src` (only the T-01 placeholder `index.ts` exists) — the
  test fails to compile / import errors.
- **Captured output:** Exact command output and exit code, pasted into
  `IMPLEMENTATION-REPORT.md`.

## Green-state and full verification

- **Focused command:** `npx vitest run packages/shared` (or equivalent
  workspace-scoped invocation)
- **Full command:** `npm run verify`
- **Expected evidence:** Focused command passes with the new shape tests
  green; full command passes with exit code 0 across all three workspaces
  (unchanged behavior for `engine`/`extension`, which still only have
  placeholder content from T-01).

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md` (project root — overwrites T-01's; prior report content is preserved in git history on `main`)
- **Independent reviewer:** A separate Claude Code subagent instance, dispatched by the Lead Orchestrator, distinct from the T-02 implementer subagent
- **Review report location:** `REVIEW-REPORT.md` (project root — overwrites T-01's; prior report content is preserved in git history on `main`)
- **Commit or patch checkpoint:** Branch `task/T-02-shared-types`
