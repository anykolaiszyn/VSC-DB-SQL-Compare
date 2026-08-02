# ParityLens — Task Brief T-27

## Objective

Found during the prompt-07 Release step 5 live smoke test's second pass
(2026-08-01, after T-26 fixed the activity-bar icon), on a real,
non-fixture human observation: after installing the freshly rebuilt
`.vsix` and confirming the icon/tree-view registration now works, the
owner reported two further live failures: clicking the Data Parity icon
shows "There is no data provider registered that can provide view data,"
and running "ParityLens: Run Comparison" from the Command Palette fails
with "command not found."

**Root cause, confirmed by direct inspection of the actual packaged
`.vsix` contents** (unzipped and listed): the archive contains
`extension/dist/**` (compiled TypeScript) and `extension/package.json`,
but **no `node_modules/` directory at all**. `dist/activation/activate.js`
does `require("@paritylens/engine")` at module-load time (confirmed via
`grep -n "require(" dist/activation/activate.js`). When VS Code's
extension host tries to activate this extension, that `require()` throws
`MODULE_NOT_FOUND` (uncaught, since no defensive try/catch exists around
module-load-time requires), `activate()` never runs to completion,
nothing it would have registered (`ParityTreeDataProvider`, the
`paritylens.runComparison` command handler) actually gets registered —
exactly producing both symptoms observed live.

**Why `node_modules/` is missing:** `@paritylens/engine` and
`@paritylens/shared` are npm-workspaces packages, symlinked into the
repo-root `node_modules/@paritylens/**` rather than living inside
`packages/extension/node_modules/`. T-25 added `vsce package
--no-dependencies` specifically because `vsce`'s default dependency-walk
climbed past the npm-workspaces boundary and swept the entire monorepo
(8,946 files, 224 MB, including `.git/`) into the package — a real
problem `--no-dependencies` correctly solved. But `--no-dependencies`
also means `vsce` never resolves or bundles *any* runtime dependency,
including the two workspace packages this extension's own code actually
`require()`s. `vsce` offers no middle-ground flag (`--dependencies` is
all-or-nothing walk-the-whole-tree; `--no-dependencies` is walk-nothing)
— confirmed via `npx --no-install @vscode/vsce package --help`.

**This is a structural gap neither T-25's implementer, T-25's reviewer,
nor T-26's implementer/reviewer could reasonably have caught without
exactly this live, human-driven "run the actual command" smoke test** —
every automated check performed so far (unit tests, `.vsix` content
listing for file-leak concerns, VS Code's own startup log for the icon
registration error) genuinely passed, because none of them actually
*invoked* the extension's runtime code path that hits the missing
`require()`.

## Scope

**The correct, standard fix for a VS Code extension built from an npm
workspaces monorepo is to bundle the extension into a single
self-contained JS file** (inlining `@paritylens/engine`/
`@paritylens/shared`'s code directly, rather than depending on
`node_modules` resolution at runtime) — this is the standard pattern
VS Code's own extension-samples repository and most real-world monorepo
extensions use, and it also eliminates the underlying tension `vsce
--no-dependencies` exists to route around in the first place.

1. **Add a bundler** to `packages/extension`. `esbuild` is the
   lightweight, fast, standard choice for this (used by VS Code's own
   official extension templates) — add it as a **root-level
   devDependency** (same network-install exception category as T-25's
   `@vscode/vsce` install; this is a new tool install, disclose it the
   same way, no separate owner approval needed since the precedent and
   rationale are identical and already recorded).
2. **Write a bundle script** (e.g. `packages/extension/esbuild.config.mjs`
   or inline in `package.json`'s scripts, your choice, document which)
   that bundles `packages/extension/src/index.ts` (the actual extension
   entry point) into a single output file — e.g.
   `packages/extension/dist-bundle/extension.js` (choose a directory name
   that clearly distinguishes this from the existing `dist/` produced by
   `tsc -b`, which remains needed for typecheck/test purposes and should
   NOT be replaced or removed) — with:
   - `platform: "node"`, `format: "cjs"` (VS Code extension hosts are
     CommonJS/Node).
   - `external: ["vscode"]` (the `vscode` module is provided by the
     extension host at runtime, never bundle it).
   - `bundle: true` so `@paritylens/engine`/`@paritylens/shared` (and
     their own dependencies like `yaml`, `@duckdb/node-api` if the
     bundle's actual code path reaches them — investigate what's truly
     needed vs. what can stay external; native-binary packages like
     `@duckdb/node-api`'s per-platform bindings typically CANNOT be
     bundled by esbuild and must be marked `external` and shipped
     alongside the bundle instead — this is a real, non-trivial
     investigation step, do not assume bundling "just works" for every
     dependency without checking) are inlined.
   - Minification is optional (your judgment; not required for
     correctness, only for artifact size).
3. **Update `packages/extension/package.json`'s `main` field** to point
   at the new bundled output instead of `./dist/index.js`.
4. **Update `.vscodeignore`** so the packaged `.vsix` includes the new
   bundled output (and any unbundleable native dependencies it needs
   alongside it, if applicable per the investigation in step 2) instead
   of (or in addition to, if genuinely still needed) the raw `tsc`-built
   `dist/`.
5. **Update the `package` npm script** to run the bundle step before
   `vsce package`, and confirm whether `--no-dependencies` is still the
   correct flag now that the bundle inlines the workspace packages
   itself (it likely still is, to avoid re-triggering T-25's original
   monorepo-sweep problem for whatever *is* left as an external/real npm
   dependency — but verify this rather than assume, since the dependency
   surface has changed).
6. **Verify the actual fix the way this defect was found**: rebuild
   everything, install into a fresh sandboxed VS Code profile (scratch
   temp folders, never a real profile), launch it, and this time actually
   invoke the runtime path that failed before — you have the same CLI
   access previous tasks used; if you cannot fully automate clicking the
   activity-bar icon or running the command palette entry yourself,
   at minimum confirm via VS Code's own extension-host log output that
   `activate()` completes without a `MODULE_NOT_FOUND` (or any other)
   error, and disclose plainly what you could versus couldn't confirm
   without human interaction — same honesty standard T-26 already set.
   If you have a way to programmatically execute a registered VS Code
   command from the CLI/a script against the sandboxed instance
   (investigate `code --command` or similar if the installed `code` CLI
   version supports it; do not assume, check), use it to actually invoke
   `paritylens.runComparison` end-to-end and confirm it doesn't fail with
   "command not found" — this would be strictly stronger evidence than
   log inspection alone.

## Dependencies

- **Required completed tasks:** T-22 (the command this bug affects),
  T-25 (packaging setup, being extended), T-26 (icon fix, already
  reconciled — this task's smoke-test evidence builds on that fix already
  being in place).
- **Required decisions or approvals:** the esbuild devDependency install
  is a disclosed network-install exception, same category and rationale
  as T-25's `@vscode/vsce` install (already owner-approved in principle
  for this release phase) — no separate approval needed.
