# ParityLens — Review Report T-46

## Review independence

This review was performed by an independent reviewer instance with no
memory of, or involvement in, implementing T-46. All findings below are
based on the reviewer's own fresh reading of `TASK-BRIEF.md`, the actual
diff, `eslint.config.mjs`'s current content, and the reviewer's own
independently re-run commands — the implementer's `IMPLEMENTATION-REPORT.md`
is treated as a claim to verify, not a source of truth. The reviewer did
not edit `eslint.config.mjs`, `TASK-BRIEF.md`, or `IMPLEMENTATION-REPORT.md`
(a temporary manual edit to `eslint.config.mjs` was made and reverted
solely to reproduce the red state — see Verification performed).

## Review scope

- **Task objective:** Resolve finding T-27-01 (OPEN, accepted
  non-blocking) by adding `"**/dist-bundle/**"` to `eslint.config.mjs`'s
  `ignores` array, so `npm run bundle` (or `npm run package`) followed by
  `npm run verify` in the same working tree no longer false-fails on the
  generated, gitignored bundle.
- **Files and interfaces reviewed:** `eslint.config.mjs` (repo root, the
  only file the brief authorizes for edit); `TASK-BRIEF.md`,
  `IMPLEMENTATION-REPORT.md`; `PROGRESS-LEDGER.md`'s T-27-01 row (verbatim
  finding text, line 214) and its 2026-08-01/08-02 decision-log entries
  referencing this gap; `.gitignore` (confirmed `dist-bundle/` is
  gitignored, line 3); `packages/extension/package.json` (confirmed
  `bundle`/`package` script locations, lines 70-71); root `package.json`
  (confirmed no root-level `bundle` script exists).
- **Evidence reviewed:** `git diff --stat main..task/T-46-eslint-dist-bundle-ignore`,
  `git diff main..task/T-46-eslint-dist-bundle-ignore -- eslint.config.mjs`,
  and independently re-run `npm run lint` / `npm run verify` in both the
  reverted (red) and fixed (green) states, with `packages/extension/dist-bundle/`
  physically present in the working tree throughout.

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
| Diff scope (repo-wide) | `git diff --stat main..task/T-46-eslint-dist-bundle-ignore` | Exactly 3 files changed: `eslint.config.mjs` (+1/-0), `IMPLEMENTATION-REPORT.md`, `TASK-BRIEF.md`. No implementation-owned code file, `.vscodeignore`, `package.json`, or bundler config touched. |
| Diff scope (eslint.config.mjs only) | `git diff main..task/T-46-eslint-dist-bundle-ignore -- eslint.config.mjs` | Single-line addition `+ "**/dist-bundle/**",` inserted between the existing `"**/out/**"` and `"**/*.d.ts"` entries. All five pre-existing `ignores` entries (`node_modules`, `dist`, `out`, `*.d.ts`, `coverage`) unchanged. New entry matches the brief's required glob exactly — not a bare `"dist-bundle"`, not widened. |
| Working-tree precondition | `ls packages/extension/dist-bundle/` | `extension.js` and `extension.js.map` present in the working tree for the entire review, satisfying the brief's "bundle still present" requirement for green-state evidence without needing to rebuild it. |
| Green state (fix as committed) | `npm run lint` | Exit 0, no output beyond the npm script header — bundle not linted. |
| **Red-state reproduction (independent)** | Manually removed the `"**/dist-bundle/**"` line from `eslint.config.mjs` via Edit, then ran `npm run lint` | Exit 1, 1772 problems (1768 errors, 4 warnings), with errors concentrated at line numbers 95000-97800+ referencing `require()`/`module is not defined` — consistent with linting the minified bundle, not authored source. This independently reproduces the implementer's reported red-state numbers (1772 problems) exactly, not merely a similar count. |
| Fix restoration | `git checkout -- eslint.config.mjs` then re-read file | File restored byte-for-byte to the committed fixed state (`ignores` array with all 6 entries including `dist-bundle`); `git status` showed working tree clean immediately after, confirming no stray diff was left. |
| Full fresh verify (fix in place, bundle present) | `npm run verify` (run twice independently) | Exit 0 both times. `typecheck` (`tsc -b --force`) and `lint` (`eslint .`) both ran and passed with no errors; test run: `Test Files 34 passed \| 2 skipped (36)`, `Tests 598 passed \| 27 skipped (625)` — matches the pre-task baseline and the task's specified expected baseline (598/27/625) exactly. |
| Bundle invocation path claim | `grep -n '"bundle"\|"package"' package.json packages/extension/package.json` | Confirmed root `package.json` has no `bundle` script; only `packages/extension/package.json` defines `"bundle": "node esbuild.config.mjs"` and `"package": "npm run bundle && vsce package --no-dependencies"`. The implementer's disclosed use of `npm run bundle --workspace=packages/extension` (rather than a literal root-level `npm run bundle`, which does not exist) is the only viable way to produce the named artifact and was explicitly disclosed as an assumption in the report, not hidden. |
| Residue check | `git status` after all probing | Clean — no leftover scratch files, no stray diff, before writing this report. |

## Prior-finding disposition

| Finding ID | Disposition | Evidence of resolution |
| --- | --- | --- |
| T-27-01 | **RESOLVED** | Independently reproduced the original red state (lint fails against `dist-bundle/extension.js` with 1772 problems when the ignore entry is absent) and independently confirmed the green state (lint and full `npm run verify` both pass cleanly, exit 0, with the bundle physically present in the working tree and the new `"**/dist-bundle/**"` ignore entry in place). Test counts (598 passed / 27 skipped / 625 total) match the pre-existing baseline with no regression. The fix is exactly the single-entry `ignores` array addition the finding's own recorded recommended resolution specified — no other `ignores` entry, `.vscodeignore`, `package.json` script, or bundler config was touched. |

## Approval status

- **Status:** APPROVED
- **Reviewer:** Independent Reviewer subagent (Claude Sonnet 5), separate instance from the T-46 implementer
- **Date:** 2026-08-03
- **Release or dependency impact:** Closes T-27-01 (the only open finding blocking nothing but itself). No behavioral, interface, or test-surface change — this is a lint-configuration-only fix. Safe to merge into `main` immediately; no downstream task depends on this change beyond removing the false-verify-failure hazard for any future `npm run package` → `npm run verify` sequence (e.g. a future release checklist).
