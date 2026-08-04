# TASK-BRIEF.md — T-41: Tree view title command buttons

## Objective

Implement the `contributes.menus` entries named in `IMPLEMENTATION-PLAN.md`'s
Phase 6 table for T-41: `view/title` navigation buttons (a `+`-style icon,
using a built-in codicon) on the "Connections" and "Comparisons" tree
sections, invoking `paritylens.addConnection` and `paritylens.newComparison`
respectively. Addresses self-service gap-analysis Finding 2
(command-palette-only discovery) — today the only way to discover these two
commands is `Ctrl+Shift+P` and typing "ParityLens", with zero in-tree
affordance.

## Scope

1. Confirm the red state: read `packages/extension/package.json`'s current
   `contributes` block and confirm no `contributes.menus` key exists today
   (it does not, as of this brief; T-40 added `viewsWelcome` but not
   `menus`).
2. Read `packages/extension/src/views/parityTreeDataProvider.ts` in full to
   confirm the exact section `id`s the "Connections" and "Comparisons"
   `ParityTreeItem` nodes carry (`section.id`, via `PARITY_SECTIONS`) and
   their `contextValue` (`paritylens.section.${section.id}`) — VS Code
   `view/item/context` menu contributions key off an item's `contextValue`
   via a `viewItem ==` `when` clause, but `view/title` contributions
   (the scope of this task, per the brief's "navigation button" framing —
   a `+`-style icon shown in the view's title bar, not per-row) key off the
   *view* id (`paritylens.dataParityView`) only, since VS Code's `view/title`
   menu group is view-scoped, not per-tree-item-scoped. Confirm which of the
   two (`view/title` vs. per-item `view/item/context`) actually matches
   "navigation buttons on the Connections/Comparisons tree sections" as
   literally describable in `package.json` — VS Code does not support a
   title-bar-style icon button scoped to one specific top-level tree item
   inside a single view; only `view/item/context`
   (right-click-context-menu, or inline via `"group": "inline"`) can target
   a specific item. Since the brief calls for "navigation buttons on the
   Connections/Comparisons sections" (not the whole view), use
   `view/item/context` with `"group": "inline"` (renders as an inline
   icon button on the specific tree row, VS Code's standard pattern for
   "add" affordances on tree sections — e.g. how the built-in Source
   Control view adds inline `+` buttons per repository row) and a `when`
   clause matching each section's exact `contextValue`
   (`viewItem == paritylens.section.connections` /
   `viewItem == paritylens.section.comparisons`), not a whole-view
   `view/title` entry. Document this reasoning in
   `IMPLEMENTATION-REPORT.md` since it's a deliberate interpretation of the
   brief's "navigation button" language against VS Code's actual menu
   contribution points.
3. Add two `contributes.menus["view/item/context"]` entries:
   - `paritylens.addConnection`, `when: "view == paritylens.dataParityView && viewItem == paritylens.section.connections"`, `group: "inline"`, using codicon `add` (a real, published VS Code codicon id) as the command's `icon` field in `contributes.commands`.
   - `paritylens.newComparison`, `when: "view == paritylens.dataParityView && viewItem == paritylens.section.comparisons"`, `group: "inline"`, same `add` codicon.
4. Add an `icon` field (VS Code's `{ "light": ..., "dark": ... }` object
   form is unnecessary here — a bare codicon reference via
   `"icon": "$(add)"` inside the menu contribution itself, or an `icon`
   field on the command definition, per VS Code's documented two supported
   forms; read the VS Code extension manifest schema reference if unsure
   which form `contributes.menus` entries actually use — menu-contribution
   icons are set via the menu item's own `when`-adjacent fields, not
   necessarily the command's `contributes.commands` entry; verify the
   correct field before writing it, do not guess) to both new menu entries.
   Do not invent a codicon name — `add` is confirmed real and commonly used
   for exactly this "add new item" affordance.

## Files owned

- `packages/extension/package.json` (`contributes.menus`, and if the
  codicon must be declared on the command entry rather than the menu
  entry, the relevant `icon` field under `contributes.commands` for
  `paritylens.addConnection`/`paritylens.newComparison` only — no other
  command's `icon` field)

## Interfaces consumed

- `paritylens.addConnection` / `paritylens.newComparison` command IDs
  (T-29/T-32, read-only reference — do not modify their registration)
- `ParitySectionId`/`PARITY_SECTIONS`/`contextValue` shape from
  `parityTreeDataProvider.ts` (T-10/T-33, read-only reference — do not
  modify this file)

## Prohibited changes

- Do not modify `parityTreeDataProvider.ts` (read-only reference only).
- Do not modify T-40's `viewsWelcome` entry.
- Do not register any new command or change any existing command's
  behavior — this task is a declarative `package.json` menu-contribution
  addition only.
- Do not add a new npm dependency or new icon asset — built-in codicons
  only.

## Red-state evidence required

Confirmation (via reading `package.json`) that no `contributes.menus` key
exists today.

## Green-state evidence required

1. The scoped diff across the owned files.
2. A test (`package.json`-shape test, same disclosed-approach pattern T-40
   used for `viewsWelcome`, since `contributes.menus` is likewise
   declarative JSON with no unit-testable runtime rendering hook) confirming:
   - exactly two `view/item/context` entries exist, each referencing a real,
     already-registered command ID;
   - each entry's `when` clause correctly scopes to
     `paritylens.dataParityView` AND the correct section's `contextValue`
     (not the whole view, not the wrong section);
   - each entry's `group` is `"inline"`;
   - the codicon reference used (`add`) is applied consistently and
     correctly per whichever field VS Code's schema actually requires.
3. A full fresh `npm run verify` passing with no regression versus the
   637/637 (T-40-inclusive) baseline; report the before/after test count
   (this task adds no new runtime logic, so the count should grow only by
   the new shape-test cases, not shrink or otherwise change).

## Handoff

- Write `IMPLEMENTATION-REPORT.md` using
  `multi-agent-idea-to-app/templates/IMPLEMENTATION-REPORT.md`.
- Commit on branch `task/T-41-tree-view-title-buttons`.
- Recommend independent review as the next step.
- Reviewer should specifically re-verify: (1) every referenced codicon name
  is a real, published VS Code codicon (spot-check against the codicon
  reference, same discipline T-34's review applied to `ThemeIcon`/
  `ThemeColor` ids); (2) the `when` clauses genuinely scope to the correct
  section and don't accidentally show both buttons on both sections or on
  every tree row (adversarially reason through the `viewItem` matching,
  e.g. would a `ParityComparisonTreeItem` child row under "Comparisons"
  ever match `viewItem == paritylens.section.comparisons` — it must not,
  since its own `contextValue` is `paritylens.comparisonFile`, a different
  string); (3) the `when` clauses don't clash with T-40's `viewsWelcome`
  state (both should coexist correctly — a `view/item/context` inline
  button is scoped per-row and is orthogonal to `viewsWelcome`'s
  whole-view-empty overlay, so there should be no real conflict, but
  confirm this reasoning rather than assuming it); (4) a fresh full
  `npm run verify` is green with the reported test count.
