# ParityLens — Task Brief T-22

## Objective

Close a cross-task integration gap found during the prompt-06 Integration
check (2026-08-01): no task in `IMPLEMENTATION-PLAN.md`'s original T-01
through T-21 ever exported `@paritylens/engine`'s real API from its package
entry point, and no task ever wired a real command connecting
`parseDefinition` → `runComparison` → `showResultsWebview`/export. Every
extension-layer task (T-10, T-11, T-16, T-16b) tested rendering/export
against a **hand-built** `ComparisonResult` literal only, and every
engine-layer test imported from deep relative paths inside
`packages/engine/src/...`, never through `@paritylens/engine`'s declared
package entry point — which still contains only T-01's original placeholder:

```typescript
// packages/engine/src/index.ts (current content, verbatim)
export const PLACEHOLDER = true;
```

This was not any individual task's failure — T-10's own brief explicitly
scoped out "comparison logic" and "results rendering," and T-11/T-16/T-16b's
briefs were explicitly scoped to render *a passed-in* `ComparisonResult`.
Each task's own scope boundary was honest and correctly reviewed. But no
task ever owned closing the loop, so the two package boundaries central to
`DESIGN-SPEC.md`'s own data-flow section (steps 2-5: Orchestration API
invokes checks, Extension Layer renders the result) have never actually
been connected by real code.

