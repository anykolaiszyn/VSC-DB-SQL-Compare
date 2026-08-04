# TASK-BRIEF.md — T-40: Onboarding welcome view

## Objective

Implement the `viewsWelcome` contribution named in `IMPLEMENTATION-PLAN.md`'s
Phase 6 table for T-40: when the `paritylens.dataParityView` tree has no
`.paritylens` files in the workspace and no saved connection profiles, show
short guidance text with command-linked buttons for
`paritylens.addConnection` and `paritylens.newComparison`. Addresses
self-service gap-analysis Finding 1 (no onboarding surface) — today a brand
new user opens the Data Parity view and sees three collapsed, permanently
empty section nodes (Connections / Comparisons / Recent Runs) with zero
guidance on what to do next.

## Scope

1. Confirm the red state: read `packages/extension/package.json`'s current
   `contributes` block and confirm no `viewsWelcome` key exists today (it
   does not, as of this brief).
2. Add a `contributes.viewsWelcome` entry to
   `packages/extension/package.json` targeting view id
   `paritylens.dataParityView`. Content should be short guidance text plus
   two command links, using VS Code's standard Markdown-command-link syntax
   inside `contents`, e.g.:
   ```
   [Add a Connection](command:paritylens.addConnection)
   [Create a Comparison](command:paritylens.newComparison)
   ```
   with a one-line explanatory sentence above the links (VS Code renders
   `contents` as Markdown; each `[label](command:id)` on its own line
   renders as a button).
3. Decide the correct `when` clause. VS Code's `viewsWelcome` shows its
   content automatically whenever the target view's `TreeDataProvider`
   returns zero root-level children for a given collapsed state — **but
   this view's `getChildren()` with no `element` always returns the three
   fixed section nodes** (`ParityTreeDataProvider.getChildren`, in
   `packages/extension/src/views/parityTreeDataProvider.ts`), so the view is
   never "empty" at the top level even when Comparisons/Recent Runs have no
   children underneath. Read `parityTreeDataProvider.ts` in full (already in
   context if you have prior session history; otherwise read it fresh) to
   confirm this before proceeding — `viewsWelcome`'s automatic empty-tree
   behavior will **not** fire for this view's current structure.
   Since VS Code's `viewsWelcome` has no way to key off "the two dynamic
   sections are both empty" without a context-key, you must:
   a. Introduce a VS Code context key (e.g.
      `paritylens.hasNoContent`) set via
      `vscode.commands.executeCommand("setContext", "paritylens.hasNoContent", true|false)`
      from the extension activation/wiring code, computed by checking
      whether `findComparisonFiles()` returns zero URIs AND the connection
      profile store (T-29) has zero saved profiles.
   b. Use that context key as the `viewsWelcome` entry's `when` clause:
      `"view == paritylens.dataParityView && paritylens.hasNoContent"`.
   c. Wire the context key to be (re)computed at activation and whenever the
      tree is refreshed (`ParityTreeDataProvider.refresh()` is already
      called after add/edit/delete-connection and after scaffold/run
      commands elsewhere in the codebase — read `activate.ts` to find every
      existing `refresh()` call site and add the context-key recomputation
      alongside each one, not just at startup).
4. Both linked commands (`paritylens.addConnection`, `paritylens.newComparison`)
   already exist and are already registered (T-29, T-32) — do not
   register new commands, just reference their existing IDs.

## Files owned

- `packages/extension/package.json` (`contributes.viewsWelcome` and, if
  needed, a `when`-clause-relevant addition to `contributes.commands` is
  NOT expected — only `viewsWelcome`)
- `packages/extension/src/activation/activate.ts` (extends T-10/T-22/T-29/
  T-30/T-32/T-33 — only the context-key `setContext` calls, added alongside
  existing `refresh()` call sites; no unrelated changes)
- New test file(s) under `packages/extension/src/activation/` or
  `packages/extension/src/views/` covering the context-key computation
  logic, your call on exact filename/location — keep it colocated with
  whichever module actually owns the computation function

## Interfaces consumed

- `findComparisonFiles` (existing injected dependency, read-only)
- Connection profile store's list/count accessor (T-29, read-only — read
  `packages/extension/src/connections/**` to find the exact existing
  function name; do not invent a new one)
- `paritylens.addConnection` / `paritylens.newComparison` command IDs
  (T-29/T-32, read-only reference)

## Prohibited changes

- Do not modify `ParityTreeDataProvider.getChildren`'s existing return
  shape/behavior (its "three fixed section nodes at top level" contract is
  relied on by existing T-10/T-33 tests — this task adds a `viewsWelcome`
  overlay, it does not change the tree provider's own children).
- Do not touch `packages/extension/src/connections/**`'s CRUD logic itself
  (T-29) beyond reading its existing list/count accessor.
- Do not add a new npm dependency.

## Red-state evidence required

Confirmation (via reading `package.json`) that no `viewsWelcome` contribution
exists today, plus a failing/absent test demonstrating the context-key
computation function doesn't exist yet.

## Green-state evidence required

1. The scoped diff across the owned files.
2. A test proving the context-key computation function returns `true` when
   both zero `.paritylens` files and zero saved profiles are present, and
   `false` when either is non-zero.
3. A `package.json`-shape test (or documented manual VS Code Extension
   Development Host check, since `viewsWelcome` rendering itself is
   declarative JSON with no unit-testable runtime behavior — disclose which
   approach was used, consistent with how the brief for this exact
   situation is described in `IMPLEMENTATION-PLAN.md`'s T-40 row) confirming
   the `viewsWelcome` JSON key exists with the correct `view`/`contents`/
   `when` fields and that both command IDs referenced in `contents` are real,
   already-registered command IDs (no typo'd `command:` URI).
4. A full fresh `npm run verify` passing with no regression versus the
   current baseline; report the before/after test count.

## Handoff

- Write `IMPLEMENTATION-REPORT.md` using
  `multi-agent-idea-to-app/templates/IMPLEMENTATION-REPORT.md`.
- Commit on branch `task/T-40-onboarding-welcome-view`.
- Recommend independent review as the next step.
- Reviewer should specifically re-verify: (1) the `when` clause genuinely
  gates on emptiness — adversarially probe by constructing a case with one
  `.paritylens` file and zero profiles (should NOT show welcome content) and
  a case with zero files and one profile (should NOT show welcome content),
  confirming the AND logic is correct, not accidentally OR; (2) both
  `command:` URIs reference real, already-registered command IDs (grep
  `package.json`'s `contributes.commands` list); (3) the context-key
  recomputation genuinely fires after every relevant mutation (add/edit/
  delete connection, scaffold a new comparison, run a comparison that
  creates the first `.paritylens` file) — not just at activation, which
  would leave a stale welcome view showing after a user's first action;
  (4) a fresh full `npm run verify` is green with the reported test count.
