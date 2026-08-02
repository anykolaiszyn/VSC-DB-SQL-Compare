# ParityLens — Implementation Report T-27

## Status and objective

- **Status:** COMPLETE (implementation and evidence only — not reviewed or approved; see Recommended next step)
- **Objective:** per `TASK-BRIEF.md`, fix the packaged `.vsix` shipping with no
  `node_modules/`, which caused `dist/activation/activate.js`'s
  `require("@paritylens/engine")` to throw `MODULE_NOT_FOUND` at extension-host
  activation time, so that `activate()` completes and the Data Parity tree
  view / `paritylens.runComparison` command actually register — by bundling
  `packages/extension/src/index.ts` and its `@paritylens/engine`/
  `@paritylens/shared` workspace dependencies into a single self-contained
  CommonJS file with esbuild, while handling DuckDB's native per-platform
  binary bindings (which esbuild cannot bundle) as a separately staged,
  runtime-resolved directory.

## Provenance note (read this first)

This task resumed from checkpoint commit `2342e57` on this branch, which a
prior implementer session left mid-task after being interrupted by a
session/infrastructure limit (not a design failure — its own commit message
documents this honestly). That commit already contained, and I inherited
without rewriting:

- `esbuild` added as a root devDependency.
- `packages/extension/esbuild.config.mjs` — the full bundling script,
  including the documented investigation into `vsce`'s hardcoded
  `node_modules/**` ignore and Node's `require.resolve` `paths` behavior
  that motivated staging DuckDB's native bindings into
  `packages/extension/native/node_modules/` with a `Module._resolveFilename`
  runtime patch injected as an esbuild `banner`.
- `packages/extension/package.json`'s `main` field pointed at
  `./dist-bundle/extension.js`, plus `bundle`/`package` scripts.
- `packages/extension/.vscodeignore` updated to exclude the now-unshipped
  `dist/**` and non-runtime files under `native/`, while explicitly not
  excluding `native/node_modules/**` itself.
- `.gitignore` additions for `dist-bundle/`, `packages/extension/native/`
  (attributed in the checkpoint commit message to the orchestrator, not the
  interrupted session).

