# ParityLens — Task Brief T-16b

## Objective

Deliver the SQL preview panel that was explicitly descoped from T-16 (see
`PROGRESS-LEDGER.md`'s 2026-07-31 "Descoped T-16's SQL preview panel"
decision entry): the extension must be able to show the user the actual
SQL that will be (or was) executed for a comparison's schema/profile/
volume/row-level checks, **before or alongside** execution, per
`DESIGN-SPEC.md`'s SQL-preview requirement.

T-16's investigation found the root blocker: no engine interface exposes
generated SQL as a string. Three files build SQL privately and execute it
immediately inline, with no seam for a caller to just ask "what would you
run":

- `packages/engine/src/comparison-core/volume/volume.ts` — `countRows`
  builds `SELECT COUNT(*) AS row_count FROM <objectRef>` inline (line
  ~188) and immediately executes it.
- `packages/engine/src/comparison-core/profiling/profiling.ts` —
  `profileColumn` issues **between 2 and 5 separate queries per column**
  depending on canonical type (always a general metrics query plus
  `computeMostCommonValue`'s query; then one of
  `computeStringMetrics`/`computeNumericMetrics`/`computeDateMetrics`/
  `computeBooleanMetrics`, each of which may itself issue more than one
  query — read the actual functions, don't assume a 1:1 shape). There is
  no single "the SQL" for a profiled column; a preview must show the
  **list** of queries that column's profile will issue.
- `packages/engine/src/orchestration/planner/planner.ts` — `fetchAllRows`
  builds `SELECT * FROM <objectRef> [WHERE <where>]` inline (line ~289)
  for row-level comparison and immediately executes it.

Per the user's explicit direction on how to close this gap (recorded
below in Dependencies), the fix is **not** a new centralized SQL-builder
module. Each of the three files above gets a small additional **exported,
pure, string-returning function** that the existing execution code path
now calls internally (so the executed SQL and the previewed SQL are
provably the same code, not two independently-maintained copies — this
was the specific drift risk the original T-16 deferral decision flagged
as a reason *not* to have the extension re-derive SQL independently).

This task therefore has **four** file-ownership zones, three of them
extending existing owned files rather than a single clean new directory —
read the Files owned section carefully.

## Dependencies

