# REVIEW-REPORT.md — T-39: CodeLens actions

## Review independence statement

This review was performed by a separate agent instance from the
implementer, with no memory of authoring this code. All findings below are
based on direct inspection of the actual diff/source on
`task/T-39-codelens-actions` (base `main`), my own independently re-run
verification commands, and my own constructed adversarial test probes
(written to a temporary file inside `packages/extension/src/codelens/`,
run via `npx vitest run`, then deleted — confirmed via `git status`
producing a clean tree). `IMPLEMENTATION-REPORT.md`'s claims were treated
as things to verify, not trust.

## Scope reviewed

- `packages/extension/src/codelens/comparisonCodeLensProvider.ts` (new)
- `packages/extension/src/codelens/comparisonCodeLensProvider.test.ts`
  (new)
- `packages/extension/src/activation/activate.ts` (extended)
- `packages/extension/src/activation/activate.test.ts` (extended)
- `IMPLEMENTATION-REPORT.md` (self-report, cross-checked, not trusted)

Confirmed via my own `git diff --stat main..task/T-39-codelens-actions`:
only the five files above changed (four implementation files + the
report). `packages/engine/**`, `comparisonEditorProvider.ts`,
`comparisonEditorHtml.ts`, `runConfirmationWebview.ts`, and
`packages/extension/src/activation/runComparisonCommand.test.ts` (a
pre-existing file explicitly outside this task's declared ownership) are
all confirmed untouched — `git diff --stat` / `git log --oneline` against
that last file on this branch both show zero changes.

## Findings

### Critical

NONE.

### Important

NONE.

### Minor

| ID | Finding | Evidence | Suggested resolution |
| --- | --- | --- | --- |
| T-39-01 | `provideCodeLenses` does not catch a rejection from the injected `listRecentRuns` dependency for an otherwise-*valid* document — only `parseDefinition` failures are caught. If `listRecentRuns` throws (e.g. an unreadable/corrupted run-history directory, a transient I/O error), `provideCodeLenses` itself rejects rather than degrading to "no lenses" or "lenses without Open Last Result." | My own adversarial probe (temporary test file, deleted): `listRecentRuns: async () => { throw new Error("disk read failed"); }` against a valid document caused `provideCodeLenses` to reject with that error rather than resolve. VS Code's CodeLens host generally tolerates a rejected provider call for one document (no crash), but this is a live gap in the "never throws" framing the brief's Scope item 1 describes, which is written in terms of an invalid *document*, not a failing dependency. | Not blocking — `listRecentRuns` reads a project-local, extension-managed directory (`.paritylens/runs`) rather than user-editable content, so the realistic failure surface is narrow, and VS Code itself tolerates a single rejected `provideCodeLenses` call without crashing the host. Worth wrapping the `listRecentRuns` call in its own try/catch (treating a failure as "no last-run lens" rather than a hard reject) in a small follow-up, but does not affect this task's stated Red/Green requirements or the brief's actual "invalid document" contract. |
| T-39-02 | The circular module reference between `activate.ts` and `comparisonCodeLensProvider.ts` (disclosed by the implementer) is real and confirmed benign for the current code shape, but is fragile to a specific future change: if either module ever needs to read the other's export during its own top-level module evaluation (rather than only inside a function body executed later), this would break under CommonJS/some bundler configurations even though it works fine today under `tsc -b` + Vitest/esbuild's ESM-with-live-bindings semantics. | Confirmed the cycle exists via `Grep` (`comparisonCodeLensProvider.ts` imports `RUN_COMPARISON_COMMAND_ID`/`REOPEN_RUN_COMMAND_ID` from `activate.ts`; `activate.ts` imports `ComparisonCodeLensProvider`/`NO_RUNS_YET_COMMAND_ID` from `comparisonCodeLensProvider.ts`). Confirmed both cross-references are read only inside function bodies (`buildLensesForValidDocument`, `registerComparisonCodeLensProvider`), never at module-top-level, so no evaluation-order deadlock is possible today. Ran `npm run typecheck` (`tsc -b --force`) fresh myself: clean, no errors. | No action required for this task — correctly disclosed as a structural note rather than silently left undocumented, and the project has no bundler step yet (`packages/extension` is declaration-only per `CLAUDE.md`) where a stricter cycle-evaluation-order requirement would bite. Worth a one-line note in a future bundling-related task's brief so it isn't rediscovered from scratch. |

## Adversarial verification performed (my own, independent of the implementation report)

| # | Check | Method | Result |
| --- | --- | --- | --- |
| 1 | Lenses never appear for an invalid document, beyond the implementer's own test cases | My own temporary test file with 5 new malformed-input cases not in `comparisonCodeLensProvider.test.ts`: empty string, binary/control-character garbage, YAML with `name` typed as a number (schema-shape violation `parseDefinition` should reject), YAML with an inline `password` field (credential-blocklist rejection per `definition.ts`), and YAML with a duplicated top-level key | All 5 resolved to `[]` with no throw, matching the brief's Scope item 1 contract. |
| 2 | "Open Last Result" reuses T-31's exact lookup, not a reimplementation | Read `runHistory.ts` line 187: `summaries.sort((a, b) => b.timestamp.localeCompare(a.timestamp))` — confirms `listRecentRuns` itself is most-recent-first. Read `comparisonCodeLensProvider.ts`'s `findMostRecentRunForComparison`: `runs.find((run) => run.name === comparisonName)` — a plain first-match filter with no independent re-sort, exactly matching the ordering contract `listRecentRuns` already provides, and mirroring `parityTreeDataProvider.ts`'s own "no re-sorting of its own" comment for the same T-31 function. Confirmed `NO_RUNS_YET_COMMAND_ID` (`paritylens.noRunsYetForComparison`) is registered in `activate.ts` (`registerNoRunsYetCommand`, wired into `activate()`) and its handler calls `vscode.window.showInformationMessage` with a clear message — not a silent no-op. | Confirmed as claimed; no reimplementation drift found. |
| 3 | No lens bypasses T-38's confirmation flow | Traced `activate.ts`: every one of the three run-triggering lenses ("Run Profile," "Run Schema Check," "Run Full Comparison") invokes `RUN_COMPARISON_COMMAND_ID` (`paritylens.runComparison`) with only `uri` (Full Comparison) or `[uri, checksOverride]` (the two subset lenses) as arguments — never a direct call into `runComparison`/`planQueries` from the CodeLens provider itself. The registered command callback (`registerRunComparisonCommand`) always calls `runComparisonCommand`, whose body (lines 336–420) unconditionally calls `planQueries` then gates on `deps.confirmRun` (bound to the real `createWebviewConfirmRun` webview-confirmation callback for every live registration) before ever reaching `runComparison`. Confirmed the T-38 confirmation test suite ("blocks on confirmRun and never calls runComparison...") is present, unmodified in substance (diff against `main` shows only mechanical additions — extended `vscode` mock, extended import list — zero removed assertions), and passing. | Confirmed: no bypass exists for any of the three lenses. |
| 4 | Check-subset override never persists | Traced `runComparisonCommand`: `checksOverride` is applied via `{ ...parsedDefinition, checks: deps.checksOverride }` (a shallow copy) — `yamlText`/`parsedDefinition` are never reassigned, and the function contains no `writeFile`/`fs` write call anywhere. Confirmed `activate.test.ts`'s own T-39 suite includes a **real filesystem** before/after byte comparison (`registerRunComparisonCommand (T-39 uri argument)` → `"a checksOverride argument (position 2) never modifies the on-disk .paritylens file the Uri points to"`, lines 865–877: writes a real temp file, invokes the real registered callback with a `checksOverride`, re-reads the file from disk, asserts byte-for-byte equality) — not just an in-memory string check. Ran this exact test myself as part of the fresh `npm run verify` pass below; it passed. | Confirmed: no disk mutation under any code path, verified both by static trace and by a real-filesystem test I independently re-ran. |
| 5 | Backward compatibility | `git diff main..task/T-39-codelens-actions -- packages/extension/src/activation/activate.ts`: the no-argument path (`registerRunComparisonCommand`'s `else` branch when `uri` is `undefined`) is byte-for-byte the same dialog/filter/`defaultUri` logic as `main`, only re-indented one level deeper inside a new `if (uri !== undefined) { … } else { … }` split — confirmed line-by-line, no field/default/filter changed. `git diff --stat main..task/T-39-codelens-actions -- packages/extension/src/activation/runComparisonCommand.test.ts` produced an empty diff (file untouched); ran it standalone (`npx vitest run packages/extension/src/activation/runComparisonCommand.test.ts`) and got 8/8 passing. | Confirmed: the command-palette (no-argument) path is unchanged, and the pre-existing test file outside this task's ownership is both untouched and still green. |
| 6 | File-ownership diff | `git diff --stat main..task/T-39-codelens-actions`, run independently | Only the 4 declared implementation files + `IMPLEMENTATION-REPORT.md` changed. No other file touched. |
| 7 | Fresh full verification | `npm run verify` (typecheck + lint + test), run by me on a clean checkout of this branch | Exit 0. `tsc -b --force` clean (also re-ran standalone: clean). `eslint .` clean (implicit — verify reached the test stage). Vitest: **34 test files passed, 2 skipped (36 total), 598 tests passed, 27 skipped (625 total)** — matches `IMPLEMENTATION-REPORT.md`'s claimed numbers exactly, and matches the numbers the dispatching context had already independently observed. |

No residue was left from my adversarial probes: one temporary test file
(`packages/extension/src/codelens/__t39_reviewer_adversarial.test.ts`) was
created, run via `npx vitest run`, and deleted before finishing. A second
throwaway file was briefly created outside the `packages/` tree (Vitest's
include glob doesn't reach outside `packages/*/src/**`) and was also
deleted. `git status` after cleanup shows a clean working tree.

## Judgment calls independently assessed

**"Open Last Result" always shows, invoking `paritylens.noRunsYetForComparison`
when no run exists.** Reasonable and correctly implemented — the brief
explicitly left this as the implementer's call ("your call, document it").
Confirmed the command is genuinely registered (not a dangling string
constant) and genuinely shows a message rather than silently no-opping (see
adversarial check #2 above).

**Circular import between `activate.ts` and `comparisonCodeLensProvider.ts`.**
Real, confirmed via `Grep`, and confirmed benign for the current code shape
(both cross-references are read lazily inside function bodies, never at
module top-level; `tsc -b --force` and Vitest both handle it cleanly).
Downgraded to Minor (T-39-02 above) purely as a forward-looking structural
note, not a defect in this task.

**Absence of `onDidChangeCodeLenses` live-refresh wiring.** A reasonable,
correctly disclosed, non-blocking scope boundary. The brief's Scope item 1
and Red/Green evidence requirements never asked for live refresh on run
completion; VS Code will still re-invoke `provideCodeLenses` on its own
document-change heuristics, so the lens becomes stale only in one specific
scenario (a run completes without any subsequent document edit) rather than
never updating at all. Not a defect — correctly scoped out, not silently
omitted.

## Prior findings this task was meant to resolve

None cited in `TASK-BRIEF.md` — this is a new feature task (the final task
of Phase 5), not a remediation of a prior open finding.

## Overall assessment

- File-ownership diff is exactly the declared four implementation files —
  confirmed independently, no scope creep.
- No lens (Run Profile, Run Schema Check, or Run Full Comparison) bypasses
  T-38's confirmation flow; all three route through the identical
  `runComparisonCommand` → `planQueries` → `confirmRun` gate →
  `runComparison` sequence, traced directly in `activate.ts`.
- The check-subset override is genuinely in-memory-only: confirmed by
  static trace (shallow copy, no write call) and by independently
  re-running a real-filesystem before/after byte-comparison test.
- "Open Last Result" reuses T-31's `listRecentRuns` ordering contract and
  T-33's lookup-by-name pattern exactly, with no independent re-sort or
  subtly different matching logic.
- Backward compatibility for the zero-argument command-palette path is
  confirmed both by direct diff (unchanged dialog/filter logic) and by the
  pre-existing, untouched `runComparisonCommand.test.ts` still passing
  standalone.
- My own fresh `npm run verify` run matches the implementation report's
  claimed numbers exactly (34 files / 598 passed / 27 skipped / 625
  total), with no discrepancy.
- My own adversarial malformed-document probes (5 cases beyond the
  implementer's own 2) all correctly produced zero lenses with no throw.
- Two Minor findings identified: a narrow "never throws" gap when the
  injected `listRecentRuns` dependency itself rejects for an otherwise-
  valid document (T-39-01), and a forward-looking note on the disclosed
  circular import's fragility to a future eager-evaluation change
  (T-39-02). Neither affects correctness of the delivered behavior or the
  brief's actual stated requirements.

## Disposition

**APPROVED**

0 Critical, 0 Important, 2 Minor (T-39-01, T-39-02 — both non-blocking,
recommended as small follow-up notes for whichever future task next
touches `comparisonCodeLensProvider.ts` or introduces a bundling step).
