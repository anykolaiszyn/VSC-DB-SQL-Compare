# ParityLens — Review Report T-50

## Review independence

This review was performed by an independent reviewer agent instance with no
memory of authoring the T-50 implementation. All claims in
`IMPLEMENTATION-REPORT.md` were independently re-verified against the actual
diff, fresh command output, and constructed adversarial probes — none were
accepted on the implementer's characterization alone. No implementation-owned
file, `TASK-BRIEF.md`, or `IMPLEMENTATION-REPORT.md` was edited by this
review.

## Review scope

- **Task objective:** Resolve finding T-20-03 (`compareByHash` surfaces a raw,
  opaque connector/binder error on a genuine source/target column-name
  mismatch instead of a clear, actionable message) without adding column-
  name-mapping support and without adding a `getSchema` preflight call.
- **Files and interfaces reviewed:**
  `packages/engine/src/comparison-core/hash-comparison/hash-comparison.ts`
  (full diff read line-by-line: header-comment addition, `HashComparisonOptions`
  doc-comment addition, `fetchNormalizedRows`'s `SELECT *` change and new
  `side` parameter, new `assertFetchColumnsPresent` helper) and
  `packages/engine/src/comparison-core/hash-comparison/hash-comparison.test.ts`
  (full file read, including the two new T-50 tests and the
  `fixtureWithMismatchedColumnName` builder). Confirmed via
  `git diff --stat main..task/T-50-hash-comparison-column-mismatch-disclosure`
  that only these two files plus `TASK-BRIEF.md`/`IMPLEMENTATION-REPORT.md`
  changed — no scope expansion into `row-level/`, `profiling/`, `schema-diff/`,
  `volume/`, `normalization/`, or `type-mapping/`.
