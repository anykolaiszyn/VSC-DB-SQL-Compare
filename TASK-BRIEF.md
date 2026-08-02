# ParityLens — Task Brief T-26

## Objective

Found during the prompt-07 Release step 5 live smoke test (2026-08-01,
first-ever real VS Code extension-host launch of this project — a
human-driven test in a sandboxed profile, `--extensions-dir`/
`--user-data-dir` pointed at scratch folders, never touching the real VS
Code environment): the extension fails to register its own tree view at
all. Two real, cascading VS Code errors observed directly:

```
property icon is mandatory and must be of type string
View container 'paritylens' does not exist and all views registered to it will be added to 'Explorer'.
```

Root cause, confirmed by reading `packages/extension/package.json`
directly: `contributes.viewsContainers.activitybar[0]` (the `"paritylens"`
container, registered by T-10) declares `id`/`title` but no `icon` field.
VS Code's manifest schema requires an `icon` for any custom activity-bar
container; without one, VS Code refuses to register the container
entirely, and the view registered against it (`paritylens.dataParityView`,
also from T-10) silently falls back into the built-in Explorer container
instead of getting its own "Data Parity" activity-bar icon — the exact
UX T-10's `TASK-BRIEF.md` intended.

**Why this was never caught before now:** every prior task (T-10, T-11,
T-16, T-16b, T-22) tested extension-layer code exclusively via Vitest
against a hand-mocked `vscode` module — never against a real VS Code
extension host. This is the concrete, first-observed instance of the
already-disclosed X-01 finding ("no test proves the tree view registers
against a real extension-host runtime") turning out to hide a real
defect, not just an unverified-but-fine assumption. `zero` icon assets of
any kind exist anywhere in this repository — this needs a genuinely new
asset added, not just a manifest field pointed at something that already
exists.

## Scope

1. **Create an icon asset** at `packages/extension/media/icon.svg` (or
   another path of your choosing inside `packages/extension/media/` —
   document your choice). Convention for a VS Code activity-bar container
   icon: a monochrome SVG, roughly 24x24 viewBox, using `fill="currentColor"`
   (or equivalent) rather than a fixed color, so it inherits VS Code's
   theme-appropriate icon color automatically in both light and dark
   themes — do not hardcode a specific color. Keep the icon simple
   (VS Code renders activity-bar icons small); a simple geometric mark
   representing "parity"/"comparison" (e.g. two overlapping or
   side-by-side shapes, a checkmark-vs-diff motif, or similar) is
   appropriate — this does not need to be a polished professional logo,
   it needs to be a valid, reasonable placeholder that satisfies VS
   Code's manifest requirement and doesn't look broken/blank.
2. **Add the `icon` field** to `packages/extension/package.json`'s
   `contributes.viewsContainers.activitybar[0]` entry, pointing at the
   new asset's path relative to the extension root (e.g.
   `"icon": "media/icon.svg"`).
