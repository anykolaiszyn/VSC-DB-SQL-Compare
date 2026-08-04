# ParityLens — Review Report T-43 (re-review after fixes)

## Review independence

This re-review was performed by an independent reviewer instance with no
memory of implementing T-43 or of the fix commit `e24ab8c`. All claims were
re-derived from the actual diff, the current source of the modified files,
and fresh command runs — none were taken on trust from the commit message
or `IMPLEMENTATION-REPORT.md`. No implementation-owned file was edited
during this review; the only file this pass writes is this report.

Note on process: the fix for T-43-01/T-43-02 was applied directly by the
orchestrator (commit `e24ab8c`), not by a fresh implementer dispatch. This
review treats that commit exactly as it would treat any other change under
review — verified against the actual diff and source, not accepted because
of who authored it.

## Review scope

- **Task objective (unchanged from the first pass):** Add a static,
  plain-language legend/glossary explaining every real `Severity` value,
  and a short per-tab caption to each of the 4 check-family tab panels
  (Schema/Profile/Volume/Row-Level) in the results webview
  (`packages/extension/src/webview/resultsWebview.ts`), per
  `TASK-BRIEF.md` T-43, while preserving `renderResultsHtml`'s
  pure-function contract and `enableScripts: false`.
- **This pass specifically re-verifies:** the T-43-01 (Important) and
  T-43-02 (Minor) findings from the prior review round, plus a fresh full
  re-read of all remaining legend/caption copy in case anything else needs
  a second look.