- **Evidence reviewed:** `AGENTS.md`, `TASK-BRIEF.md`,
  `IMPLEMENTATION-REPORT.md`, `PROGRESS-LEDGER.md`'s T-20-03 finding row and
  decision-log entries, the full diff of both owned files, a fresh
  `npm run verify` run, a fresh focused
  `npx vitest run packages/engine/src/comparison-core/hash-comparison` run, an
  independent DuckDB reproduction of the binder-error claim (constructed and
  run directly against `@duckdb/node-api`, not reusing implementer code), and
  three original adversarial test cases (source-side mismatch, multiple
  simultaneous missing columns, `keyColumns` mismatch) constructed fresh by
  this review and deleted after use.

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
| T-50-01 | The `SELECT * FROM <object>` change (replacing the prior named-column `SELECT`) is a genuine, disclosed behavioral widening beyond the brief's literal text. It now fetches every column of the source/target table on **every** `compareByHash` call, including the already-passing identical-column-name path, not just the mismatch path the brief targeted. For a wide table this is more bytes over the wire and more DuckDB-side materialization than the previous targeted `SELECT`, a cost the original T-20 design deliberately avoided. Independently reproduced: a named-column `SELECT` naming a nonexistent column throws `Binder Error: Referenced column "IS_ACTIVE" not found in FROM clause!` before any `RecordBatch` is returned (confirmed via a standalone `@duckdb/node-api` script run directly against a throwaway table, not the implementer's own test); `SELECT *` against the same table returns a `RecordBatch` with the real column list (`['ID','NAME','IS_ACTIVE_TARGET']`), confirming the stated reasoning is correct and validation is genuinely impossible against a `RecordBatch` with the old named-column query. No wide-table fixture currently exists in this repo (fixtures top out at ~5 columns), so no test exercises the cost concretely, but the implementer's own report discloses the trade-off explicitly rather than hiding it. | `IMPLEMENTATION-REPORT.md`'s Risks section; this review's own DuckDB repro (see Verification performed); `packages/engine/fixtures/sqlserver-customer.ts` (5-column widest fixture) | Accepted as documented, non-blocking debt. Track as a candidate for a future task if a real connector's wide tables make this measurably costly — e.g. reverting to a named-column `SELECT` for the identical-name case and only falling back to `SELECT *` after detecting a likely mismatch, or building the fetch column list defensively. No action required to close T-50. |
| T-50-02 | Process observation (not a code defect): `IMPLEMENTATION-REPORT.md` was found uncommitted in the working tree at the start of this review's preparation and had to be committed separately as `8228ef0` before the review could proceed against a clean tree. This is a deviation from the implementer's own standing hard rule (`AGENTS.md` Handoff contract / this project's task-loop discipline) to commit all work, including the report itself, before finishing. | `git log --oneline`: `8228ef0 T-50: commit implementation report (was left uncommitted)` immediately following `fdb7595 T-50: disclose hash-comparison column-name-mismatch limitation clearly` | No code action required — already remediated by the separate commit. Flag to the orchestrator as a reminder that the implementer's finishing checklist should include `git status` before declaring COMPLETE. |

## Verification performed

| Check | Exact command or inspection | Result |
| --- | --- | --- |
| Scope check | `git diff --stat main..task/T-50-hash-comparison-column-mismatch-disclosure` | Exactly `hash-comparison.ts` + `hash-comparison.test.ts` (2 owned files) + `TASK-BRIEF.md` + `IMPLEMENTATION-REPORT.md` changed. No unauthorized files. |
| `getSchema`/mapping grep | `grep -n "getSchema\|columnMapping\|column-name-mapping\|columnMap" hash-comparison.ts` | No matches — confirms no `getSchema` preflight call and no column-mapping capability were added, matching the brief's Prohibited-changes section. |
| Independent DuckDB repro of binder-error claim | Standalone script against `@duckdb/node-api` (deleted after use): named-column `SELECT "ID","NAME","IS_ACTIVE" FROM t` against a table with `IS_ACTIVE_TARGET` instead of `IS_ACTIVE` | `THREW: Binder Error: Referenced column "IS_ACTIVE" not found in FROM clause!` — confirms the query fails before any `RecordBatch` is returned, validating the implementer's stated reasoning for the `SELECT *` change. |
| Independent DuckDB repro, `SELECT *` case | Same script, `SELECT * FROM t` against the same table | `SUCCESS, columns: [ 'ID', 'NAME', 'IS_ACTIVE_TARGET' ]` — confirms `SELECT *` returns a `RecordBatch` with the real column list, making post-fetch validation reachable exactly as claimed. |
| Focused test suite | `npx vitest run packages/engine/src/comparison-core/hash-comparison` | 15 tests passed (13 pre-existing + 2 new), 1 file, 0 failures. All pre-existing tests pass unchanged — no regression. |
| Full verification | `npm run verify` (typecheck + lint + test) | Typecheck clean, lint clean. 34 test files passed / 2 skipped, **623 tests passed / 27 skipped (650 total)** — exactly matches `IMPLEMENTATION-REPORT.md`'s claimed figures and is +2 over the stated 621/27/648 baseline (the two new T-50 tests, no other change). |
| Adversarial probe 1: side attribution | Original test constructed by this review (deleted after use): source table missing a column the target has (`REGION`) | Error message: `column(s) "REGION" not found on the source side (actual source columns: "ID", "NAME"). ... no per-side mapping is supported ...` — correctly attributes the mismatch to **source**, not hardcoded to "target". Confirms the error isn't a copy-paste artifact that always says "target". |
| Adversarial probe 2: multiple missing columns | Original test: two columns (`A`, `B`) both missing from target | Error message lists both: `column(s) "A", "B" not found on the target side ...` — confirms the message doesn't silently drop all-but-one missing column. |
| Adversarial probe 3: `keyColumns` mismatch (not just `columns`) | Original test: `keyColumns: ["PK"]` where target's real key column is `ID` | Error message: `column(s) "PK" not found on the target side (actual target columns: "ID", "NAME"). ...` — confirms the validation covers the full `fetchColumns` union (`keyColumns`/`columns`/`partitionColumn`), not just `options.columns`, matching the brief's Scope item 2. |
| Residue check | `git status --short` after each probe/script was deleted | Clean — no leftover scratch files in the repo. |

## Prior-finding disposition

| Finding ID | Disposition | Evidence of resolution |
| --- | --- | --- |
| T-20-03 | RESOLVED | The finding's own recorded probe scenario (source/target column-name mismatch, e.g. `IsActive` vs `IS_ACTIVE`) now throws a clear `Error` naming the missing column(s), the affected side, and a pointer to `HashComparisonOptions`'s doc comment, instead of a raw DuckDB binder error — reproduced independently by this review (see Verification performed) with three variations beyond the implementer's own single test case (source-side mismatch, multi-column mismatch, `keyColumns` mismatch), all producing correctly-attributed, actionable messages. Column-name-mapping support was explicitly NOT added (confirmed by grep), matching the finding's own recorded resolution direction ("disclose," not "add mapping"). No `getSchema` preflight call was added (confirmed by grep) — validation runs purely against the already-fetched `RecordBatch.columns`, per the brief's Scope item 3 and Prohibited-changes section. |

## Approval status

- **Status:** APPROVED
- **Reviewer:** Independent Reviewer (Claude Code subagent, Sonnet 5), separate instance from the T-50 implementer
- **Date:** 2026-08-03
- **Release or dependency impact:** Closes finding T-20-03 in `PROGRESS-LEDGER.md`'s Open findings table. No exported signature, `HashComparisonOptions`, `HashMismatch`, or `HashComparisonResult` shape changed — no downstream consumer impact. The one non-blocking Minor (T-50-01, `SELECT *` wide-table cost) should be carried forward into `PROGRESS-LEDGER.md`'s Open findings table as accepted, non-blocking debt, consistent with how T-20-02 and other accepted-tradeoff findings are already tracked in this project.
