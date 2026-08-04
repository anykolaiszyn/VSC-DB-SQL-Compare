# ParityLens — Implementation Report T-41

## Status and objective

- **Status:** COMPLETE (implementation and evidence only — not reviewed or approved)
- **Objective:** Per `TASK-BRIEF.md`: implement the `contributes.menus` entries
  named in `IMPLEMENTATION-PLAN.md`'s Phase 6 table for T-41 — a `+`-style
  icon (built-in codicon) on the "Connections" and "Comparisons" tree
  sections, invoking `paritylens.addConnection` and `paritylens.newComparison`
  respectively, addressing self-service gap-analysis Finding 2
  (command-palette-only discovery of these two commands).

## Interpretation of "navigation buttons" vs. VS Code's actual menu contribution points

The brief's Scope item 2 requires this reasoning to be documented here
before describing the change.

`IMPLEMENTATION-PLAN.md`'s T-41 row and the brief's Objective both use the
phrase "`view/title` navigation button." However, VS Code's `view/title`
menu group is scoped to the *view as a whole* (`paritylens.dataParityView`),
not to one specific top-level tree item inside that view — there is no
`package.json`-declarable way to make a `view/title` button appear only
next to the "Connections" row versus the "Comparisons" row; a `view/title`
entry would render once, in the view's title bar, regardless of which
section is expanded/selected.

The brief itself (Scope item 2, verbatim) resolves this in favor of
`view/item/context` with `"group": "inline"`:

> "Since the brief calls for 'navigation buttons on the Connections/
> Comparisons sections' (not the whole view), use `view/item/context` with
> `"group": "inline"` (renders as an inline icon button on the specific tree
> row, VS Code's standard pattern for 'add' affordances on tree sections —
> e.g. how the built-in Source Control view adds inline `+` buttons per
> repository row) and a `when` clause matching each section's exact
> `contextValue`."

This is what was implemented: two `view/item/context` entries, each with
`group: "inline"` and a `when` clause combining the view ID with the
section's exact `contextValue` (confirmed by reading
`parityTreeDataProvider.ts`'s `ParityTreeItem` constructor:
`this.contextValue = \`paritylens.section.${section.id}\`;`, giving
`paritylens.section.connections` and `paritylens.section.comparisons`
exactly, for the two `PARITY_SECTIONS` entries of those IDs). No
`view/title` entry was added — it would not have satisfied the
section-scoped requirement.

## Icon field placement: command-level, not menu-item-level

The brief's Scope item 4 required verifying against VS Code's actual
schema which field carries the codicon reference, rather than guessing.
Fetched VS Code's `contributes.menus`/`contributes.commands` documentation
(`https://code.visualstudio.com/api/references/contribution-points`) and
confirmed: an individual `contributes.menus` entry supports only
`command`/`when`/`group`/`alt` — no `icon` field of its own. A contributed
command's icon is declared once on its `contributes.commands` entry (either
a `{ "light": ..., "dark": ... }` path pair, or a bare codicon reference
string, e.g. `"icon": "$(add)"`), and VS Code applies that icon wherever the
command is rendered as a button, including inline `view/item/context`
group entries. The `icon` field was therefore added to the
`contributes.commands` entries for `paritylens.addConnection` and
`paritylens.newComparison` only — no other command's `icon` field was
touched, and no `icon` field was added to either menu entry itself.

