# ParityLens — Review Report T-41

## Review independence

This review was performed by an independent reviewer instance, not the
implementer. No implementation-owned file (`packages/extension/package.json`,
`packages/extension/src/views/treeViewMenus.test.ts`) was edited during this
review. Findings below are derived from the actual diff, the actual current
source of every changed file, a fresh `npm run verify` run in this session,
and independent web verification of the VS Code codicon and manifest-schema
claims — not from trusting `IMPLEMENTATION-REPORT.md`'s characterization of
its own work.

## Review scope

- **Task objective:** Per `TASK-BRIEF.md` — add two `contributes.menus`
  entries providing an inline "add" affordance (codicon `add`) on the
  "Connections" and "Comparisons" tree sections of the Data Parity view,
  invoking `paritylens.addConnection` / `paritylens.newComparison`,
  addressing self-service gap-analysis Finding 2 (command-palette-only
  discovery).
- **Files and interfaces reviewed:**
  - `packages/extension/package.json` (full diff against `main`)
  - `packages/extension/src/views/treeViewMenus.test.ts` (new file, read in
    full)
  - `packages/extension/src/views/parityTreeDataProvider.ts` (read in full,
    confirmed untouched — read-only reference per the brief)
  - `IMPLEMENTATION-REPORT.md`
  - `TASK-BRIEF.md`, `AGENTS.md`
