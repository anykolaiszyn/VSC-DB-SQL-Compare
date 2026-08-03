# REVIEW-REPORT.md — T-38: Pre-execution SQL preview + confirmation

## Review independence statement

This review was performed by a separate agent instance from the implementer,
with no memory of authoring this code. All findings below are based on
direct inspection of the actual diff/source on
`task/T-38-plan-queries-preview` (commit `91ee19d779715ecafb75e53804e46c06b1db0302`,
base `main`), my own independently re-run verification commands, and my own
constructed adversarial test probes (written to temporary files, run, and
deleted before finishing — confirmed via `git status --porcelain` producing
no output). `IMPLEMENTATION-REPORT.md`'s claims were treated as things to
verify, not trust.

## Scope reviewed

- `packages/engine/src/orchestration/planner/planQueries.ts` (new)
- `packages/engine/src/orchestration/planner/planQueries.test.ts` (new)
- `packages/extension/src/webview/runConfirmationWebview.ts` (new)
- `packages/extension/src/webview/runConfirmationWebview.test.ts` (new)
- `packages/extension/src/webview/resultsWebview.ts` (one-line change)
- `packages/extension/src/activation/activate.ts` (extended)
- `packages/extension/src/activation/activate.test.ts` (extended)
- `packages/engine/src/index.ts` (disclosed, undeclared, mechanically
  required re-export)
- `IMPLEMENTATION-REPORT.md` (self-report, cross-checked, not trusted)

## Findings

### Critical

NONE.

### Important

NONE.

### Minor

| ID | Finding | Evidence | Suggested resolution |
| --- | --- | --- | --- |
| T-38-01 | `planQueries`'s Layer-1 `testConnection()` gate (a genuine, disclosed mid-implementation addition) causes the confirmation panel to show an empty query list for an unreachable connection, with no distinguishing message from "this definition genuinely issues zero queries" (e.g. a schema-only definition). A user cannot tell these two states apart from the panel alone. | `planQueries.ts` lines 137–160 (returns `[]` on either side's `testConnection()` failing); confirmed via my own adversarial probe (temporary test file, deleted) that a definition with `checks.schema.enabled: true` and one connector always returning `{success:false}` produces `planned === []`, indistinguishable in shape from `SCHEMA_ONLY_YAML`'s legitimately-empty `[]` result in `planQueries.test.ts`. | Already disclosed by the implementer as a known, deliberate UX gap ("Risks/limitations not fixed" in `IMPLEMENTATION-REPORT.md`) rather than left silent. Does not block this task — the correctness property that matters (no silent "success" masking a real failure) holds, see Verification item 3 below. Worth a small follow-up task (e.g. distinguishing "no queries — nothing to preview" from "no queries — connection unreachable, see the Run button for the real error" in the panel copy), but is a UX polish item, not a correctness defect. |

## Disposition of the three flagged-for-scrutiny items

**1. Layer-1 `testConnection()` gate in `planQueries` — correctness of the fix.**
Confirmed correct. `planQueries` mirrors `runComparison`'s own Layer-1 step
(`planner.ts` lines 200–226) by calling `testConnection()` on both sides
before touching `getSchema`, and returns `[]` (not a throw) on failure. I
constructed my own adversarial test (a `DataPlatformConnector` whose
`testConnection()` always resolves `{success:false}` and whose `getSchema`
throws if ever called) and confirmed:
- `planQueries` returns `[]` without ever calling the failing connector's
  `getSchema` (the throw-if-called guard never fired).
- `runComparison`, called afterward against the same registry (simulating
  the user clicking Run despite the empty-looking preview), correctly
  returns `status: "failed"` / `summary.failed: 1` via its own,
  byte-for-byte-unmodified Layer-1 check.

