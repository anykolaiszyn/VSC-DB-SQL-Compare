# ParityLens — Implementation Plan

## Plan controls

- **Approved design:** `DESIGN-SPEC.md` (approved 2026-07-27)
- **Plan owner:** alex.nykolaiszyn@gmail.com
- **Full verification command:** `npm run verify` (runs `tsc --noEmit` across
  all workspaces, `eslint .`, and `vitest run` across all workspaces) —
  defined as part of T-01 and required to pass, unmodified in meaning, for
  every subsequent task's full-verification step.
- **Branch or workspace policy:** One feature branch per task
  (`task/<TASK-ID>-<slug>`), merged to `main` only after independent review
  approval. No task branches from an unmerged sibling task except where a
  dependency explicitly requires it (see Dependency-ordered tasks). Tooling
  choice (confirmed 2026-07-27): npm workspaces monorepo with
  `packages/shared`, `packages/engine`, `packages/extension`; Vitest for
  tests, ESLint for linting, TypeScript strict mode.

## Human approval gates

| Trigger | Approval required before | Human approver | Approval record |
| --- | --- | --- | --- |
| Implementation plan approval | Starting T-01 | alex.nykolaiszyn@gmail.com | Recorded below once granted |
| Material scope changes | Changing approved deliverables, interfaces, constraints, or acceptance criteria | alex.nykolaiszyn@gmail.com | To be recorded in `PROGRESS-LEDGER.md` at time of change |
| Destructive or externally consequential actions | Deleting, overwriting, publishing, sending, deploying, charging, or changing external state | alex.nykolaiszyn@gmail.com | To be recorded in `PROGRESS-LEDGER.md` at time of action, with exact target and recovery plan |
| Security, privacy, or licensing assumptions | Changing a recorded data, security, privacy, dependency, or license assumption (e.g. the read-only enforcement or credential-storage rules in `AGENTS.md`/`DESIGN-SPEC.md`) | alex.nykolaiszyn@gmail.com | To be recorded in `PROGRESS-LEDGER.md` at time of change |
| Release readiness | Publishing or delivering a release candidate | alex.nykolaiszyn@gmail.com | To be recorded in `RELEASE-CHECKLIST.md` |

## Dependency-ordered tasks

Phase groupings below mirror `Idea Prompt.md` section 15 (Recommended
Development Phases), mapped onto the approved design's five components.

### Phase 0 — Foundation