- **Environment:** No WSL/Docker containers needed. Network access needed
  only for the one-time `esbuild` install.

## Files owned

- `package.json` (root — new devDependency for `esbuild` only)
- `package-lock.json` (regenerated by `npm install`)
- `packages/extension/package.json` (`main` field, `scripts.package`,
  and a new bundling-related script entry — do not touch `name`/
  `publisher`/`private`/the `icon` field T-26 already fixed)
- `packages/extension/esbuild.config.mjs` (or equivalent — new file,
  exact name your choice, document it)
- `packages/extension/.vscodeignore` (update to match the new build
  output layout)

Do not touch any file under `packages/*/src/**` — this task changes how
existing, already-approved code is bundled/packaged, not what it does.
Do not remove or break the existing `tsc -b`-produced `dist/` output or
the `npm run typecheck`/`npm run test` scripts' reliance on it — those
must keep working exactly as before; this task adds a new, separate
bundling step for packaging purposes only.

## Interfaces

None — this task changes build/packaging tooling only. No runtime
interface is consumed or produced.

## Prohibited changes

- Do not modify any file under `packages/*/src/**`.
- Do not remove the existing `tsc -b` build/typecheck pathway.
- Do not touch `name`/`publisher`/`private`/`icon` in
  `packages/extension/package.json` — already correctly resolved by
  T-25/T-26.
- Do not expand scope into fixing other things this investigation might
  surface (e.g. if native-dependency bundling turns out to need real
  connector code changes) — stop and report as a new finding instead.

## Red-state evidence

- **Check to add:** none in the traditional Vitest sense — like T-26,
  this defect is only observable via a real extension-host runtime
  invocation. Red-state evidence is the exact failure already captured
  above (unzip the *current*, pre-fix `.vsix` and confirm no
  `node_modules/` is present; `grep -n "require(" dist/activation/activate.js`
  showing the `@paritylens/engine` require that will fail) — reproduce
  this yourself before making any change, to have a genuine before/after.

## Green-state and full verification

- **Focused evidence:** unzip the post-fix `.vsix` and confirm
  `@paritylens/engine`/`@paritylens/shared`'s code is now actually
  present (bundled into the new output file, or as a real
  `node_modules/` subset if you determine that's the more correct
  approach after investigation — document which and why). Confirm via
  extension-host log output (and, if you find a way, direct command
  invocation) that `activate()` completes without a `MODULE_NOT_FOUND`
  error and the `paritylens.runComparison` command is genuinely
  registered.
- **Full command:** `npm run verify`
- **Expected evidence:** exits 0 with the same test count as the current
  baseline (404 passed, 27 pre-existing skips, 431 total) — this task
  changes packaging/bundling only, `npm run test`'s Vitest suite doesn't
  consume the bundled output, only the `tsc -b`-produced `dist/`, which
  must remain unchanged in behavior.

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md`
- **Independent reviewer:** `reviewer` subagent (separate instance from
  whichever `implementer` subagent does this task)
- **Review report location:** `REVIEW-REPORT.md`
- **Commit or patch checkpoint:** Branch `task/T-27-extension-bundling`

**Note to reviewer:** this is the most consequential packaging task so
far — a broken `require()` at activation time means the shipped extension
is completely non-functional despite every prior automated check passing.
Independently reproduce both red state (unzip `main`'s current `.vsix`,
confirm the missing `node_modules/`) and green state (unzip the fixed
`.vsix`, confirm the workspace packages' code is genuinely reachable from
the bundled/shipped output — actually trace a `require`/import path by
hand if needed, don't just check a directory exists). If you have the
same CLI access, independently install and launch the fixed `.vsix` in
your own fresh sandbox and check extension-host logs for activation
success. Pay particular attention to whether `@duckdb/node-api`'s native
per-platform bindings (used somewhere in `@paritylens/engine`'s
dependency chain) were correctly handled — esbuild cannot bundle native
`.node` binaries, so if the bundled code path reaches DuckDB, those
binaries need a real solution (shipped alongside the bundle, or
`external`+documented as a known gap for a future connector-specific
task) rather than silently missing.