I read this code in full rather than trusting the checkpoint's own
self-assessment, verified its reasoning against the actual installed
`@vscode/vsce` and `@duckdb/node-bindings` package sources on disk (see
Verification evidence below), and found it correct on inspection with one
defect: `packages/extension/esbuild.config.mjs` used the bare Node global
`process` without it being declared for ESLint's flat-config `no-undef` rule
(the repo's `eslint.config.mjs` has no `globals.node` environment configured
for any file), which failed `npm run lint` outright. This is the one
substantive code change I made; everything else in this report is my own
verification work on top of the inherited checkpoint.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/extension/esbuild.config.mjs` | Added a `/* global process */` comment (+ explanatory note) above the imports. No other lines changed. | `npm run lint` failed with `'process' is not defined  no-undef` at line 120 (now ~127) before this fix — a real, blocking lint error in inherited code, not a style preference. Flat-config ESLint (this repo's `eslint.config.mjs`) does not honor `/* eslint-env node */` comments (confirmed via the lint tool's own deprecation warning), so `/* global process */` is the correct fix scoped to this one file rather than touching the shared `eslint.config.mjs`, which is outside this task's file ownership. |
| `IMPLEMENTATION-REPORT.md` | Rewritten for T-27 (previously held T-26's report). | Required handoff artifact. |

No other files under this task's ownership (`package.json`, `package-lock.json`,
`packages/extension/package.json`, `packages/extension/.vscodeignore`) needed
further changes beyond what the checkpoint already had — verified by
inspection and by successfully building/packaging/testing against them
unmodified.

## Behavior and interfaces

- **Behavior delivered:** `npm run package` (via `packages/extension`'s
  `package` script: `npm run bundle && vsce package --no-dependencies`)
  produces a `.vsix` whose `extension/dist-bundle/extension.js` contains the
  inlined code of `@paritylens/engine`/`@paritylens/shared` (verified: zero
  `require("@paritylens/...")` calls remain in the bundle output, while
  internal engine symbols like `compareSchemas`/`profileColumn` are present),
  and whose `extension/native/node_modules/` contains the current
  platform/arch's DuckDB native binding
  (`@duckdb/node-bindings-win32-x64/duckdb.node` + `duckdb.dll`),
  `@duckdb/node-bindings`, and `detect-libc`. A Node-level harness that mocks
  the `vscode` module exactly as the real extension host would provide it
  (see Verification evidence) confirms `require()` of the packaged bundle
  succeeds and `activate()` runs to completion, registering both
  the `paritylens.dataParityView` tree view and the
  `paritylens.runComparison` command — the two symptoms reported broken
  (`"no data provider registered"`, `"command not found"`) are both
  confirmed fixed at this level of testing.
- **Interfaces consumed:** none (per brief — packaging/build tooling only,
  no runtime interface).
- **Interfaces produced:** none (per brief).

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Red state (lint) | `npm run verify` (before my `/* global process */` fix) | `packages/extension/esbuild.config.mjs 120:52 error 'process' is not defined no-undef` (x2), exit 1 | captured directly in this session's transcript; reproduced by running `npx eslint packages/extension/esbuild.config.mjs` in isolation, same two errors |
| Focused green state (lint) | `npx eslint packages/extension/esbuild.config.mjs` (after fix) | exit 0, no output | this session's transcript |
| Red state (packaging defect — reconstructed from `main`, not this branch) | reconstructed `main`'s pre-T-27 package layout in a scratch dir (`extension/dist/**` copied verbatim + `packages/extension/package.json`, no `node_modules/`, matching exactly what `vsce package --no-dependencies` on `main` produces per `git show main:packages/extension/package.json`'s `"package": "vsce package --no-dependencies"` script and `main`'s `.vscodeignore`), then ran a mock-activate Node harness (`mock-activate-test.cjs`, described below) against `extension/dist/index.js` | `REQUIRE_THREW:Error: Cannot find module '@paritylens/engine'` — exact `MODULE_NOT_FOUND`-class failure the brief describes, exit 1 | this session's transcript; `grep -n "require(" packages/extension/dist/activation/activate.js` independently confirms line 41 is `const engine_1 = require("@paritylens/engine");` |
| Focused green state (packaging fix) | `npm run bundle` then `npm run package` inside `packages/extension`, then unzip the resulting `.vsix` and run the same mock-activate harness against `extension/dist-bundle/extension.js` | bundle: `dist-bundle/extension.js` 757.4kb + sourcemap, exit 0. package: `vsce package --no-dependencies` succeeds, `.vsix` contains `dist-bundle/extension.js`, `native/node_modules/@duckdb/node-bindings/`, `native/node_modules/@duckdb/node-bindings-win32-x64/` (`duckdb.dll` 35.02 MB + `duckdb.node` 1.1 MB), `native/node_modules/detect-libc/`, and **no** `dist/**`. Harness output: `REQUIRE_OK` / `CREATED_TREE_VIEW:paritylens.dataParityView` / `REGISTERED_COMMAND:paritylens.runComparison` / `ACTIVATE_OK`, exit 0 | this session's transcript; unzip listing reproduced from `vsce package`'s own `INFO Files included in the VSIX` output |
| Full verification | `npm run verify` (typecheck + lint + test) | exit 0. `tsc -b --force` clean. `eslint .` clean. Vitest: **22 test files passed, 2 skipped (24)**; **404 tests passed, 27 skipped (431 total)** | this session's transcript, run twice (once to establish the lint-blocked state, once clean after the fix) |

### The mock-activate harness, and why I built it

`code` CLI 1.131.0 (confirmed via `code --version`) has no `--command` flag or
equivalent for invoking a registered command against a running instance from
the CLI (confirmed via `code --help` — only `--wait`, `--status`,
`--list-extensions` exist in that space, no command-invocation flag). I
installed the packaged `.vsix` into a genuinely fresh, fully sandboxed
profile (`--user-data-dir`/`--extensions-dir` both scratch temp folders under
this session's own scratchpad, never a real profile — confirmed via
`--list-extensions` showing only `parity-lens-dev.paritylens@0.0.1` installed)
and launched it. `paritylens`'s only `activationEvents` entry is
`onView:paritylens.dataParityView` (unchanged by this task, from
`packages/extension/package.json`) — VS Code only fires that event when the
view is actually rendered (typically by clicking the activity-bar icon),
which requires GUI interaction. This sandboxed environment has no
desktop-automation tool available (checked for `xdotool`/`wmctrl`/`nircmd`;
none present; the only GUI-automation tool available to me,
`claude-in-chrome`, drives a Chrome browser, not a native Electron/VS Code
window). I confirmed this by inspecting the exthost log
(`user-data/logs/.../window1/exthost/exthost.log`) and `views.log` after a
30+ second live sandboxed launch: no `paritylens` activation line appears
anywhere, and `views.log` never shows `paritylens.dataParityView` being
added to any view container — consistent with the view simply never having
been opened, not with any error.

Rather than stop at "log shows nothing" (which is genuinely ambiguous — it
looks identical whether the extension is fixed-but-never-triggered, or
still-broken-but-never-triggered), I wrote a small Node harness
(`mock-activate-test.cjs`, kept only in the OS temp scratchpad, not committed
— deleted with the rest of the sandbox before finishing) that:

1. Patches `Module._load`/`Module._resolveFilename` to return a hand-built
   mock `vscode` module for the bare specifier `"vscode"` — the same
   mechanism VS Code's real extension host uses to inject its own `vscode`
   module at runtime, and the same reason this bundle marks `vscode` as
   `external` rather than bundling it.
2. The mock implements exactly the `vscode` API surface the bundle's code
   actually touches at module-load time and inside `activate()` — I
   determined this by reading the bundle's own decompiled contents (e.g.
   `class ParityTreeItem extends vscode.TreeItem`, `vscode.window.createTreeView(...)`,
   `vscode.commands.registerCommand(...)`) rather than guessing, and expanded
   the mock twice when it threw on a genuinely missing mock member
   (`vscode.TreeItem` first, then `vscode.window.createTreeView`/`ViewColumn`/
   `showOpenDialog`) — each expansion is visible in this session's tool-call
   history as a real, unscripted failure that had to be diagnosed, not
   fabricated.
3. `require()`s the real packaged bundle file exactly as Node's CJS loader
   (which is what VS Code's extension host actually is) would, then calls
   the bundle's exported `activate(context)` with a mock `ExtensionContext`.

This is strictly stronger evidence than log inspection alone for the two
specific defects in scope (`MODULE_NOT_FOUND` at load time; tree
view/command not registering) because it directly exercises the same
`require()`/`activate()` code path VS Code's real host would run, using the
actual packaged bundle bytes unzipped from the real `.vsix` — it is not a
reimplementation or simulation of the logic, only a substitute for the
`vscode` module VS Code itself would normally supply. I verified the harness
actually discriminates red from green (rather than trivially always
"passing") by running it unmodified against a reconstructed pre-fix package
layout (`main`'s current `dist/index.js` + `package.json`, no
`node_modules/`) and confirming it fails with the exact `MODULE_NOT_FOUND`
error, then against the new bundle and confirming success — see the Red
state / Focused green state rows above.

### What I could NOT confirm, and why (read honestly, not glossed over)

- **No human-visual or interactive confirmation was performed or is claimed.**
  I did not click the activity-bar icon or invoke the Command Palette entry
  in a real, interactively-driven VS Code window — this sandboxed environment
  has no tool that can do that against a native desktop application (verified
  absence of `xdotool`/`wmctrl`/`nircmd`; `claude-in-chrome` only drives
  Chrome). The exthost/views logs from the live sandboxed launch are
  consistent with "never activated because never opened," not with any
  failure, but they are not, by themselves, proof of success — that's exactly
  why I built the mock-activate harness as a substitute. A human (or an agent
  with desktop GUI automation) actually clicking the icon and running the
  command in a sandboxed profile would have been strictly better evidence,
  but that sandbox has now been deleted per the brief's cleanup instruction
  (see below) — a fresh one would need to be recreated from the same `.vsix`
  if that confirmation is wanted.
- **The mock-activate harness's `vscode` mock is hand-built and could be
  incomplete for code paths not exercised by `activate()` itself** (e.g.
  deeper webview message-passing behavior inside `runComparisonCommand`,
  which only runs after the command is actually invoked with a real file
  picked via `showOpenDialog` — my mock stubs `showOpenDialog` to resolve
  `undefined`, so `runComparisonCommand`'s actual body was not exercised,
  only its registration). This is consistent with the brief's own framing —
  registration (not full end-to-end comparison execution) is the specific
  regression in scope for T-27; T-22 already covers `runComparisonCommand`'s
  internal logic under its own Vitest suite
  (`runComparisonCommand.test.ts`, part of the 404 passing tests above),
  which does not change in this task.
- **DuckDB native binary resolution is confirmed working, but only for the
  build machine's own platform/arch** (`win32-x64`, confirmed via
  `process.platform`/`process.arch` used in `esbuild.config.mjs`'s staging
  logic) — this was already a disclosed, deliberate limitation in the
  inherited checkpoint's own code comments (not something I introduced or am
  newly disclosing), and I did not attempt to address it, per the brief's
  explicit instruction not to expand scope into further native-dependency
  work.
- I did not independently re-derive whether `@duckdb/node-bindings`'s native
  `.node` load is *provably* reached by the harness beyond the fact that
  `require("@duckdb/node-bindings")`'s module body is
  `module.exports = getNativeNodeBinding(...)` at the top level (confirmed by
  reading the installed package's own `duckdb.js`) — meaning it necessarily
  runs during module load, and `ACTIVATE_OK` could not have printed if that
  load had thrown. I consider this solid evidence but flag it explicitly as
  inference from reading the dependency's source, not a dedicated assertion
  inside the harness itself (e.g. no console log line was added at the
  exact resolution call site).

## Assumptions and risks

- **Assumptions:**
  - The inherited checkpoint's own documented investigation (vsce's
    hardcoded `node_modules/**` ignore only matching the top-level
    directory; Node's `paths` resolution requiring a literally-named
    `node_modules` directory) is correct — I did not re-derive this from
    scratch, but did independently confirm its *outcome* (the packaged
    `.vsix` genuinely contains `native/node_modules/**` intact, and the
    mock-activate harness genuinely resolves the DuckDB chain through it)
    rather than trusting the write-up alone.
  - `mssql`/`pg` genuinely do not appear in the bundle graph, as the
    checkpoint's comment claims — I did not re-verify this via a fresh
    esbuild metafile inspection; I re-ran the exact same `npm run bundle`
    the checkpoint already validated this against, and it is unchanged by
    my one lint fix.
- **Risks or limitations:**
  - The mock-activate harness is a substitute for real VS Code activation,
    not a replacement — see "What I could NOT confirm" above. This is the
    single most important thing for the reviewer to independently probe,
    per the brief's own note ("if you have the same CLI access,
    independently install and launch the fixed `.vsix` in your own fresh
    sandbox and check extension-host logs").
  - DuckDB binary is win32-x64-only in this build's `.vsix`, a
    pre-existing, disclosed limitation (documented in
    `esbuild.config.mjs`'s own header comment, inherited from the
    checkpoint) — cross-platform packaging is out of scope for T-27.
  - The `.vsix` is 13.02 MB (mostly the 35 MB-uncompressed DuckDB DLL),
    confirmed via `vsce package`'s own summary output — worth the
    reviewer's awareness but not a defect; the brief's scope is
    correctness, not artifact size (T-27 §2 explicitly says minification
    is optional/"your judgment").
- **Blockers:** none.

## Patch or commit identity

- **Branch:** `task/T-27-extension-bundling`
- **Commits on this branch:**
  - `2342e57` — inherited checkpoint (esbuild bundling implementation,
    pre-existing before this session; see Provenance note above).
  - New commit from this session (added immediately after this report is
    written) — the `esbuild.config.mjs` lint fix and this
    `IMPLEMENTATION-REPORT.md`.

## Recommended next step

Independent review by the `reviewer` subagent, per the brief's Handoff
section — a separate instance from this implementer. The brief's own note to
the reviewer specifically asks for independent reproduction of both red and
green state and independent sandboxed install/launch; I recommend the
reviewer pay particular attention to the one gap I could not close myself:
real interactive/visual confirmation of the activity-bar icon and Command
Palette entry actually working in a live-clicked VS Code window, since no
tool available to me in this environment can drive that GUI interaction. I
am not recommending self-approval and have not marked this task complete
beyond my own implementation-and-evidence scope.
