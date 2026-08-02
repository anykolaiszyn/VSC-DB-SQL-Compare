# ParityLens — Review Report T-28

## Review independence

I am a separate reviewer instance from the implementer session that produced
commit `bf42fb4` on `task/T-28-row-level-key-mapping`. I did not author any
of the code under review. I read `TASK-BRIEF.md` as sole authority, treated
every claim in `IMPLEMENTATION-REPORT.md` as something to independently
verify rather than trust, and did not edit any implementation-owned file —
this report is the only file I touched. All scratch/probe files I created
during review (a standalone Node harness distinct from the implementer's, a
temporary `.paritylens` definition, a temporary adversarial Vitest spec, a
sandbox VS Code user-data/extensions directory, and a rebuilt `.vsix`/
`dist-bundle/`) were created either under the session scratchpad or as
already-`.gitignore`'d build output inside the repo, and were all deleted
before finishing. `git status` shows a clean working tree with no residue
beyond this report.

## Review scope

- **Task objective:** fix `compareRows`' `indexByKey` helper
  (`packages/engine/src/comparison-core/row-level/row-level.ts`), which
  looked up a key column's index using the source-side `keys` name against
  both source and target column lists with no `column_mapping` translation,
  so that a key column named differently on source vs. target (e.g.
  `CustomerID` → `CUSTOMER_ID`) produced `keyValues: [undefined]` for every
  target-side row-level finding.
