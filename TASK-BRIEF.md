# TASK-BRIEF.md — T-46: eslint `dist-bundle` ignore fix

## Objective

Resolve finding **T-27-01** (OPEN, accepted non-blocking, recorded in
`PROGRESS-LEDGER.md`'s Open findings table): add
`"**/dist-bundle/**"` to `eslint.config.mjs`'s `ignores` array so that
running `npm run bundle` (or `npm run package`, which runs it first)
followed by `npm run verify` in the same working tree does not lint the
generated, gitignored `packages/extension/dist-bundle/extension.js`
bundle as source.

The finding's own recorded text (verbatim, from `PROGRESS-LEDGER.md`):

> `npm run bundle` (and `npm run package`, which now runs it first)
> produces `packages/extension/dist-bundle/extension.js`, which is
> `.gitignore`'d but not added to `eslint.config.mjs`'s `ignores` list
> (only `**/dist/**`/`**/out/**` are excluded, no `**/dist-bundle/**`
> entry). Reviewer reproduced twice: run `npm run bundle` then `npm run
> verify` → exit 1, 221 lint problems (the minified bundle linted as
> source); delete `dist-bundle/` and re-run → exit 0, 404/27/431.
> ... the gap means `npm run package` followed by `npm run verify` in
> the same working tree (a plausible release-checklist ordering)
> produces a false verify failure unrelated to actual code correctness.

Recorded recommended resolution: add `"**/dist-bundle/**"` to
`eslint.config.mjs`'s `ignores` array.

## Scope

1. Edit `eslint.config.mjs`'s existing `ignores` array (currently:
   `"**/node_modules/**"`, `"**/dist/**"`, `"**/out/**"`, `"**/*.d.ts"`,
   `"**/coverage/**"`) to add one new entry: `"**/dist-bundle/**"`.
2. Reproduce the finding's red state first: run `npm run bundle` (from
   repo root, builds `packages/extension/dist-bundle/extension.js`),
   then run `npm run lint` (or `npm run verify`) and confirm it fails
   with lint errors against the generated bundle — this is the
   red-state evidence the finding itself already describes; capture the
   actual exit code and problem count you observe (may differ slightly
   from the finding's originally recorded 221/404/27/431 numbers since
   the codebase has grown since T-27 — that's expected and fine, record
   what you actually see).
3. Apply the one-line `ignores` array edit.
4. Re-run `npm run lint` (or `npm run verify`) with the bundle still
   present in the working tree — confirm it now passes cleanly (bundle
   no longer linted).
5. Run the full `npm run verify` one more time to confirm no regression
   elsewhere.

## Files owned

- `eslint.config.mjs` (repo root) — the only file this task may edit.

## Interfaces consumed

- None. This is a standalone lint-config change with no code interface
  dependency.

## Prohibited changes

- Do not touch any other `ignores` entry already present.
- Do not touch `packages/extension/.vscodeignore`, `package.json`
  scripts, or any bundling script (`esbuild`/bundle config) — the
  bundle-generation process itself is out of scope; only the lint
  config's blindness to its output is being fixed.
- Do not delete or commit the generated `dist-bundle/` directory itself
  (it is gitignored and must stay that way — do not add it to git, do
  not remove it from `.gitignore`).
- Do not widen the new ignore glob beyond `"**/dist-bundle/**"` (e.g. no
  bare `"dist-bundle"` or overly broad wildcard that could accidentally
  exempt unrelated source directories).

## Red-state evidence required

Actual command output (not paraphrased) showing:
1. `npm run bundle` succeeding and producing
   `packages/extension/dist-bundle/extension.js`.
2. `npm run lint` (or `npm run verify`) failing with lint errors
   specifically against files under `dist-bundle/`, confirming the
   currently-unfixed gap is real and reproducible right now, before any
   edit is made.

## Green-state evidence required

1. The one-line `eslint.config.mjs` diff.
2. `npm run lint` (or `npm run verify`) passing cleanly with
   `dist-bundle/` still present in the working tree (bundle no longer
   generates lint errors).
3. A full fresh `npm run verify` run (typecheck + lint + test) passing
   with no regression in test counts versus the pre-task baseline.

## Handoff

- Write `IMPLEMENTATION-REPORT.md` using
  `multi-agent-idea-to-app/templates/IMPLEMENTATION-REPORT.md`.
- Commit on branch `task/T-46-eslint-dist-bundle-ignore`.
- Recommend independent review as the next step.
- Reviewer should specifically re-verify: (1) the red-state reproduction
  is genuine (lint actually fails against the bundle before the fix),
  (2) the fix is scoped to exactly the one new ignore entry, (3) no
  other file was touched, (4) a fresh full `npm run verify` is green
  with the bundle present.
