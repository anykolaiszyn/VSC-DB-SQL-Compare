# ParityLens — Implementation Report T-16b

## Status and objective

- **Status:** COMPLETE (implementation and evidence only — not reviewed or approved; see Recommended next step)
- **Objective:** Per `TASK-BRIEF.md`'s Objective section: "Deliver the SQL
  preview panel that was explicitly descoped from T-16 ... the extension
  must be able to show the user the actual SQL that will be (or was)
  executed for a comparison's schema/profile/volume/row-level checks,
  **before or alongside** execution." The brief's specified mechanism (not
  a new centralized SQL-builder module, per the project owner's
  `AskUserQuestion` decision on 2026-08-01 recorded in the brief's
  Dependencies section) is: one small exported, pure, string-returning
  builder function added to each of `volume.ts`, `profiling.ts`,
  `planner.ts`, with the existing execution code refactored to call that
  same function, plus a new optional `queriesUsed` field on
  `ComparisonResult` populated by the planner, plus a new "Query Preview"
  section in the results webview.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/engine/src/comparison-core/volume/volume.ts` | Added exported `buildRowCountSql(connector, input): string`; refactored `countRows` to call it instead of building the string inline | Brief's Files owned: "add one new exported function ... that returns exactly the SQL string `countRows` already builds internally. Refactor `countRows` to call this new function" |
| `packages/engine/src/comparison-core/volume/volume.test.ts` | Added `describe("buildRowCountSql", ...)` with a spy-based test asserting the builder's output is byte-for-byte identical to the SQL `compareVolume`/`countRows` actually sends via `executeQuery`, plus a `{kind:"query"}` input case | Red-state evidence + Green-state "verify this directly ... assert equality against the builder's output, not just that both look plausible" |
| `packages/engine/src/comparison-core/profiling/profiling.ts` | Added 8 small pure `build*Sql` helper functions (general metrics, most-common-value, string metrics, string populated-count, numeric metrics, date earliest/latest, date future-count, boolean metrics) plus exported `buildProfileQueries(connector, column, options): string[]` that composes them in the same order/dispatch as `profileColumn`; refactored every internal query-issuing call site in `profileColumn`/`computeStringMetrics`/`computeNumericMetrics`/`computeDateMetrics`/`computeBooleanMetrics`/`computeMostCommonValue` to source SQL from these same helpers instead of building strings inline a second time | Brief's Files owned: "mirror `profileColumn`'s own type-dispatch logic exactly, don't reimplement a parallel simplified version that can drift from it" |
| `packages/engine/src/comparison-core/profiling/profiling.test.ts` | Added `describe("buildProfileQueries", ...)` with 4 spy-based tests (String, Integer/Decimal numeric, Date-family, Boolean categories), each asserting the builder's ordered output is byte-for-byte identical to every SQL string `profileColumn` actually issues for that column | Red-state evidence + reviewer note: "construct your own column of each canonical type and diff the actual queries issued against `buildProfileQueries`'s output for that same column" |
| `packages/engine/src/orchestration/planner/planner.ts` | Added exported `buildFetchAllRowsSql(connector, side): string`; refactored `fetchAllRows` to call it. Also wired `buildRowCountSql`/`buildProfileQueries`/`buildFetchAllRowsSql` into `runComparison` and `runProfileChecks` to collect every SQL string issued during a run into a `queriesUsed` array, included in the returned `ComparisonResult` only when non-empty. Pinned a single `now` per profiled column pair, passed explicitly to both `buildProfileQueries` and `profileColumn`, to guarantee byte-identical `TIMESTAMP` literals for Date-family columns (see Assumptions and risks) | Brief's Files owned (both the `buildFetchAllRowsSql` addition and the "second change ... wire the new builder functions ... into `runComparison`") |
| `packages/engine/src/orchestration/planner/planner.test.ts` | Added a `queriesUsed` test asserting `runComparison` against fixture data with schema/profile/volume/row-level checks all enabled produces a populated `queriesUsed` containing both a `COUNT(*)` (volume) and a `SELECT *` (row-level) query | Red-state evidence: "`runComparison` against fixture data with schema/profile/volume/row-level checks enabled produces a `ComparisonResult` with a populated `queriesUsed`" |
| `packages/shared/src/result.ts` | Added optional `queriesUsed?: string[]` field to `ComparisonResult`, with a doc comment explaining its provenance and the drift-avoidance guarantee | Brief's Files owned: "narrow, additive-only edit ... add an optional `queriesUsed` (or similarly named) field to `ComparisonResult`" — no other field in this file was touched |
| `packages/extension/src/webview/resultsWebview.ts` | Added `renderQueryPreviewSection(queriesUsed)` (escaped `<pre>` per query, ordered list) and wired it into `renderResultsHtml` as a new "Query Preview" `<h2>` section; extended the file header doc comment to document T-16b's extension of T-11's/T-16's ownership | Brief's Files owned: "render a new 'Query Preview' section in `renderResultsHtml` ... showing the SQL that was used to produce the displayed result ... Keep `renderResultsHtml` pure, no new `vscode` import" |
| `packages/extension/src/webview/resultsWebview.test.ts` | Added 2 tests: empty-state message when `queriesUsed` is absent, and an XSS-shaped-payload escaping test asserting a `<script>` tag embedded in a query string is rendered escaped, not passed through raw | Green-state: "`renderResultsHtml`'s new section renders `queriesUsed` correctly and escapes it" |

No file outside this list was modified. No file under
`packages/engine/src/comparison-core/type-mapping/**`,
`packages/engine/src/connector-sdk/safety/**`,
`packages/engine/src/connector-sdk/fixture/**`,
`packages/engine/src/connector-sdk/sqlserver/**`, or
`packages/engine/src/connector-sdk/postgres/**` was touched, per the
brief's Prohibited changes section. No field on `SchemaDifference`,
`ProfileDifference`, `AggregateDifference`, or `RowDifference` was touched
— only the new `queriesUsed` addition on `ComparisonResult` itself.

## Behavior and interfaces

- **Behavior delivered:** Every SQL string the engine actually issues for a
  comparison run's schema/profile/volume/row-level checks is now also
  obtainable as a plain string (or ordered list of strings, for profiling)
  from a pure builder function, and the planner collects all of them into
  `ComparisonResult.queriesUsed`. The results webview renders this as a new
  "Query Preview" section (an ordered list of `<pre>`-formatted, escaped SQL
  strings) below the existing Row-Level Differences section. This is a
  post-hoc preview of SQL that was used to produce the displayed result —
  no pre-execution confirmation gate was added (none was requested, and the
  brief explicitly prohibits one, since no comparison-triggering command
  exists yet to gate).
- **Interfaces consumed:** `DataPlatformConnector.quoteIdentifier` (public
  surface only, exactly as `countRows`/`fetchAllRows` already used it before
  this task) via `volume.ts`, `profiling.ts`, `planner.ts`. `ColumnDefinition`,
  `QueryInput` from `@paritylens/shared` (already-existing interfaces, not
  modified).
- **Interfaces produced:**
  - `buildRowCountSql(connector: DataPlatformConnector, input: QueryInput): string` (`volume.ts`)
  - `buildProfileQueries(connector: DataPlatformConnector, column: ColumnDefinition, options: ProfileOptions): string[]` (`profiling.ts`)
  - `buildFetchAllRowsSql(connector: DataPlatformConnector, side: ParityDefinition["source"]): string` (`planner.ts`)
  - `ComparisonResult.queriesUsed?: string[]` (`packages/shared/src/result.ts`)
  - `renderResultsHtml`'s new "Query Preview" section, sourced only from `ComparisonResult.queriesUsed` (`resultsWebview.ts`)

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline (before any change) | `npm run verify` | Exit 0. 359 passed, 27 skipped (386 total) | Captured in this session, see "Baseline capture" below |
| Red state | `npx vitest run packages/engine/src/comparison-core/volume packages/engine/src/comparison-core/profiling packages/engine/src/orchestration/planner` | **7 failed, 21 passed** (21 pre-existing tests unaffected; all 7 new tests failed for the predicted reason: `TypeError: buildProfileQueries is not a function`, `TypeError: buildRowCountSql is not a function`, and `AssertionError: expected undefined to be defined` for `result.queriesUsed`) | Captured in this session, see "Red-state capture" below |
| Focused green state | `npx vitest run packages/engine/src/comparison-core/volume packages/engine/src/comparison-core/profiling packages/engine/src/orchestration/planner packages/extension/src/webview` | **35 passed** (4 test files: volume 7, profiling 13, planner 8, webview 7) | Captured in this session, see "Green-state capture" below |
| Full verification | `npm run verify` | **Exit 0.** `tsc -b --force` clean, `eslint .` clean, `vitest run`: **368 passed, 27 skipped (395 total)** — up from the pre-task baseline of 359 passed/27 skipped (386 total); the +9 delta is exactly the 9 new tests added (2 volume + 4 profiling + 1 planner + 2 webview), no regressions in any previously-passing test | Captured in this session, see "Full verify capture" below |

### Baseline capture

```
npm run verify
...
Test Files  18 passed | 2 skipped (20)
     Tests  359 passed | 27 skipped (386)
```

### Red-state capture

```
npx vitest run packages/engine/src/comparison-core/volume packages/engine/src/comparison-core/profiling packages/engine/src/orchestration/planner

 FAIL  packages/engine/src/comparison-core/profiling/profiling.test.ts > buildProfileQueries > returns the general-metrics and most-common-value queries for every column, and matches the SQL profileColumn actually issues (String category)
TypeError: buildProfileQueries is not a function
 FAIL  packages/engine/src/comparison-core/profiling/profiling.test.ts > buildProfileQueries > returns a list containing at least the general-metrics and numeric-metrics query strings for a numeric column, matching profileColumn's actual issued queries
TypeError: buildProfileQueries is not a function
 FAIL  packages/engine/src/comparison-core/profiling/profiling.test.ts > buildProfileQueries > matches profileColumn's actual issued queries for a Date-family column
TypeError: buildProfileQueries is not a function
 FAIL  packages/engine/src/comparison-core/profiling/profiling.test.ts > buildProfileQueries > matches profileColumn's actual issued queries for a Boolean column
TypeError: buildProfileQueries is not a function
 FAIL  packages/engine/src/comparison-core/volume/volume.test.ts > buildRowCountSql > returns the exact SQL string countRows actually executes against a fixture connector (table input)
TypeError: buildRowCountSql is not a function
 FAIL  packages/engine/src/comparison-core/volume/volume.test.ts > buildRowCountSql > returns the exact SQL string for a query-kind input, wrapped as a subquery
TypeError: buildRowCountSql is not a function
 FAIL  packages/engine/src/orchestration/planner/planner.test.ts > runComparison > T-16b: queriesUsed > produces a ComparisonResult with a populated queriesUsed when schema/profile/volume/row-level checks are enabled
AssertionError: expected undefined to be defined

 Test Files  3 failed (3)
      Tests  7 failed | 21 passed (28)
```

### Green-state capture

```
npx vitest run packages/engine/src/comparison-core/volume packages/engine/src/comparison-core/profiling packages/engine/src/orchestration/planner packages/extension/src/webview

 ✓ packages/extension/src/webview/resultsWebview.test.ts (7 tests)
 ✓ packages/engine/src/comparison-core/volume/volume.test.ts (7 tests)
 ✓ packages/engine/src/comparison-core/profiling/profiling.test.ts (13 tests)
 ✓ packages/engine/src/orchestration/planner/planner.test.ts (8 tests)

 Test Files  4 passed (4)
      Tests  35 passed (35)
```

### Full verify capture

```
npm run verify
...
> npm run typecheck && npm run lint && npm run test
> tsc -b --force        [no output, exit 0]
> eslint .              [no output, exit 0]
> vitest run
...
 Test Files  18 passed | 2 skipped (20)
      Tests  368 passed | 27 skipped (395)
```

### Byte-for-byte equality verification (Green-state's specific requirement)

Per the brief's Green-state section, "verify this directly — e.g. capture
the SQL a `FixtureConnector` spy receives via `executeQuery` and assert
equality against the builder's output, not just that both look plausible."
Every new builder test does exactly this: each test monkey-patches
`connector.executeQuery` to capture every SQL string sent for `{kind:
"query"}` input, runs the real execution path (`compareVolume`/
`profileColumn`), and asserts the captured SQL array is `toEqual`/`toBe`
the builder function's own output — not a separate plausibility check.
This is possible specifically *because* the execution code paths were
refactored to call the builder functions internally (not because the two
were independently written to produce matching strings).

## Assumptions and risks

- **Assumptions:**
  - Adding tests to the existing `volume.test.ts`/`profiling.test.ts`/
    `planner.test.ts`/`resultsWebview.test.ts` files (rather than new
    separate test files) is consistent with the brief's Files owned
    section, which names the `.ts` source files without separately listing
    `.test.ts` files, but every precedent task in this repo (T-07, T-09,
    T-13, T-11, T-16) added tests directly to the existing sibling test
    file for its owned module. Judgment call: treated the sibling test file
    as implicitly in scope for the same module, consistent with that
    precedent and with the brief's own Red-state evidence section
    specifying exactly these three test-file directories as the focused
    command's target.
  - The `Files owned` section's authorization to extend T-07's/T-09's/
    T-13's/T-15's/T-16's owned files is exercised here exactly as scoped —
    only the described builder-function additions and their direct
    refactor call sites were touched; no other logic in any of those files
    was changed. Per the brief's Dependencies section, this extension is
    authorized by the project owner's 2026-08-01 `AskUserQuestion` decision
    choosing this refactor shape specifically to avoid a new ownership
    boundary — documented here explicitly per the brief's own instruction,
    in case a reviewer of T-07/T-09/T-13/T-15's original briefs would
    otherwise read those briefs' ownership as exclusive-forever.
- **Risks or limitations:**
  - **Date-family `now` timing (identified and fixed during implementation,
    not left open):** `buildProfileQueries` and `profileColumn` both default
    `now` to `new Date()` when the caller doesn't supply one (per
    `profiling.ts`'s pre-existing `ProfileOptions.now` doc comment). If the
    planner called each independently without pinning `now`, the two calls
    could evaluate a millisecond apart, producing a non-byte-identical
    `TIMESTAMP '...'` literal for Date/Time/Timestamp/TimestampWithTimezone
    columns specifically — a subtle violation of this task's core "preview
    === execution" guarantee that would only surface for that one canonical
    category. Fixed in `planner.ts`'s `runProfileChecks`: a single `now =
    new Date()` is computed once per profiled column pair and passed
    explicitly to both the `buildProfileQueries` preview call and the
    `profileColumn` execution call, guaranteeing identical `now` and
    therefore an identical `TIMESTAMP` literal. This is called out
    separately here (not folded in silently) since it is exactly the class
    of drift risk the brief's central correctness property is about, even
    though it was caught and fixed rather than left as a residual gap.
  - `queriesUsed` is omitted (not an empty array) when no check that issues
    SQL ran — this includes the Layer-1 connectivity-failure short-circuit
    path (`buildFailedResult`) and a run where every check is disabled.
    This was a judgment call (documented inline in `result.ts`'s doc
    comment) rather than an explicit brief instruction, since the brief
    does not specify empty-vs-omitted for the "no SQL issued" case;
    "optional" was read as license to omit rather than force an empty
    array, consistent with `ComparisonResult`'s existing sparse-optional-
    field pattern elsewhere (e.g. `AggregateDifference.tolerance`).
  - The webview's "Query Preview" section renders queries as a flat ordered
    list with no per-check grouping (e.g. no "Schema" vs "Profile" vs
    "Volume" sub-headings distinguishing which check issued which query).
    The brief's Interfaces table describes the section only as rendering
    "the SQL that was used to produce the displayed result" without
    specifying a grouped-by-check-type layout, and `queriesUsed` itself is
    a flat `string[]` per the brief's own interface contract — a flat
    ordered list was the smallest-scope rendering consistent with that flat
    shape. A future task could group by check type if a grouped view is
    wanted, but that would require either a richer `queriesUsed` shape
    (e.g. `{checkType, sql}[]`) — a `result.ts` change beyond what this
    brief authorizes — or is left as an open, non-blocking scope note here.
  - The `runComparison`/`runProfileChecks` refactor calls `buildProfileQueries`
    a second time (in addition to the query execution itself) purely to
    collect preview strings — this is intentional (`buildProfileQueries` is
    pure/no I/O, so calling it twice costs a small amount of string-building
    CPU, not an extra query) and matches the brief's explicit framing of
    these functions as "pure functions, no I/O" safe to call for preview
    purposes independently of execution.
- **Blockers:** None. This task is fixture-only (`FixtureConnector`/DuckDB
  in-process); no WSL/Docker test containers were needed or used.

## Patch or commit identity

- **Commit:** `35767f1` — "T-16b: SQL preview panel (buildRowCountSql/buildProfileQueries/buildFetchAllRowsSql, queriesUsed, webview Query Preview)"
- **Branch:** `task/T-16b-sql-preview` (created off `main` at `8020a07`)
- **Parent commit:** `8020a07` ("T-16b: activate — SQL preview panel deferred from T-16")

## Recommended next step

Independent review by a separate `reviewer` subagent instance, per
`TASK-BRIEF.md`'s Handoff section. The reviewer note in the brief
specifically asks the reviewer to: (1) trace each of the three execution
call sites (`countRows`, `profileColumn`'s various metric computations,
`fetchAllRows`) and confirm they call the new builder function rather than
duplicating its string-building logic; (2) construct a column of each
canonical type independently and diff the actual queries issued against
`buildProfileQueries`'s output for that same column, rather than trusting
this report's own equality tests; (3) confirm `renderResultsHtml` still has
zero reachable path to `vscode.workspace`/`SecretStorage`/a connector. This
implementer does not have authority to mark this task complete/approved or
to update `PROGRESS-LEDGER.md` — that is the Lead Orchestrator's
responsibility after independent review.
