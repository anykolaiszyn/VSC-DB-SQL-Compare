# ParityLens — Task Brief T-10

## Objective

Scaffold the VS Code extension host: activation entry point, command
registration, the "DATA PARITY" activity-bar tree view (Connections /
Comparisons / Recent Runs, per `Idea Prompt.md` section 6's sidebar
sketch), and a `SecretStore` wrapper around VS Code's `SecretStorage` API
for connection credentials. No comparison logic — this task wires the
extension shell only.

## Dependencies

- **Required completed tasks:** T-01 (npm workspaces monorepo scaffold) —
  COMPLETE and APPROVED. `packages/extension` already exists as a
  placeholder package (`export const PLACEHOLDER = true`) from T-01.
- **Required decisions or approvals:** `DESIGN-SPEC.md`'s "VS Code
  Extension Layer" row (approved): activation, commands, tree views,
  SecretStorage integration. `DESIGN-SPEC.md`'s security section
  (approved): credentials resolved only through VS Code SecretStorage,
  environment variables, or native cloud/OS credential mechanisms — never
  inline in parity configuration. This task implements the SecretStorage
  side of that for the extension layer specifically.

## Files owned

- `packages/extension/src/activation/**`
- `packages/extension/src/views/**`
- `packages/extension/src/secrets/**`

Do not touch `packages/extension/src/index.ts` beyond wiring it to call
into the new `activation/**` entry point (record if you do this). Do not
touch `packages/shared/**` or `packages/engine/**`.

## Interfaces

| Direction | Interface | Contract | Producer or consumer |
| --- | --- | --- | --- |
| Consumed | VS Code Extension API (`vscode` module types) | Standard `vscode.ExtensionContext`, `vscode.TreeDataProvider`, `vscode.SecretStorage` — add `@types/vscode` as a devDependency of `packages/extension` if not already present, and document the target VS Code API version chosen (`engines.vscode` in `package.json`) | VS Code (external, not part of this monorepo) |
| Produced | `activate(context: vscode.ExtensionContext)` | The extension's activation entry point: registers commands, instantiates the tree data provider(s), and constructs the `SecretStore` wrapper. Must be wired as the actual `activate` export `packages/extension`'s manifest points VS Code at (a minimal `package.json` `contributes`/`activationEvents`/`main` section may be required — add the minimum needed for activation to be testable, document what's deferred to T-11/T-16) | Consumed by the VS Code extension host at runtime; consumed by tests via direct invocation |
| Produced | `ParityTreeDataProvider` (or similarly named) implementing `vscode.TreeDataProvider` | Renders the three top-level sections from `Idea Prompt.md` section 6: Connections, Comparisons, Recent Runs. For this task, an empty-state provider is sufficient (no connections/comparisons exist yet — that's later scope) as long as the tree view registers and renders the three section nodes | Consumed by VS Code's tree view UI; consumed by T-11 (extends with actual data) |
| Produced | `SecretStore` wrapper class/module | Thin wrapper around `vscode.SecretStorage` (`context.secrets`) providing `get(key)`, `set(key, value)`, `delete(key)` for connection credentials. Must never write a credential to `context.globalState`, `context.workspaceState`, or any file — SecretStorage only | Consumed by future connector/connection-management tasks (not yet scheduled in the plan beyond this scaffold) |

## Prohibited changes

- Do not implement actual connection management, comparison definition
  editing, results rendering, or CodeLens — those are later tasks (T-11,
  T-16, and unscheduled connection-management work).
- Do not modify `packages/shared/**` or `packages/engine/**`.
- Do not write any credential-shaped value to `globalState`,
  `workspaceState`, or any file under version control, even a test fixture
  — SecretStorage is the only permitted destination, and a test proving
  this must use a mocked/in-memory `SecretStorage`, never a real one that
  could persist.
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Test or check to add:** A focused test (using `@vscode/test-electron`
  or an equivalent VS Code extension test harness — pick a reasonable
  approach for the packages/extension workspace and document the choice)
  asserting that `activate()` registers the tree view and that
  `ParityTreeDataProvider.getChildren()` returns the three top-level
  section nodes (Connections, Comparisons, Recent Runs).
- **Command:** `npx vitest run packages/extension` (or the chosen test
  harness's equivalent invocation — if a VS Code extension test harness
  requires a different runner than Vitest, document why and what command
  replaces it)
- **Expected failure reason:** `activate`, `ParityTreeDataProvider`, and
  `SecretStore` do not exist yet — only the T-01 placeholder does.
- **Captured output:** Exact command output and exit code, pasted into
  `IMPLEMENTATION-REPORT.md`.

## Green-state and full verification

- **Focused command:** Same as above.
- **Full command:** `npm run verify`
- **Expected evidence:** Focused command passes: tree view registers with
  the three section nodes, `SecretStore.set`/`get`/`delete` round-trip
  correctly against a mocked `SecretStorage`, and a test confirms no
  credential-shaped value is ever written to `globalState`/`workspaceState`.
  Full command passes with exit code 0, no regression in the existing 283
  tests.

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md` (project root)
- **Independent reviewer:** A separate Claude Code subagent instance, dispatched by the Lead Orchestrator, distinct from the T-10 implementer subagent. The reviewer must specifically confirm no credential-shaped data can reach `globalState`/`workspaceState`/a file, and that the tree view genuinely registers with VS Code's API contract rather than only satisfying a mocked test double.
- **Review report location:** `REVIEW-REPORT.md` (project root)
- **Commit or patch checkpoint:** Branch `task/T-10-extension-scaffold`
