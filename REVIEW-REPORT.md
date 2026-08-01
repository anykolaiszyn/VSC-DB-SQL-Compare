# ParityLens — Review Report T-23

## Review independence statement

This review was performed by a separate reviewer agent instance from
whoever implemented `task/T-23-vitest-security-bump` (tip commit
`5f430b9`, based on `main` at `7a43920`). No claim in
`IMPLEMENTATION-REPORT.md` was trusted at face value: `npm audit`,
`npm ls vitest`, and `npm run verify` were all re-run fresh on this
branch in my own shell session, and the diff scope was inspected directly
via `git diff`/`git show --stat` rather than relying on the report's
changed-files table. The lockfile's resolved-package versions (before and
after) were parsed and compared programmatically rather than eyeballing
the diff, specifically to verify the disclosed "esbuild advisory
disappeared incidentally" claim against real data instead of accepting
the disclosure as written. A stale, unrelated `REVIEW-REPORT.md` from a
prior T-22 review was found untracked in the working tree at review start
(pre-existing residue from another session, not part of this branch's
diff) and has been overwritten by this report.

## Scope reviewed

- **Task objective:** bump the root `vitest` devDependency from `^2.1.1`
  (installed `2.1.9`) to `^3.2.6`+ to resolve critical advisory
  `GHSA-5xrq-8626-4rwp`, staying on the `3.x` line, with no test or
  application code changes.
- **Files and interfaces reviewed:** `TASK-BRIEF.md` (full, sole
  authority), `IMPLEMENTATION-REPORT.md` (full, claims treated as
  assertions to verify), `package.json` (full diff), `package-lock.json`
  (diff stat + programmatic before/after resolved-version comparison for
  `vitest`, `vite`, `esbuild`, `@vitest/mocker`, `vite-node`),
  `PROGRESS-LEDGER.md` (M-01 entry, to confirm the report's "pre-existing,
  already disclosed" characterization of `brace-expansion` is accurate).
- **Evidence reviewed:** fresh `npm install`, `npm audit`, `npm ls
  vitest`, `npm run verify`, `git diff main task/T-23-vitest-security-bump
  --stat`, `git diff main task/T-23-vitest-security-bump -- package.json`,
  `git log main..task/T-23-vitest-security-bump`, `git show --stat` on
  both commits on the branch.

## Critical findings

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| NONE | — | — | — |

## Important findings

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| NONE | — | — | — |

## Minor findings

| ID | Finding | Evidence | Suggested resolution |
| --- | --- | --- | --- |
| NONE | — | — | — |

## Verification performed

| Check | Exact command or inspection | Result |
| --- | --- | --- |
| Fresh `npm install` | `npm install` | `up to date, audited 316 packages`; `1 high severity vulnerability` reported inline, matching audit below |
| Fresh `npm audit` | `npm audit` | Exit 1 (npm's convention when vulnerabilities exist), output shows **only** `brace-expansion <1.1.17` (high, transitive via ESLint) — `1 high severity vulnerability` total. `vitest`/`@vitest/mocker`/`vite-node`/`esbuild` entries are gone, matching the report's claimed green state exactly |
| Installed vitest line | `npm ls vitest` | `paritylens@0.0.1` → `└── vitest@3.2.7` — confirmed `3.x`, not `4.x`; matches `^3.2.6` range (caret allows up to but excluding `4.0.0`) |
| Full verification | `npm run verify` | Exit 0. `tsc -b --force` clean, `eslint .` clean, `vitest run`: 22 test files (2 skipped) / 404 tests passed / 27 skipped / 431 total — byte-identical to the brief's stated pre-bump baseline (404/27/431) and to the report's claimed post-bump result |
| Diff scope | `git diff main task/T-23-vitest-security-bump --name-only` | Exactly 3 files: `IMPLEMENTATION-REPORT.md`, `package-lock.json`, `package.json`. Zero files under `packages/**` |
| `package.json` diff content | `git diff main task/T-23-vitest-security-bump -- package.json` | Single-line change: `"vitest": "^2.1.1"` → `"^3.2.6"`. No other dependency touched |
| Commit-level scope | `git log main..task/T-23-vitest-security-bump` + `git show --stat` on both commits | Two commits (`fda5e95` bump, `5f430b9` report hash update); neither touches anything outside the three declared files |
| Incidental-esbuild-fix claim | Parsed `package-lock.json` `packages[...]` map on both `main` and the branch, compared resolved versions for `vitest`, `vite`, `esbuild`, `@vitest/mocker`, `vite-node` | `main`: vitest 2.1.9, vite 5.4.21, esbuild 0.21.5 (vulnerable, advisory covers `<=0.24.2`), @vitest/mocker 2.1.9, vite-node 2.1.9. Branch: vitest 3.2.7, vite 7.3.6, esbuild 0.28.1 (patched), @vitest/mocker 3.2.7, vite-node 3.2.4. Confirms the disclosed claim: esbuild's fix is a genuine transitive side effect of vite jumping 5.4.21→7.3.6 under vitest 3.2.7's dependency range, not a separately targeted change |
| Prohibited-pin check | `node -e "console.log(require('./package.json').devDependencies)"` | No `vite` or `esbuild` key exists in `devDependencies` on either `main` or the branch — confirms there was never an explicit pin to "touch," so the incidental transitive fix does not violate the brief's "do not touch esbuild/vite version pins" prohibition |
| M-01 cross-check | Read `PROGRESS-LEDGER.md` line 115 | M-01 (MINOR, from T-01 review, OPEN/accepted/non-blocking) covers "10 transitive devDependency vulnerabilities (ESLint/minimatch, Vite/esbuild chains) — dev-tooling only, not shipped." The remaining `brace-expansion` advisory is consistent with this pre-existing, already-tracked finding; report's characterization is accurate |

## Prior-finding disposition

| Finding ID | Disposition | Evidence of resolution |
| --- | --- | --- |
| N/A | Not applicable | `PROGRESS-LEDGER.md`'s open-findings table has no finding routed to T-23; this task originates directly from the prompt-07 release security review (2026-08-01), not from a prior task's disclosed defect. M-01 remains open and out of scope by design — not something T-23 was asked to resolve |

## Approval status

- **Status:** APPROVED
- **Reviewer:** Independent reviewer subagent (separate instance from the T-23 implementer)
- **Date:** 2026-08-01
- **Release or dependency impact:** Root `devDependency` `vitest` now resolves to `3.2.7` (was `2.1.9`). No `packages/**` file changed; `packages/extension` (the shipped artifact) never depended on `vitest`, so this has zero runtime/shipped-artifact impact. `npm audit` confirms the critical `GHSA-5xrq-8626-4rwp` advisory and its `@vitest/mocker`/`vite-node` chain are resolved, plus an incidental (verified, non-violating) fix of the moderate `esbuild` advisory via transitive `vite` upgrade. Only the pre-existing, already-tracked M-01 (`brace-expansion`, high, ESLint-transitive) remains — explicitly out of scope per the brief and unchanged by this task. Test suite and typecheck/lint are unaffected: 404 passed / 27 skipped / 431 total, exit 0, identical to the pre-bump baseline with no test-file edits.
