# TASK-BRIEF.md — T-53: Connections tree lists saved profiles

## Objective

Fix a release-blocking defect found during the release (prompt 07)
human-driven smoke test, 2026-08-04: the "Connections" section of the
DATA PARITY tree view never lists saved connection profiles. Connections
persist and are fully functional (usable by real comparison runs, editable,
deletable), but the tree always shows "Connections" as an empty, permanently
collapsed-with-nothing-inside section — a user has no way to see what
connections they've already configured without going through Edit/Delete's
own `showQuickPick` name list.

Root cause, confirmed by direct source read:
`ParityTreeDataProvider.getChildren` (`packages/extension/src/views/parityTreeDataProvider.ts`,
~line 224-236) explicitly special-cases `"connections"` to always return `[]`,
with an inline comment `// "connections" stays empty-state — out of this
task's scope.` — this was T-33's own documented, correct scope boundary at
the time (T-33's plan row named only "Comparisons" and "Recent Runs"), never
picked up by a later task. `ParityTreeDataProviderDeps` also has no injected
way to list saved profiles today — `findComparisonFiles`/`listRecentRuns`
exist for the other two sections, but nothing equivalent for connections.

A second, related defect confirmed during the same investigation: no
production code anywhere calls `treeDataProvider.refresh()` — grepped
`packages/extension/src` and found zero non-test call sites. This means even
once Connections has real children, the tree will not visually update after
an add/edit/delete until VS Code happens to re-query it for an unrelated
reason (e.g. window refocus). Both defects must be fixed together, since
fixing only the data source without the refresh wiring would just move the
"invisible until reload" symptom rather than resolve it.

## Scope

1. Add a new injected dependency to `ParityTreeDataProviderDeps`, e.g.
   `listConnectionProfiles: () => ConnectionProfile[]` (a synchronous
   zero-arg function — `ConnectionProfileStore.list()` is already
   synchronous, read `packages/extension/src/connections/connectionProfileStore.ts`
   to confirm its exact signature before wiring).
2. In `getChildren`, replace the `"connections"` branch's hardcoded `[]`
   with a real listing built from `this.deps.listConnectionProfiles()` (guard
   the no-`deps` case the same way `getComparisonChildren`/`getRecentRunChildren`
   already do — return `[]` if `this.deps` is undefined).
3. Add a new tree-item class for a connection row (e.g.
   `ParityConnectionTreeItem`), following `ParityComparisonTreeItem`/
   `ParityRecentRunTreeItem`'s existing established pattern exactly: a
   `contextValue` (e.g. `"paritylens.connectionProfile"`, distinct from
   every other existing `contextValue` in this file — confirm no collision),
   a sensible `ThemeIcon` (a plain, uncolored icon is fine — no outcome
   state exists for a saved connection the way `iconForRunStatus` needs one
   for a run), and a label showing at minimum the profile's `name`.
   **Do not** wire a `command` on this new tree item that invokes
   `editConnectionCommand`/`deleteConnectionCommand` directly with the
   clicked profile pre-selected unless you confirm those command handlers
   already accept an optional pre-selected profile argument — if they don't
   (they currently always re-prompt via `showQuickPick` regardless of any
   argument), leave the row non-interactive (no `command`) rather than
   wiring a command that silently ignores the click context; this matches
   the same "no-op-safe superset" precedent `ParityComparisonTreeItem`'s own
   header comment already documents for a similar situation.
4. **Fix the missing refresh wiring**: call `treeDataProvider.refresh()`
   after every mutation that can change what "Connections" (or any other
   section) should show. Read `activate.ts`'s `registerAddConnectionCommand`/
   `registerEditConnectionCommand`/`registerDeleteConnectionCommand`/
   `registerNewComparisonCommand` (the same four handlers T-40's context-key
   recompute already hooks into, per that task's own established pattern —
   follow that same wiring shape here, do not reinvent it) and add a
   `treeDataProvider.refresh()` call alongside each existing
   `refreshHasNoContentContext(...)` call. `treeDataProvider` is constructed
   inside `activate()` and currently only returned in `ActivationResult`,
   not captured in a variable any command-registration function can close
   over — you will need to either pass it into each `register*Command`
   function as an additional parameter, or restructure so the relevant
   command registrations happen after `treeDataProvider`'s construction and
   close over it directly (read `activate()`'s current top-to-bottom
   ordering before choosing — minimize the diff).
5. Also add a `treeDataProvider.refresh()` call after a comparison run
   completes and after `paritylens.newComparison` writes a new file (both
   can change "Comparisons"'/"Recent Runs"' content) — confirm via grep
   whether any such call already exists post-run (it likely does not, per
   the same root-cause investigation) and add it in the same handler that
   already calls `persistRun`/writes the new `.paritylens` file, rather than
   introducing a new call site pattern.

## Files owned

- `packages/extension/src/views/parityTreeDataProvider.ts` (extends T-10/
  T-33, adds the connections listing + new tree-item class)
- `packages/extension/src/views/parityTreeDataProvider.test.ts`
- `packages/extension/src/activation/activate.ts` (extends T-10/T-22/T-29/
  T-30/T-32/T-33/T-40, only the `treeDataProvider.refresh()` wiring — no
  unrelated change)
- `packages/extension/src/activation/activate.test.ts`

## Interfaces consumed

- `ConnectionProfileStore.list()` (T-29, read-only)
- `ConnectionProfile` type (T-29, read-only)

## Prohibited changes

- Do not modify `ConnectionProfileStore`'s own persistence logic.
- Do not modify `editConnectionCommand`/`deleteConnectionCommand`'s own
  prompt flow (T-29/T-42) — only add the new `refresh()` call after their
  existing invocation, exactly as T-40 already did for
  `refreshHasNoContentContext`.
- Do not change `getComparisonChildren`/`getRecentRunChildren`'s existing
  behavior.
- Do not add a new npm dependency.

## Red-state evidence required

A test asserting `getChildren` called with the "connections" section
element, given an injected `listConnectionProfiles` returning one profile,
still returns `[]` today (current hardcoded behavior) — fails once fixed,
demonstrating the red state.

## Green-state evidence required

1. The scoped diff across the owned files.
2. A test proving `getChildren("connections")` returns one tree item per
   saved profile, with the profile's name visible in the label.
3. A test proving zero saved profiles still returns `[]` (empty-state
   preserved, not broken into always showing a placeholder row).
4. A test proving `treeDataProvider.refresh()` is called after each of
   add/edit/delete-connection and after a comparison run persists/a new
   comparison is scaffolded — mirroring T-40's own `hasNoContent.test.ts`
   pattern for asserting a real registered-command callback fires a
   specific side effect.
5. Full fresh `npm run verify` passing with no regression versus the
   667/667 baseline; report the before/after test count.

## Handoff

- Write `IMPLEMENTATION-REPORT.md` using
  `multi-agent-idea-to-app/templates/IMPLEMENTATION-REPORT.md`.
- Commit on branch `task/T-53-connections-tree-and-refresh`.
- Recommend independent review as the next step.
- Reviewer should specifically re-verify: (1) the new tree item's
  `contextValue` doesn't collide with any existing one in this file; (2)
  `refresh()` is genuinely wired to every mutation site named above, not
  just a subset — grep for every `register*Command` function that can
  change tree content and confirm each one calls `refresh()`; (3) the
  no-command-on-connection-row decision (or whatever the implementer chose
  instead) doesn't silently misroute a click to the wrong profile; (4) a
  fresh full `npm run verify` is green with the reported test count. This
  defect was found via a real, human-driven VS Code Extension Development
  Host smoke test during release evidence-gathering (prompt 07) — if
  feasible, the reviewer should also do a quick manual sanity check in an
  isolated profile confirming a saved connection now visibly appears in the
  tree without a window reload, since this exact class of bug is invisible
  to `vitest`'s mocked `vscode` API alone.
