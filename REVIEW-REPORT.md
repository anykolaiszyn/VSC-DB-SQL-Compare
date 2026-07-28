# ParityLens — Review Report T-10

## Review independence

This review was conducted by a separate `reviewer` subagent instance with
no memory of authoring the T-10 implementation. No implementation file,
`TASK-BRIEF.md`, or `IMPLEMENTATION-REPORT.md` was edited during this
review; only this `REVIEW-REPORT.md` was written, replacing the prior
T-09 review report that previously occupied this path. No throwaway probe
files were created during this review (all adversarial checks were done
via read-only `grep`/inspection and independent re-derivation of claims);
`git status --porcelain` confirms no residue beyond the pre-existing
`PROGRESS-LEDGER.md`/`TASK-BRIEF.md` orchestrator edits that predate this
review.

## Review scope

- **Task objective:** Scaffold the VS Code extension host: activation
  entry point, command registration, the "DATA PARITY" activity-bar tree
  view (Connections / Comparisons / Recent Runs), and a `SecretStore`
  wrapper around `vscode.SecretStorage`. No comparison logic.
- **Files and interfaces reviewed:**
  `packages/extension/src/activation/activate.ts` and `activate.test.ts`,
  `packages/extension/src/views/parityTreeDataProvider.ts` and
  `parityTreeDataProvider.test.ts`,
  `packages/extension/src/secrets/secretStore.ts` and
  `secretStore.test.ts`, `packages/extension/src/index.ts` (wiring-only
  change), `packages/extension/package.json`, `package-lock.json`,
  `TASK-BRIEF.md`, `IMPLEMENTATION-REPORT.md`, `AGENTS.md`.
- **Evidence reviewed:** Commit `372089d` ("T-10: scaffold VS Code
  extension shell (activation, tree view, SecretStore)"), the working
  tree at that commit, and a fresh independent `npm run verify` run.

## Critical findings

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| NONE | — | — | — |

## Important findings

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| NONE | — | — | — |

## Minor findings

| ID | Finding | Evidence | Suggested resolution |
| --- | --- | --- | --- |
| M-01 | No `@vscode/test-electron` (real extension-host) run was performed; activation, tree-view registration, and `main: "./dist/index.js"` module loading have not been exercised inside a genuine VS Code process — only against a hand-mocked `vscode` module under Vitest. | `activate.test.ts`/`parityTreeDataProvider.test.ts` both `vi.mock("vscode", ...)`. Disclosed proactively in `IMPLEMENTATION-REPORT.md`'s "Test harness choice" section. Reviewer independently confirmed the mocked shapes (`TreeItem` constructor, `EventEmitter`, `TreeItemCollapsibleState`) match the real `@types/vscode@1.85.0` declarations in `node_modules/@types/vscode/index.d.ts`, and confirmed `npm run verify`'s `tsc -b --force` step type-checks `activate.ts`/`parityTreeDataProvider.ts` against those *real* declaration files (not the mock) — so the call-shape contract (`vscode.window.createTreeView<T>(viewId, options): TreeView<T>`) is genuinely verified at the type level, narrowing the actually-unverified surface to extension-host runtime loading (module resolution of `dist/index.js`, activation-event dispatch timing). | Track as required scope for whichever future task first produces a real packaged/loadable build (T-16 or later packaging task) — add a `@vscode/test-electron` (or equivalent) smoke test at that point, not before. |

## Verification performed

| Check | Exact command or inspection | Result |
| --- | --- | --- |
| Fresh full verification | `npm run verify` | Exit 0. `typecheck` (`tsc -b --force`) clean, `lint` (`eslint .`) clean, `test` (`vitest run`): `Test Files 11 passed (11)`, `Tests 294 passed (294)` — exact match to `IMPLEMENTATION-REPORT.md`'s claim, no discrepancy |
| Arithmetic re-derivation of test counts | Independently summed engine test counts: `69+109+30+11+9+4+40` | 272; +11 (`packages/shared`) = 283 (pre-T-10 baseline); +11 (new `packages/extension` tests: 5 tree-provider + 3 secretStore + 3 activate) = 294. Matches report exactly. |
| Red-state plausibility | `git show main:packages/extension/src/index.ts` | Confirms the T-01 placeholder (`export const PLACEHOLDER = true`) was the only content pre-T-10 — consistent with the claimed red-state failure reason ("`activate`, `ParityTreeDataProvider`, `SecretStore` do not exist yet") |
| Credential-storage boundary (adversarial) | Read `secretStore.ts` in full; `grep -rn "globalState\|workspaceState" packages/extension/src` across the entire extension source tree, not just the secrets subdirectory | `secretStore.ts` holds only a private `vscode.SecretStorage` reference and delegates `get`/`set`/`delete` directly to `secrets.get`/`store`/`delete` — no other persistence path exists. The tree-wide grep matches only inside `secretStore.test.ts` (the deliberate negative-proof test using mocked `Memento`s) and a doc comment describing the constraint in prose; zero production-code hits. `activate.ts` was hand-traced separately and confirmed to construct `SecretStore` from `context.secrets` only, never passing `context.globalState`/`context.workspaceState` into any new code path. |
| Test-harness gap assessment (adversarial, per brief's specific ask) | Compared mocked `vscode.TreeItem` constructor and `window.createTreeView` call shape against real `@types/vscode@1.85.0` declarations (`node_modules/@types/vscode/index.d.ts`, confirmed installed at that exact version) | Mock is faithful for the narrow surface exercised; the type-level contract for the real API is independently checked by `tsc -b --force` (part of `npm run verify`), not just satisfied by the mock's shape. See Minor finding M-01 for the residual gap this doesn't close. |
| Scope/ownership | `git diff --stat main...HEAD` (or equivalent `git show 372089d --stat`) | Touches exactly: `packages/extension/src/activation/**` (new), `src/views/**` (new), `src/secrets/**` (new), `src/index.ts` (wiring-only, pre-authorized and disclosed), `package.json`/`package-lock.json` (dependency/manifest declaration, pre-authorized as "may be required"), plus `IMPLEMENTATION-REPORT.md`. No changes to `packages/shared/**` or `packages/engine/**`. |
| Residue check | `git status --porcelain` after completing this review | Only pre-existing `PROGRESS-LEDGER.md`/`TASK-BRIEF.md` orchestrator-dispatch edits remain; no reviewer-created files left behind |

## Prior-finding disposition

No prior open findings were scoped to be resolved by T-10.
`PROGRESS-LEDGER.md`'s open findings at the time of this review (I-01/I-02,
statement-safety residual gaps) concern `packages/engine`, which is outside
T-10's file ownership and untouched by this task.

## Approval status

- **Status:** APPROVED
- **Reviewer:** Claude Code Independent Reviewer subagent
- **Date:** 2026-07-28
- **Release or dependency impact:** T-10 complete. Unblocks T-11 (extends
  the tree view with real connection/comparison/run data) and any future
  connection-management task consuming `SecretStore`. One Minor finding
  (M-01, no real extension-host smoke test) is tracked forward to T-16 or
  the first packaging/publishing task rather than blocking this scaffold —
  the credential-storage boundary the brief specifically flagged as its
  top concern was independently traced end-to-end with no gaps, fresh
  `npm run verify` reproduces the claimed 294/294 exactly, and scope stayed
  within declared ownership throughout.
