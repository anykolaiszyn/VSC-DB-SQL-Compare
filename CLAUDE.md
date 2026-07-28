# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

ParityLens is a VS Code extension for profiling, reconciling, and validating
datasets across heterogeneous data platforms (SQL Server, Snowflake,
PostgreSQL for the MVP). Users define source and target queries, map
corresponding fields, configure equivalence rules, and run schema, volume,
profile, aggregate, and row-level parity checks. See `Idea Prompt.md` for
the full product concept and `DESIGN-SPEC.md` for the approved architecture.

No real database instances exist for development yet — all engine work is
built and tested against a DuckDB-backed `FixtureConnector`
(`packages/engine/src/connector-sdk/fixture/`) that implements the same
`DataPlatformConnector` interface real connectors will use later, so real
connectors can be dropped in without changing any consuming code.

## Commands

```bash
npm run verify      # typecheck + lint + test, in that order — the required full check
npm run typecheck    # tsc -b --force (project-references composite build; --noEmit isn't supported in this mode)
npm run lint         # eslint .
npm run test         # vitest run, all workspaces
```

Run a single test file or pattern:
```bash
npx vitest run packages/engine                                   # one workspace
npx vitest run packages/engine/src/comparison-core/schema-diff    # one directory
npx vitest run -t "some test name"                                # by test name
```

There is no `build`/`watch`/`dev` script beyond `tsc -b` (declaration-only
build, no bundling yet — the extension package has no runtime activation
code until T-10).

## Running the task loop

Three roles drive the Task Loop phase of this project's lifecycle:

- **Lead Orchestrator** — whoever/whatever is driving the session
  directly. Writes each `TASK-BRIEF.md`, dispatches implementer/reviewer,
  reconciles and merges, and owns every `PROGRESS-LEDGER.md` edit. Follow
  `~/.claude/agents/orchestrator.md` — a protocol document, not a
  dispatchable agent — for the full per-task cycle and the judgment calls
  (scope-creep-vs-acceptable, blocking-vs-tracked-debt) that stay with
  this role rather than a subagent.
- **Implementer** — dispatch via the `implementer` subagent
  (`~/.claude/agents/implementer.md`) for every task in
  `IMPLEMENTATION-PLAN.md`. It reads `TASK-BRIEF.md` as sole authority,
  works test-first, and never self-approves.
- **Reviewer** — dispatch via the `reviewer` subagent
  (`~/.claude/agents/reviewer.md`), always a separate instance from the
  implementer. It re-verifies fresh rather than trusting the
  implementation report, and adversarially probes anything
  security-relevant or previously disclosed as a risk — this caught real
  bugs during this project's build (see `PROGRESS-LEDGER.md`'s open
  findings for I-01/I-02 as worked examples of the review gate working).

**Session maintenance:** right after reconciling a task (ledger updated,
merged, pushed) is the safest point to run `/compact` — see
`orchestrator.md` step 8 for why, and for the pre-compact check (confirm
the ledger is genuinely current first). Subagent dispatches are unaffected
either way since they run in isolated context.

## Project governance — read before making changes

This repo is being built through the `multi-agent-idea-to-app` lifecycle
kit (see `multi-agent-idea-to-app/HANDBOOK.md`), a file-backed process for
taking an idea from discovery through implementation with independent
review at every step. **`AGENTS.md` is the operating contract and takes
precedence over defaults** — read it first. Key rules from it:

- **Source of truth is the control files, not chat history**:
  `PROJECT-BRIEF.md` (intent/constraints/approvals), `DESIGN-SPEC.md`
  (approved architecture), `IMPLEMENTATION-PLAN.md` (the full dependency-
  ordered task list, T-01 through T-21), `PROGRESS-LEDGER.md` (current
  lifecycle state, active task, open findings, decision log — **read this
  first to know what's actually done and what's next**), and the current
  `TASK-BRIEF.md`/`IMPLEMENTATION-REPORT.md`/`REVIEW-REPORT.md` for
  whichever task is active.
- **One task active at a time.** Every unit of work is scoped by a
  `TASK-BRIEF.md` with exclusive file ownership, a required red-state
  test before the change, green-state + full verification after, and an
  independent review by a different agent before it's considered done. Do
  not touch files outside an active task's declared ownership without a
  revised brief.
- **Read-only source/target systems.** No connector may ever execute a
  mutating statement — every `executeQuery` call is expected to route
  through `assertReadOnlyStatement` (see Architecture below) as defense in
  depth, even for connector-generated SQL, not just user-supplied queries.
- **No inline credentials.** Connection profiles are referenced by name
  only; `packages/engine/src/orchestration/definition/definition.ts`
  actively rejects credential-shaped fields in parity YAML documents.
- **Credentials belong in VS Code `SecretStorage`**, environment variables,
  or native cloud/OS credential mechanisms — never in committed config.

## Architecture

npm workspaces monorepo, three packages, strict TypeScript throughout
(`tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`), enforcing the module boundary from
`DESIGN-SPEC.md`:

```
packages/shared    @paritylens/shared   — canonical types/interfaces only, no runtime logic, no dependencies
packages/engine     @paritylens/engine   — comparison engine, connector SDK, orchestration (depends on shared)
packages/extension  @paritylens/extension — VS Code host (depends on engine + shared; not yet implemented)
```

### `packages/shared/src/` — the contract every other package builds against

