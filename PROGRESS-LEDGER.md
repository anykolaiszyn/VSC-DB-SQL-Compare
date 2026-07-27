# ParityLens — Progress Ledger

## Current lifecycle state

- **Phase:** IMPLEMENTATION (task loop active)
- **Exactly one task may be active:** T-01
- **Last updated:** 2026-07-27, Claude Code (Lead Orchestrator)
- **Current decision maker:** alex.nykolaiszyn@gmail.com

## Task register

| Task ID | Objective | Dependencies | Agent or tool | Files owned | Status | Review state | Latest verification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-01 | Scaffold npm workspaces monorepo, TypeScript strict config, ESLint, Vitest, `npm run verify` | NONE | Claude Code Implementer subagent | `package.json`, `tsconfig*.json`, `.eslintrc*`, `vitest.config.*`, `packages/*/package.json`, `packages/*/tsconfig.json`, empty `packages/*/src/index.ts` | ACTIVE | NOT REQUESTED | Pending |
| T-02 | Define canonical shared types (`DataPlatformConnector`, `ComparisonResult`, etc.) | T-01 | Not yet assigned | `packages/shared/src/**` | NOT STARTED | NOT REQUESTED | NONE |
| T-03 | Statement-safety parser (reject mutating SQL) | T-02 | Not yet assigned | `packages/engine/src/connector-sdk/safety/**` | NOT STARTED | NOT REQUESTED | NONE |
| T-04 | DuckDB-backed Fixture connector + seed fixture datasets | T-02 | Not yet assigned | `packages/engine/src/connector-sdk/fixture/**`, `packages/engine/fixtures/**` | NOT STARTED | NOT REQUESTED | NONE |
| T-05 | Canonical type-mapping layer | T-03, T-04 | Not yet assigned | `packages/engine/src/comparison-core/type-mapping/**` | NOT STARTED | NOT REQUESTED | NONE |
| T-06 | Schema diff | T-05 | Not yet assigned | `packages/engine/src/comparison-core/schema-diff/**` | NOT STARTED | NOT REQUESTED | NONE |
| T-07 | Column profiling | T-05 | Not yet assigned | `packages/engine/src/comparison-core/profiling/**` | NOT STARTED | NOT REQUESTED | NONE |
| T-08 | Parity YAML definition schema/parser | T-02, T-04 | Not yet assigned | `packages/engine/src/orchestration/definition/**` | NOT STARTED | NOT REQUESTED | NONE |
| T-09 | Orchestration planner (Phase 1: schema + profile) | T-06, T-07, T-08 | Not yet assigned | `packages/engine/src/orchestration/planner/**` | NOT STARTED | NOT REQUESTED | NONE |
| T-10 | Extension scaffold (activation, tree view, SecretStorage) | T-01 | Not yet assigned | `packages/extension/src/activation/**`, `packages/extension/src/views/**`, `packages/extension/src/secrets/**` | NOT STARTED | NOT REQUESTED | NONE |
| T-11 | Results webview (Phase 1 scope) | T-09, T-10 | Not yet assigned | `packages/extension/src/webview/**`, `packages/extension/src/statusbar/**` | NOT STARTED | NOT REQUESTED | NONE |
| T-12 | Column mapping + normalization rules | T-09 | Not yet assigned | `packages/engine/src/comparison-core/mapping/**`, `packages/engine/src/comparison-core/normalization/**` | NOT STARTED | NOT REQUESTED | NONE |
| T-13 | Volume parity | T-12 | Not yet assigned | `packages/engine/src/comparison-core/volume/**` | NOT STARTED | NOT REQUESTED | NONE |
| T-14 | Row-level parity | T-12 | Not yet assigned | `packages/engine/src/comparison-core/row-level/**` | NOT STARTED | NOT REQUESTED | NONE |
| T-15 | Orchestration planner (Phase 2: volume + row-level) | T-09, T-13, T-14 | Not yet assigned | `packages/engine/src/orchestration/planner/**` | NOT STARTED | NOT REQUESTED | NONE |
| T-16 | Diff viewer + export + SQL preview | T-11, T-15 | Not yet assigned | `packages/extension/src/webview/**`, `packages/extension/src/export/**` | NOT STARTED | NOT REQUESTED | NONE |
| T-17 | SQL Server connector | T-03, T-05 | Not yet assigned | `packages/engine/src/connector-sdk/sqlserver/**` | NOT STARTED | NOT REQUESTED | NONE |
| T-18 | Snowflake connector | T-03, T-05 | Not yet assigned | `packages/engine/src/connector-sdk/snowflake/**` | NOT STARTED | NOT REQUESTED | NONE |
| T-19 | PostgreSQL connector | T-03, T-05 | Not yet assigned | `packages/engine/src/connector-sdk/postgres/**` | NOT STARTED | NOT REQUESTED | NONE |
| T-20 | Hash-based comparison strategy | T-14 | Not yet assigned | `packages/engine/src/comparison-core/hash-comparison/**` | NOT STARTED | NOT REQUESTED | NONE |
| T-21 | Sampling strategies | T-07 | Not yet assigned | `packages/engine/src/comparison-core/sampling/**` | NOT STARTED | NOT REQUESTED | NONE |

