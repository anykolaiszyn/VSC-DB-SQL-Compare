# ParityLens — Task Brief T-25

## Objective

Found during the prompt-07 Release step 4 (build the packaged artifact,
2026-08-01): this project has never had a documented, reproducible process
for producing a real VS Code extension package (`.vsix`). `tsc -b` compiles
TypeScript to `packages/extension/dist/`, but no packaging tool
(`@vscode/vsce`) is installed, no `.vscodeignore` exists, no packaging npm
script exists, and `packages/extension/package.json` has `"private": true`
— which `vsce package` refuses to package by default (a deliberate
safety guard against accidentally publishing an internal-only package).

**This task's job is narrowly to make a real, reproducible `.vsix` buildable
and actually build one from the current approved `main` revision** — not to
polish the extension's UX, add marketplace copy, or expand its feature set.

**Owner-approved exception, recorded here explicitly:** installing
`@vscode/vsce` as a new devDependency requires one npm registry network
call — normally avoided during the Release phase per its own "do not
depend on network access or downloads" instruction, but the owner
explicitly approved this one-time install as the only way to produce a
real packaged artifact (confirmed directly when asked, choosing "bounded
task, install vsce now" over stopping the release without an artifact).
Every other step of this task (the actual build, once `vsce` is
installed) must be fully offline/reproducible — the network exception is
for the one-time tool install only, not for the packaging process itself.

## Scope

1. **Install `@vscode/vsce`** as a root-level `devDependency` (the current
   package name; the legacy `vsce` package name is deprecated — use
   `@vscode/vsce`). Pin an exact or caret-range version, document which.
2. **Resolve the `private: true` blocker.** `vsce package` refuses a
   `private: true` manifest by default. The correct fix is `vsce package
   --allow-package-secrets`-style flags are NOT the right tool here (that's
   for a different warning class) — investigate and use whichever of these
   is actually correct for this specific blocker: either (a) pass
   `--no-dependencies`/an equivalent documented `vsce` flag if one exists
   for this exact case, or (b) if `vsce` genuinely has no flag to override
   `private: true` (confirm this by trying it and reading the actual error
   message, don't assume), the correct fix is removing `"private": true`
   from `packages/extension/package.json` — since this package is in fact
   intended to be packaged/distributed, `private: true` was never
   semantically accurate for it in the first place (it's accurate for the
   root workspace `package.json`, which should keep `private: true`, and
   for `packages/shared`/`packages/engine`, which are internal workspace
   libraries never published standalone — do not remove `private: true`
   from those two). Document in `IMPLEMENTATION-REPORT.md` exactly which
   approach was used and why.
3. **Add a `.vscodeignore` file** in `packages/extension/` excluding at
   minimum: `src/**`, `**/*.test.ts`, `**/*.test.js`, `tsconfig.json`,
   `node_modules/@types/**` (dev-only), and anything else standard for a
   TypeScript VS Code extension (your judgment, following `vsce`'s own
   documented conventions) — the packaged `.vsix` should contain only
   `dist/**`'s compiled output plus `package.json` plus whatever
   marketplace-required files exist (see item 4), not source/test files.
4. **Add a minimal `README.md`** in `packages/extension/` — `vsce package`
   warns (does not error) if one is missing, but a real release should
   have one. Keep it short and factual: what the extension is (one or two
   sentences, matching `AGENTS.md`'s Mission section), current state
   (Data Parity tree view, `ParityLens: Run Comparison` command,
   fixture-backed comparisons only — no real database connections yet,
   per T-22's disclosed limitation), and a note that this is a
   development/pre-release build. Do not write marketing copy or invent
   features that don't exist.
5. **Add a packaging npm script** — e.g. `"package": "vsce package"` (or
   `"package:extension"` if you judge that clearer given this is a
   monorepo) at whichever `package.json` level makes it actually runnable
   (likely `packages/extension/package.json`, invoked from that directory,
   or a root-level script that `cd`s into it — your call, document which
   and why).
6. **Actually run the packaging process** and produce a real `.vsix` file
   from the current `main` revision. Record its exact file name, size, and
   a SHA-256 hash (`Get-FileHash` on Windows or `sha256sum` — use whichever
   is available in your shell) in `IMPLEMENTATION-REPORT.md`. Do not commit
   the `.vsix` binary itself to git — add `*.vsix` to `.gitignore` if not
   already covered by an existing ignore pattern, and instead reference its
   location/hash in the report (this repo's git history should not carry
   binary build artifacts).

## Dependencies

- **Required completed tasks:** T-22 (the `paritylens.runComparison`
  command this package now ships), T-24 (license metadata — `vsce package`
  itself warns if `license`/`repository` fields are missing, and T-24
  already resolved the `license` field; a missing `repository` field is a
  separate, expected, non-blocking `vsce` warning for a project with no
  public git remote yet — disclose it in the report, do not attempt to
  invent a fake repository URL to silence the warning).
- **Required decisions or approvals:** the network-install exception,
  already recorded above as owner-approved. No further approval needed
  for this task's scope as written.
- **Environment:** No WSL/Docker containers needed. This task's only
  network dependency is the one-time `npm install @vscode/vsce` — every
  other step must work fully offline.

## Files owned

- `package.json` (root — new `devDependencies` entry for `@vscode/vsce`
  only)
- `package-lock.json` (regenerated by `npm install`, not hand-edited)
- `packages/extension/package.json` (`private` field removal only, plus a
  new `scripts.package` entry — do not touch any other field)
- `packages/extension/.vscodeignore` (new file)
- `packages/extension/README.md` (new file)
- `.gitignore` (repo root, if it exists — add `*.vsix`; create it if it
  doesn't exist, scoped to just this one pattern, do not invent an
  extensive ignore list beyond what this task needs)

Do not touch `packages/shared/package.json` or `packages/engine/package.json`
(their `private: true` stays as-is — they are not independently packaged).
Do not touch any file under `packages/*/src/**` — this task packages
existing, already-approved code, it does not change it.

## Interfaces

None new — this task adds a build/packaging process around existing,
already-produced compiled output (`packages/extension/dist/`, itself
already produced by the existing `tsc -b` build script). No runtime
interface is consumed or produced.

## Prohibited changes

- Do not modify any file under `packages/*/src/**`.
- Do not remove `private: true` from `packages/shared/package.json` or
  `packages/engine/package.json`.
- Do not add extension features, commands, or UI beyond what already
  exists — this is a packaging task, not a feature task.
- Do not commit the built `.vsix` file to git.
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Check to add:** none in the traditional automated-test sense — this
  is a build-tooling task. The "red state" is the current, already-
  confirmed absence: `npx --no-install @vscode/vsce --version` fails
  (not installed); no `packages/extension/.vscodeignore` exists; running
  `npx --no-install @vscode/vsce package` (once installed, before the
  `private: true` fix) fails with `vsce`'s own private-package error.
  Capture the exact error text for this last one specifically — it's the
  direct evidence for which fix approach (item 2 above) was actually
  necessary.

## Green-state and full verification

- **Focused check:** running the new packaging script produces a real
  `.vsix` file with a non-zero size; record its exact size and SHA-256
  hash. Unzip it (a `.vsix` is a standard ZIP archive — `Expand-Archive`
  on Windows, or any zip tool) and confirm its contents: compiled
  `dist/**` output present, no `src/**` or `*.test.*` files present, no
  `node_modules/@types/**` present, `package.json`/`README.md`/`LICENSE`
  present. Record this content listing in `IMPLEMENTATION-REPORT.md`.
- **Full command:** `npm run verify`
- **Expected evidence:** `npm run verify` exits 0 with the same test count
  as the current baseline (404 passed, 27 pre-existing skips, 431 total)
  — this task changes packaging/build tooling only, not test-relevant
  code, so the count must be unchanged.

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md`
- **Independent reviewer:** `reviewer` subagent (separate instance from
  whichever `implementer` subagent does this task)
- **Review report location:** `REVIEW-REPORT.md`
- **Commit or patch checkpoint:** Branch `task/T-25-extension-packaging`

**Note to reviewer:** this task's central risk is package-content
correctness (does the `.vsix` actually contain what it should, and
nothing it shouldn't — source files, test files, or `node_modules` bloat
leaking into a shipped artifact would be a real defect) and scope
discipline (no `src/**` edits, no feature additions). Independently
unzip the produced `.vsix` yourself and inspect its contents directly
rather than trusting the report's content listing. Confirm the
`private: true` fix approach taken was actually necessary by reading
`vsce`'s own error message/documentation, not just accepting the
implementer's stated reasoning. Confirm `packages/shared`/`packages/engine`
still have `private: true` unchanged.
