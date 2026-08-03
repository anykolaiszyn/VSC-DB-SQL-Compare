# REVIEW-REPORT.md — T-45: npm audit fix for brace-expansion (M-01)

## Review independence statement

This review was performed by a separate agent instance from the
implementer, with no memory of authoring this change. All claims in
`IMPLEMENTATION-REPORT.md` were treated as things to verify, not trust:
every command cited there was re-run independently in this session, and
the actual `package-lock.json` diff was read directly rather than
summarized from the report.

## Scope reviewed

- `package-lock.json` (regenerated dependency lock entries only)
- `package.json` (confirmed unchanged — checked directly, not assumed)
- `TASK-BRIEF.md`, `IMPLEMENTATION-REPORT.md` (task control files)

Confirmed via my own
`git diff --stat $(git merge-base main task/T-45-npm-audit-fix)..task/T-45-npm-audit-fix`:
only `IMPLEMENTATION-REPORT.md`, `TASK-BRIEF.md`, and `package-lock.json`
changed. No file under `packages/**` changed. `package.json` does not
appear in the diff at all — a stricter result than the brief's own
expected "package.json/package-lock.json/IMPLEMENTATION-REPORT.md" list,
and consistent with the report's own claim that no manifest edit was
needed.

## Findings

### Critical

NONE.

### Important

NONE.

### Minor

| ID | Finding | Evidence | Suggested resolution |
| --- | --- | --- | --- |
| T-45-01 | The implementation report frames all four resolved `brace-expansion` installs as belonging to "ESLint's dependency chain," but one of the four (the top-level `node_modules/brace-expansion`, `5.0.8`→`5.0.9`) actually resolves under `@vscode/vsce`'s `minimatch@10.2.6`, a separate dependency subtree unrelated to ESLint. This does not change the outcome — it is still one of the four installs M-01's advisory covered, and it is still fully resolved within its existing semver range — but the provenance description in the report is imprecise. | `npm ls eslint @eslint/config-array @eslint/eslintrc brace-expansion` (run fresh in this review) shows the tree: `@vscode/vsce@3.9.2 > minimatch@10.2.6 > brace-expansion@5.0.9` as a sibling branch, distinct from the `eslint@9.39.5 > @eslint/config-array\|@eslint/eslintrc > minimatch@3.1.5 > brace-expansion@1.1.18` subtree. | No action required to close M-01. Worth a one-line correction if this report's provenance description is ever cited as authoritative for a future advisory triage. |

## Verification performed (my own, independent of the implementation report)