This directly satisfies the dispatch's central correctness question: a
down connection does **not** silently masquerade as "everything's fine" —
the user sees an empty preview (Minor UX gap, T-38-01 above) but the
authoritative failure is still correctly reported by the real
`runComparison` call after Run, exactly as it was before this task existed.
The fix is squarely within the brief's own stated allowance ("Must not
throw for a connectivity failure the way `runComparison` doesn't either")
and does not touch `planner.ts`.

**2. `packages/engine/src/index.ts` — scope of the undeclared touch.**
Confirmed via `git diff main..task/T-38-plan-queries-preview --
packages/engine/src/index.ts`: exactly one new export line
(`export * from "./orchestration/planner/planQueries.js";`) plus a comment
block following the file's own pre-existing "amendment" precedent (the T-29
comment immediately above it, same style). No existing export line was
touched, reordered, or removed. This is a minimal, mechanically-forced
consequence of `activate.ts` needing to import `planQueries` across the
`@paritylens/engine` package boundary (confirmed: every other
engine-consuming file in this codebase imports from the package root, not
a deep relative path) — acceptable scope, correctly disclosed rather than
silently folded in.

**3. `resultsWebview.ts` — narrowness of the permitted change.**
Confirmed via diff: exactly one line changed, adding the `export` keyword
to the previously-private `renderQueryPreviewSection` function signature.
No other line in the file was touched. This is exactly the one narrow
exception `TASK-BRIEF.md`'s "Prohibited changes" section explicitly
permitted.

## Verification performed (my own, independent of the implementer's report)

