# TASK-BRIEF.md — T-52: LICENSE packaging fix

## Objective

Resolve finding **T-26-02** (OPEN, accepted non-blocking, recorded in
`PROGRESS-LEDGER.md`'s Open findings table): `vsce package` prints a
"LICENSE, LICENSE.md, or LICENSE.txt not found" warning even though
`LICENSE` exists at the repo root (added by T-24) — `vsce` only checks
for a license file alongside the manifest it packages
(`packages/extension/package.json`), never at the monorepo root, and no
copy/symlink/equivalent exists inside `packages/extension/`.

The finding's own recorded text (verbatim, from `PROGRESS-LEDGER.md`):

> `vsce package` prints a "LICENSE, LICENSE.md, or LICENSE.txt not
> found" warning even though `LICENSE` exists at the repo root (from
> T-24) — `vsce` only checks alongside the manifest it packages
> (`packages/extension/`). Confirmed accurate by the reviewer; correctly
> disclosed by T-26's implementer as pre-existing and out of scope ...
> candidate fix: copy/symlink `LICENSE` into `packages/extension/`, or
> an equivalent `vsce` flag if one exists.

## Scope

1. Confirm the warning is still reproducible today: run the extension's
   packaging script (see `packages/extension/package.json`'s
   `scripts.package`, e.g. `npm run package --workspace=packages/extension`
   or equivalent — read the actual script definition rather than
   assuming) and capture the exact warning text/exit behavior before
   making any change (red-state evidence).
2. Fix by making `LICENSE`'s content available to `vsce` at
   `packages/extension/LICENSE` (the location `vsce` actually checks).
   A plain copy is the safer, simpler choice for this monorepo (no
   platform-dependent symlink semantics to worry about across
   Windows/macOS/Linux contributors, and no OS-level symlink-creation
   privilege concerns on Windows specifically) — **prefer a copy over a
   symlink** unless you find during Scope item 1's investigation that a
   `vsce` CLI flag exists that points it at an out-of-tree license file
   without needing either a copy or a symlink (check `vsce package --help`
   / the installed `@vscode/vsce` version's documented flags first; if no
   such flag exists, proceed with the copy).
3. The copied `packages/extension/LICENSE` must be kept in sync with the
   canonical root `LICENSE` going forward without relying on a human to
   remember to update both — the two most defensible options are: (a) a
   small `prepackage`-style npm script step in `packages/extension/package.json`
   that copies the root file fresh immediately before `vsce package` runs
   every time (so the packaged copy can never silently drift stale even
   if the root file is edited later), or (b) committing the copy directly
   to git alongside a comment/README note that it must be kept in sync
   manually. **Prefer option (a)** (a copy step wired into the existing
   packaging script, e.g. as an added step before the `vsce package`
   invocation) since it removes the human-memory dependency entirely;
   only fall back to (b) if wiring an extra script step turns out to
   conflict with how `scripts.package` is currently structured (read it
   first before deciding).
4. Whichever option is chosen, `packages/extension/LICENSE`'s content
   must be byte-identical to the root `LICENSE` immediately after
   packaging — verify this directly (e.g. `diff`/hash comparison) as
   part of your own testing, not just visually.
5. Re-run the packaging script and confirm the "LICENSE ... not found"
   warning is gone (green-state evidence). Also spot-check that the
   packaged `.vsix`'s content listing now includes a `LICENSE` file
   (unzip/list the produced `.vsix` — `vsce ls` or an actual unzip, your
   choice, whichever the existing `.gitignore`d local workflow already
   supports) — do not just trust the absence of the warning text alone.

## Files owned

- `packages/extension/package.json` (`scripts.package`, or an added
  adjacent npm script it invokes, only — no other field)
- `packages/extension/LICENSE` (new file — a copy of the root
  `LICENSE`'s content; if option 3(a) is chosen, this file need not be
  committed to git at all if it's purely a build-time-generated
  artifact — your call, document which you chose and why)
- `packages/extension/.gitignore` or the root `.gitignore` (only if
  option 3(a) generates `packages/extension/LICENSE` at package time and
  you decide it should not be committed — a one-line addition at most)
- `packages/extension/.vscodeignore` (only if the new file needs an
  explicit inclusion/exclusion rule — read its current content first;
  it currently excludes `src/**` and various dev-only files, so a root-
  level `LICENSE` copy should NOT be excluded, but confirm no existing
  glob accidentally catches it before assuming no edit is needed)

## Interfaces consumed

None new. `@vscode/vsce` (already a devDependency, installed by T-25) —
read-only usage, no version change.

## Prohibited changes

- Do not touch the root `LICENSE` file's content — it is the canonical
  source; this task only makes its content reachable to `vsce`.
- Do not add a new devDependency or change any existing dependency
  version (this is a packaging-config fix, not a tooling upgrade).
- Do not touch `packages/extension/esbuild.config.mjs`, `native/**`
  staging logic, or any other packaging concern unrelated to the license
  file specifically (T-27's DuckDB native-binary staging work is
  out of scope and must not be touched).
- Do not modify `package.json`'s `license` field in any workspace
  package (T-24 already set these; this task is about the packaged
  `.vsix`'s file contents, not manifest metadata).

## Red-state evidence required

The exact warning text/output from running the packaging script against
today's unmodified `packages/extension/` (no `LICENSE` file present
there yet) — captured directly, not paraphrased from the original T-26
finding's own (now slightly dated) recollection.

## Green-state evidence required

1. The scoped diff across the owned files.
2. The same packaging script re-run, showing the "LICENSE ... not found"
   warning no longer appears.
3. Direct confirmation (diff/hash) that `packages/extension/LICENSE`'s
   content is byte-identical to the root `LICENSE` at the moment of
   packaging.
4. Confirmation the produced `.vsix`'s content listing includes a
   `LICENSE` file.
5. A full fresh `npm run verify` passing with no regression versus the
   current baseline (this task touches no test-relevant code, so the
   test count itself should be unchanged — confirm this, since an
   unchanged count is itself evidence nothing unrelated broke).

## Handoff

- Write `IMPLEMENTATION-REPORT.md` using
  `multi-agent-idea-to-app/templates/IMPLEMENTATION-REPORT.md`.
- Commit on branch `task/T-52-license-packaging-fix`.
- Recommend independent review as the next step.
- Reviewer should specifically re-verify: (1) independently reproduce
  the packaging script run and confirm the warning is genuinely gone,
  not just trust the report's pasted output; (2) independently diff/hash
  `packages/extension/LICENSE` against the root `LICENSE` to confirm
  byte-identical content; (3) independently unzip/list the produced
  `.vsix` and confirm a `LICENSE` file is actually present inside it —
  the true test of this fix, since the warning disappearing and the file
  actually being packaged are two different claims; (4) if option 3(a)
  (copy-on-package) was chosen, confirm the copy step genuinely re-runs
  every time `scripts.package` is invoked (not a stale one-time copy
  that would silently drift if the root `LICENSE` is ever edited) —
  e.g. by modifying the root `LICENSE`'s content temporarily, re-running
  the packaging script, and confirming the packaged copy picked up the
  change, then reverting; (5) a fresh full `npm run verify` is green
  with an unchanged test count.
