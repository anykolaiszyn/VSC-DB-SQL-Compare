# ParityLens — Task Brief T-01

## Objective

Scaffold the npm workspaces monorepo (`packages/shared`, `packages/engine`,
`packages/extension`) with TypeScript strict configuration, ESLint, Vitest,
and a working `npm run verify` script (tsc --noEmit + eslint + vitest across
all workspaces), establishing the tooling contract every later task depends
on.

## Dependencies

- **Required completed tasks:** NONE
- **Required decisions or approvals:** `IMPLEMENTATION-PLAN.md` approved
  2026-07-27 (tooling decision: Vitest + ESLint + TypeScript strict, npm
  workspaces monorepo).

## Files owned

- `package.json` (root)
- `tsconfig.json`, `tsconfig.base.json` (root-level shared TS config)
- `.eslintrc.cjs` (or `.eslintrc.json` — implementer's choice, record which)
- `vitest.config.ts` (root workspace test config)
- `.gitignore` (create if absent; must exclude `node_modules`, build output)
- `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/src/index.ts`
- `packages/engine/package.json`, `packages/engine/tsconfig.json`, `packages/engine/src/index.ts`
- `packages/extension/package.json`, `packages/extension/tsconfig.json`, `packages/extension/src/index.ts`

`src/index.ts` in each package is a placeholder only (e.g. a single exported
constant or empty module) — no real logic. Real logic starts in T-02 onward.

## Interfaces

| Direction | Interface | Contract | Producer or consumer |
| --- | --- | --- | --- |
| Produced | `npm run verify` | Runs `tsc --noEmit` across all workspaces, then `eslint .`, then `vitest run` across all workspaces; exits non-zero if any step fails | Consumed by every subsequent task (T-02 through T-21) as their full-verification command |
| Produced | npm workspaces structure | Three packages (`@paritylens/shared`, `@paritylens/engine`, `@paritylens/extension`) resolvable via workspace protocol, each independently buildable/testable | Consumed by T-02 (populates `packages/shared`) and all later tasks |

## Prohibited changes

- Do not write any real business logic, connector code, or UI code — this
  task is scaffolding only. Placeholder exports in `src/index.ts` are the
  only content permitted beyond configuration files.
- Do not modify `AGENTS.md`, `PROJECT-BRIEF.md`, `DESIGN-SPEC.md`, or
  `IMPLEMENTATION-PLAN.md`.
- Do not install or reference any database driver (`mssql`, `snowflake-sdk`,
  `pg`, `duckdb`) — those are introduced in later tasks (T-04, T-17–T-19).
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Test or check to add:** A focused check confirming `npm run verify` does
  not exist yet as a working command in a clean checkout.
- **Command:** `npm run verify`
- **Expected failure reason:** No root `package.json`/`verify` script exists
  yet in the repository — command fails with "npm error Missing script:
  verify" (or equivalent, since no `package.json` exists at all before this
  task starts).
- **Captured output:** Exact console output and exit code, pasted into
  `IMPLEMENTATION-REPORT.md`.

## Green-state and full verification

- **Focused command:** `npm run verify` (this task defines the very command
  it is tested against; "focused" and "full" are the same command for T-01
  specifically, since there is no narrower unit yet)
- **Full command:** `npm run verify`
- **Expected evidence:** Exit code 0; output shows `tsc --noEmit` passing
  with zero errors across all three packages, `eslint .` passing with zero
  errors, and `vitest run` reporting 0 failed / 0 or more passed (an empty
  test suite passing is acceptable at this stage since no real logic
  exists yet — but the command must complete successfully end-to-end).

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md` (project root)
- **Independent reviewer:** A separate Claude Code subagent instance, dispatched by the Lead Orchestrator, distinct from the implementer subagent
- **Review report location:** `REVIEW-REPORT.md` (project root)
- **Commit or patch checkpoint:** Branch `task/T-01-scaffold`