| # | Check | Method | Result |
| --- | --- | --- | --- |
| 1 | Fresh full verification | `npm run verify` (typecheck + lint + test), run by me from a clean working tree on this branch | Exit 0. `tsc -b --force` clean, `eslint .` clean, vitest: **33 test files passed, 2 skipped (35), 581 tests passed, 27 skipped (608 total)** — matches `IMPLEMENTATION-REPORT.md`'s claimed numbers exactly. |
| 2 | No drift, byte-for-byte, 2 definitions the implementer's own tests do **not** use | My own test file (`planQueries`/`runComparison` imported directly), comparing `planQueries` output against `runComparison`'s `queriesUsed` for a **rowCount-only** definition (direct `toEqual`, no normalization needed — no TIMESTAMP literal in rowCount SQL) and a **rowLevel-only** definition (normalized only for the TIMESTAMP substring, per the same, independently-verified rationale the implementer's own tests use) | Both passed: exact string equality, same order, in both cases. |
| 3 | Zero `executeQuery` calls, my own mock construction, and the Layer-1 gate's real-world effect | A hand-rolled `Proxy`-wrapped `vi.fn()` spy around `executeQuery` on both source and target connectors (not the implementer's `SpyConnector` class), run against a definition with all four checks enabled; separately, an unreachable-connector probe (see item 1 above) | `executeQuerySpy`/`executeQuerySpyTarget` both `not.toHaveBeenCalled()`; `planned.length > 0` (confirming the function did real work, not a no-op). Also confirmed by direct grep: no literal `executeQuery` call site exists in `planQueries.ts`, and the two builder functions it calls transitively (`buildProfileQueries` in `profiling.ts`, `buildFetchAllRowsSql`/`buildRowCountSql` in `planner.ts`/`volume.ts`) are pure string builders with no `executeQuery` call anywhere in their bodies (read in full). Unreachable-connector probe: `planQueries` returns `[]` without throwing and without calling the poisoned `getSchema`; the subsequent real `runComparison` call correctly reports `status: "failed"`. |
| 4 | `runComparison`/`planner.ts` genuinely untouched | `git diff main..task/T-38-plan-queries-preview -- packages/engine/src/orchestration/planner/planner.ts` | Empty diff — zero changes, confirmed. |
| 5 | Cancellation genuinely blocks execution, my own test | A standalone probe (mirroring `runComparisonCommand.test.ts`'s minimal `vscode` mock, not reusing `activate.test.ts`'s own T-38 assertions) calling `runComparisonCommand` with a `confirmRun` mock resolving `false`, against a rowLevel-enabled definition | `confirmRun` called exactly once, received the real (length-2, non-empty) planned query list; `result` is `undefined`; `createWebviewPanel` and `showErrorMessage` both never called — `runComparison`'s real effects genuinely never happen on Cancel. |
| 6 | Confirmation panel purity/escaping, my own adversarial payloads | Three payloads distinct from the implementer's own test: a `</pre><script>alert(document.cookie)</script>` breakout, a `">` attribute-breakout `<img onerror=...>` payload, and a `-- ' onmouseover="alert(1)"` comment/attribute injection, plus a purity check (same input twice) | All escaped correctly — exactly one literal `<script>` tag survives in the output (the file's own static embedded client script), the adversarial payloads' raw HTML never appears unescaped, and identical input produces identical output on repeated calls. |
| 7 | File-ownership diff | `git diff --stat main..task/T-38-plan-queries-preview` | Only declared files (+ the disclosed `index.ts` re-export) changed: `planQueries.ts`/`.test.ts` (new), `runConfirmationWebview.ts`/`.test.ts` (new), `resultsWebview.ts` (1-line `export` addition, confirmed via diff), `activate.ts`/`.test.ts` (extended), `packages/engine/src/index.ts` (1 export line + comment), `IMPLEMENTATION-REPORT.md`. `runComparisonCommand.test.ts` (outside declared ownership) confirmed unmodified via diff — consistent with the implementer's disclosed judgment call about `confirmRun`'s optional typing preserving that file's existing behavior. |

No residue was left from my adversarial probes: three temporary test files
were created under `packages/engine/src/orchestration/planner/`,
`packages/extension/src/activation/`, and `packages/extension/src/webview/`,
each run individually via `npx vitest run <path>`, then deleted. `git
status --porcelain` after cleanup produced no output, confirming a clean
tree.

## Prior findings this task was meant to resolve

None cited in `TASK-BRIEF.md` — this is a new feature task, not a
remediation of a prior open finding.

## Overall assessment

- Query-building logic in `planQueries.ts` genuinely mirrors
  `runComparison`'s own checks-gating, resolution, and builder-function
  calls, verified via my own byte-for-byte comparisons on definitions the
  implementer's own tests did not exercise.
- Zero `executeQuery` calls confirmed both by static reading of every
  transitively-called function and by my own dynamic mock-based
  assertion.
- `planner.ts` (the one file under an absolute non-modification
  requirement) has a genuinely empty diff against `main`.
- The disclosed Layer-1 `testConnection()` gate — the one real design
  decision made mid-implementation rather than pre-specified — is correct:
  it prevents a spurious hard failure of the preview step while preserving
  the property that a real connectivity failure is still correctly and
  authoritatively reported by `runComparison`'s own unmodified Layer-1
  check if the user proceeds past an (admittedly uninformative, Minor,
  disclosed) empty preview.
- Cancellation genuinely blocks all of `runComparison`'s real effects,
  confirmed by my own independently-constructed test.
- The confirmation webview's render function is pure and correctly escapes
  every adversarial payload I constructed, including payloads distinct
  from the implementer's own test cases.
- Scope discipline is intact: the two undeclared touches
  (`packages/engine/src/index.ts`, one export line; `resultsWebview.ts`,
  one `export` keyword) are both exactly as narrow as disclosed and both
  fall within the brief's own explicit allowances.
- My fresh `npm run verify` run matches the implementation report's
  claimed numbers exactly (33 files / 581 passed / 27 skipped / 608
  total), with no discrepancy.

## Disposition

**APPROVED**

0 Critical, 0 Important, 1 Minor (T-38-01 — disclosed pre-existing UX gap
in the confirmation panel's messaging for an unreachable connection;
correctness is unaffected, does not block approval, recommended as a small
future-task follow-up).
