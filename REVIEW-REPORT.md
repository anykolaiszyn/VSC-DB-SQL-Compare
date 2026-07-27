# ParityLens — Review Report T-03 (re-review after I-01 fix)

## Review independence

This re-review was performed by a Claude Code subagent instance distinct from
the T-03 implementer and distinct in session from the first review round,
with no edit access to implementation files, `TASK-BRIEF.md`, or
`IMPLEMENTATION-REPORT.md`. This report is the only file this reviewer wrote.
Assessment is based on the actual current source
(`statement-safety.ts`, `statement-safety.test.ts`), fresh command execution
performed by this reviewer, direct inspection of the fix commit's diff, and
an independently written set of 72 adversarial probe cases (not part of the
committed suite, deleted after use) — not on trust in the implementation
report's claims.

## Review scope

- **Task objective:** Implement `assertReadOnlyStatement(sql, dialect)` in the
  Connector SDK to hard-block INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/MERGE
  and equivalent platform-specific mutating constructs before any statement
  reaches a database driver, per `DESIGN-SPEC.md`'s approved "hard block +
  SQL parse check" decision.
- **Scope of this pass specifically:** Verify whether finding I-01 (Important,
  blocking, from the first review round) is genuinely resolved by commits
  `afae34f`/`b3cd0fb`, and whether the fix introduced any new problem. M-05
  (SQL Server `GO` separator) and M-06 (PostgreSQL dollar-quoting) were
  explicitly marked non-blocking, accepted, and deferred to T-17/T-19 in the
  first review round and are out of scope for this re-review — not
  re-litigated here.
- **Files and interfaces reviewed:**
  - `packages/engine/src/connector-sdk/safety/statement-safety.ts` (full
    current-state read, in particular `WITH_KEYWORD_PATTERN` and
    `effectiveLeadingKeyword`)
  - `packages/engine/src/connector-sdk/safety/statement-safety.test.ts`
    (full current-state read: 109-case matrix, including the 20 new I-01
    regression cases)
  - `IMPLEMENTATION-REPORT.md`, including the appended "I-01 regression fix
    (post-review)" section
  - `AGENTS.md`, `TASK-BRIEF.md`
- **Evidence reviewed:** `git show afae34f` (full diff, both files) and
  `git show --stat` for `afae34f` and `b3cd0fb`; fresh
  `npx vitest run packages/engine` and `npm run verify` runs performed by
  this reviewer; 72 independently written adversarial probe cases (18
  scenarios × 4 dialects, not part of the committed suite, deleted after
  use — see Verification performed).

## Critical findings

None.

## Important findings

None. I-01 is resolved — see Prior-finding disposition below for evidence.

## Minor findings

None newly identified by this re-review's adversarial probing.

## Verification performed