- **Files and interfaces reviewed:** full diff of
  `packages/engine/src/comparison-core/row-level/row-level.ts` (29 lines
  changed), `row-level.test.ts` (+67 lines), and
  `packages/engine/src/orchestration/planner/planner.test.ts` (+68 lines),
  base `f229f73` → branch tip `bf42fb4`. Also read
  `packages/engine/fixtures/sqlserver-customer.ts` (to independently verify
  the fixture's real CustomerID 2/4/5 mismatch facts the new tests assert
  against), `packages/extension/src/activation/activate.ts` and
  `resultsWebview.ts` (to understand the real end-to-end rendering path the
  brief's manual re-check targets).
- **Evidence reviewed:** fresh `npx vitest run` of both the row-level and
  planner suites; a genuine red-state reproduction by substituting the
  pre-fix `row-level.ts` (from `f229f73`) back into the working tree; a
  from-scratch adversarial Vitest spec of my own (composite key with only
  one differing column name; a `column_mapping` target that doesn't exist
  in the target's real columns); a fresh `npm run verify`; a from-scratch
  rebuild of the `.vsix` and an independently-written Node harness (not the
  implementer's, which was deleted per its own cleanup instructions) that
  mocks `vscode`, requires the real `dist-bundle/extension.js`, calls the
  real `activate()`, invokes the real registered `paritylens.runComparison`
  command against a real `.paritylens` file with a genuine
  `CustomerID: CUSTOMER_ID` key mapping, and inspects the rendered webview
  HTML; the same harness re-run against a bundle rebuilt from the pre-fix
  `row-level.ts` to confirm it discriminates; a fresh sandbox `code
  --install-extension` of the rebuilt `.vsix`.

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
| T-28-01 | `resolveTargetKeyName` (new helper) falls back to the source-side key name unchanged when the key column has no matching entry in `column_mapping` — correct and required for the common identical-naming case. However, if a `column_mapping` entry's `target` value is itself wrong (e.g. a typo, or a target column name that doesn't actually exist in the real target row set — a configuration error, not the bug this task fixes), `indexByKey`'s `columns.indexOf(...)` on the resolved-but-wrong name returns `-1`, silently reproducing the exact same `keyValues: [undefined]` visible symptom this task was created to eliminate, just from a different root cause. Confirmed via my own adversarial probe (`compareRows` with `column_mapping: { CustomerID: "CUSTOMER_ID_TYPO" }` against a target row set whose real column is `CUSTOMER_ID`): the call does not throw and produces `keyValues: [undefined]` for the resulting finding, rather than a distinguishable "key column not found" signal. This is not a regression and not in scope per the brief (which only requires fixing the reported bug, not adding config validation), but it means a future user encountering `[undefined]` again cannot immediately tell "column_mapping mistranslation" apart from "column_mapping points at a nonexistent column" from the rendered output alone. | Optional follow-up: have `indexByKey` (or `resolveTargetKeyName`) distinguish "key column not found on this side at all" from "found and resolved" — e.g. surface a distinct `unable-to-compare`-style finding or a more diagnostic key-value placeholder — for a future task that wants stronger `column_mapping` config-error diagnostics. Not required for T-28's approval. |

## Verification performed

| Check | Exact command or inspection | Result |
| --- | --- | --- |
| Diff scope/narrowness | Read full diff of `row-level.ts`; confirmed `indexByKey`'s own body is byte-identical to pre-fix, `compareRows`'s broader flow/matching/classification logic unchanged; only the target-side `indexByKey` call site now receives a new `targetKeys` array instead of raw `keys`, plus one new private helper `resolveTargetKeyName` | Confirmed. Matches the brief's "narrowly targeted at `indexByKey`'s `keyIndexes` computation" requirement exactly — no restructuring beyond what was necessary. |
| Reuse-not-duplication of the mapping mechanism | Read `resolveTargetKeyName`'s implementation and `compareMatchedRow`'s existing column resolution | `resolveTargetKeyName` calls `mapping.find((candidate) => mappingSourceColumnName(candidate) === keyName)` — the exact same `mappingSourceColumnName` private helper `compareMatchedRow` already calls (`const sourceColumnName = mappingSourceColumnName(entry)`), and resolves to `entry.target`, matching `compareMatchedRow`'s `targetColumnName = entry.target`. Genuinely reused, not a parallel/subtly-different mechanism. |
| Focused unit tests, fresh run | `npx vitest run packages/engine/src/comparison-core/row-level` | 11/11 passed |
| Focused planner tests, fresh run | `npx vitest run packages/engine/src/orchestration/planner` | 9/9 passed |
| Fixture-fact cross-check | Read `packages/engine/fixtures/sqlserver-customer.ts` directly | Confirmed CustomerID 4 is missing-from-target, CustomerID 2's name differs (`Jane Roe` vs `Jane R. Doe`), CustomerID 5 is duplicated in target — matches exactly what the new `planner.test.ts` case asserts (`keyValues` of `[4]`, `[2]`, `[5]` respectively). No hand-computed arithmetic error found. |
| Independent red-state reproduction | Copied `f229f73`'s pre-fix `row-level.ts` back into the working tree (`git diff --stat` confirmed only that one file differed), re-ran `npx vitest run packages/engine/src/comparison-core/row-level` | 2 of 11 tests failed exactly as the report claims: `expected [ undefined ] to deeply equal [ 2 ]` (missing-from-source case) and a length-mismatch on the matched-pair case. Genuinely discriminating, not passing regardless. |
| Independent red-state reproduction (planner) | Same reverted file, `npx vitest run packages/engine/src/orchestration/planner -t "genuinely different name"` | Failed: `expected [ 1 ] to deeply equal [ 4 ]` — matches the report's claimed failure text exactly. Restored the fixed file afterward; `git diff` on the file returned empty. |
| My own adversarial probe 1: composite key, only one of two key columns renamed | Temporary Vitest spec (deleted after use) with keys `["RegionCode", "CustomerID"]`, mapping `RegionCode: RegionCode` (identity) and `CustomerID: CUST_ID` (renamed), covering a `missing-from-source` finding and a `matching` pair | Both resolved correctly: `keyValues` = `["EU", 77]` and `["NA", 88]` respectively — confirms per-key-column resolution works correctly when only one of several composite key parts is renamed, not just the single-key case the implementer's own tests cover. |
| My own adversarial probe 2: `column_mapping` target pointing at a nonexistent column | Same temporary spec, `column_mapping: { CustomerID: "CUSTOMER_ID_TYPO" }` against a target row set whose real column is `CUSTOMER_ID` | Did not throw; produced `keyValues: [undefined]` — a sensible non-crashing outcome for a genuine config error, though it is visually indistinguishable from the original bug's symptom (see T-28-01, Minor, non-blocking). |
| Full verification, fresh | `npm run verify` | Exit 0. `tsc -b --force` clean, `eslint .` clean, Vitest: 22 test files passed / 2 skipped (24), **408 tests passed / 27 skipped (435 total)** — matches `IMPLEMENTATION-REPORT.md`'s claimed count exactly; no regressions against the 404-test T-27 baseline (4 new: 3 in `row-level.test.ts`, 1 in `planner.test.ts`). |
| End-to-end: fresh `.vsix` rebuild | `npm run package` (inside `packages/extension`), post-fix code | Succeeded: `paritylens-0.0.1.vsix` (19 files, 13.02 MB), same shape as the report describes. |
| End-to-end: independently-authored Node harness (green) | New harness (`t28-reviewer-harness.cjs`, written from scratch, not reused from the implementer or any prior task) that mocks `vscode`, `require()`s the real `dist-bundle/extension.js`, calls the real `activate()`, captures the real registered `paritylens.runComparison` callback (via a mocked `showOpenDialog` pointing at a real `.paritylens` file on disk with `keys: [CustomerID]` and `column_mapping: {CustomerID: CUSTOMER_ID, CustomerName: CUSTOMER_NAME}`), and inspects the rendered webview HTML | `Occurrences of literal 'undefined' in rendered HTML: 0`; real key values `2`, `4`, `5` all present in the output; harness printed `PASS`. |
| End-to-end: same harness, pre-fix bundle (discriminating-red proof) | Reverted `row-level.ts` to `f229f73`'s pre-fix version, rebuilt the `.vsix`/`dist-bundle`, re-ran the same harness unmodified | `Occurrences of literal 'undefined' in rendered HTML: 7` — all 7 in `duplicate-in-target` rows' Key Values cell — harness printed `FAIL`. Confirms the harness genuinely discriminates rather than passing regardless of the underlying code. Restored the fix afterward and rebuilt a clean green `.vsix`/`dist-bundle` before finishing. |
| End-to-end: sandbox install | `code --user-data-dir <fresh tmp dir> --extensions-dir <fresh tmp dir> --install-extension paritylens-0.0.1.vsix` (rebuilt post-fix) | `Extension 'paritylens-0.0.1.vsix' was successfully installed.` Matches the report. |
| Cleanup verification | `git status` after deleting all scratch/probe files, the rebuilt `.vsix`, and `dist-bundle/` (both already `.gitignore`'d, confirmed via `.gitignore` inspection: `dist-bundle/`, `*.vsix`) | Working tree clean; no residue outside this report. |
| Scope/ownership check | `git diff f229f73 bf42fb4 --stat` against `TASK-BRIEF.md`'s "Files owned" list | Only `row-level.ts`, `row-level.test.ts`, `planner.test.ts` were changed among implementation-owned files (plus `IMPLEMENTATION-REPORT.md`, `PROGRESS-LEDGER.md`, `TASK-BRIEF.md`, which are process/control files, not implementation files, and are expected to change per task). `planner.ts` itself was **not** touched, consistent with the brief's explicit prohibition ("do not touch `planner.ts` itself unless the investigation reveals the bug actually needs a fix at that layer too"). No file outside the declared ownership was modified. |

## Prior-finding disposition

No open finding in `PROGRESS-LEDGER.md` was routed to T-28 for resolution —
T-28 itself is the task that resolves the live smoke-test bug recorded in
commit `2d970d8` ("Release step 5 live pass #3 finds row-level key-mapping
bug, routed to T-28"). That underlying defect is confirmed genuinely fixed
(see verification table above: both my own red-state reproduction and my
own independent Node harness against the pre-fix bundle reproduce the exact
reported symptom, and both are clean against the fixed code).

| Finding ID | Disposition | Evidence of resolution |
| --- | --- | --- |
| Release-step-5 live bug (`2d970d8`, routed to T-28) | RESOLVED | Independently reproduced the exact red-state failure (`keyValues: [undefined]` for target-side row-level findings when `column_mapping` translates the key column) via both a unit-level file revert and an end-to-end Node harness against a rebuilt pre-fix `.vsix`; independently confirmed the fix resolves it via the same two methods against the fixed code, plus a fresh full `npm run verify`. |

## Approval status

- **Status:** APPROVED
- **Reviewer:** Independent reviewer subagent (Sonnet 5), separate instance
  from the T-28 implementer session
- **Date:** 2026-08-02
- **Release or dependency impact:** The row-level key-mapping bug found
  during the prompt-07 release step 5 live smoke test's third pass is
  genuinely fixed. The fix is narrowly scoped (one new private helper,
  targeting only the target-side `indexByKey` call site), correctly reuses
  `compareMatchedRow`'s existing `mappingSourceColumnName`-based
  column-mapping mechanism rather than duplicating it, and is backed by
  both unit-level and planner-level tests that I independently confirmed
  discriminate (fail red against the pre-fix code, pass green against the
  fix) rather than passing regardless. `npm run verify` is clean at
  408 passed / 27 skipped / 435 total with no regressions, matching the
  implementation report exactly. My own independently-authored Node harness
  against the real packaged `.vsix` confirms the fix end-to-end: real key
  values (`2`, `4`, `5`) render in the results webview instead of
  `undefined`, and the same harness fails red (7 occurrences of literal
  `undefined`) against a bundle rebuilt from the pre-fix code, proving the
  harness is genuinely discriminating rather than passing by construction.
  One Minor, non-blocking finding (T-28-01) is recorded for a residual,
  out-of-scope gap: a `column_mapping` entry whose target name doesn't
  exist in the real target columns silently reproduces the same
  `[undefined]` visible symptom for a different (configuration-error) root
  cause. This does not affect the correctness of the fix for the bug this
  task was scoped to address and does not block approval. Safe to reconcile
  and merge.
