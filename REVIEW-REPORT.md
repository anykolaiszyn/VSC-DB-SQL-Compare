# ParityLens — Review Report T-27

## Review independence

I am a separate reviewer instance from both implementer sessions that
produced `2342e57` (checkpoint) and `e3dbcfb` (final). I did not author any
of the code under review. I read `TASK-BRIEF.md` as sole authority, treated
every claim in `IMPLEMENTATION-REPORT.md` as something to independently
verify rather than trust, and did not edit any implementation-owned file —
this report and (if warranted) `PROGRESS-LEDGER.md`'s open-findings table
are the only files I touched. All scratch/probe files I created during
review (two independent Node harnesses, a `require.resolve` paths-behavior
probe, reconstructed red-state/green-state `.vsix` unzip directories) were
created only under the session scratchpad, never inside the repository, and
were deleted before finishing; `git status`/`git diff --stat` on the repo
show no residue.

## Review scope

- **Task objective:** fix the packaged `.vsix` shipping with no
  `node_modules/`, which caused `dist/activation/activate.js`'s
  `require("@paritylens/engine")` to throw `MODULE_NOT_FOUND` at extension
  activation (the shipped extension was completely non-functional), by
  bundling the extension with esbuild into a single self-contained CommonJS
  file, with DuckDB's native per-platform binary handled separately since
  esbuild cannot bundle a `.node` file.
- **Files and interfaces reviewed:** `packages/extension/esbuild.config.mjs`
  (new, full read), `packages/extension/package.json` (`main`, `scripts`),
  `packages/extension/.vscodeignore`, `.gitignore`, root `package.json`/
  `package-lock.json` (esbuild devDependency), `IMPLEMENTATION-REPORT.md`,
  `TASK-BRIEF.md`, `PROGRESS-LEDGER.md`. Diff base `32f27bc` (main) →
  branch tip `e3dbcfb`. Confirmed `2342e57..e3dbcfb` touches only
  `esbuild.config.mjs` (+9 lines, the `/* global process */` fix) and
  `IMPLEMENTATION-REPORT.md`, matching the report's provenance claim exactly.
