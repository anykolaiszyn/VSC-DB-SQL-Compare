# ParityLens — Implementation Report T-40

## Status and objective

- **Status:** COMPLETE (implementation and evidence only — not reviewed or approved)
- **Objective:** Implement the `viewsWelcome` contribution for
  `paritylens.dataParityView`, per TASK-BRIEF.md: "when the
  `paritylens.dataParityView` tree has no `.paritylens` files in the
  workspace and no saved connection profiles, show short guidance text with
  command-linked buttons for `paritylens.addConnection` and
  `paritylens.newComparison`." Addresses self-service gap-analysis Finding
  1 (no onboarding surface).

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/extension/package.json` | Added `contributes.viewsWelcome`: one entry targeting `paritylens.dataParityView`, with an explanatory sentence plus two `command:` links, gated by `when: "view == paritylens.dataParityView && paritylens.hasNoContent"`. | TASK-BRIEF.md Scope items 2–3b. |
| `packages/extension/src/activation/activate.ts` | Added `HAS_NO_CONTENT_CONTEXT_KEY` constant, `HasNoContentDeps` interface, `computeHasNoContent(deps)` (pure, `vscode`-free, exported), `refreshHasNoContentContext(connectionProfileStore)` (calls `vscode.workspace.findFiles`/`connectionProfileStore.list()` and pushes the result via `vscode.commands.executeCommand("setContext", ...)`). Wired a call to `refreshHasNoContentContext` into `activate()` (fire-and-forget, since `activate()` itself is synchronous) and into the tail of `registerAddConnectionCommand`, `registerEditConnectionCommand`, `registerDeleteConnectionCommand`, and `registerNewComparisonCommand`'s registered callbacks. | TASK-BRIEF.md Scope item 3a–3c. |
| `packages/extension/src/activation/hasNoContent.test.ts` (new) | New test file: 4 tests for `computeHasNoContent`'s AND logic, 4 tests asserting the `package.json` `viewsWelcome` shape/command-ID validity, 5 tests asserting `setContext` recomputation actually fires at activation and after each of the four wired command callbacks. | TASK-BRIEF.md's "Files owned" list — new test file(s) colocated with the module owning the computation function (`activate.ts`). |

## Behavior and interfaces

- **Behavior delivered:** A brand-new user with zero `.paritylens` files
  in their workspace and zero saved connection profiles sees the "DATA
  PARITY" tree view's welcome overlay: one sentence of guidance plus two
  buttons ("Add a Connection", "Create a Comparison") that invoke the
  existing `paritylens.addConnection`/`paritylens.newComparison` commands.
  The overlay disappears (per VS Code's own `viewsWelcome` `when`-clause
  evaluation) as soon as either condition becomes false — one saved
  profile, or one `.paritylens` file, or both.
- **Interfaces consumed:**
  - `findComparisonFiles` — read-only, via `vscode.workspace.findFiles("**/*.paritylens")`, the same call `activate()`'s `ParityTreeDataProvider` construction already makes.
  - `ConnectionProfileStore.list()` (T-29) — read-only accessor, used as-is; no CRUD logic in `connections/**` was touched.
  - `paritylens.addConnection` (T-29) / `paritylens.newComparison` (T-32) command IDs — referenced only, both already registered in `contributes.commands` before this task.
- **Interfaces produced:**
  - `HAS_NO_CONTENT_CONTEXT_KEY` (`"paritylens.hasNoContent"`, exported) — the VS Code context key `contributes.viewsWelcome`'s `when` clause gates on.
  - `computeHasNoContent(deps: HasNoContentDeps): Promise<boolean>` (exported, pure) — `true` iff zero comparison files AND zero profiles.
  - `contributes.viewsWelcome[0]` in `package.json`.

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline (pre-change) | `npm run verify` | Pass — 624 tests passed, 27 skipped, 34 test files passed / 2 skipped | Command run before any edit (see transcript) |
| Red state | `npx vitest run packages/extension/src/activation/hasNoContent.test.ts` (with `hasNoContent.test.ts` written, `computeHasNoContent` not yet exported by `activate.ts`) | **Fail** — all 4 `computeHasNoContent` tests threw `TypeError: computeHasNoContent is not a function`, the predicted missing-function reason | Command run before implementing `computeHasNoContent` (see transcript) |
| Focused green state | `npx vitest run packages/extension/src/activation/hasNoContent.test.ts` | Pass — 13/13 tests passed (4 AND-logic cases, 4 `package.json`-shape assertions, 5 context-key-recomputation-wiring assertions) | Command run after implementation (see transcript) |
| `npm run typecheck` | `npm run typecheck` | Pass — `tsc -b --force`, no errors | Command run after implementation |
| `npm run lint` | `npm run lint` | Pass — `eslint .`, no errors | Command run after implementation |
| Full verification | `npm run verify` | Pass — **637 tests passed** (up from 624 baseline, +13 new), 27 skipped, 35 test files passed / 2 skipped (37 total) | Command run after implementation (see transcript) |

## Assumptions and risks

- **Assumptions:**
  - The context-key computation function belongs in `activate.ts` itself
    (not a new source module) per the brief's "Files owned" list, which
    authorizes only `package.json`, `activate.ts`, and a new *test* file —
    not a new source module under `connections/**` or `views/**`. A new
    pure-logic source file was briefly drafted, then removed once this
    reading of the brief was confirmed, to stay strictly inside declared
    ownership.
  - `computeHasNoContent`'s AND-vs-OR shape ("both conditions must be zero,
    not either") is read directly from the brief's own wording ("checking
    whether `findComparisonFiles()` returns zero URIs AND the connection
    profile store... has zero saved profiles") — not inferred.
  - The `viewsWelcome`-shape test approach (asserting on the parsed
    `package.json` object plus a regex over `contents` for `command:`
    links) was chosen over a documented manual Extension Development Host
    check, per the brief's own explicit disclosure requirement
    ("`viewsWelcome` rendering itself is declarative JSON with no
    unit-testable runtime behavior — disclose which approach was used").
    **No manual VS Code Extension Development Host check was performed**
    for this task; the automated shape test above is the sole green-state
    evidence for the manifest contribution actually rendering correctly at
    runtime. This is a real, disclosed limitation: the automated test
    cannot prove VS Code itself parses the Markdown/`when` clause exactly
    as intended, only that the JSON shape and referenced command IDs are
    correct.

- **Risks or limitations:**
  - **Discrepancy with the brief's Scope item 3c premise, disclosed
    explicitly rather than silently worked around:** the brief states
    "`ParityTreeDataProvider.refresh()` is already called after add/edit/
    delete-connection and after scaffold/run commands elsewhere in the
    codebase — read `activate.ts` to find every existing `refresh()` call
    site and add the context-key recomputation alongside each one." I
    checked this directly: as of this task's start, `refresh()` is
    defined on `ParityTreeDataProvider` (`parityTreeDataProvider.ts`) but
    is **never called anywhere in `activate.ts`** — the only call site in
    the entire `packages/extension/src` tree is
    `parityTreeDataProvider.test.ts`'s own unit test
    (`provider.refresh()`), confirmed via a full-repo grep for
    `.refresh()`. No command handler in the current `activate.ts` invokes
    it. Rather than silently inventing call sites that don't exist or
    leaving the recomputation unwired because the brief's stated premise
    didn't hold, I wired `refreshHasNoContentContext` into the same
    logical points the brief names by intent — the tail of
    `registerAddConnectionCommand`, `registerEditConnectionCommand`,
    `registerDeleteConnectionCommand`, and `registerNewComparisonCommand`'s
    registered callbacks, plus once at `activate()` — since those are
    exactly the command handlers whose outcomes can change
    `computeHasNoContent`'s inputs (profile count, comparison file count).
    I did **not** add a `.refresh()` call to `ParityTreeDataProvider`
    anywhere, since doing so would be an undeclared, unrequested behavior
    change to a class this task doesn't own (the brief's own "Prohibited
    changes" section forbids touching `ParityTreeDataProvider.getChildren`'s
    contract, and adding new `refresh()` call sites goes beyond
    `viewsWelcome`/context-key wiring). **This is a judgment call a
    reviewer should specifically re-check**: is wiring the context-key
    recompute directly into the four command-registration functions
    (rather than piggybacking on a `refresh()` call site that doesn't
    exist) the correct interpretation of Scope item 3c's intent?
  - `runComparisonCommand` (the `paritylens.runComparison` handler) was
    deliberately **not** wired with a recompute call: running a comparison
    against an *existing* `.paritylens` file does not change the
    `.paritylens` file count or the profile count, so `computeHasNoContent`'s
    result cannot change as a result of a run. The brief's Handoff section
    lists "run a comparison that creates the first `.paritylens` file" as
    a reviewer-probe item, but no such flow exists in this codebase today
    — running a comparison requires selecting an *already-existing*
    `.paritylens` file (via `showOpenDialog` or a tree/CodeLens click); it
    is `paritylens.newComparison` (the scaffold wizard) that creates a new
    `.paritylens` file, and that command *is* wired. Flagging this
    explicitly in case the brief intended a different, not-yet-built flow.
  - `activate()` remains synchronous per its existing signature (unchanged,
    per the brief's "Files owned" not authorizing an `ActivationResult`
    shape change); the initial context-key push at activation is therefore
    fire-and-forget (`void refreshHasNoContentContext(...).catch(() =>
    undefined)`), so there is a brief window between activation completing
    and the context key actually landing. This mirrors the same
    async-fire-and-forget constraint every other one-time async setup in a
    sync `activate()` would face in this codebase; not something this task
    introduced as a new pattern, but worth naming as an accepted residual
    gap (a cosmetic, not functional, one — VS Code's default context-key
    value is falsy, so the welcome view briefly not rendering on a
    cold-started brand-new workspace, then rendering a tick later, is the
    worst case).

- **Blockers:** None.

## Patch or commit identity

- **Patch or commit:** `58e8400`
- **Branch or workspace:** `task/T-40-onboarding-welcome-view`

## Recommended next step

Independent review by a reviewer who did not author this change (per
`AGENTS.md`: "Every implementation task receives an independent review by
a reviewer who did not author the task's change"). The reviewer should, per
TASK-BRIEF.md's Handoff section:

1. Re-verify the `when` clause genuinely gates on emptiness — construct a
   case with one `.paritylens` file and zero profiles, and a case with zero
   files and one profile, confirming neither shows welcome content (the
   `computeHasNoContent` AND-logic tests in `hasNoContent.test.ts` cover
   this at the function level; the reviewer should independently confirm
   the `package.json` `when`-clause string itself, `"view ==
   paritylens.dataParityView && paritylens.hasNoContent"`, is a real AND in
   VS Code `when`-clause syntax, not accidentally an OR).
2. Confirm both `command:` URIs in `contents` reference real,
   already-registered command IDs (the `package.json`-shape test in
   `hasNoContent.test.ts` already asserts this against
   `contributes.commands`, but independent confirmation is requested per
   the brief).
3. **Specifically evaluate the Scope-item-3c discrepancy disclosed above**
   (no `refresh()` call sites existed in `activate.ts` prior to this task,
   contrary to the brief's stated premise) and judge whether wiring
   `refreshHasNoContentContext` directly into the four command-registration
   functions is the correct resolution, or whether a revised brief/
   different wiring point is warranted.
4. Re-run `npm run verify` fresh and confirm the reported 637-tests-passed
   (27 skipped) count independently.

This implementer does not have authority to approve this task's own work;
review and approval are a separate, later step owned by a different agent.