- **Required completed tasks:** T-07 (profiling, COMPLETE/APPROVED), T-09
  (planner Phase 1, COMPLETE/APPROVED), T-13 (volume, COMPLETE/APPROVED),
  T-15 (planner Phase 2, COMPLETE/APPROVED), T-16 (webview + export,
  COMPLETE/APPROVED — this task extends its webview ownership again, the
  same way T-16 itself extended T-11's).
- **Required decisions or approvals:** The refactor shape (export builder
  functions in place in each of the three existing owned files, rather
  than a new centralized SQL-preview module) was chosen directly by the
  project owner via `AskUserQuestion` on 2026-08-01, specifically to keep
  the diff minimal and avoid introducing a new ownership boundary for one
  feature. This constitutes each of T-07/T-09/T-13/T-15's implicit
  authorization to extend their files for this narrowly-scoped purpose —
  document this authorization explicitly in `IMPLEMENTATION-REPORT.md` if
  any of those files' original reviewers would otherwise read their
  brief's ownership as exclusive-forever.

## Files owned

- `packages/engine/src/comparison-core/volume/volume.ts` — **extend
  only**: add one new exported function, e.g.
  `buildRowCountSql(connector: DataPlatformConnector, input: QueryInput): string`,
  that returns exactly the SQL string `countRows` already builds
  internally. Refactor `countRows` to call this new function rather than
  building the string twice.
- `packages/engine/src/comparison-core/profiling/profiling.ts` — **extend
  only**: add one new exported function, e.g.
  `buildProfileQueries(connector: DataPlatformConnector, column: ColumnDefinition, options: ProfileOptions): string[]`,
  that returns the **ordered list** of every SQL string `profileColumn`
  would issue for that column (general metrics, most-common-value, and
  whichever type-specific metrics query/queries apply — mirror
  `profileColumn`'s own type-dispatch logic exactly, don't reimplement a
  parallel simplified version that can drift from it). Refactor the
  internal query-building call sites to source their SQL from this same
  function (or from shared helpers this function itself calls) rather
  than maintaining two independent string-construction paths.
- `packages/engine/src/orchestration/planner/planner.ts` — **extend
  only**: add one new exported function, e.g.
  `buildFetchAllRowsSql(connector: DataPlatformConnector, side: ParityDefinition["source"]): string`,
  that returns exactly the SQL string `fetchAllRows` already builds
  internally. Refactor `fetchAllRows` to call it.
- `packages/extension/src/webview/**` (extends T-11's/T-16's ownership
  again) — render a new "Query Preview" section in `renderResultsHtml`
  (or a clearly-separated new exported function alongside it, your call,
  document the choice) showing the SQL that was used to produce the
  displayed result. This is a **post-hoc preview of SQL already run**,
  not a pre-execution confirmation gate — `ComparisonResult` doesn't
  currently carry the queries used to produce it (see the new interface
  requirement below), and adding an actual execution-blocking
  confirmation UI is out of scope here (no command/trigger wiring exists
  yet for initiating a comparison at all — same boundary T-11's review
  already established for activation wiring). Keep `renderResultsHtml`
  pure, no new `vscode` import, matching T-11/T-16's existing contract
  exactly.
- `packages/shared/src/result.ts` — **narrow, additive-only edit**: add
  an optional `queriesUsed` (or similarly named) field to
  `ComparisonResult` (or a sub-shape it references) capturing the SQL
  strings actually issued for the run, populated by the planner. This is
  the one shared-type edit this task is authorized to make; do not touch
  `SchemaDifference`/`ProfileDifference`/`AggregateDifference`/
  `RowDifference` or any other existing field.
- `packages/engine/src/orchestration/planner/planner.ts` also needs a
  **second** change beyond `buildFetchAllRowsSql` above: wire the new
  builder functions from volume.ts/profiling.ts/planner.ts itself into
  `runComparison` so the collected SQL strings populate the new
  `queriesUsed` field on the returned `ComparisonResult`. This is still
  within this task's planner.ts ownership already declared above — not a
  new zone.

Do not touch any other file in `packages/engine/src/comparison-core/**`
or `packages/engine/src/connector-sdk/**` (including
`sqlserver/**`/`postgres/**`/`fixture/**`/`safety/**`) — this task only
needs read access to `DataPlatformConnector`'s public surface
(`quoteIdentifier`), exactly as `countRows`/`fetchAllRows` already use it
today.

## Interfaces

| Direction | Interface | Contract | Producer or consumer |
| --- | --- | --- | --- |
| Produced | `buildRowCountSql(connector, input): string` (`volume.ts`) | Pure function, no I/O, returns the exact string `countRows` would execute for that input | This task (producer); webview (consumer, indirectly via `queriesUsed`) |
| Produced | `buildProfileQueries(connector, column, options): string[]` (`profiling.ts`) | Pure function, no I/O, returns the ordered list of every SQL string `profileColumn` would issue for that column, matching its real type-dispatch logic | This task (producer); webview (consumer, indirectly via `queriesUsed`) |
| Produced | `buildFetchAllRowsSql(connector, side): string` (`planner.ts`) | Pure function, no I/O, returns the exact string `fetchAllRows` would execute for that side | This task (producer); webview (consumer, indirectly via `queriesUsed`) |
| Produced | `ComparisonResult.queriesUsed` (new optional field, `packages/shared/src/result.ts`) | Populated by `runComparison`, holding the SQL strings actually issued during that run (source and target, per check type run) | This task (producer); webview (consumer) |
| Produced | Extended `renderResultsHtml` (or a new sibling export) rendering a "Query Preview" section from `ComparisonResult.queriesUsed` when present | Pure function, `escapeHtml`-sanitized like every other field T-11/T-16 already render, no new `vscode` import | This task (producer) |

## Prohibited changes

- Do not modify `packages/engine/src/connector-sdk/safety/**`,
  `packages/engine/src/comparison-core/type-mapping/**`,
  `packages/engine/src/connector-sdk/fixture/**`,
  `packages/engine/src/connector-sdk/sqlserver/**`, or
  `packages/engine/src/connector-sdk/postgres/**`.
- Do not modify `SchemaDifference`, `ProfileDifference`,
  `AggregateDifference`, or `RowDifference` in
  `packages/shared/src/result.ts` — only the new `queriesUsed` addition is
  authorized there.
- Do not add any actual execution-blocking "confirm before running" UI —
  this task is a post-hoc preview of SQL that was used, not a
  pre-execution gate (no comparison-triggering command exists yet to gate
  in the first place).
- Do not reimplement SQL-building logic a second time anywhere (e.g.
  inside the webview) — the webview must only ever display strings that
  originated from the three new engine-layer builder functions, never
  independently reconstruct SQL from a `QueryInput`/`ColumnDefinition`.
  This is the exact drift risk the original T-16 deferral decision was
  written to avoid.
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Test or check to add:** A test asserting `buildRowCountSql` returns
  the same SQL string `countRows` actually executes against a fixture
  connector — must fail because the function doesn't exist yet. A second:
  `buildProfileQueries` for a numeric column returns a list containing at
  least the general-metrics and numeric-metrics query strings — must
  fail. A third: `runComparison` against fixture data with schema/profile/
  volume/row-level checks enabled produces a `ComparisonResult` with a
  populated `queriesUsed` — must fail (field doesn't exist).
- **Command:**
  `npx vitest run packages/engine/src/comparison-core/volume packages/engine/src/comparison-core/profiling packages/engine/src/orchestration/planner`
- **Expected failure reason:** Functions/field do not exist yet.
- **Captured output:** Paste the actual failing command output into
  `IMPLEMENTATION-REPORT.md`.

## Green-state and full verification

- **Focused command:** same as above, now passing.
- **Full command:** `npm run verify`
- **Expected evidence:** All red-state cases now pass; the SQL strings
  the new builder functions return are byte-for-byte identical to what
  the corresponding execution code path actually sends to the connector
  (verify this directly — e.g. capture the SQL a `FixtureConnector` spy
  receives via `executeQuery` and assert equality against the builder's
  output, not just that both look plausible); `renderResultsHtml`'s new
  section renders `queriesUsed` correctly and escapes it; all previously
  passing tests (386 as of T-19) still pass with no regression;
  `npm run verify` exits 0. This task does not depend on the WSL/Docker
  test containers — everything here is fixture-only (`FixtureConnector`),
  no live-database work is in scope.

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md`
- **Independent reviewer:** `reviewer` subagent (separate instance from
  whichever `implementer` subagent does this task)
- **Review report location:** `REVIEW-REPORT.md`
- **Commit or patch checkpoint:** Branch `task/T-16b-sql-preview`

**Note to reviewer:** the central risk on this task is exactly the drift
risk the original T-16 deferral was written to avoid — verify, don't
trust, that the previewed SQL and the executed SQL are the *same string
from the same code path*, not two independently-written string templates
that merely look similar today and can silently diverge tomorrow. Trace
each of the three execution call sites (`countRows`, `profileColumn`'s
various metric computations, `fetchAllRows`) and confirm they call the
new builder function rather than duplicating its string-building logic.
Also confirm `profileColumn`'s type-dispatch branching
(String/Integer-Decimal-FloatingPoint/Date-family/Boolean) is mirrored
exactly by `buildProfileQueries`, not approximated — construct your own
column of each canonical type and diff the actual queries issued against
`buildProfileQueries`'s output for that same column. Confirm
`renderResultsHtml` still has zero reachable path to `vscode.workspace`/
`SecretStorage`/a connector, matching T-11/T-16's established contract.