| Check | Exact command or inspection | Result |
| --- | --- | --- |
| Fix diff inspection | `git show afae34f -- packages/engine/src/connector-sdk/safety/statement-safety.ts` | Confirms the only functional code change is `const WITH_KEYWORD_PATTERN = /^\s*WITH\b/i;` → `const WITH_KEYWORD_PATTERN = /^[\s(]*WITH\b/i;`. Remaining diff lines are comment/docstring updates only. Matches the implementation report's claim exactly — this is the same `[\s(]*` tolerance `leadingKeywordPattern` already grants ordinary keywords, applied to the CTE-detection gate. No other logic changed. |
| Test diff inspection | `git show afae34f -- packages/engine/src/connector-sdk/safety/statement-safety.test.ts` | Confirms 5 new test cases × 4 dialects = 20 new cases, matching the claimed set: single-paren DELETE, whitespace/newline-internal variant, doubly-paren-wrapped variant, plain paren-wrapped non-CTE DELETE (regression guard), and a paren-wrapped CTE SELECT negative case. |
| Focused suite (fresh run) | `npx vitest run packages/engine` | `Test Files 1 passed (1)`, `Tests 109 passed (109)`. Matches implementation report's claimed count exactly. |
| Full verification (fresh run) | `npm run verify` (`tsc -b --force && eslint . && vitest run`) | Exit 0. Typecheck clean, lint clean, `Test Files 2 passed (2)`, `Tests 120 passed (120)` (11 `packages/shared` + 109 engine). Matches claimed counts exactly. |
| Scope/ownership check | `git show --stat afae34f` and `git show --stat b3cd0fb` | `afae34f` touches only `statement-safety.ts` (+24/-8 within the diff hunk, all comment/regex, see above) and `statement-safety.test.ts` (+30 new lines). `b3cd0fb` touches only `IMPLEMENTATION-REPORT.md`. No changes to `packages/shared/**`, `packages/extension/**`, `packages/engine/src/index.ts`, `PROGRESS-LEDGER.md`, or `TASK-BRIEF.md` by either commit. Matches the task brief's ownership boundary. |
| Adversarial probe — multiple CTEs before mutation, paren-wrapped | `(WITH a AS (SELECT 1), b AS (SELECT 2) DELETE FROM x)` across all 4 dialects | Throws on all 4. Correct. |
| Adversarial probe — nested double-parens | `((WITH cte AS (SELECT 1) DELETE FROM x))` across all 4 dialects | Throws on all 4. Correct — goes beyond the implementer's tested doubly-wrapped case (which had internal spaces) by using no internal spacing at all. |
| Adversarial probe — triple nested parens | `(((WITH cte AS (SELECT 1) DELETE FROM x)))` across all 4 dialects | Throws on all 4. Confirms the fix is not limited to exactly one or two parens — `[\s(]*` is unbounded by construction. |
| Adversarial probe — no outer parens at all (original a4fb5c4 fix, regression check) | `WITH cte AS (SELECT 1) DELETE FROM x` across all 4 dialects | Throws on all 4. Confirms the un-parenthesized CTE-bypass fix from `a4fb5c4` is not regressed by the `afae34f` change. |
| Adversarial probe — mixed whitespace/tab/newline between paren and WITH | `( \t\n  \t WITH cte AS (SELECT 1) DELETE FROM x)` and `(\tWITH cte AS (SELECT 1) DELETE FROM x)` across all 4 dialects | Throws on all 4 in both variants. Confirms the fix is not whitespace-shape-specific. |
| Adversarial probe — case variations | `(with cte as (select 1) delete from x)` and `(WiTh cte AS (SELECT 1) DeLeTe FROM x)` across all 4 dialects | Throws on all 4 in both variants (pattern is case-insensitive by construction, `/i` flag). |
| Adversarial probe — false positive check: plain paren-wrapped SELECT | `(SELECT * FROM x)` across all 4 dialects | Does not throw on any. Correct, unaffected by the fix. |
| Adversarial probe — false positive check: paren-wrapped CTE SELECT | `(WITH cte AS (SELECT 1) SELECT * FROM cte)` across all 4 dialects | Does not throw on any. Correct — this is the exact shape I-01's fix must not turn into a false positive, and it does not. |
| Adversarial probe — false positive check: doubly-paren-wrapped CTE SELECT | `((WITH cte AS (SELECT 1) SELECT * FROM cte))` across all 4 dialects | Does not throw on any. Correct. |
| Adversarial probe — false positive check: multi-CTE paren-wrapped SELECT | `(WITH a AS (SELECT 1), b AS (SELECT 2) SELECT * FROM a, b)` across all 4 dialects | Does not throw on any. Correct. |
| Adversarial probe — extra/unbalanced closing paren after mutation | `(WITH cte AS (SELECT 1) DELETE FROM x))` across all 4 dialects | Throws on all 4 (fail-safe: the extra trailing `)` does not suppress detection). |
| Adversarial probe — batched: safe SELECT then paren-wrapped CTE mutation as second statement | `SELECT 1; (WITH cte AS (SELECT 1) DELETE FROM x)` across all 4 dialects | Throws on all 4. Confirms the fix composes correctly with the pre-existing `;`-splitting evasion defense. |
| Adversarial probe — line comment then paren-wrapped CTE mutation | `-- innocuous\n(WITH cte AS (SELECT 1) DELETE FROM x)` across all 4 dialects | Throws on all 4. Confirms composition with comment-stripping. |
| Adversarial probe — paren-wrapped CTE with UPDATE tail | `(WITH cte AS (SELECT 1) UPDATE x SET y = 1)` across all 4 dialects | Throws on all 4. Confirms the fix is not DELETE-specific. |
| Adversarial probe — paren-wrapped CTE with INSERT tail | `(WITH cte AS (SELECT 1) INSERT INTO x VALUES (1))` across all 4 dialects | Throws on all 4. |
| Adversarial probe — space between outer parens and inner content | `( (WITH cte AS (SELECT 1) DELETE FROM x) )` across all 4 dialects | Throws on all 4. |
| Probe cleanup | Probe file `packages/engine/src/connector-sdk/safety/_review-probe.test.ts` (72 cases: 18 scenarios × 4 dialects, all passed) removed with `rm`; re-ran `npx vitest run packages/engine` and `git status --porcelain` | Confirmed 109/109 clean afterward; `git status --porcelain` shows only the pre-existing unrelated working-tree modifications to `PROGRESS-LEDGER.md`, `REVIEW-REPORT.md`, and `TASK-BRIEF.md` (the latter two being this review's and the orchestrator's own in-flight edits) — no stray probe files leaked into the tree. |