| # | Check | Method | Result |
| --- | --- | --- | --- |
| 1 | Scope diff | `git diff --stat $(git merge-base main task/T-45-npm-audit-fix)..task/T-45-npm-audit-fix`, run by me | Exactly 3 files: `IMPLEMENTATION-REPORT.md`, `TASK-BRIEF.md`, `package-lock.json`. Nothing under `packages/**`. |
| 2 | package-lock.json diff content | `git diff ...task/T-45-npm-audit-fix -- package-lock.json`, read in full | Exactly 4 `brace-expansion` entries changed: `@eslint/config-array` nested install `1.1.16→1.1.18`, `@eslint/eslintrc` nested install `1.1.16→1.1.18`, `eslint` nested install `1.1.16→1.1.18`, top-level install `5.0.8→5.0.9`. Matches the report's changed-files table line-for-line, including the version numbers. |
| 3 | package.json diff | `git diff ...task/T-45-npm-audit-fix -- package.json`, run by me | Empty. Confirms the report's claim of zero manifest edits. |
| 4 | Fresh dependency install | `npm ci` on this checkout | Succeeds; install-time audit summary already reports `found 0 vulnerabilities`. |
| 5 | Audit (fresh, standalone) | `npm audit`, run by me | Exit 0, `found 0 vulnerabilities`. Matches the report's claimed green state exactly (report claims: "found 0 vulnerabilities"). |
| 6 | Full verification (fresh) | `npm run verify` (typecheck + lint + test), run by me on this checkout | Exit 0. `Test Files 34 passed \| 2 skipped (36)`, `Tests 598 passed \| 27 skipped (625)` — exact match to the report's claimed pre- and post-change counts, and to `main`'s last recorded state (598/27) per the brief's requirement. |
| 7 | ESLint major-version check | `grep '"eslint"' package.json`; `npm ls eslint @eslint/config-array @eslint/eslintrc brace-expansion` | `package.json` still declares `"eslint": "^9.9.0"` — unchanged range. Installed resolves to `eslint@9.39.5`, same major line (9.x), not bumped to a new major. `@eslint/config-array@0.21.2` and `@eslint/eslintrc@3.3.6` both still resolve `brace-expansion` via `minimatch@3.1.5` to `1.1.18` — still on the `1.x` line the original `1.1.16` install was on, a patch bump only. No `--force`-style major jump anywhere in the ESLint subtree. |
| 8 | Provenance/adversarial check on the 4th bumped install | `npm ls brace-expansion` (full tree, not filtered) | Confirmed the top-level `brace-expansion@5.0.9` install traces to `@vscode/vsce > minimatch@10.2.6`, not the ESLint subtree — see Minor finding T-45-01. Functionally correct regardless: still resolved, in-range, non-breaking. |
| 9 | Original M-01 advisory text cross-check | Read `PROGRESS-LEDGER.md` line 190 (M-01 entry) directly | Confirms the brief's citation is accurate: M-01 as last recorded describes "1 high-severity `brace-expansion` finding (ESLint's transitive dependency, `GHSA-mh99-v99m-4gvg`, DoS via unbounded expansion)... non-breaking fix available via `npm audit fix`, not yet applied." The brief's second cited advisory, `GHSA-rgw5-rvv9-x895`, is the sibling advisory under the same `npm audit` grouping (both cleared together by the same fix — confirmed by the pre-fix `npm audit` text pasted in the implementation report listing both IDs under one finding). |
| 10 | Working-tree cleanliness (no probe residue) | `git status`, run by me after all checks | Clean working tree — no throwaway files left from this review. |

## Prior findings this task was meant to resolve

M-01 (`PROGRESS-LEDGER.md`, MINOR, originally opened at T-01's review):
"Remaining: 1 high-severity `brace-expansion` finding (ESLint's transitive
dependency, `GHSA-mh99-v99m-4gvg`...) — non-breaking fix available via
`npm audit fix`, not yet applied." Re-verified directly by reproducing the
original failing case's *absence*: a fresh `npm audit` run in this review
(not copied from the implementation report) shows `found 0
vulnerabilities` — both `GHSA-mh99-v99m-4gvg` and `GHSA-rgw5-rvv9-x895`
are gone, and no other advisory has appeared in their place.

## Overall assessment

- File-ownership diff is exactly `package-lock.json` plus the two task
  control files — no file under `packages/**` touched, confirmed
  independently. `package.json` itself is untouched, which is stricter
  than the brief anticipated and consistent with the brief's own
  instruction not to hand-edit version numbers when no side effect
  requires it.
- `npm audit fix` (no `--force`) fully resolved M-01's remaining
  `brace-expansion` finding within existing semver ranges — confirmed by
  a fresh `npm audit` run showing 0 vulnerabilities, not by trusting the
  report's pasted output.
- No major-version bump occurred anywhere in the ESLint subtree —
  `package.json`'s `"eslint": "^9.9.0"` range is unchanged, and the
  resolved `eslint@9.39.5` / `@eslint/config-array@0.21.2` /
  `@eslint/eslintrc@3.3.6` versions are all consistent with that range.
- `npm run verify` reproduces the exact pre-change test/skip counts
  (598/27, exit 0) on a fresh independent run, satisfying the brief's
  strict "must match exactly, not just close enough" requirement.
- One Minor finding (T-45-01): the report's prose slightly
  mischaracterizes the provenance of one of the four bumped
  `brace-expansion` installs (it comes from `@vscode/vsce`'s
  `minimatch@10.2.6`, not ESLint's chain). This does not affect
  correctness, scope, or the resolution of M-01, and is not blocking.

## Disposition

**APPROVED**

0 Critical, 0 Important, 1 Minor (T-45-01 — non-blocking, informational
correction only). M-01 is confirmed resolved by independent re-verification
(fresh `npm audit` shows 0 vulnerabilities). Safe to merge to `main`; no
further action required for M-01 beyond updating its `PROGRESS-LEDGER.md`
status to CLOSED.
