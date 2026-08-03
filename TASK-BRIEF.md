# TASK-BRIEF.md — T-45: npm audit fix for brace-expansion (M-01)

## Objective

Close M-01's remaining `npm audit` findings — `brace-expansion`
(transitive via ESLint's dependency chain: `@eslint/config-array`,
`@eslint/eslintrc`, `eslint` itself), 2 high-severity advisories
(`GHSA-mh99-v99m-4gvg`, `GHSA-rgw5-rvv9-x895`) — via a non-breaking
`npm audit fix`. This mirrors T-23's exact precedent (bump a
dev-tooling dependency range, no code changes, verify green,
independently confirm the audit output afterward).

## Scope

1. Run `npm audit fix` (no `--force`) at the repo root. Confirm it
   resolves within existing semver ranges — do not accept a fix that
   requires `--force` or that bumps ESLint to a new major version; if
   `npm audit fix` alone cannot close these findings without `--force`,
   stop and report that back rather than forcing a breaking bump.
2. Regenerate `package-lock.json` as a natural consequence of step 1
   (do not hand-edit it).
3. Re-run `npm run verify` and confirm it is still green with the same
   test count as before this change (no source code should need to
   change — this is a dev-dependency-only bump).
4. Re-run `npm audit` and confirm `brace-expansion`'s findings are gone
   (or reduced — document exactly what remains, if anything).

## Dependencies

None — this is an isolated dependency bump, same shape as T-23.

## Files owned

- `package.json` (root `devDependencies`/`dependencies` ranges only, as
  a side effect of `npm audit fix` — do not hand-edit version numbers
  yourself outside of what the tool changes)
- `package-lock.json`

## Prohibited changes

- Do not touch any file under `packages/**` — this task should require
  zero source code changes.
- Do not run `npm audit fix --force` or manually bump ESLint to a new
  major version. If the non-breaking path doesn't fully close the
  finding, document what's left rather than forcing a breaking change.
- Do not touch `vitest`'s version (already fixed by T-23) or any other
  dependency not implicated by the `brace-expansion` advisory chain.

## Interfaces consumed / produced

None — no code-level interface changes. Produces: an updated
`package-lock.json` and a documented `npm audit` before/after diff in
the implementation report.

## Red/Green/Full verification evidence required

- **Red**: `npm audit` output today, showing the `brace-expansion`
  findings (2 advisories) as M-01 currently documents.
- **Green**: `npm audit` output after the fix, showing those specific
  findings resolved (paste the full before/after `npm audit` summary
  line counts in the implementation report).
- **Full**: `npm run verify` (typecheck + lint + test) green, with the
  exact same test/skip counts as `main`'s last recorded state (598
  non-skipped, 27 skipped) — since no source code changes, counts must
  match exactly, not just "close enough."

## Handoff note for the reviewer

Please independently confirm:

1. `npm audit` genuinely shows the `brace-expansion` findings resolved
   (re-run it yourself, don't trust the pasted output alone).
2. No package under `packages/**` changed — `git diff --stat main..<branch>`
   should show only `package.json`/`package-lock.json`/
   `IMPLEMENTATION-REPORT.md`.
3. `npm run verify`'s test count matches `main`'s exactly (598/27) —
   any deviation here would indicate an unexpected transitive behavior
   change from the dependency bump, not just a lint/type issue.
4. No major-version bump snuck in for ESLint or any of its plugins —
   check `package.json`'s version ranges are still semver-compatible
   with what was there before, not silently widened.

## Branch

`task/T-45-npm-audit-fix`
