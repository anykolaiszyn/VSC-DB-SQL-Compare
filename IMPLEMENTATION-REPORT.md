# ParityLens — Implementation Report T-10

## Status and objective

- **Status:** COMPLETE (implementation and evidence only — not self-approved;
  see Recommended next step)
- **Objective:** Scaffold the VS Code extension host: activation entry
  point, command registration, the "DATA PARITY" activity-bar tree view
  (Connections / Comparisons / Recent Runs, per `Idea Prompt.md` section
  6's sidebar sketch), and a `SecretStore` wrapper around VS Code's
  `SecretStorage` API for connection credentials. No comparison logic —
  this task wires the extension shell only.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/extension/src/activation/activate.ts` | New file | `activate(context)` entry point: constructs `ParityTreeDataProvider`, registers the tree view against `paritylens.dataParityView` via `vscode.window.createTreeView`, pushes the view onto `context.subscriptions` for disposal, and constructs `SecretStore` wrapping `context.secrets`. |
| `packages/extension/src/activation/activate.test.ts` | New file | Focused Vitest suite (mocked `vscode` module) proving `activate()` registers the tree view against the expected view ID, that `getChildren()` on the returned provider yields the three top-level sections, and that `SecretStore` is constructed and the tree view registered for disposal. |
| `packages/extension/src/views/parityTreeDataProvider.ts` | New file | `ParityTreeDataProvider implements vscode.TreeDataProvider<ParityTreeItem>`. Empty-state provider: `getChildren()` with no element returns the three top-level `ParityTreeItem` section nodes (Connections, Comparisons, Recent Runs); `getChildren()` under any section returns `[]`. Also exports `PARITY_SECTIONS`, `ParitySectionDefinition`, `ParityTreeItem`, and a `refresh()` method that fires `onDidChangeTreeData` (unused by this task's scope, provided for T-11 to extend). |
| `packages/extension/src/views/parityTreeDataProvider.test.ts` | New file | Focused Vitest suite (mocked `vscode` module) proving the three sections, `getTreeItem` identity, empty-state children under a section, and `refresh()` firing `onDidChangeTreeData`. |
| `packages/extension/src/secrets/secretStore.ts` | New file | `SecretStore` class wrapping `vscode.SecretStorage` (`context.secrets`) with `get(key)`, `set(key, value)`, `delete(key)`. Delegates directly to `secrets.get`/`secrets.store`/`secrets.delete` — holds no other persistence mechanism and never touches `globalState`/`workspaceState`/a file. |
| `packages/extension/src/secrets/secretStore.test.ts` | New file | Focused Vitest suite against a mocked in-memory `SecretStorage`: round-trip set/get/delete, `get()` returns `undefined` for an unset key, and an explicit negative-proof test that `globalState.update`/`workspaceState.update` (mocked `vscode.Memento`-shaped objects) are never called and their backing maps stay empty across a full set/get/delete cycle. |
| `packages/extension/src/index.ts` | Modified | Was the T-01 placeholder (`export const PLACEHOLDER = true`). Now re-exports `activate` from `./activation/activate` — the minimum wiring so VS Code's `main` entry point resolves to the real activation function. Per the brief's file-ownership note ("Do not touch `packages/extension/src/index.ts` beyond wiring it to call into the new `activation/**` entry point (record if you do this)") — recorded here as required. |
| `packages/extension/package.json` | Modified | Added `engines.vscode: "^1.85.0"` (target VS Code API version, matching the `@types/vscode` version installed), a minimal `activationEvents`/`contributes.viewsContainers`/`contributes.views` block (activity-bar container `paritylens` titled "Data Parity", one view `paritylens.dataParityView` activated `onView:`), changed `main` from `src/index.ts` to `./dist/index.js` (VS Code loads the compiled output, not a `.ts` source file — `tsc -b` already emits `dist/` per the existing `outDir` in `packages/extension/tsconfig.json`), and added `@types/vscode: ^1.85.0` as a devDependency. |
| `package-lock.json` | Modified | Lockfile update for the new `@types/vscode` devDependency (10 lines added, confirmed via `git diff --stat`). |

No files were added or modified outside `packages/extension/src/activation/**`,
`packages/extension/src/views/**`, `packages/extension/src/secrets/**`,
`packages/extension/src/index.ts` (wiring only, as disclosed above), and
`packages/extension/package.json`/`package-lock.json` (dependency
declaration only). `packages/shared/**` and `packages/engine/**` were not
touched.

## Behavior and interfaces

- **Behavior delivered:**
  1. **Activation.** `activate(context: vscode.ExtensionContext)` in
     `packages/extension/src/activation/activate.ts` is the extension's
     real activation entry point, exported through `src/index.ts`. It
     instantiates `ParityTreeDataProvider`, registers it against the
     `paritylens.dataParityView` view ID declared in `package.json`'s
     `contributes.views`, disposes the resulting `TreeView` through
     `context.subscriptions`, and constructs a `SecretStore` wrapping
     `context.secrets`. It returns `{ treeDataProvider, treeView,
     secretStore }` so tests (and, later, other activation-time wiring)
     can reach these instances directly rather than only through VS
     Code's own API surface.
  2. **Tree view.** `ParityTreeDataProvider` renders exactly the three
     top-level sections the brief names — Connections, Comparisons,
     Recent Runs — as an empty-state provider (no children under any
     section yet; that's later scope). `Idea Prompt.md` section 6's
     sketch also lists a fourth "Saved Profiles" section; it is
     deliberately omitted here because the brief's Interfaces table names
     only "Connections, Comparisons, Recent Runs" as this task's tree
     view contract — documented as a source comment in
     `parityTreeDataProvider.ts` so a future task doesn't mistake the
     omission for an oversight.
  3. **SecretStore.** A thin wrapper with `get`/`set`/`delete`, delegating
     directly to `vscode.SecretStorage`. It holds no reference to
     `globalState`/`workspaceState` and no file-write path at all, so
     there is no code path by which a credential could reach either —
     proven by the negative-assertion test described below.

- **Interfaces consumed:** `vscode.ExtensionContext`, `vscode.TreeView`,
  `vscode.TreeDataProvider`, `vscode.TreeItem`,
  `vscode.TreeItemCollapsibleState`, `vscode.EventEmitter`,
  `vscode.SecretStorage` — all from `@types/vscode@^1.85.0`, added as a
  devDependency of `packages/extension`.
- **Interfaces produced:**
  - `activate(context: vscode.ExtensionContext): ActivationResult` from
    `packages/extension/src/activation/activate.ts`, plus the exported
    constant `PARITY_TREE_VIEW_ID = "paritylens.dataParityView"`.
  - `ParityTreeDataProvider` (implements `vscode.TreeDataProvider<ParityTreeItem>`),
    `ParityTreeItem`, `PARITY_SECTIONS`, `ParitySectionDefinition`,
    `ParitySectionId` from `packages/extension/src/views/parityTreeDataProvider.ts`.
  - `SecretStore` (`get`/`set`/`delete`) from
    `packages/extension/src/secrets/secretStore.ts`.

## Test harness choice (documented per the brief's "pick a reasonable approach" instruction)

The brief allowed either `@vscode/test-electron` or "an equivalent VS Code
extension test harness." This implementation uses **Vitest with a mocked
`vscode` module** (`vi.mock("vscode", () => ({ ... }))`), not
`@vscode/test-electron`, for these reasons:

- `@vscode/test-electron` downloads and launches a real VS Code instance
  as a separate out-of-process test run, with its own runner (not
  Vitest) and its own CI wiring. Adding it would mean introducing a new
  test runner/dependency and a second `npm test`-equivalent invocation
  outside the existing `npm run verify` pipeline (`typecheck && lint &&
  test`, where `test` is `vitest run` across all workspaces) — a
  tooling/config change beyond this task's declared file ownership
  (`packages/extension/src/activation/**`, `src/views/**`,
  `src/secrets/**` only).
- The brief's own Red-state/Green-state sections specify the command as
  `npx vitest run packages/extension` (with the electron-harness
  alternative offered only if a different runner turns out to be
  required) — Vitest was already the expected default.
- The `vscode` module surface this code actually touches is narrow
  (`TreeItem`, `TreeItemCollapsibleState`, `EventEmitter`,
  `window.createTreeView`) and is mocked faithfully enough (documented
  inline in each test file) to exercise the real logic under test:
  `ParityTreeDataProvider`'s section list and empty-state children,
  `activate()`'s registration call and its exact arguments (including
  `expect.objectContaining({ treeDataProvider: expect.any(...) })`), and
  `SecretStore`'s delegation to `secrets.get`/`store`/`delete`.
- **Known limitation, disclosed per the brief's reviewer instruction**
  ("the reviewer must ... confirm that the tree view genuinely registers
  with VS Code's API contract rather than only satisfying a mocked test
  double"): this test suite proves `activate()` calls
  `vscode.window.createTreeView` with the correct view ID and a real
  `ParityTreeDataProvider` instance, and that `package.json`'s
  `contributes.views` declares a matching `paritylens.dataParityView`
  entry — but it does **not** prove the extension activates correctly
  inside a real VS Code extension host process (no `@vscode/test-electron`
  run was performed). This is a real, disclosed gap, not something I
  consider fully closed — I have not verified that VS Code's actual
  runtime accepts this manifest/activation code without adaptation
  (e.g. `main` pointing at `./dist/index.js`, which requires a
  `tsc -b` build to exist before the extension host can load it — no
  end-to-end `dist/` load was performed here, only `tsc -b --force`
  type-checking via `npm run verify`).

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Red state | `npx vitest run packages/extension` (run with `packages/extension/src/activation`, `src/secrets`, `src/views` temporarily absent) | Exit 0, `No test files found, exiting with code 0` — confirms no test files existed yet for `activate`/`ParityTreeDataProvider`/`SecretStore` before this task's files were restored, matching the brief's predicted failure reason ("`activate`, `ParityTreeDataProvider`, and `SecretStore` do not exist yet") | This report; captured directly from the terminal during this implementation session |
| Focused green state | `npx vitest run packages/extension` | Exit 0. `Test Files 3 passed (3)`, `Tests 11 passed (11)` — `parityTreeDataProvider.test.ts` (5), `secretStore.test.ts` (3), `activate.test.ts` (3) | This report; captured directly from the terminal |
| Full verification | `npm run verify` | Exit 0. `typecheck` (`tsc -b --force`) clean, `lint` (`eslint .`) clean, `test` (`vitest run`, all workspaces): `Test Files 11 passed (11)`, `Tests 294 passed (294)` — the prior 283 plus this task's 11 new extension tests, no regression | This report; captured directly from the terminal |

Full `npm run verify` test-file breakdown (11 files, 294 tests): the
existing 283 across `packages/shared` (11) and `packages/engine`
(type-mapping 69, statement-safety 109, definition 30, schema-diff 11,
profiling 9, planner 4, fixture-connector 40 = 272 — arithmetic:
69+109+30+11+9+4+40 = 272; 272+11 = 283, matching the pre-task baseline
stated in the dispatch prompt), plus this task's 11 new
`packages/extension` tests (5+3+3 = 11). 283 + 11 = 294, matching the
observed total exactly.

## Assumptions and risks

- **Assumptions:**
  - `@types/vscode@^1.85.0` is an acceptable target API version; no
    `DESIGN-SPEC.md` line pins an exact VS Code engine version, so this
    was a judgment call using a recent-but-not-bleeding-edge release line
    consistent with the extension not needing any VS Code API newer than
    the stable `TreeDataProvider`/`SecretStorage` surfaces used here.
  - "Connections / Comparisons / Recent Runs" (omitting "Saved Profiles"
    from `Idea Prompt.md` section 6's four-item sketch) is a deliberate
    scope boundary the brief's own Interfaces table draws, not an
    oversight — documented inline in `parityTreeDataProvider.ts` per the
    codebase's stated convention (`CLAUDE.md`: "Judgment calls are
    documented inline as source comments explaining *why*").
  - `main`: `./dist/index.js` assumes a `tsc -b` build step runs before
    the packaged extension loads in a real VS Code host; this task does
    not add a `vsix`-packaging or `vscode:prepublish` step (out of scope
    per the brief — deferred, along with real `@vscode/test-electron`
    verification, to whichever future task actually packages/publishes
    the extension, most likely at or after T-16 per the ledger's task
    list).
- **Risks or limitations:**
  - As disclosed above under "Test harness choice": no
    `@vscode/test-electron` run was performed, so activation has not been
    proven against a real VS Code extension host — only against a
    faithful-but-hand-written `vscode` module mock. The reviewer's brief
    explicitly calls this out as something to check; I am flagging it
    proactively rather than waiting to be asked.
  - `SecretStore.get`/`set`/`delete` are thin pass-throughs with no
    additional validation (e.g. no key-format enforcement). This matches
    the brief's stated contract ("Thin wrapper ... providing `get(key)`,
    `set(key, value)`, `delete(key)`") — no more, no less — so this is a
    deliberate minimalism, not an oversight, but a future
    connection-management task will likely want key-naming conventions
    layered on top.
- **Blockers:** None.

## Patch or commit identity

- **Patch or commit:** Uncommitted at time of writing this report — all
  changes are in the working tree on branch `task/T-10-extension-scaffold`.
  `git status --porcelain` at report time:
  ```
   M PROGRESS-LEDGER.md
   M TASK-BRIEF.md
   M package-lock.json
   M packages/extension/package.json
   M packages/extension/src/index.ts
  ?? packages/extension/src/activation/
  ?? packages/extension/src/secrets/
  ?? packages/extension/src/views/
  ```
  `PROGRESS-LEDGER.md` and `TASK-BRIEF.md` were modified by the Lead
  Orchestrator dispatching this task (not by this implementation) —
  outside this task's file ownership and not touched further here.
- **Branch or workspace:** `task/T-10-extension-scaffold` (per the
  brief's Handoff section)

## Recommended next step

Recommend independent review by a separate Claude Code subagent instance,
per the brief's Handoff section — distinct from this implementer. The
reviewer should specifically re-verify (not just re-read) that no
credential-shaped value can reach `globalState`/`workspaceState`/a file
(the negative-assertion test in `secretStore.test.ts` plus direct
inspection of `secretStore.ts`'s implementation, which holds no reference
to either Memento), and independently judge the disclosed
`@vscode/test-electron` gap — whether the mocked-`vscode` Vitest approach
is sufficient evidence for this task's scope or whether a real
extension-host run should be required before approval. This report does
not claim review or approval status; only the independent reviewer and
the human decision maker can grant that.