- **Evidence reviewed:** `@vscode/vsce`'s own installed compiled source
  (`node_modules/@vscode/vsce/out/package.js`, `out/npm.js`); an empirical
  Node script confirming `require.resolve(..., {paths})` behavior; a fresh
  rebuild of the `.vsix` from this branch tip; two independently-authored
  Node harnesses (not the implementer's, written from scratch based on my
  own reading of the actual bundle's `vscode.*` API surface) that mock the
  `vscode` module and `require()` the real packaged bundle; a reconstruction
  of `main`'s pre-fix package layout to confirm red-state failure; a fresh
  `npm run verify` run.

## Critical findings

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| NONE | — | — | — |

## Important findings

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| T-27-01 | `npm run bundle` (and therefore `npm run package`, which the brief's own scripts.package now runs as its first step) produces `packages/extension/dist-bundle/extension.js` on disk. That path is `.gitignore`'d but was **not** added to `eslint.config.mjs`'s `ignores` list (which excludes `**/dist/**` but has no `**/dist-bundle/**` entry). `npm run lint` (part of `npm run verify`) then lints the generated, minified bundle as source and fails hard: 221 problems / 219 errors (`no-undef` on `require`/`module`/`process`/`setTimeout`/`performance`, `no-require-imports`, etc.), exit 1. I reproduced this myself twice: ran `npm run bundle` then `npm run verify` → exit 1 with the error dump above; deleted `dist-bundle/` and re-ran `npm run verify` → exit 0, 404/27/431 (matching the report exactly). This means the report's clean `npm run verify` result is real but only holds in a specific ordering (verify-before-bundle, or bundle-output-deleted-before-verify) that the report never states or defends — a developer or CI job that runs `npm run package` (the brief's own new release-packaging entry point) and then `npm run verify` in the same working tree, a highly plausible release-checklist sequence, will get a false verify failure that has nothing to do with actual code correctness. Root cause is a one-line gap in `eslint.config.mjs`, a file outside T-27's declared ownership (`Files owned` in `TASK-BRIEF.md` lists only root `package.json`/`package-lock.json`, `packages/extension/package.json`, `packages/extension/esbuild.config.mjs`, `packages/extension/.vscodeignore`) — so the correct fix is a new bounded follow-up task, not an in-place edit here. | Route to a new bounded task (or amend `eslint.config.mjs`'s `ignores` array to add `"**/dist-bundle/**"`, mirroring the existing `**/dist/**`/`**/out/**` entries) before `npm run package` is used as a routine step in any release checklist or CI job. Does not block T-27's own approval since it is a build-tooling/lint-scope gap, not a defect in the packaged extension's actual runtime behavior, and T-27 correctly did not touch the out-of-ownership `eslint.config.mjs` itself — but it must be tracked, since the brief's own stated full-verification contract ("exits 0 with the same test count as the current baseline") is only true order-dependently, and this was not disclosed anywhere in `IMPLEMENTATION-REPORT.md`. |

## Minor findings

| ID | Finding | Evidence | Suggested resolution |
| --- | --- | --- | --- |
| NONE | — | — | — |

## Verification performed

| Check | Exact command or inspection | Result |
| --- | --- | --- |
| `vsce`'s hardcoded `node_modules/**` ignore claim | Read `node_modules/@vscode/vsce/out/package.js` (`defaultIgnore` array, `collectAllFiles`, `collectFiles`) and `out/npm.js` (`getDependencies`) directly | Confirmed accurate. `defaultIgnore` (applied unconditionally via `collectFiles`) contains no `node_modules` entry at all. The `ignore: 'node_modules/**'` glob option only appears inside `collectAllFiles`, evaluated per-`dep` where `deps = getDependencies(cwd, dependencies, ...)`; with `--no-dependencies`, `dependencies === 'none'` and `getDependencies` returns `[cwd]` (just `packages/extension/` itself) per `npm.js` line 188-189 — so the glob's `ignore` is evaluated relative to `packages/extension/`, matching only a literal top-level `packages/extension/node_modules/**`, never a nested `native/node_modules/**`. Matches the esbuild config's comment and the report's claim exactly. |
| Node's `require.resolve(..., {paths})` directory-name requirement | Wrote and ran a standalone Node script (deleted after use) creating two directories — one literally named `node_modules`, one not — each containing an equivalent resolvable package, then calling `require.resolve(name, {paths: [dir]})` against each | Confirmed empirically: resolution against the non-`node_modules`-named directory threw `MODULE_NOT_FOUND`; resolution against the real `node_modules`-named directory succeeded. Matches the claim exactly. |
| Bundle content — no remaining workspace `require()`s | `npm run bundle` (fresh, this branch tip) then `grep -c 'require("@paritylens' dist-bundle/extension.js` | `0` matches; `grep -c "compareSchemas\|profileColumn"` (internal engine symbols) → 6 matches, confirming genuine inlining, not just an absent standalone check |
| `.vsix` structure | `npx vsce package --no-dependencies` (fresh rebuild) then unzipped the output | `extension/dist-bundle/extension.js` present; `extension/native/node_modules/@duckdb/node-bindings/`, `@duckdb/node-bindings-win32-x64/` (`duckdb.dll` 35.02 MB, `duckdb.node` 1.1 MB), `detect-libc/` all present; **no `extension/dist/` directory anywhere in the archive** |
| Red-state reproduction | Reconstructed `main`'s (`32f27bc`) pre-fix package.json (`main: ./dist/index.js`, `package: vsce package --no-dependencies`, no bundle step) plus the current `tsc -b`-produced `dist/` (unchanged by T-27, confirmed via `git diff` showing zero `src/**` touches), then ran my own from-scratch mock-`vscode` Node harness against it | `REQUIRE_THREW: Error: Cannot find module '@paritylens/engine'` — the exact defect described in the brief, reproduced independently, not copy-pasted from the implementer's transcript |
| Green-state confirmation (registration) | Ran my own from-scratch mock-`vscode` harness (built independently from reading the bundle's actual `vscode2.*`/`vscode.*` call sites via `grep`, not the implementer's script) against the freshly rebuilt, freshly unzipped `.vsix` payload | `REQUIRE_OK` / `CREATED_TREE_VIEW:paritylens.dataParityView` / `REGISTERED_COMMAND:paritylens.runComparison` / `ACTIVATE_OK` — confirms the harness genuinely discriminates red from green using an independently-derived implementation, not a reuse of the implementer's own script |
| Green-state confirmation (deeper than the implementer's disclosed gap) | Wrote a second, deeper independent harness that also mocks `showOpenDialog` to return a real temp `.paritylens` YAML file, then actually **invokes** the registered `paritylens.runComparison` command handler end-to-end (not just confirming registration) | First run surfaced a probe-authoring mistake (`"version" is required and must be a number"` — my first test YAML was missing the required `version`/`name`/`keys` fields per `definition.ts`), fixed the probe's YAML against the real schema (confirmed via `planner.test.ts`'s own fixtures), then re-ran: `ACTIVATE_OK` → command invoked → `parseDefinition` → `runComparison` against real `FixtureConnector` instances (genuinely exercising the DuckDB native binding staged in `native/node_modules/`, not just resolving it) → `renderResultsHtml` output containing `"Schema Differences"`, 3026 characters, no error path taken. This is strictly stronger evidence than the implementer's own harness, which explicitly disclosed stopping at command *registration* and not exercising `runComparisonCommand`'s body. My probe closes that specific gap for the win32-x64 build machine and confirms the DuckDB native binding is not just present on disk but genuinely loads and executes real comparison logic through the packaged bundle. |
| Full verification (clean tree) | `npm run verify` with `dist-bundle/`/`native/`/the built `.vsix` all removed first | Exit 0. `tsc -b --force` clean, `eslint .` clean, Vitest: 22 test files passed / 2 skipped (24), 404 tests passed / 27 skipped (431 total) — matches the report's claimed baseline exactly |
| Full verification (dirty tree, adversarial order) | `npm run bundle` then `npm run verify` (bundle output left on disk) | Exit 1 — see T-27-01. Reproduced twice for certainty |
| Scope/ownership check | `git diff 32f27bc..e3dbcfb --name-only` against `TASK-BRIEF.md`'s "Files owned" list; `git diff ... -- packages/extension/package.json` grepped for `name`/`publisher`/`private`/`icon`; `git diff --name-only \| grep 'packages/.*/src/'` | All changed files (`.gitignore`, `IMPLEMENTATION-REPORT.md`, `package-lock.json`, `package.json`, `packages/extension/.vscodeignore`, `packages/extension/esbuild.config.mjs`, `packages/extension/package.json`) are within, or are a minimal mechanically-forced consequence of, declared ownership. `.gitignore`'s two new lines (`dist-bundle/`, `packages/extension/native/`) are outside the literal "Files owned" list but are the necessary, minimal consequence of introducing new build-output directories that must not be committed — correctly attributed in the report to "the orchestrator," not disguised. No `name`/`publisher`/`private`/`icon` touches (prohibited). Zero `packages/*/src/**` files touched (prohibited) |

## Prior-finding disposition

No open finding in `PROGRESS-LEDGER.md` was explicitly routed to T-27 for
resolution (T-27 itself is the routing target from the `32f27bc` release
step 5 finding, and it fully resolves that finding — see below). X-01 (open
since T-10, "no test proves the tree view registers against a real
extension-host runtime") is adjacent but not this task's stated target; T-27
does not close X-01 (still no `@vscode/test-electron` or real GUI-driven
confirmation), but does provide materially stronger evidence than X-01's
gap describes, via the two independent Node-level harnesses above. X-01
should remain open, unchanged.

| Finding ID | Disposition | Evidence of resolution |
| --- | --- | --- |
| Release-step-5 finding routed to T-27 (`32f27bc`'s commit message: "packaged extension is non-functional") | RESOLVED | Independently reproduced the exact red-state failure (`Cannot find module '@paritylens/engine'`, the Node-level manifestation of `MODULE_NOT_FOUND`) against a reconstruction of `main`'s pre-fix layout, and independently confirmed the green-state fix via two from-scratch harnesses, one of which goes beyond registration to a full command-invocation-through-DuckDB round trip. The specific defect described in the brief is genuinely fixed in the shipped `.vsix`. |
| X-01 (open, T-10) | NOT APPLICABLE to this task's closure — remains OPEN | T-27 strengthens the evidence available (Node-level harness exercising the real bundle) but does not add `@vscode/test-electron` or real GUI-driven confirmation; the brief itself frames this as an acceptable, disclosed gap for this environment, not something T-27 was scoped to close |

## Assessment of the disclosed GUI-confirmation gap

The brief explicitly anticipated this environment may have no GUI-automation
tool and asked the reviewer to judge whether Node-harness evidence is strong
enough to approve without a human/real-VS-Code GUI check. My own assessment,
reached independently and with materially stronger evidence than what the
implementer produced (two harnesses, not one; one of which exercises the
full command-invocation path through real `FixtureConnector`/DuckDB
execution, not just registration): **the Node-harness evidence is
sufficient to approve this specific defect as fixed.** The reasoning:

- The original defect was a `require()`-time `MODULE_NOT_FOUND` thrown
  during `activate()`, before any VS Code UI event ever fires. A harness
  that `require()`s the actual packaged bundle bytes and calls the real
  exported `activate()` function exercises exactly the code path that threw
  before — it is not a simulation of that code, it is that code, run against
  a minimal (but API-surface-complete, confirmed via `grep`-derived
  enumeration of every `vscode.*`/`vscode2.*` call site actually present in
  the bundle) substitute for the one dependency (`vscode` itself) that VS
  Code's real extension host would supply.
- My second, deeper harness goes further than what the brief technically
  required (registration only) and confirms the DuckDB native binding is not
  merely present on disk or resolvable, but genuinely loads and executes —
  closing the specific "DuckDB native binary correctly handled" concern the
  brief's own note to the reviewer flagged as the thing to pay particular
  attention to.
- What remains unconfirmed (real activity-bar click, real Command Palette
  invocation, visual rendering) is a materially different and narrower risk
  category than "does `require()` throw" — it is UI-wiring/`package.json`
  manifest correctness (already covered by T-26's own live human
  confirmation of icon/view-container registration) plus the
  `onView:paritylens.dataParityView` activation-event dispatch mechanism
  itself, which is VS Code platform behavior, not something T-27's bundling
  change touches or could plausibly break. T-26 already confirmed live that
  the icon renders and the view container registers with no startup error;
  T-27 does not change `contributes.viewsContainers`/`contributes.views`/
  `activationEvents` at all (confirmed via the diff — only `main`,
  `scripts`, and the new bundling file changed).
- This is a case where the project's own established pattern (T-26's
  precedent: "disclosed limitation, not something to penalize," per this
  task's own dispatch instructions) applies squarely, and where a human GUI
  click-through would mostly re-confirm T-26's already-closed finding plus
  the specific `require()`-doesn't-throw fact this review's harnesses
  already establish twice, independently, by two different authors.

I do **not** believe this task should be blocked pending a human GUI check.
If the owner wants belt-and-suspenders confidence, a real
activity-bar-click/Command-Palette confirmation remains cheap to obtain
before the next release-checklist step that actually ships this `.vsix` to
an end user, but nothing in my independent probing found any reason to
expect it would fail.

## Approval status

- **Status:** APPROVED
- **Reviewer:** Independent reviewer subagent (Sonnet 5), separate instance
  from both T-27 implementer sessions
- **Date:** 2026-08-01
- **Release or dependency impact:** The core defect this task exists to fix
  (shipped `.vsix` with no `node_modules/`, `MODULE_NOT_FOUND` on
  activation, extension completely non-functional) is genuinely resolved
  and independently re-verified via two from-scratch harnesses plus direct
  `.vsix` content inspection — safe to proceed with this as the release
  candidate's packaging approach. One Important, non-blocking finding
  (T-27-01) must be tracked and fixed before `npm run package` becomes a
  routine step immediately preceding `npm run verify` in any release
  checklist or CI pipeline, since that specific ordering currently produces
  a false verify failure (a lint-scope gap in `eslint.config.mjs`, not a
  packaging or runtime defect). Recommend the orchestrator open a small
  bounded follow-up task to add `"**/dist-bundle/**"` to
  `eslint.config.mjs`'s `ignores` array before relying on that ordering in
  the release checklist.
