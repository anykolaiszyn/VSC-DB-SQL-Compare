# ParityLens — Progress Ledger

## Current lifecycle state

- **Phase:** IMPLEMENTATION (task loop active)
- **Exactly one task may be active:** NONE (T-01 and T-02 complete and approved; T-03, T-04, or T-10 may activate next)
- **Last updated:** 2026-07-27, Claude Code (Lead Orchestrator)
- **Current decision maker:** alex.nykolaiszyn@gmail.com

## Task register

| Task ID | Objective | Dependencies | Agent or tool | Files owned | Status | Review state | Latest verification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T-01 | Scaffold npm workspaces monorepo, TypeScript strict config, ESLint, Vitest, `npm run verify` | NONE | Claude Code Implementer subagent | `package.json`, `tsconfig*.json`, `eslint.config.mjs`, `vitest.config.*`, `packages/*/package.json`, `packages/*/tsconfig.json`, `packages/*/src/index.ts` | COMPLETE | APPROVED | `npm run verify` exit 0, 2026-07-27, reviewed independently by a separate subagent |
| T-02 | Define canonical shared types (`DataPlatformConnector`, `ComparisonResult`, etc.) | T-01 | Claude Code Implementer subagent | `packages/shared/src/**` | COMPLETE | APPROVED | `npm run verify` exit 0, 2026-07-27, reviewed independently by a separate subagent; re-verified post-merge on `main` |
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
| M-01 | MINOR | T-01 review | alex.nykolaiszyn@gmail.com | 10 transitive devDependency vulnerabilities (ESLint/minimatch, Vite/esbuild chains) — dev-tooling only, not shipped; revisit if/when a non-breaking fix becomes available | OPEN (accepted, non-blocking) |
| M-02 | MINOR | T-01 review | N/A | `tsc -b --force` used instead of literal `tsc --noEmit`, since project-references composite builds don't support `--noEmit`; reviewer confirmed this satisfies the actual verification contract | RESOLVED (no action needed) |
| M-03 | MINOR | T-02 review | N/A | Implementation report cited the `Severity` union's six values to `DESIGN-SPEC.md` when the exact enumeration actually lives in `Idea Prompt.md` section 12; type itself is correct, only the citation is off | RESOLVED (documentation-only, no code change needed) |
| M-04 | MINOR | T-02 review | Owner of T-06/T-07/T-13/T-14 | `SchemaDifference`/`ProfileDifference`/`AggregateDifference`/`RowDifference` are currently identical aliases of a thin `DifferenceItem{severity,message}` shape; nothing yet prevents cross-assignment at the type level. Intentionally deferred — each owning task (T-06, T-07, T-13, T-14) must refine its own difference shape when implemented | OPEN (tracked, not blocking; must be addressed by the task that owns each shape) |

## Blockers and dependencies

| Item | Blocking effect | Owner | Needed action | Date recorded |
| --- | --- | --- | --- | --- |
| No real SQL Server/Snowflake/PostgreSQL instances or sample data available | T-17/T-18/T-19 integration tests will need a documented environment-conditional strategy (test containers / trial accounts) before they can run to completion | alex.nykolaiszyn@gmail.com | Identify real test instances or containerized targets before T-17/T-18/T-19 start | 2026-07-27 |
| No agent/tool assigned yet to T-03, T-04, or T-10 | All three are now unblocked (T-01 and T-02 approved) but need an implementer assigned before activating | alex.nykolaiszyn@gmail.com | Choose which task to activate next and assign an implementer | 2026-07-27 |

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
| 2026-07-27 | T-01 implemented by a Claude Code Implementer subagent, independently reviewed by a separate Claude Code Reviewer subagent, approved with 0 Critical, 0 Important, 2 Minor findings (transitive dev-dependency audit warnings; `tsc -b --force` used in place of `tsc --noEmit` for project-references composite builds) | Reviewer independently re-ran `npm install`/`npm run verify`/`npm audit` and confirmed the implementer's claimed evidence byte-for-byte; scope stayed within TASK-BRIEF.md's owned files | Claude Code Independent Reviewer subagent (recommendation); Lead Orchestrator reconciled | T-01 complete; unblocks T-02 and T-10 |
| 2026-07-27 | Established `main` as the trunk by renaming `task/T-01-scaffold` (the repo's only commit) rather than merging into a separate `main` | Repo had no prior commits and no divergent history to merge; renaming is equivalent and simpler | Project owner (confirmed via question) | Sets the branch policy baseline for all future tasks in `IMPLEMENTATION-PLAN.md` |
| 2026-07-27 | T-02 implemented by a Claude Code Implementer subagent, independently reviewed by a separate Claude Code Reviewer subagent, approved with 0 Critical, 0 Important, 2 Minor findings (M-03 citation correction, M-04 deferred difference-shape refinement); branch merged into `main` with `--no-ff` and re-verified green post-merge | Reviewer independently confirmed field-for-field fidelity to `Idea Prompt.md` sections 2, 9, and 11, and re-ran all tests/checks itself | Claude Code Independent Reviewer subagent (recommendation); Lead Orchestrator reconciled and merged | T-02 complete; unblocks T-03, T-04, T-05 (indirectly), T-08, and T-09 |

## Cost notes

| Date | Activity | Time or spend | Value or trade-off | Owner |
| --- | --- | --- | --- | --- |
| 2026-07-27 | Initial project setup: seeded control files from idea document | Single session, file creation only | Gives Discovery a running start instead of a blank brief | Claude Code |
| 2026-07-27 | T-01 implementer + reviewer subagents (2 dispatches) | Two subagent runs, ~187s + ~111s | Enforced implementer/reviewer independence per `AGENTS.md`; caught nothing needing rework but validated the process | Claude Code Lead Orchestrator |
| 2026-07-27 | T-02 implementer + reviewer subagents (2 dispatches) | Two subagent runs, ~346s + ~158s | Enforced implementer/reviewer independence; reviewer caught 2 Minor citation/design-debt notes, no rework required | Claude Code Lead Orchestrator |