## Open findings

| ID | Severity | Source task or review | Owner | Required resolution | Status |
| --- | --- | --- | --- | --- | --- |
| NONE | — | — | — | — | — |

## Blockers and dependencies

| Item | Blocking effect | Owner | Needed action | Date recorded |
| --- | --- | --- | --- | --- |
| No real SQL Server/Snowflake/PostgreSQL instances or sample data available | T-17/T-18/T-19 integration tests will need a documented environment-conditional strategy (test containers / trial accounts) before they can run to completion | alex.nykolaiszyn@gmail.com | Identify real test instances or containerized targets before T-17/T-18/T-19 start | 2026-07-27 |
| No agent/tool assigned yet to any task | Blocks starting T-01 | alex.nykolaiszyn@gmail.com | Assign an implementer for T-01 and record it in the task register | 2026-07-27 |

## Decisions and approvals

| Date | Decision | Rationale | Approver | Affected tasks |
| --- | --- | --- | --- | --- |
| 2026-07-27 | Adopted the `multi-agent-idea-to-app` lifecycle kit for this project; seeded `AGENTS.md`, `PROJECT-BRIEF.md`, and this ledger from `Idea Prompt.md` | User requested the idea be run through the kit's file-backed lifecycle, working one prompt at a time | Project owner | Sets up Discovery as the next step |
| 2026-07-27 | Completion boundary set to full MVP (all connectors and check layers from the idea document) | Owner chose full scope over a smaller Phase 1 slice | Project owner | All future task planning must sequence full-MVP scope into reviewable slices |
| 2026-07-27 | Development/validation will target local or mocked fixtures (e.g. DuckDB/SQLite) instead of real database instances | No real SQL Server/Snowflake/PostgreSQL instances or sample data are available yet | Project owner | Design must define a local fixture strategy; real-connector validation deferred |
| 2026-07-27 | Project owner recorded as decision maker/approver for all lifecycle gates | No other approver identified; single-owner project | Project owner | Applies to all future approval gates |
| 2026-07-27 | `PROJECT-BRIEF.md` approved | Owner reviewed and approved the drafted brief with no changes requested | Project owner | Unblocked Design phase |
| 2026-07-27 | Architecture: TypeScript VS Code extension with in-process TypeScript comparison engine backed by DuckDB | Recommended option in Design; single-language codebase, simpler packaging, matches idea document's own recommended direction | Project owner | All implementation tasks in the Comparison Core and Orchestration API |
| 2026-07-27 | Connectors: official per-platform Node drivers (mssql, snowflake-sdk, pg), each implementing a shared `DataPlatformConnector` interface | Recommended option; native support, no extra runtime dependency vs. ODBC | Project owner | Connector SDK tasks |
| 2026-07-27 | Development/testing target: DuckDB-backed fixture connector implementing the same `DataPlatformConnector` interface as real connectors | Recommended option; unblocks Design/implementation without real database access, no rework needed when real connectors are validated later | Project owner | Connector SDK and integration/validation tasks |
| 2026-07-27 | Query safety: hard-block statement parsing (rejects mutating SQL) in addition to read-only credentials; conservative user-configurable default row cap (100,000) and timeout (60s) | Recommended option; defense in depth against user error with a writable credential | Project owner | Connector SDK safety-parsing tasks |
| 2026-07-27 | `DESIGN-SPEC.md` approved section by section (scope, architecture, data flow, security, testing/release, acceptance criteria) | Owner confirmed the recommended option at each material decision point | Project owner | Unblocked Implementation Planning phase |
| 2026-07-27 | Repo tooling: Vitest + ESLint + TypeScript strict, npm workspaces monorepo (`packages/shared`, `packages/engine`, `packages/extension`) | Recommended option; enforces the module boundary from `DESIGN-SPEC.md` at the package level | Project owner | T-01 and all subsequent tasks' verification commands |
| 2026-07-27 | `IMPLEMENTATION-PLAN.md` approved: 21 tasks (T-01 through T-21) across Foundation, Phase 1 (schema/profile), Phase 2 (keyed/row-level), and Phase 3 (real connectors, hash, sampling) | Owner approved the full dependency-ordered plan with no changes requested | Project owner | Unblocks starting T-01; sets T-01 as next active task |

## Cost notes

| Date | Activity | Time or spend | Value or trade-off | Owner |
| --- | --- | --- | --- | --- |
| 2026-07-27 | Initial project setup: seeded control files from idea document | Single session, file creation only | Gives Discovery a running start instead of a blank brief | Claude Code |