**What integration confirmed already works** (via a temporary, discarded
probe using deep relative imports identical to what the existing test
suites already do — this brief does not need to re-derive this, only wire
the already-correct pieces together): a real `runComparison()` result
(status `"failed"`, 9 `schemaDifferences`, 13 `rowDifferences`, produced
from the `sqlserver-customer` fixture pair's deliberate mismatches) renders
correctly through `renderResultsHtml` and exports correctly through all
three of `exportToCsv`/`exportToJson`/`exportToMarkdown` with no shape
mismatch. **This task is pure wiring, not new logic** — every function this
task calls already exists, is already tested in isolation, and is already
confirmed shape-compatible end-to-end. Do not modify any comparison-core,
orchestration, or webview/export rendering logic — if you find yourself
wanting to change behavior inside any of those to make the wiring work,
stop and flag it as a scope violation rather than doing it.

## Scope

Two pieces, both required:

1. **Export the real engine API** from `packages/engine/src/index.ts`
   (currently the T-01 placeholder), following `packages/shared/src/index.ts`'s
   own precedent exactly: a re-export-only file, no logic. At minimum,
   re-export `parseDefinition`/`InvalidDefinitionError` (from
   `orchestration/definition/definition.js`), `runComparison`/
   `ConnectorRegistry`/`UnresolvedConnectionError` (from
   `orchestration/planner/planner.js`), and `FixtureConnector` (from
   `connector-sdk/fixture/fixture-connector.js`) — the pieces this task's
   own command needs, plus anything else already exported from those
   modules that a consumer would reasonably expect at the package root
   (use judgment consistent with `packages/shared/src/index.ts`'s "re-export
   the public surface" framing, but do not spend time auditing every
   engine-internal symbol; the four named above are the hard requirement).
2. **Register one new VS Code command** (e.g. `paritylens.runComparison`)
   in `packages/extension/src/activation/activate.ts` (extends T-10's
   ownership) plus a new `contributes.commands` entry in
   `packages/extension/package.json`, that:
   - Prompts the user (via `vscode.window.showOpenDialog` or a simple
     `showQuickPick`/`showInputBox` — your judgment on the simplest correct
     UX, this is not a polished feature) to select a `.paritylens` YAML
     definition file from the open workspace.
   - Reads the file, calls `parseDefinition`.
   - Builds a `ConnectorRegistry` using **`FixtureConnector` only** — real
     connection-profile resolution (SQL Server/Snowflake/PostgreSQL
     credentials via `SecretStore`) is explicitly out of scope for this
     task (no task has built connection-profile management yet; this is
     unscheduled future work, not something to invent here). Document this
     limitation plainly in the command (e.g. a code comment and/or a
     user-visible notice) rather than silently only working for fixture
     names.
   - Calls `runComparison`, then `showResultsWebview` with the real result.
   - On any error (`InvalidDefinitionError`, `UnresolvedConnectionError`,
     or any other thrown error), shows a `vscode.window.showErrorMessage`
     with the error's message — do not let an unhandled rejection surface
     as a generic VS Code crash notification.

## Dependencies

- **Required completed tasks:** T-09/T-15 (planner, COMPLETE/APPROVED),
  T-08/T-08a (definition parser, COMPLETE/APPROVED), T-10 (extension
  scaffold/activation, COMPLETE/APPROVED), T-11/T-16/T-16b (webview/export,
  COMPLETE/APPROVED), T-04 (FixtureConnector, COMPLETE/APPROVED).
- **Required decisions or approvals:** NONE beyond this brief — this is a
  bounded integration-gap fix, not a scope change to any approved
  deliverable.
- **Environment:** fixture-only, same as most prior tasks. No WSL/Docker
  containers needed.

## Files owned

- `packages/engine/src/index.ts` (currently T-01's placeholder — this task
  is the first to give it real content)
- `packages/extension/src/activation/activate.ts` (extends T-10's
  ownership — the only permitted edit is adding the new command
  registration; do not restructure `activate()`'s existing tree-view/
  SecretStore wiring)
- `packages/extension/package.json` (`contributes.commands` array only —
  do not edit `activationEvents`, `contributes.views`, or any other field)

Do not touch any file inside `packages/engine/src/comparison-core/**`,
`packages/engine/src/connector-sdk/**` (other than importing from
`fixture/fixture-connector.js`, read-only), `packages/engine/src/orchestration/**`
(other than importing, read-only), `packages/extension/src/webview/**`,
`packages/extension/src/export/**`, or `packages/extension/src/views/**` —
this task imports and calls existing functions, it does not modify any of
their internals.

## Interfaces

| Direction | Interface | Contract | Producer or consumer |
| --- | --- | --- | --- |
| Consumed | `parseDefinition`, `runComparison`, `ConnectorRegistry`, `FixtureConnector` | Existing, complete, already tested in isolation | T-08/T-09/T-04 (producers) |
| Consumed | `showResultsWebview`, `renderResultsHtml` | Existing, complete, already tested against hand-built `ComparisonResult` literals | T-11/T-16 (producers) |
| Produced | `@paritylens/engine`'s real package-root export surface | `packages/engine/src/index.ts` re-exports the symbols named in Scope item 1 above | This task (producer) |
| Produced | `paritylens.runComparison` VS Code command | Registered in `activate()`, appears in the command palette, end-to-end wires fixture-backed comparison runs to the results webview | This task (producer) |

## Prohibited changes

- Do not modify any comparison-core, connector-sdk, orchestration, webview,
  or export logic — this task wires existing, already-correct pieces
  together. If wiring reveals a real shape mismatch (it is not expected
  to, per the integration probe's findings), stop and flag it as a
  blocker rather than patching the mismatched side yourself.
- Do not attempt real connection-profile resolution (SQL Server/Snowflake/
  PostgreSQL credentials) — fixture-backed registries only, explicitly
  disclosed as a known limitation.
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Test or check to add:** a test asserting the new command handler
  function (extract it as an exported, directly-testable function separate
  from the raw `vscode.commands.registerCommand` callback, same pattern
  T-10/T-11 already use for testability without `@vscode/test-electron`)
  runs `parseDefinition` → `runComparison` → `showResultsWebview` against a
  real `.paritylens`-shaped YAML string and a `FixtureConnector`-backed
  registry, and fails because the function doesn't exist yet.
- **Command:** `npx vitest run packages/extension/src/activation`
- **Expected failure reason:** Function/export does not exist yet.

## Green-state and full verification

- **Focused command:** `npx vitest run packages/extension/src/activation`
- **Full command:** `npm run verify`
- **Expected evidence:** the new command handler, called directly (not
  through the VS Code command palette, consistent with how T-10/T-11 test
  activation-adjacent code without a real extension host), produces a real
  `ComparisonResult` from the `sqlserver-customer` (or another seeded)
  fixture pair and passes it to `showResultsWebview`/`renderResultsHtml`
  without error. Also add or extend a test proving `packages/engine/src/index.ts`
  actually exports the four required symbols (e.g. a test file in
  `packages/engine/src` importing from `./index.js` and asserting each
  export is defined) — this is the direct evidence for Scope item 1, since
  a missing export would otherwise only surface as a downstream import
  failure in `packages/extension`. All previously passing tests (396 as of
  T-16b/T-21) still pass with no regression. `npm run verify` exits 0.

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md`
- **Independent reviewer:** `reviewer` subagent (separate instance from
  whichever `implementer` subagent does this task)
- **Review report location:** `REVIEW-REPORT.md`
- **Commit or patch checkpoint:** Branch `task/T-22-engine-export-and-run-command`

**Note to reviewer:** this task's central risk is scope discipline, not
correctness of any comparison logic (all of that is pre-existing and
already reviewed). Confirm: (1) no file outside the three declared owned
paths was touched; (2) `packages/engine/src/index.ts`'s new exports are
genuinely re-exports only, no new logic; (3) the command handler correctly
surfaces `InvalidDefinitionError`/`UnresolvedConnectionError` as a VS Code
error message rather than an unhandled rejection (construct an adversarial
case yourself — a malformed YAML file, and a YAML file referencing an
unregistered connection name — and confirm both produce a clean,
non-crashing error message rather than a thrown/unhandled exception); (4)
the fixture-only limitation is genuinely disclosed to the user, not just in
a code comment nobody sees at runtime.