- **Files and interfaces reviewed:** `packages/extension/src/webview/
  resultsWebview.ts` (full `SEVERITY_LEGEND`, `renderLegend`,
  `renderTabCaption`, and all 4 tab-panel caption call sites re-read),
  `packages/extension/src/webview/resultsWebview.test.ts` (the rewritten
  SQL-panel boundary test, plus all 4 caption-ordering tests re-read),
  `packages/engine/src/comparison-core/row-level/row-level.ts` (re-read
  `DEFAULT_SEVERITY_FOR_CATEGORY`, `compareMatchedRow`,
  `lookupMappedValue` fresh, independent of the prior review's citations),
  `TASK-BRIEF.md`, the fix commit `e24ab8c` in full.
- **Evidence reviewed:** `git show e24ab8c` (full diff), `git diff
  main..task/T-43-results-webview-legend --stat` (scope/ownership), a
  fresh `npm run verify` run, direct reads of the current on-disk source
  for both changed files (not just the incremental diff), `git status`
  for residue.

## Prior-finding disposition

| Finding ID | Original severity | Outcome | Evidence |
| --- | --- | --- | --- |
| T-43-01 | Important (blocking) | **Fixed** | The `Error` legend entry (resultsWebview.ts line 159-161) now reads: *"This specific item couldn't be evaluated (for example, a value that couldn't be compared between source and target) — it's neither a confirmed match nor a confirmed mismatch. Look at the item's own message for what went wrong before drawing a conclusion about it."* Independently re-read `row-level.ts` fresh (not reused from the prior pass): `DEFAULT_SEVERITY_FOR_CATEGORY["unable-to-compare"] = "Error"` (line 87) is the only real producer of `Error` severity in the codebase today. `compareMatchedRow`'s `catch` block (lines 271-281) is reached when `lookupMappedValue` throws because a mapped column is missing from a row (lines 318-324), or when normalization/tolerance evaluation throws for a matched row's value — a per-row, per-column comparability failure, not a connection/query/infrastructure problem. The row's own message (`Column "X" could not be normalized or compared.`, line 279) is exactly what the new legend text tells the reader to go look at ("Look at the item's own message for what went wrong"). The new copy no longer asserts any specific wrong cause (no "connection", "query", or "run" language) and correctly frames it as an unresolved/undetermined outcome rather than a confirmed problem. This is an accurate description of the actual code path and directly resolves the finding — no remaining infrastructure-failure framing anywhere in the entry. |
| T-43-02 | Minor (non-blocking) | **Fixed** | The rewritten test (resultsWebview.test.ts lines 360-376) replaces the old coincidentally-passing "search for a marker that can never recur" logic with an explicit ordering assertion — `expect(html.indexOf(otherClass)).toBeLessThan(panelIndex)` for each of `tab-panel--schema`/`tab-panel--profile`/`tab-panel--volume`/`tab-panel--rows` — followed by a slice-to-end-of-string (`html.slice(panelIndex)`) and a `.not.toContain("tab-caption")` check. Independently confirmed against the current source (`resultsWebview.ts` lines 803, 809, 815, 821, 827) that `tab-panel--sql` is genuinely the last `tab-panel` div in markup order, so the ordering assertion is checking a true, currently-passing fact rather than an assumption. Unlike the original version, this test is no longer just incidentally correct: if a future edit added a caption inside the SQL panel itself, the slice-to-end-of-string would include that new text and `.not.toContain("tab-caption")` would correctly fail; if a future edit reordered the panels so SQL Preview were no longer last, the new ordering assertions would fail first and explicitly, rather than the test silently degrading into testing something else. Both of the original finding's concerns (fragile boundary logic, silent-drift risk on reordering) are addressed. |

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

No new findings surfaced on this pass. A fresh, independent re-read of the
remaining 5 legend entries (`Failure`/`Warning`/`Pass`/`Informational`/
`Skipped`) and all 4 tab captions (Schema/Profile/Volume/Row-Level) found
no factual inaccuracies, no jargon regressions, and no new
`escapeHtml`/interpolation gaps — see Verification performed below for the
specific checks run against each.

## Verification performed

| Check | Exact command or inspection | Result |
| --- | --- | --- |
| T-43-01 re-verification: `Error` legend vs. real `row-level.ts` semantics | Fresh read of `row-level.ts` lines 80-89, 222-281, 318-324 (independent of prior review's line citations) plus the current `SEVERITY_LEGEND` entry for `"Error"` | New copy accurately describes a per-item comparison failure, points the reader to the item's own message, and asserts no incorrect infrastructure/connection cause. Confirmed fixed. |
| T-43-02 re-verification: SQL-panel test soundness | Read `resultsWebview.test.ts` lines 360-376 and `resultsWebview.ts` lines 803-830 (panel markup order) | Ordering assertion checks a true fact about current source; slice-to-end-of-string + `.not.toContain("tab-caption")` would correctly fail if a future caption were added to the SQL panel or if panel order changed. Confirmed fixed. |
| Fresh full verify | `npm run verify` (typecheck → lint → test), run independently on `task/T-43-results-webview-legend` after the fix commit | PASS — typecheck clean, lint clean, **659 passed / 27 skipped (686 total)**, 36 test files passed / 2 skipped. Identical to the count reported in the prior review round (fix commit changed copy/test-assertion logic only, not test count). No regression. |
| Scope/ownership check | `git diff main..task/T-43-results-webview-legend --stat` | Only `IMPLEMENTATION-REPORT.md`, `resultsWebview.ts`, and `resultsWebview.test.ts` changed across the whole branch (including the fix commit) — matches the brief's declared file ownership exactly. |
| Fix-commit scope check | `git show e24ab8c --stat` | Fix commit touches only `resultsWebview.ts` (2 lines: 1 added, 1 removed) and `resultsWebview.test.ts` (13 lines: 11 added, 2 removed) — a minimal, same-file, same-scope correction as the prior review required; no unrelated changes bundled in. |
| Fresh adversarial read of untouched legend/caption copy | Manual re-read of `Failure`/`Warning`/`Pass`/`Informational`/`Skipped` legend entries (resultsWebview.ts lines 155-177) and all 4 tab captions (lines 804-823) against a "junior analyst, no data-engineering background" bar, cross-checked Volume caption's "row counts against tolerance" framing against `renderAggregateDifferencesTable`'s actual rendered columns (`sourceCount`/`targetCount`/`difference`/`differenceRate`/`message`, lines 574-599) | No new issues found. Copy remains plain-language, non-circular, and accurate to what each tab renders. `AggregateDifference` is a genuinely refined shape in this file (not the placeholder `DifferenceItem` CLAUDE.md describes as the shared-package baseline), so the Volume caption's specific claims about counts/rates are accurate to the actual rendered table. |
| Residue check | `git status` | Clean aside from this report; no throwaway scripts or files left behind by this review. |

## Approval status

- **Status:** APPROVED
- **Reviewer:** Independent Reviewer agent (Sonnet 5), separate instance
  from both the original T-43 implementer and the orchestrator who applied
  the fix commit.
- **Date:** 2026-08-03
- **Release or dependency impact:** None blocking. Both findings from the
  prior review round (T-43-01 Important, T-43-02 Minor) are independently
  confirmed resolved by this pass — T-43-01 was re-verified against a
  fresh, independent read of `row-level.ts`'s actual severity-producing
  code path (not reused from the prior review), and T-43-02's fix was
  checked for genuine soundness (would it catch a real future regression),
  not just "does it still pass." No new Critical, Important, or Minor
  findings surfaced on this pass, including on a fresh adversarial read of
  the legend/caption copy that was not part of the fix commit. Fresh
  `npm run verify` reproduced the same 659 passed / 27 skipped (686 total)
  count with no regression. T-43 is cleared for reconciliation.