## Prior-finding disposition

| Finding ID | Disposition | Evidence of resolution |
| --- | --- | --- |
| I-01 | **RESOLVED** | Root cause (`WITH_KEYWORD_PATTERN` lacking the `[\s(]*` leading-paren tolerance that `leadingKeywordPattern` already had) fixed by widening the regex to `/^[\s(]*WITH\b/i` in commit `afae34f`, confirmed by direct diff inspection to be the only functional change. The original failing repro, `(WITH cte AS (SELECT 1) DELETE FROM x)`, now throws `MutatingStatementError` on all four dialects — reconfirmed independently by this reviewer, not merely by re-running the implementer's own committed tests. This reviewer's own 72 freshly written adversarial probes (going beyond the implementer's 20 committed regression cases: multiple CTEs, triple-nested parens, no-outer-parens regression check, tab/mixed-whitespace variants, case variants, batching + comment composition, UPDATE/INSERT tails, and multiple independent false-positive checks on safe paren-wrapped SELECTs) all passed — none surfaced a new bypass or a new false positive. Fresh `npx vitest run packages/engine` (109/109) and `npm run verify` (120/120, exit 0) both match the implementation report's claimed counts exactly. |
| M-05 | NOT APPLICABLE (out of scope for this re-review) | SQL Server `GO` batch-separator gap was explicitly marked non-blocking, accepted, and deferred to T-17 in the first review round's Approval status rationale. Not touched by commits `afae34f`/`b3cd0fb` and not re-litigated in this pass. |
| M-06 | NOT APPLICABLE (out of scope for this re-review) | PostgreSQL dollar-quoting desync gap was explicitly marked non-blocking, accepted, and deferred to T-19 in the first review round's Approval status rationale. Not touched by commits `afae34f`/`b3cd0fb` and not re-litigated in this pass. |
| M-01 (T-01) | NOT APPLICABLE | T-03 touches only `packages/engine/src/connector-sdk/safety/**` (and, in this fix round, `IMPLEMENTATION-REPORT.md`); no `packages/extension` or T-01-scope files were modified by any T-03 commit, confirmed via `git show --stat` for `afae34f` and `b3cd0fb`. |
| M-02 (T-01) | NOT APPLICABLE | Same as above — unrelated files. |
| M-03 (T-02) | NOT APPLICABLE | T-03's fix round does not modify `packages/shared/**`; confirmed no shared-type changes in either new commit's diff. |
| M-04 (T-02) | NOT APPLICABLE | Same as above — unrelated files. |

## Approval status

- **Status:** APPROVED
- **Reviewer:** Claude Code Independent Reviewer subagent
- **Date:** 2026-07-27
- **Release or dependency impact:** I-01 is resolved with fresh, independently
  reproduced evidence, and this re-review's adversarial probing (72 cases
  beyond the implementer's own 20 regression tests) found no new Critical or
  Important issue and no new false positive. No Critical or Important
  findings remain open for T-03. Per `AGENTS.md`, this independent review
  does not itself substitute for final human release approval, and does not
  authorize merge to `main` or release on its own — but from a task-review
  standpoint, T-03 may now proceed to unblock its dependents (T-04, T-17,
  T-18, T-19), which may begin consuming `assertReadOnlyStatement`. M-05
  (`GO` separator, deferred to T-17) and M-06 (PostgreSQL dollar-quoting,
  deferred to T-19) remain open, non-blocking, accepted residual risk from
  the first review round; they should stay tracked against those future
  tasks and were intentionally not re-assessed in this pass.