3. **Verify the fix in a real extension host**, the same way this defect
   was found: rebuild the `.vsix` (`npm run package` inside
   `packages/extension`, after `npm run build` — confirm `dist/` is
   current), install it into a sandboxed profile (`code
   --extensions-dir <scratch> --user-data-dir <scratch>
   --install-extension <path-to-vsix>`, never the real environment), then
   launch `code --extensions-dir <scratch> --user-data-dir <scratch>
   <a-scratch-workspace-folder>` and confirm directly: no `icon is
   mandatory` error, no `View container 'paritylens' does not exist`
   error, and the Data Parity activity-bar icon and tree view actually
   appear. You have terminal/CLI access to do this yourself (the `code`
   CLI is available in this environment) — this is not blocked on human
   interaction the way the original smoke test's visual confirmation
   was, since you can capture VS Code's own startup log output
   (`--verbose` or checking `user-data-dir`'s log files) as evidence
   rather than needing a human to look at a rendered icon.
4. **Clean up your sandbox test folders** after verification — do not
   leave scratch VS Code profiles/extension installations lying around
   in the repo or its parent directories; use the OS temp directory.

## Dependencies

- **Required completed tasks:** T-10 (owns the `activitybar`/`views`
  contribution being fixed), T-25 (packaging — this task will rebuild
  and re-verify the `.vsix`).
- **Required decisions or approvals:** NONE beyond this brief — icon
  *content* (what it visually looks like) is a bounded implementation
  judgment call within "simple, valid, theme-appropriate placeholder,"
  not a decision requiring owner sign-off, unlike T-24's license choice
  or T-25's publisher identity.
- **Environment:** No WSL/Docker containers needed. No network access
  needed (an SVG can be authored directly as text, no external asset
  download required).

## Files owned

- `packages/extension/media/**` (new directory, icon asset)
- `packages/extension/package.json` (`contributes.viewsContainers.activitybar[0].icon`
  field only — do not touch any other field, including `name`/`publisher`
  which T-25 already resolved correctly)

Do not touch any file under `packages/*/src/**`. Do not modify
`contributes.views` or `contributes.commands` — this task fixes exactly
the missing `icon` field and its required asset, nothing else.

## Interfaces

None — this task adds a static asset and one manifest field. No runtime
interface is consumed or produced.

## Prohibited changes

- Do not modify any file under `packages/*/src/**`.
- Do not touch `name`/`publisher`/`private` in `packages/extension/package.json`
  (T-25 already resolved these correctly).
- Do not expand scope into other extension-host defects that live
  verification might surface beyond this specific icon issue — if you
  find something else broken during your verification pass, stop and
  report it as a new finding rather than silently fixing it here too.
- Do not commit any `.vsix` build artifact or scratch VS Code profile
  directory to git.

## Red-state evidence

- **Check to add:** none in the traditional Vitest sense — this defect
  is only observable via a real extension-host launch, which is exactly
  what a Vitest-mocked test cannot exercise (that gap is the pre-existing
  X-01 finding, out of this task's scope to close in general — this task
  only needs to prove *this specific* fix). Red-state evidence is the
  exact error text already captured above, reproduced by you rebuilding
  the *current* (unfixed) `.vsix` and launching it in a sandbox, before
  making any change — confirm you see the same two errors, then apply
  the fix.

## Green-state and full verification

- **Focused evidence:** rebuild the `.vsix` after the fix, install and
  launch it in a fresh sandbox profile, and capture evidence that the
  `icon is mandatory` and `View container 'paritylens' does not exist`
  errors are both gone. If VS Code's CLI/log output doesn't directly
  confirm the tree view rendered (some UI-only confirmations may need
  a human), state plainly in `IMPLEMENTATION-REPORT.md` exactly what
  you were able to verify via CLI/logs versus what still needs human
  visual confirmation, rather than overclaiming full verification.
- **Full command:** `npm run verify`
- **Expected evidence:** exits 0 with the same test count as the current
  baseline (404 passed, 27 pre-existing skips, 431 total) — this is a
  static-asset-plus-manifest-field change, no test-relevant code changes.

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md`
- **Independent reviewer:** `reviewer` subagent (separate instance from
  whichever `implementer` subagent does this task)
- **Review report location:** `REVIEW-REPORT.md`
- **Commit or patch checkpoint:** Branch `task/T-26-activity-bar-icon`

**Note to reviewer:** independently reproduce both the red state (rebuild
the pre-fix `.vsix` — or just inspect `main`'s current `package.json`
directly, don't need to actually launch it if you trust reading the
manifest — and confirm the `icon` field is genuinely absent before this
task's commit) and the green state (confirm the `icon` field now points
at a real, valid SVG file that actually exists at that relative path
inside the built `.vsix`'s contents, not just in source). If you have the
same terminal/`code` CLI access the implementer used, independently
launch the fixed `.vsix` in your own fresh sandbox profile and confirm
the two specific errors are gone, per this project's "don't just re-run
the implementer's own evidence" discipline.