- **Evidence reviewed:** `git diff main..task/T-41-tree-view-title-buttons`
  (full diff and `--stat`/`--name-only`), a fresh `npm run verify` run in
  this session, VS Code codicon reference and contribution-points
  documentation fetched independently, VS Code `viewsWelcome` entry from
  T-40 read directly from the current `package.json`.

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
| T-41-01 | No manual Extension Development Host visual check was performed to confirm the inline button actually renders as expected in a live VS Code window; the only evidence is a manifest-shape unit test. This is explicitly disclosed by the implementer (matching T-40's precedent) rather than hidden, and `contributes.menus` genuinely has no unit-testable runtime rendering hook in this repo's plain Vitest suite, so it is not a blocking gap — but it remains a real, undischarged verification gap for a declarative UI contribution (a typo in a codicon name or a `when`-clause syntax error could still slip through a shape test that only checks the JSON's own internal consistency, not that VS Code accepts and renders it). | `IMPLEMENTATION-REPORT.md` "Risks or limitations"; `treeViewMenus.test.ts` only parses/asserts on the raw JSON, never loads it through `vscode`'s extension host. | Track as follow-up debt (e.g. add to a future manual-smoke-test pass before release, or the next task that already opens an Extension Development Host for another reason) rather than blocking this task. |

## Verification performed

| Check | Exact command or inspection | Result |
| --- | --- | --- |
| Fresh full verification | `npm run verify` (this session, on `task/T-41-tree-view-title-buttons`) | Exit 0. Typecheck clean, lint clean. `Test Files: 36 passed \| 2 skipped (38)`; `Tests: 645 passed \| 27 skipped (672)`. Matches the implementer's claimed count exactly — no discrepancy. |
| Diff scope | `git diff main..task/T-41-tree-view-title-buttons --name-only` | Exactly 3 files changed: `IMPLEMENTATION-REPORT.md`, `packages/extension/package.json`, `packages/extension/src/views/treeViewMenus.test.ts`. `package.json` is the sole declared "Files owned" entry; the new test file is disclosed in the report as a brief-mandated addition (the brief's own "Green-state evidence required" item 2 requires a shape test, and T-41 owned no pre-existing test file to extend) — judged a minimal, brief-forced consequence, not unauthorized scope expansion. |
| `parityTreeDataProvider.ts` untouched | `git diff main..task/T-41-tree-view-title-buttons -- packages/extension/src/views/parityTreeDataProvider.ts` | Empty diff — confirmed read-only, as the brief requires (Prohibited changes). |
| `contextValue` strings, read directly from source | Read `parityTreeDataProvider.ts` in full | `ParityTreeItem.contextValue = \`paritylens.section.${section.id}\`` → exactly `paritylens.section.connections` / `paritylens.section.comparisons` for the two `PARITY_SECTIONS` entries of those IDs. `ParityComparisonTreeItem.contextValue = "paritylens.comparisonFile"` (child row under Comparisons). `ParityRecentRunTreeItem.contextValue = "paritylens.recentRun"` (child row under Recent Runs). All four strings are distinct; the new `when` clauses use plain `==` equality (not a prefix/regex match), so a child row's `contextValue` can never satisfy `viewItem == paritylens.section.connections` or `viewItem == paritylens.section.comparisons` — confirmed by direct string comparison, not assumption. |
| `when`-clause correctness, read directly from the diff | `git diff main..task/T-41-tree-view-title-buttons -- packages/extension/package.json` | `paritylens.addConnection`: `"when": "view == paritylens.dataParityView && viewItem == paritylens.section.connections"`, `"group": "inline"`. `paritylens.newComparison`: `"when": "view == paritylens.dataParityView && viewItem == paritylens.section.comparisons"`, `"group": "inline"`. Both scoped to the correct view AND the correct, distinct section — not the whole view, not each other's section, not any child-row contextValue. |
| T-40 `viewsWelcome` orthogonality | `grep -n "viewsWelcome" -A 15` / `grep -n "dataParityView"` on the current `package.json` | T-40's `viewsWelcome` entry: `"when": "view == paritylens.dataParityView && paritylens.hasNoContent"` — a separate custom context key (`paritylens.hasNoContent`) gates a whole-tree-body replacement overlay shown only when the tree provider yields zero content. `ParityTreeDataProvider.getChildren()` (read in full) always returns the three `PARITY_SECTIONS` top-level items regardless of content state, so the section rows (and therefore the new inline buttons) and the welcome overlay are mutually exclusive render states driven by different VS Code mechanisms (`viewsWelcome` vs. per-item `view/item/context`) — genuinely orthogonal, not just presumed so. |
| Codicon `add` is real and published | Fetched `https://microsoft.github.io/vscode-codicons/dist/codicon.html` and cross-checked via web search | Confirmed: `add` (`codicon-add` / `$(add)`) is a real, published codicon in the VS Code codicon set, listed alongside `add-small`/`add-compact` as a distinct base icon — matches its documented use elsewhere in VS Code (e.g. Source Control's inline per-repository add button), consistent with the implementer's and brief's claim. |
| `contributes.menus`/`contributes.commands` icon-field schema | Fetched `https://code.visualstudio.com/api/references/contribution-points` | Confirmed: an individual `contributes.menus` entry supports only `command`/`when`/`group`/`alt`(/`submenu`) — no `icon` field of its own. `contributes.commands` entries support `icon` as either a light/dark path-pair object or a bare `"$(codiconName)"` string, applied wherever the command renders as a button (including inline `view/item/context` group entries). The implementation places `"icon": "$(add)"` on the `contributes.commands` entries for the two target commands only (verified via `grep -n "\"icon\""` — exactly 2 new `$(add)` occurrences, plus one pre-existing, unrelated `media/icon.svg` extension icon at a different key) — matches this confirmed schema. |
| `view/title` vs. `view/item/context` API-constraint reasoning | Independent reasoning from VS Code extension API knowledge, cross-checked against the fetched contribution-points documentation | Confirmed real: VS Code's `view/title` menu group is keyed only by `view ==` in its `when` clause — there is no `viewItem`-equivalent scoping for `view/title` entries, so a `view/title` button cannot be restricted to one specific top-level tree item within a single view. `view/item/context` (optionally with `group: "inline"` to render as a row-level icon rather than only in the right-click context menu) is the only contribution point that can key off a specific item's `contextValue`. The brief's own Scope item 2 already resolves this in favor of `view/item/context`/`inline`, and the implementer's report correctly follows and documents that resolution rather than second-guessing or silently deviating from it. |
| Command IDs referenced are real, already-registered, unmodified | `packages/extension/package.json` `contributes.commands` array (read in full via diff and grep) | `paritylens.addConnection` and `paritylens.newComparison` both pre-exist in `contributes.commands` (T-29/T-32); only their `icon` field changed, no `command` ID, `title`, or registration/behavior changed. Matches the brief's "Interfaces consumed... read-only reference — do not modify their registration." |
| Adversarial probe: could any other `contextValue` in the codebase accidentally collide with the two new `when` clauses | Read `parityTreeDataProvider.ts` in full — it is the sole file that sets `contextValue` for Data Parity tree items | Only four `contextValue` values exist in the tree provider: `paritylens.section.connections`, `paritylens.section.comparisons`, `paritylens.section.recentRuns` (implicit, via the `ParityTreeItem` constructor for the third section, not targeted by either menu entry), `paritylens.comparisonFile`, `paritylens.recentRun`. None collide with either new `when` clause's exact-match target. |
| Test file correctness | Read `treeViewMenus.test.ts` in full | 8 tests: exactly-two-entries, both commands registered, each `when` clause's exact string (not just substring/contains), a negative assertion that neither `when` clause contains the child-row contextValues, both entries' `group === "inline"`, both commands' `icon === "$(add)"`, and a negative assertion that no other command gained an `icon` field. All 8 pass in the fresh run; assertions are exact-equality on the parsed JSON, not loosely shaped — no test-quality gap found. |

## Prior-finding disposition

No prior open finding was assigned to this task for resolution (T-41 is new
scope, not a fix for a previously disclosed defect). `PROGRESS-LEDGER.md`'s
existing open findings (I-01/I-02, statement-safety residual gaps; T-34-01,
resolved by T-47 per `parityTreeDataProvider.ts`'s own comments) are
unrelated to this task's file ownership and are not touched or claimed
resolved here.

| Finding ID | Disposition | Evidence of resolution |
| --- | --- | --- |
| NONE | N/A — first review round for T-41 | — |

## Approval status

- **Status:** APPROVED
- **Reviewer:** Independent Reviewer (T-41)
- **Date:** 2026-08-03
- **Release or dependency impact:** None blocking. Zero Critical, zero
  Important findings. One Minor finding (T-41-01, no manual Extension
  Development Host visual smoke test) is disclosed, non-blocking, and
  recommended for tracking as follow-up debt — consistent with the
  project's own risk framing that `contributes.menus` has no in-repo
  unit-testable runtime rendering hook, and the shape test plus independent
  schema/codicon verification performed in this review provide sufficient
  confidence for approval. Fresh `npm run verify` reproduced the
  implementer's claimed 645 passed / 27 skipped (672 total) exactly, with
  no regression from the 637/637 T-40-inclusive baseline (net +8 tests, all
  from the new shape test file). Scope, file ownership, `contextValue`
  matching, codicon validity, manifest-schema field placement, and
  orthogonality with T-40's `viewsWelcome` were all independently
  re-derived from source rather than accepted from the implementation
  report.
