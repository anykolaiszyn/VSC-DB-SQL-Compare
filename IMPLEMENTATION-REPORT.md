# ParityLens — Implementation Report T-46

## Status and objective

- **Status:** COMPLETE (implementation only — not reviewed or approved)
- **Objective:** Resolve finding T-27-01 (OPEN, accepted non-blocking, recorded
  in `PROGRESS-LEDGER.md`'s Open findings table): add `"**/dist-bundle/**"` to
  `eslint.config.mjs`'s `ignores` array so that running `npm run bundle`
  (or `npm run package`, which runs it first) followed by `npm run verify`
  in the same working tree does not lint the generated, gitignored
  `packages/extension/dist-bundle/extension.js` bundle as source.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `eslint.config.mjs` | Added one entry, `"**/dist-bundle/**"`, to the existing `ignores` array (between `"**/out/**"` and `"**/*.d.ts"`) | Brief's recorded recommended resolution for T-27-01: exclude the generated, `.gitignore`'d bundle output from linting without touching any other ignore entry |

No other file was touched. `packages/extension/dist-bundle/` (the generated
bundle directory itself) was left exactly as `npm run bundle` produced it —
gitignored, not added to git, not deleted.

## Behavior and interfaces

- **Behavior delivered:** `eslint.config.mjs`'s `ignores` array now excludes
  `**/dist-bundle/**` in addition to the pre-existing
  `**/node_modules/**`, `**/dist/**`, `**/out/**`, `**/*.d.ts`,
  `**/coverage/**`. Running `npm run bundle` followed by `npm run lint` (or
  `npm run verify`) in the same working tree no longer lints the minified,
  generated `packages/extension/dist-bundle/extension.js` as source, and no
  longer fails on its lint problems.
- **Interfaces consumed:** None — standalone lint-config change, no code
  interface dependency, per the brief's own "Interfaces consumed" section.
- **Interfaces produced:** None — this is a build-tooling/lint-scope config
  change, not a code interface.

## Verification evidence

All commands run from repo root (`V:\Secret Projects\VSC-DB-SQL-Compare`)
on branch `task/T-46-eslint-dist-bundle-ignore`.

**Baseline check (before any edit), confirming the working tree was green
prior to reproducing the finding:**

```
$ npm run verify
```
Result: exit 0. `Test Files 34 passed | 2 skipped (36)`,
`Tests 598 passed | 27 skipped (625)`.

**Red-state reproduction — brief's required evidence:**

```
$ npm run bundle --workspace=packages/extension
> paritylens@0.0.1 bundle
> node esbuild.config.mjs

  dist-bundle\extension.js      4.1mb
  dist-bundle\extension.js.map  7.2mb

Done in 431ms
```
(The root `package.json` has no `bundle` script of its own — `bundle` is
defined in `packages/extension/package.json` as `node esbuild.config.mjs`,
confirmed by reading that file before running it — so it was invoked via
`--workspace=packages/extension`, npm's standard way to run a script that
lives in one workspace package. This produced exactly the file path the
brief names: `packages/extension/dist-bundle/extension.js`.)

```
$ npm run lint
...
  95080:5    error    'escapeIdentifier' is assigned a value but never used     @typescript-eslint/no-unused-vars
  ...
  97842:1    error    Unexpected constant truthiness on the left-hand side of a `&&` expression   no-constant-binary-expression
  97842:7    error    'module' is not defined                                    no-undef

✖ 1772 problems (1768 errors, 4 warnings)
  7 errors and 4 warnings potentially fixable with the `--fix` option.
```
Exit code: 1 (confirmed separately via `echo $?` after a non-piped run,
since piping through `tail` masks the real exit status).

This confirms the finding's own description is currently reproducible:
lint fails specifically against generated content inside `dist-bundle/`
(line numbers in the 95000+/96000+/97000+ range, well past any real source
file's line count, and referencing `require()`/`module` — bundler-emitted
constructs, not this codebase's authored TypeScript). The exact problem
count (1772) differs from the finding's originally recorded 221, which the
brief explicitly anticipates ("may differ slightly ... since the codebase
has grown since T-27 — that's expected and fine, record what you actually
see").

**Fix applied:** one-line addition to `eslint.config.mjs`'s `ignores`
array (see diff below).

**Green-state evidence — with `dist-bundle/` still present in the working
tree:**

```
$ ls packages/extension/dist-bundle/
extension.js
extension.js.map

$ npm run lint
> paritylens@0.0.1 lint
> eslint .
```
Exit code: 0 (no output beyond the npm script header — no lint problems
reported).

**Full fresh `npm run verify`, bundle still present:**

```
$ npm run verify
```
Exit code: 0. `Test Files 34 passed | 2 skipped (36)`,
`Tests 598 passed | 27 skipped (625)` — identical counts to the pre-task
baseline, confirming no regression.

**The one-line diff:**

```diff
--- a/eslint.config.mjs
+++ b/eslint.config.mjs
@@ -8,6 +8,7 @@ export default tseslint.config(
       "**/node_modules/**",
       "**/dist/**",
       "**/out/**",
+      "**/dist-bundle/**",
       "**/*.d.ts",
       "**/coverage/**"
     ]
```

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline (pre-edit) | `npm run verify` | Exit 0, 598 passed / 27 skipped (625) | This report, above |
| Red state | `npm run bundle --workspace=packages/extension` then `npm run lint` | Bundle produced successfully; lint exit 1, 1772 problems (1768 errors, 4 warnings) against `dist-bundle/extension.js` | This report, above |
| Focused green state | `npm run lint` (bundle still present) | Exit 0, no problems reported | This report, above |
| Full verification | `npm run verify` (bundle still present) | Exit 0, 598 passed / 27 skipped (625) — no regression vs. baseline | This report, above |

## Assumptions and risks

- **Assumptions:** The brief describes running `npm run bundle` from repo
  root; the root `package.json` has no such script itself, only
  `packages/extension/package.json` does. I ran it via
  `npm run bundle --workspace=packages/extension`, npm's standard
  workspace-targeted invocation, which produces the identical output file
  the brief names (`packages/extension/dist-bundle/extension.js`) and is
  functionally equivalent to what `npm run package` (which the finding
  also references) would trigger internally. I judged this satisfies the
  brief's intent (reproduce the real red state against the real generated
  artifact) rather than being a scope deviation, since the brief's actual
  requirement is the artifact and the lint failure against it, not the
  exact invocation syntax.
- **Risks or limitations:** None identified. The fix is a single glob
  entry, scoped exactly as the brief requires (no other `ignores` entry
  touched, no widening beyond `"**/dist-bundle/**"`, no bare
  `"dist-bundle"`, no `.vscodeignore`/`package.json`/bundler config
  touched, `dist-bundle/` itself left gitignored and untracked).
- **Blockers:** None.

## Patch or commit identity

- **Patch or commit:** see commit created immediately after this report on
  this branch (staged together: `eslint.config.mjs` and this report).
- **Branch or workspace:** `task/T-46-eslint-dist-bundle-ignore`

## Recommended next step

Independent review by a separate reviewer agent, per the brief's Handoff
section. The brief specifically asks the reviewer to re-verify: (1) the
red-state reproduction is genuine (lint actually fails against the bundle
before the fix), (2) the fix is scoped to exactly the one new ignore
entry, (3) no other file was touched, (4) a fresh full `npm run verify` is
green with the bundle present. This report does not constitute review or
approval, and the task should not be marked COMPLETE/APPROVED in
`PROGRESS-LEDGER.md` until that independent review has run.
