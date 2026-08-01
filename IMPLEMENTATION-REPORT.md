# ParityLens — Implementation Report T-22

## Status and objective

- **Status:** COMPLETE (implementation only — not reviewed or approved; see
  Recommended next step)
- **Objective:** Close the cross-task integration gap identified during the
  prompt-06 Integration check: (1) export the real `@paritylens/engine` API
  from `packages/engine/src/index.ts` (previously only T-01's
  `PLACEHOLDER = true`), and (2) register one new VS Code command,
  `paritylens.runComparison`, that wires `parseDefinition` →
  `runComparison` → `showResultsWebview` end-to-end using a
  `FixtureConnector`-only `ConnectorRegistry`. Per TASK-BRIEF.md: "This
  task is pure wiring, not new logic" — no comparison-core, orchestration,
  or webview/export logic was modified.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/engine/src/index.ts` | Replaced T-01's `PLACEHOLDER = true` with `export * from` re-exports of `orchestration/definition/definition.js`, `orchestration/planner/planner.js`, and `connector-sdk/fixture/fixture-connector.js` | Scope item 1 — gives `@paritylens/engine`'s package entry point real content for the first time, per brief's exact `packages/shared/src/index.ts` precedent |
| `packages/extension/src/activation/activate.ts` | Added `runComparisonCommand` (exported, directly testable), `buildFixtureRegistry`, `registerRunComparisonCommand`, and one new call in `activate()` registering the command and pushing its disposable — existing tree-view/SecretStore wiring left untouched | Scope item 2 — registers `paritylens.runComparison`, prompts for a `.paritylens` file, reads it, and wires `parseDefinition` → `runComparison` → `showResultsWebview` |
| `packages/extension/package.json` | Added one entry to `contributes.commands` (`paritylens.runComparison` / "ParityLens: Run Comparison"); no other field touched | Required so the new command appears in the command palette, per brief's Interfaces table |
| `packages/engine/src/index.test.ts` (new) | New test file asserting `parseDefinition`, `InvalidDefinitionError`, `runComparison`, `UnresolvedConnectionError`, `FixtureConnector`, and the `ConnectorRegistry` type are all importable from `./index.js` | Brief's Green-state section: "add or extend a test proving `packages/engine/src/index.ts` actually exports the four required symbols" |
| `packages/extension/src/activation/runComparisonCommand.test.ts` (new) | New test file exercising `runComparisonCommand` directly against real `.paritylens`-shaped YAML and a `FixtureConnector`-backed registry, plus two adversarial error cases | Brief's Red-state/Green-state evidence requirement |
| `packages/extension/src/activation/activate.test.ts` | Extended the existing `vi.mock("vscode", ...)` factory to add `commands.registerCommand` (stub disposable) and `workspace.workspaceFolders: undefined` | **Forced minimal edit outside the literal three-file ownership list** — flagged separately below |

## Forced minimal edit outside declared ownership (flagged per Implementer instructions)

`packages/extension/src/activation/activate.test.ts` is not in T-22's
declared "Files owned" list. However, `activate()` (which that file tests)
now also calls `vscode.commands.registerCommand` and reads
`vscode.workspace.workspaceFolders` inside the newly-registered command's
callback closure creation path. The pre-existing `vi.mock("vscode", ...)`
factory in `activate.test.ts` only defined `TreeItem`/`EventEmitter`/
`TreeItemCollapsibleState`/`window.createTreeView`, so all three of its
existing tests started failing with `No "commands" export is defined on
the "vscode" mock` — a direct, mechanical consequence of Scope item 2,
not a deliberate scope expansion. I added exactly two keys to the mock's
returned object (`commands: { registerCommand: () => ({ dispose: () =>
undefined }) }` and `workspace: { workspaceFolders: undefined }`) and
nothing else — the three existing assertions in that file are byte-for-byte
unchanged. This restored all three pre-existing tests to green without
weakening any assertion. Flagging this explicitly per the Implementer
contract's instruction to call out any such forced edit separately rather
than fold it in silently.

## Behavior and interfaces

- **Behavior delivered:**
  - `@paritylens/engine`'s package root (`import ... from "@paritylens/engine"`)
    now resolves `parseDefinition`, `InvalidDefinitionError`,
    `ParityDefinition`/`ParitySide`/`ColumnMappingEntry`/`NormalizationRule`/
    `ParityChecks` (definition.ts's full exported surface), `runComparison`,
    `ConnectorRegistry`, `UnresolvedConnectionError`, `buildFetchAllRowsSql`
    (planner.ts's full exported surface), and `FixtureConnector`
    (fixture-connector.ts's exported surface) — the four hard-required
    symbols plus everything else already exported from those three modules,
    per the brief's "re-export the public surface" framing.
  - A new `paritylens.runComparison` command is registered in `activate()`
    and appears in `package.json`'s `contributes.commands`. When invoked
    through the live VS Code API path (`registerRunComparisonCommand`, not
    directly tested — see Risks below), it prompts the user via
    `vscode.window.showOpenDialog` (filtered to `.paritylens`/`.yaml`/`.yml`,
    defaulting to the first workspace folder if one is open), reads the
    selected file from disk, and delegates to the exported, directly
    testable `runComparisonCommand(yamlText, deps)` function.
  - `runComparisonCommand` always shows a fixture-only-limitation notice via
    `showInformationMessage` first (disclosed to the user at runtime, not
    just as a code comment — see the reviewer note below), then calls
    `parseDefinition(yamlText)`, builds a `ConnectorRegistry` mapping
    *whatever* connection names the parsed definition actually uses to the
    `"source"`/`"target"` sides of the `sqlserver-customer` `FixtureConnector`
    pair, calls `runComparison(definition, registry)`, and passes the real
    result to `showResultsWebview`. Any thrown error
    (`InvalidDefinitionError`, `UnresolvedConnectionError`, or anything
    else, e.g. a runtime error from `getSchema` against an unknown fixture
    table) is caught and surfaced via `showErrorMessage` with a
    `"ParityLens: run comparison failed — <message>"` string — the function
    never lets an error propagate as an unhandled rejection.
- **Interfaces consumed:** `parseDefinition`/`InvalidDefinitionError`
  (`orchestration/definition/definition.ts`, T-08/T-08a, read-only),
  `runComparison`/`ConnectorRegistry`/`UnresolvedConnectionError`
  (`orchestration/planner/planner.ts`, T-09/T-15, read-only),
  `FixtureConnector` (`connector-sdk/fixture/fixture-connector.ts`, T-04,
  read-only), `showResultsWebview` (`webview/resultsWebview.ts`, T-11/T-16,
  read-only). None of these files were modified — confirmed by `git status`
  below.
- **Interfaces produced:** `@paritylens/engine`'s real package-root export
  surface (`packages/engine/src/index.ts`); the `paritylens.runComparison`
  VS Code command; the exported, directly testable
  `runComparisonCommand(yamlText, deps)` function (new public surface of
  `activate.ts`, alongside the pre-existing `activate`/`PARITY_TREE_VIEW_ID`)
  and the new `RUN_COMPARISON_COMMAND_ID` constant.

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline (pre-change) | `npm run verify` | Exit 0 — 396 passed, 27 skipped, 20 test files passed / 2 skipped | Captured in this session's transcript before any edit |
| Red state | `npx vitest run packages/extension/src/activation` (run via `git stash` against the unmodified `activate.ts`/mock, with the two new test files present) | **Failed as predicted** — `runComparisonCommand.test.ts` errored with `No "TreeItem" export is defined on the "vscode" mock` while importing `activate.ts` (the function/export the test needs does not exist on that branch state); `activate.test.ts`'s 3 tests still passed unaffected at that point | This session's transcript |
| Focused green state | `npx vitest run packages/extension/src/activation` | Exit 0 — 2 test files passed (7 tests: 3 in `activate.test.ts`, 4 in `runComparisonCommand.test.ts`) | This session's transcript |
| Focused green state (engine export) | `npx vitest run packages/engine/src/index` | Exit 0 — 1 test file passed, 4 tests passed | This session's transcript |
| Full verification | `npm run verify` | Exit 0 — typecheck clean, lint clean, **404 tests passed, 27 skipped** (22 test files passed, 2 skipped) — up from 396 passed/27 skipped baseline, a net +8 (4 new engine-index tests + 4 new command tests), no regressions | This session's transcript; also re-confirmed with explicit `echo "EXIT_CODE=$?"` → `EXIT_CODE=0` |

Test-count arithmetic: baseline 396 passed → final 404 passed. New tests
added: `packages/engine/src/index.test.ts` (4 tests) +
`packages/extension/src/activation/runComparisonCommand.test.ts` (4 tests)
= 8 new tests. 396 + 8 = 404, matching the observed final count exactly;
`activate.test.ts`'s own 3 tests are unchanged in count (only their mock
was extended, no test added/removed there). Skipped count (27) is
unchanged — those are the SQL Server/PostgreSQL integration tests that
skip without a live test container, untouched by this task.

## Assumptions and risks

- **Assumption (judgment call — UX):** The brief left the exact prompt
  mechanism to implementer judgment ("your judgment on the simplest correct
  UX, this is not a polished feature"). I used
  `vscode.window.showOpenDialog` filtered to `.paritylens`/`.yaml`/`.yml`
  extensions, defaulting to the first open workspace folder if any, over
  `showQuickPick`/`showInputBox` — this avoids requiring the user to type or
  remember a path and matches how VS Code extensions conventionally let a
  user pick a file from the workspace.
- **Assumption (judgment call — connection-name resolution):** The brief
  requires "`FixtureConnector` only," but does not specify how a parsed
  definition's arbitrary `source.connection`/`target.connection` string
  names should map onto fixture sides. I registered *whatever* two names
  the definition actually contains against the `"source"`/`"target"` sides
  of the single `sqlserver-customer` fixture pair (rather than, e.g.,
  requiring the author to use specific hardcoded names like
  `legacy-sql-prod`/`snowflake-analytics`), so any `.paritylens` file
  authored against this command works regardless of what its author named
  the connections. This is disclosed to the user via a
  `showInformationMessage` notice shown on every invocation (see
  `FIXTURE_ONLY_NOTICE` in `activate.ts`), not just a code comment — the
  reviewer note in TASK-BRIEF.md specifically asks this to be checked.
- **Known limitation, disclosed, not fixed (explicitly out of scope per
  brief):** This command can only ever run against the built-in
  `sqlserver-customer` fixture data. Real connection-profile resolution
  (SQL Server/Snowflake/PostgreSQL credentials via `SecretStore`) does not
  exist in any task yet and is explicitly unscheduled future work per the
  brief — not invented here.
- **Known limitation — not independently exercised end-to-end through the
  live `vscode.commands.registerCommand` callback (`showOpenDialog` → file
  read → `runComparisonCommand`) under a real extension host:** consistent
  with "how T-10/T-11 already test activation-adjacent code without a real
  extension host" (brief's own Green-state wording), only the extracted
  `runComparisonCommand(yamlText, deps)` function is directly tested. The
  thin `registerRunComparisonCommand` wrapper (dialog prompt, file read,
  wiring those into `runComparisonCommand`) is exercised only by TypeScript
  compiling against the real `vscode.d.ts` types during `npm run
  typecheck` — it is not covered by a mocked-`vscode` unit test calling the
  registered callback itself. I judged this consistent with the brief's own
  framing rather than a gap to close, but flagging it explicitly since it
  is a real, if intentional, testing-depth boundary.
- **Blockers:** None.

## Patch or commit identity

- **Branch:** `task/T-22-engine-export-and-run-command`
- **Commit:** recorded after this report is finalized and staged (see
  reconciliation step) — branch was created from `main` at commit
  `dab5db7` ("Integration (prompt 06): find and route the engine/extension
  wiring gap to T-22").

## Recommended next step

Independent review by a separate `reviewer` subagent instance, per
TASK-BRIEF.md's Handoff section. Per the brief's own reviewer note, please
specifically verify: (1) no file outside the three declared owned paths was
touched with logic changes (the one forced mock-only edit to
`activate.test.ts` is disclosed above — please judge whether that is
acceptable scope or should be revised); (2) `packages/engine/src/index.ts`'s
new exports are genuinely re-exports only; (3) both adversarial cases
(malformed YAML, and a YAML referencing/targeting content that fails inside
`runComparison`) produce a clean `showErrorMessage` call rather than a
thrown/unhandled exception — `runComparisonCommand.test.ts`'s last two
tests cover this, but an independent adversarial construction is
recommended per the brief; (4) the fixture-only limitation is genuinely
user-visible at runtime (via `showInformationMessage`), not just a code
comment. I do not have authority to self-approve this task and am not
recommending it be marked complete/approved in `PROGRESS-LEDGER.md` myself.