| ID | Depends on | Objective | Files owned | Interfaces consumed | Interfaces produced | Focused red/green verification | Review gate | Commit or patch checkpoint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-01 | NONE | Scaffold the npm workspaces monorepo (`packages/shared`, `packages/engine`, `packages/extension`), TypeScript strict config, ESLint, Vitest, and the `npm run verify` script | `package.json`, `tsconfig*.json`, `.eslintrc*`, `vitest.config.*`, `packages/*/package.json`, `packages/*/tsconfig.json`, empty `packages/*/src/index.ts` placeholders | NONE | `npm run verify` command contract (tsc + eslint + vitest across workspaces) | Red: no `package.json` exists, `npm run verify` fails with "command not found". Green: `npm run verify` runs and passes against the empty scaffolded packages. Full: same command | Independent reviewer confirms workspace boundaries match the design's module boundary and no package deep-imports another's internals | Branch `task/T-01-scaffold` |
| T-02 | T-01 | Define the canonical shared types: `DataPlatformConnector`, `ConnectorCapabilities`, `ColumnDefinition`, `QueryInput`, `ExecutionOptions`, `RecordBatch`, canonical type-category enum (Integer/Decimal/.../Unknown), `ComparisonResult` and its sub-shapes (from idea doc section 11) | `packages/shared/src/**` | `npm run verify` contract from T-01 | `@paritylens/shared` package: exported TypeScript interfaces/types, no runtime logic | Red: a focused type-check test importing each interface fails to compile (types don't exist yet). Green: same test compiles and passes. Full: `npm run verify` | Independent reviewer confirms every interface named in `DESIGN-SPEC.md`'s Architecture table exists and matches the design's field-level contracts | Branch `task/T-02-shared-types` |

### Phase 1 — Schema and profile comparison (idea doc phase 1)

| ID | Depends on | Objective | Files owned | Interfaces consumed | Interfaces produced | Focused red/green verification | Review gate | Commit or patch checkpoint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-03 | T-02 | Implement the statement-safety parser: reject INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/MERGE and platform-specific mutating statements before any statement reaches a driver | `packages/engine/src/connector-sdk/safety/**` | `@paritylens/shared` `QueryInput` type | `assertReadOnlyStatement(sql: string, dialect): void` throwing on any mutating statement | Red: test asserting `DROP TABLE x` is rejected fails (function doesn't exist). Green: same test plus a matrix of mutating statements across SQL Server/Snowflake/Postgres/DuckDB dialects all rejected, non-mutating statements pass. Full: `npm run verify` | Independent reviewer attempts to find a bypass (e.g. comments, multi-statement batches, CTE-wrapped mutations) and confirms none succeed | Branch `task/T-03-statement-safety` |
| T-04 | T-02 | Implement the DuckDB-backed Fixture connector implementing `DataPlatformConnector`, including seed fixture datasets with deliberately mismatched schema/volume/profile/row cases for SQL Server-shaped, Snowflake-shaped, and PostgreSQL-shaped test data | `packages/engine/src/connector-sdk/fixture/**`, `packages/engine/fixtures/**` | `@paritylens/shared` connector interfaces | A working `FixtureConnector` usable by every later engine task's tests | Red: test instantiating `FixtureConnector` and calling `testConnection()` fails (class doesn't exist). Green: `testConnection`, `getSchema`, `executeQuery` all pass against seeded fixture data. Full: `npm run verify` | Independent reviewer confirms fixture data includes at least one deliberate mismatch per acceptance criterion 1 in `DESIGN-SPEC.md` (schema) | Branch `task/T-04-fixture-connector` |
| T-05 | T-03, T-04 | Implement the canonical type-mapping layer: map native types (from fixture + declared real-platform type catalogs) into the canonical category enum | `packages/engine/src/comparison-core/type-mapping/**` | `@paritylens/shared` `ColumnDefinition`, canonical enum | `mapNativeType(nativeType: string, platform): CanonicalType` | Red: test mapping `NUMBER(38,0)` (Snowflake) to `Integer` fails (function doesn't exist). Green: mapping table test covering all platforms' representative types passes. Full: `npm run verify` | Independent reviewer checks mapping table against idea doc section 2's example row (`INT`/`NUMBER(38,0)` compatible) | Branch `task/T-05-type-mapping` |
| T-06 | T-05 | Implement schema diff: column count/name/order/native+normalized type/length/precision/scale/nullability comparison, severity-scored per `DESIGN-SPEC.md` expectations model | `packages/engine/src/comparison-core/schema-diff/**` | Type-mapping output from T-05, `ColumnDefinition[]` from two connectors | `compareSchemas(source, target, expectations): SchemaDifference[]` | Red: test comparing two mismatched fixture schemas expecting a `Risk`-severity finding fails (function doesn't exist). Green: same test passes; a matching-schema case produces zero findings. Full: `npm run verify` | Independent reviewer verifies against acceptance criterion 1 in `DESIGN-SPEC.md` using the T-04 fixture mismatch | Branch `task/T-06-schema-diff` |
| T-07 | T-05 | Implement column profiling: general/string/numeric/date/boolean metrics per `Idea Prompt.md` section "Layer 4: Data Profiling", executed via pushdown query generation against a connector plus DuckDB local aggregation | `packages/engine/src/comparison-core/profiling/**` | `DataPlatformConnector.executeQuery`, `ColumnDefinition[]` | `profileColumn(connector, column, options): ColumnProfile` and `compareProfiles(source, target): ProfileDifference[]` | Red: test profiling a fixture column with known null/distinct counts fails (function doesn't exist). Green: same test's computed profile matches hand-verified expected counts. Full: `npm run verify` | Independent reviewer spot-checks profile output against the fixture's known data characteristics | Branch `task/T-07-profiling` |
| T-08 | T-02, T-04 | Implement the Parity YAML definition schema and parser (source/target/keys/column_mapping/exclude_columns/rules/checks per idea doc section 7), with validation rejecting inline credentials | `packages/engine/src/orchestration/definition/**` | `@paritylens/shared` types | `parseDefinition(yaml: string): ParityDefinition`, throwing on schema violations including any credential-shaped field | Red: test parsing a minimal valid YAML fails (parser doesn't exist); a second red case with an inline `password:` field must fail validation. Green: both cases behave correctly; a full example matching idea doc section 7 parses correctly. Full: `npm run verify` | Independent reviewer confirms the credential-rejection rule from `DESIGN-SPEC.md` security section is enforced, not just documented | Branch `task/T-08-definition-parser` |
| T-09 | T-06, T-07, T-08 | Implement the Orchestration API's run planner for Phase-1 checks only (connectivity, schema, profile): resolves a `ParityDefinition`, invokes connectors, assembles a `ComparisonResult` with `schemaDifferences` and `profileDifferences` populated | `packages/engine/src/orchestration/planner/**` | `ParityDefinition` from T-08, `compareSchemas` from T-06, profiling from T-07, `FixtureConnector` from T-04 | `runComparison(definition): Promise<ComparisonResult>` (schema + profile checks only at this stage) | Red: test running a full comparison against two fixture connectors expecting populated `schemaDifferences` fails (planner doesn't exist). Green: same test produces a `ComparisonResult` matching acceptance criterion 1. Full: `npm run verify` | Independent reviewer verifies the result object shape matches idea doc section 11 exactly | Branch `task/T-09-orchestration-phase1` |
| T-10 | NONE (parallel-safe with T-03 through T-09; depends only on T-01) | Extension scaffold: activation, command registration, Connections/Comparisons/Recent Runs tree view (empty state), SecretStorage wrapper for connection profiles | `packages/extension/src/activation/**`, `packages/extension/src/views/**`, `packages/extension/src/secrets/**` | `npm run verify` contract from T-01 | Extension activation entry point; `SecretStore` wrapper interface for later tasks to consume | Red: extension integration test asserting the tree view registers on activation fails (not implemented). Green: same test passes using `@vscode/test-electron`. Full: `npm run verify` | Independent reviewer confirms no credential ever touches `globalState`/`workspaceState`, only `SecretStorage` | Branch `task/T-10-extension-scaffold` |
| T-11 | T-09, T-10 | Results webview (Phase-1 scope): renders schema diff and profile comparison from a `ComparisonResult`; status bar summary | `packages/extension/src/webview/**`, `packages/extension/src/statusbar/**` | `ComparisonResult` shape from T-02/T-09 | Rendered webview panel; status bar item | Red: webview test asserting a schema difference renders as a table row fails (webview doesn't exist). Green: same test passes against a fixture `ComparisonResult`. Full: `npm run verify` | Independent reviewer confirms the webview only renders data passed to it (no direct connector/credential access from webview code) | Branch `task/T-11-results-webview-phase1` |

### Phase 2 — Keyed data comparison (idea doc phase 2)

| ID | Depends on | Objective | Files owned | Interfaces consumed | Interfaces produced | Focused red/green verification | Review gate | Commit or patch checkpoint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-12 | T-09 | Implement column mapping (automatic suggestion by exact/case-insensitive/snake-camel/ordinal matching, per idea doc section 3) and normalization rules (trim, case, whitespace, numeric tolerance, date truncation/timezone, null equivalents, per idea doc section 4) | `packages/engine/src/comparison-core/mapping/**`, `packages/engine/src/comparison-core/normalization/**` | `ColumnDefinition[]` from T-02, `ParityDefinition.rules` from T-08 | `suggestMappings(source, target): MappingSuggestion[]`, `applyNormalization(value, rule): NormalizedValue` | Red: test suggesting a mapping for `cust_nm` → `CUSTOMER_NAME` fails (function doesn't exist); a second red case for trimming/case-normalizing a value fails. Green: both pass against fixture data matching idea doc section 3's example. Full: `npm run verify` | Independent reviewer confirms normalization never mutates source data, only comparison-time values (per `DESIGN-SPEC.md` write-safety) | Branch `task/T-12-mapping-normalization` |
| T-13 | T-12 | Implement volume parity (row count, distinct count, duplicate/null key counts, tolerance evaluation per idea doc "Layer 3") | `packages/engine/src/comparison-core/volume/**` | Connector query execution, `ParityDefinition` tolerance config | `compareVolume(source, target, tolerance): VolumeDifference` | Red: test comparing fixture row counts expecting a `FAIL` result at a configured tolerance fails (function doesn't exist). Green: same test passes; an in-tolerance case passes as `PASS`. Full: `npm run verify` | Independent reviewer verifies against idea doc section 2's row-count example (percentage tolerance FAIL case) | Branch `task/T-13-volume-parity` |
| T-14 | T-12 | Implement row-level parity: key-based matching, classification (matching/missing-source/missing-target/duplicate-source/duplicate-target/differing/unable-to-compare/ignored), applying normalization from T-12 | `packages/engine/src/comparison-core/row-level/**` | Mapping/normalization from T-12, `ParityDefinition.keys` | `compareRows(source, target, keys, mapping): RowDifference[]` | Red: test classifying a hand-built fixture set (with known matching/missing/duplicate/differing rows) fails (function doesn't exist). Green: same test achieves 100% correct classification, satisfying `DESIGN-SPEC.md` acceptance criterion 2. Full: `npm run verify` | Independent reviewer independently re-verifies the classification against the hand-built expected set, not just re-running the same test | Branch `task/T-14-row-level` |
| T-15 | T-09, T-13, T-14 | Extend the Orchestration API planner to include volume and row-level checks in `runComparison`, honoring `checks.*.enabled` flags from the definition | `packages/engine/src/orchestration/planner/**` (extends T-09's ownership; sequenced after T-09 merges) | `compareVolume` from T-13, `compareRows` from T-14 | `ComparisonResult` with `rowCounts` and `rowDifferences` populated | Red: test running a full comparison with `row_level.enabled: true` expecting populated `rowDifferences` fails (planner doesn't route to T-14 yet). Green: same test passes end-to-end. Full: `npm run verify` | Independent reviewer confirms disabling a check in the definition actually skips it (no silent execution) | Branch `task/T-15-orchestration-phase2` |
| T-16 | T-11, T-15 | Extend the results webview and export module: full difference viewer (row-level table), CSV/JSON/Markdown export, SQL preview panel showing generated queries before execution | `packages/extension/src/webview/**` (extends T-11's ownership; sequenced after T-11 merges), `packages/extension/src/export/**` | `ComparisonResult` with Phase 2 fields from T-15 | Exported CSV/JSON/Markdown files under the safe output root; rendered SQL preview | Red: export test asserting a CSV file with expected row-difference columns is written fails (exporter doesn't exist). Green: same test passes and confirms the file is contained under the configured safe output root. Full: `npm run verify` | Independent reviewer confirms export paths cannot escape the safe output root (path traversal check) and SQL preview always appears before any real execution per `DESIGN-SPEC.md` | Branch `task/T-16-diff-viewer-export` |

### Phase 3 — Real connectors and scale (idea doc phases 3 and part of MVP connector scope)

| ID | Depends on | Objective | Files owned | Interfaces consumed | Interfaces produced | Focused red/green verification | Review gate | Commit or patch checkpoint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-17 | T-03, T-05 | Implement the SQL Server connector (`mssql`/Tedious) against `DataPlatformConnector`, including its native-type catalog for T-05's mapping and statement-safety integration from T-03 | `packages/engine/src/connector-sdk/sqlserver/**` | `@paritylens/shared` interfaces, `assertReadOnlyStatement` from T-03 | Working `SqlServerConnector` | Red: connection test against a local mssql test container (or documented skip-if-unavailable) fails (connector doesn't exist). Green: `testConnection`/`getSchema`/`executeQuery` pass against the available test target; statement-safety rejection confirmed. Full: `npm run verify` (integration tests may be marked environment-conditional, documented explicitly, not silently skipped) | Independent reviewer confirms read-only enforcement and credential handling match `AGENTS.md`; confirms no test skip hides a real failure | Branch `task/T-17-sqlserver-connector` |
| T-18 | T-03, T-05 | Implement the Snowflake connector (`snowflake-sdk`) against `DataPlatformConnector`, same requirements as T-17 | `packages/engine/src/connector-sdk/snowflake/**` | Same as T-17 | Working `SnowflakeConnector` | Same pattern as T-17, against a Snowflake target (trial account or documented skip-if-unavailable) | Same as T-17 | Branch `task/T-18-snowflake-connector` |
| T-19 | T-03, T-05 | Implement the PostgreSQL connector (`pg`) against `DataPlatformConnector`, same requirements as T-17 | `packages/engine/src/connector-sdk/postgres/**` | Same as T-17 | Working `PostgresConnector` | Same pattern as T-17, against a local Postgres test container | Same as T-17 | Branch `task/T-19-postgres-connector` |
| T-20 | T-14 | Implement hash-based comparison strategy (table/partition/key-range/row/column hash levels, progressive narrowing per idea doc "Strategy C") as an alternative to full row-level pull for large datasets | `packages/engine/src/comparison-core/hash-comparison/**` | Row-level matching contracts from T-14 | `compareByHash(source, target, level): HashComparisonResult` | Red: test comparing two fixture partitions by hash expecting a mismatch at partition 2 fails (function doesn't exist). Green: same test passes, matches idea doc's progressive-narrowing example structure. Full: `npm run verify` | Independent reviewer confirms hash comparison and full row-level comparison agree on the same fixture mismatch case | Branch `task/T-20-hash-comparison` |
| T-21 | T-07 | Implement sampling strategies (first-N, random, deterministic hash, stratified, date-window, key-range per idea doc "Strategy A") for use when row-level or profile checks are configured with a sample strategy | `packages/engine/src/comparison-core/sampling/**` | `QueryInput`/connector execution | `buildSampleQuery(strategy, input): GeneratedQuery` | Red: test requesting a deterministic-hash sample expecting reproducible row selection fails (function doesn't exist). Green: same test passes with two runs producing identical sample sets. Full: `npm run verify` | Independent reviewer confirms sampling never bypasses the row-cap/timeout safety limits from `DESIGN-SPEC.md` | Branch `task/T-21-sampling` |

## Execution rules

1. Start only the task identified as active in `PROGRESS-LEDGER.md` after all dependencies are approved.
2. Create a `TASK-BRIEF.md` from this plan with exact owned files, interfaces, and test commands.
3. Capture focused red-state evidence before the behavior change, then capture green-state evidence after it.
4. Write `IMPLEMENTATION-REPORT.md`, obtain an independent `REVIEW-REPORT.md`, and resolve every Critical or Important finding before advancing dependent work.
5. Record each checkpoint, decision, blocker, and verification result in `PROGRESS-LEDGER.md`.

## Interface change control

An interface change requires an updated design decision, revised task
ownership, and acknowledgement from every affected dependent task before
implementation. Material scope changes also require the recorded human
approval identified in the approval-gates table before implementation
resumes.

## Safe-parallelism note

Default execution is sequential, one active task per lane, per
`HANDBOOK.md`. Two lanes are pre-identified as genuinely independent and may
be run as an approved parallel batch, each with its own isolated worktree
and scoped ledger:

- **Engine lane:** T-01 → T-02 → (T-03, T-04 in parallel) → T-05 → T-06 → T-07
  → T-08 → T-09 → T-12 → T-13 → T-14 → T-15 → (T-17, T-18, T-19 in parallel)
  → T-20, T-21.
- **Extension lane:** T-01 → T-10 → (waits for T-09 before T-11; waits for
  T-15 before T-16).

T-17, T-18, and T-19 (the three real-platform connectors) have no ownership
overlap with each other and share only their dependency on T-03/T-05 — they
are the clearest approved-parallel-batch candidate once those dependencies
are merged. T-03 and T-04 similarly do not overlap in ownership and both
depend only on T-02. All other tasks are sequenced by real interface
dependency (a later task consumes an earlier task's produced interface) and
must not be started concurrently with what they depend on. No task pair
above shares file ownership; any future task added to this plan must
preserve that property or receive a revised brief before starting.

## Human approval record

- **Plan approved by:** alex.nykolaiszyn@gmail.com
- **Approval date:** 2026-07-27