`add` was used as specified by the brief ("Do not invent a codicon name —
`add` is confirmed real and commonly used for exactly this 'add new item'
affordance") — this is a real, published VS Code codicon ID (a plus-sign
glyph), consistent with its use elsewhere in VS Code (e.g. Source Control's
inline repository-add button) for exactly this "add new item" affordance.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/extension/package.json` | Added `contributes.menus["view/item/context"]` (two entries: `paritylens.addConnection` scoped to `paritylens.section.connections`, `paritylens.newComparison` scoped to `paritylens.section.comparisons`, both `group: "inline"`); added `"icon": "$(add)"` to the `contributes.commands` entries for those same two commands only. | T-41 objective — inline "add" affordances on the Connections/Comparisons tree sections, addressing gap-analysis Finding 2. |
| `packages/extension/src/views/treeViewMenus.test.ts` (new) | Shape test asserting: exactly two `view/item/context` entries exist; each references a real registered command ID; each `when` clause scopes to the correct view AND the correct section's `contextValue` (not the whole view, not the wrong section, not a child-row `contextValue` like `paritylens.comparisonFile`/`paritylens.recentRun`); each `group` is `"inline"`; the `add` codicon is declared via `$(add)` on the two commands' `contributes.commands` entries and no other command's `icon` field was touched. | Required green-state evidence per the brief's "Green-state evidence required" item 2 — `contributes.menus` is declarative JSON with no unit-testable runtime rendering hook, so (per the same disclosed-approach pattern T-40 used for `viewsWelcome` in `hasNoContent.test.ts`) this test asserts on the manifest shape itself. |

**Note on file ownership, disclosed rather than silently expanded:** the
brief's "Files owned" section lists only `packages/extension/package.json`.
The brief's own "Green-state evidence required" item 2, however, explicitly
mandates a test proving the menu-contribution shape (following T-40's
disclosed pattern). Since `contributes.menus` has no unit-testable runtime
hook to attach to an *existing* owned test file (T-41 owns no `.ts` test
file at all), satisfying the brief's own evidence requirement necessitated
creating one new test file. `treeViewMenus.test.ts` was placed alongside
the read-only-reference `parityTreeDataProvider.ts` in `src/views/` (the
directory whose contract this test verifies against) as the smallest
reasonable judgment call, and is called out here explicitly rather than
folded in silently, per the operating contract's rule that a
brief-mandated edit outside the literal file list must be flagged for a
reviewer's judgment. `parityTreeDataProvider.ts` itself was **not**
modified — read-only reference only, as the brief requires.

## Behavior and interfaces

- **Behavior delivered:** In the "Data Parity" activity-bar tree view, an
  inline `+` (codicon `add`) icon button now renders on the "Connections"
  row, invoking `paritylens.addConnection` when clicked, and on the
  "Comparisons" row, invoking `paritylens.newComparison` — both discoverable
  without opening the command palette, addressing gap-analysis Finding 2.
  No other tree row (including comparison-file and recent-run child rows)
  gains a button, since the `when` clauses are scoped to the exact section
  `contextValue`s only.
- **Interfaces consumed:** `paritylens.addConnection` / `paritylens.newComparison`
  command IDs (T-29/T-32, referenced only — registration untouched);
  `ParitySectionId`/`PARITY_SECTIONS`/`contextValue` shape from
  `parityTreeDataProvider.ts` (T-10/T-33, read only — file untouched).
- **Interfaces produced:** None — this is a declarative manifest addition
  with no new exported TypeScript symbol. The two new `contributes.commands`
  `icon` fields and the new `contributes.menus["view/item/context"]` array
  are the only new manifest-level surface.

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline (pre-change) | `npm run verify` | Exit 0. 637 passed \| 27 skipped (664 total), 35 test files passed \| 2 skipped (37). | Captured in this session before any edit. |
| Red state | `npx vitest run packages/extension/src/views/treeViewMenus.test.ts` (test file written against the pre-change `package.json`, which had no `contributes.menus` key — confirmed by reading the file directly) | Exit 1. 5 of 8 tests failed for the predicted reason: `expected manifest.contributes.menus to be defined` (received `undefined`), `expected undefined to be 'view == paritylens.dataParityView && viewItem == paritylens.section.connections'`, `expected undefined to be 'view == paritylens.dataParityView && viewItem == paritylens.section.comparisons'`, and `expected undefined to be '$(add)'` (icon field, twice). 3 of 8 passed trivially (assertions over an empty/undefined menus object, e.g. "does not scope to comparisonFile/recentRun" vacuously true). | Captured in this session's transcript. |
| Focused green state | `npx vitest run packages/extension/src/views/treeViewMenus.test.ts` (after the `package.json` edit) | Exit 0. 8 of 8 tests passed. | Captured in this session's transcript. |
| Full verification | `npm run verify` (`tsc -b --force` && `eslint .` && `vitest run`, in that order) | Exit 0. Typecheck clean, lint clean, tests: 36 test files passed \| 2 skipped (38 total); 645 tests passed \| 27 skipped (672 total). Net gain of exactly 8 tests over the 637/637 (T-40-inclusive) baseline — the 8 new `treeViewMenus.test.ts` cases — with zero shrinkage or other change elsewhere. | Captured in this session's transcript; also saved to `C:\Users\alexn\AppData\Local\Temp\claude\V--Secret-Projects-VSC-DB-SQL-Compare\46d87bff-0647-4762-9ba4-ee6c1f665978\scratchpad\verify_out.txt`. |

## Assumptions and risks

- **Assumptions:**
  - `add` is the correct codicon ID for an "add new item" affordance. This
    was not independently re-verified against the live codicon font/icon
    reference site inside this task (only cross-checked against the
    brief's own explicit confirmation and VS Code's documented convention
    of using it for this exact affordance elsewhere, e.g. Source Control).
    The brief's Handoff section explicitly flags this as a reviewer
    spot-check item — see Recommended next step below.
  - The VS Code contribution-points documentation fetched via `WebFetch`
    (summarized, not the raw schema JSON) accurately reflects the current
    manifest schema's field set for `contributes.menus` entries (no `icon`
    field there) and `contributes.commands` entries (`icon` field
    supported, string or light/dark object form). This is standard,
    long-stable VS Code API surface, not a recent/beta feature, so drift
    risk is low.
- **Risks or limitations:**
  - No manual Extension Development Host check was performed to visually
    confirm the inline button actually renders as expected in a live VS
    Code window — per the brief's own framing (matching T-40's precedent),
    this is disclosed as the accepted approach given `contributes.menus`
    has no unit-testable runtime rendering hook in this repo's plain
    Vitest suite, not an oversight.
  - `treeViewMenus.test.ts` is a new file not listed in the brief's "Files
    owned" section — disclosed explicitly above (not folded in silently)
    as a brief-mandated minimal necessary addition, per the operating
    contract's rule for exactly this situation.
- **Blockers:** None.

## Patch or commit identity

- **Patch or commit:** (recorded after commit — see below; this report is
  committed together with the change per the brief's Handoff instruction
  to "Commit your work before finishing.")
- **Branch or workspace:** `task/T-41-tree-view-title-buttons`

## Recommended next step

Independent review by a separate reviewer agent, per the brief's Handoff
section, specifically re-verifying:

1. Every referenced codicon name (`add`) is a real, published VS Code
   codicon — spot-check against the codicon reference, same discipline
   T-34's review applied to `ThemeIcon`/`ThemeColor` IDs.
2. The `when` clauses genuinely scope to the correct section and don't
   accidentally show both buttons on both sections or on every tree row —
   adversarially reason through whether a `ParityComparisonTreeItem` child
   row under "Comparisons" (`contextValue = "paritylens.comparisonFile"`)
   could ever match `viewItem == paritylens.section.comparisons` (it must
   not, since it's a different string).
3. The `when` clauses don't clash with T-40's `viewsWelcome` state (both
   should coexist correctly since an inline `view/item/context` button is
   per-row and orthogonal to `viewsWelcome`'s whole-view-empty overlay —
   confirm this reasoning rather than assuming it).
4. A fresh full `npm run verify` is green with the reported test count.

This report does not itself constitute review, approval, or a claim that
the task is complete beyond implementation-and-evidence scope.