- `types.ts` — `CanonicalTypeCategory` (15-value enum normalizing native
  platform types like `NUMBER(38,0)`/`INT`/`BIGINT` into comparable
  categories), `ColumnDefinition`, `QueryInput` (discriminated union:
  `table` / `query` / `sqlFile` — the three MVP input shapes),
  `ExecutionOptions`, `RecordBatch`.
- `connector.ts` — `DataPlatformConnector`, the interface every connector
  (fixture and real) implements, plus `ConnectorCapabilities` so the engine
  never assumes identical execution mechanics across platforms.
- `result.ts` — `ComparisonResult` and its sub-shapes, matching
  `Idea Prompt.md` section 11's JSON example field-for-field. The four
  difference arrays (`schemaDifferences`, `profileDifferences`,
  `aggregateDifferences`, `rowDifferences`) started as a shared thin
  `DifferenceItem{severity,message}` placeholder; each is refined into a
  real shape by the task that owns that check family
  (`SchemaDifference`/`ProfileDifference` are done; `AggregateDifference`/
  `RowDifference` are still placeholders, owned by future volume/row-level
  tasks). **Only the task that owns a given difference shape may change
  it** — do not widen an unrelated one as a side effect.

### `packages/engine/src/` — three layers, each depending only on `shared` and the layer below

- **`connector-sdk/`** — platform access.
  - `safety/statement-safety.ts` — `assertReadOnlyStatement(sql, dialect)`:
    a bounded lexical scanner (not a full SQL parser) that strips
    comments/string literals, splits on top-level `;`, resolves the
    effective leading keyword past any CTE prefix, and rejects mutating
    statements per dialect. Every connector's `executeQuery` must call this
    before touching a driver. Known accepted residual gaps (SQL Server `GO`
    separator, PostgreSQL dollar-quoting) are documented in
    `PROGRESS-LEDGER.md`'s open findings — this is defense-in-depth, not
    the sole control (read-only credentials are primary).
  - `fixture/fixture-connector.ts` — `FixtureConnector`, backed by an
    in-memory DuckDB instance via `@duckdb/node-api`, implementing
    `DataPlatformConnector`. Constructed with a fixture-set ID and a side
    (`"source"`/`"target"`).
  - `../../fixtures/` (note: at `packages/engine/fixtures/`, sibling to
    `src/`, not under it) — three named fixture pairs
    (`sqlserver-customer`, `snowflake-orders`, `postgres-products`), each
    with a deliberate, documented schema mismatch, row-count mismatch, and
    row-level mismatch, used as the primary test data for every engine
    task above this layer.
- **`comparison-core/`** — the actual comparison logic, organized one
  concern per subdirectory: `type-mapping/` (native → canonical type
  mapping + `Compatible`/`Review`/`Risk` classification), `schema-diff/`
  (`compareSchemas`), `profiling/` (`profileColumn` + `compareProfiles` —
  computes general/string/numeric/timestamp/boolean metrics and surfaces
  only *meaningful* changes, not a blind side-by-side dump). Volume,
  aggregate, row-level, hash-comparison, and sampling subdirectories do not
  exist yet (planned as `volume/`, `row-level/`, `hash-comparison/`,
  `sampling/`, `mapping/`, `normalization/`).
- **`orchestration/`** — ties the above together.
  - `definition/definition.ts` — `parseDefinition(yaml)`, parsing the
    "Comparison Definition as Code" YAML format (`Idea Prompt.md` section
    7) into `ParityDefinition`, using the `yaml` package (never `js-yaml`
    — chosen specifically because `yaml`'s `parse()` has no unsafe-load
    mode). Enforces the no-inline-credentials rule via a recursive
    field-name blocklist plus a structural rule that `connection` must be
    a bare string.
  - `planner/planner.ts` — `runComparison(definition, connectors)`, the
    Phase-1 orchestrator: resolves named connections through an injectable
    `ConnectorRegistry` (`Map<string, DataPlatformConnector>` — the planner
    depends only on the interface, never on `FixtureConnector`
    specifically), runs a Layer-1 connectivity check that short-circuits
    the whole run to a `"failed"` result before any schema/profile work if
    either side fails to connect, then runs schema and/or profile checks
    per the definition's `checks.*.enabled` flags, and assembles the final
    `ComparisonResult` with `summary`/`status` derived from the actual
    collected finding severities. **Volume and row-level checks are
    explicitly out of scope for this planner** — `rowCounts`,
    `aggregateDifferences`, `rowDifferences` stay empty even if
    `checks.rowCount`/`checks.rowLevel` are enabled in the definition; a
    later planner extension handles those once the underlying comparison
    logic exists.

### `packages/extension/`

Placeholder only (`export const PLACEHOLDER = true`). Real VS Code
activation, tree views, webviews, and SecretStorage integration are not
yet implemented.

## Working within this codebase

- **Check `PROGRESS-LEDGER.md` first** for the current lifecycle phase,
  which tasks are complete/approved vs. not started, and any open findings
  that constrain future work (e.g. a Minor finding routed to a specific
  future task as required scope).
- **Judgment calls are documented inline** as source comments explaining
  *why*, not just what — this codebase leans heavily on that pattern
  (e.g. `RecordBatch`'s row-oriented-vs-Arrow tradeoff, `ProfileDifference`'s
  discriminated-union-vs-`unknown` tradeoff). Read the header comment of a
  file before assuming a shape is under-designed; it's often a documented,
  deliberate scope boundary for a specific future task to extend.
- **A refined difference shape (`SchemaDifference`, `ProfileDifference`)
  is owned by the task that created it** — extend it only if you are that
  task's stated successor (e.g. `AggregateDifference` is explicitly
  reserved for the volume/aggregate task).
