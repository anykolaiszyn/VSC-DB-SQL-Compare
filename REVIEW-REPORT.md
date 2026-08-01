# ParityLens — Review Report T-16b

## Review independence statement

This review was performed by a separate reviewer agent instance from the
implementer who authored commit `35767f1`/`84f8e38`. Findings below are
based on my own reading of the actual diff and source files, my own
independently-constructed adversarial/probing tests (written fresh, not
reused from the implementer's test files, and deleted after use — see
Verification performed), and my own fresh run of `npm run verify`. The
implementation report's claims were treated as assertions to verify, not
as facts.

## Scope reviewed

- Branch `task/T-16b-sql-preview`, commits `35767f1` (implementation) and
  `84f8e38` (report), diffed against `main` at `8020a07`.
- `TASK-BRIEF.md` (T-16b) and `IMPLEMENTATION-REPORT.md` read in full.
- All 9 changed files read in full:
  `packages/engine/src/comparison-core/volume/volume.ts` (+ test),
  `packages/engine/src/comparison-core/profiling/profiling.ts` (+ test),
  `packages/engine/src/orchestration/planner/planner.ts` (+ test),
  `packages/extension/src/webview/resultsWebview.ts` (+ test),
  `packages/shared/src/result.ts`.

## Scope / ownership check

`git diff --name-only main task/T-16b-sql-preview` returns exactly:

```
IMPLEMENTATION-REPORT.md
packages/engine/src/comparison-core/profiling/profiling.test.ts
packages/engine/src/comparison-core/profiling/profiling.ts
packages/engine/src/comparison-core/volume/volume.test.ts
packages/engine/src/comparison-core/volume/volume.ts
packages/engine/src/orchestration/planner/planner.test.ts
packages/engine/src/orchestration/planner/planner.ts
packages/extension/src/webview/resultsWebview.test.ts
packages/extension/src/webview/resultsWebview.ts
packages/shared/src/result.ts
```

This matches the brief's "Files owned" section exactly (three engine
source files + their sibling test files, the webview file + its test
file, and `result.ts`). No file under `packages/engine/src/connector-sdk/
safety/**`, `type-mapping/**`, `fixture/**`, `sqlserver/**`, or
`postgres/**` was touched — confirmed by absence from the diff list above.
No unauthorized scope expansion found.

## Central correctness property: preview SQL === executed SQL

Traced all three execution call sites directly in source, not from the
report's description:

- **`volume.ts`**: `countRows` (line 199) calls `buildRowCountSql(connector,
  input)` directly and executes the returned string — no separate string
  construction. `buildRowCountSql` (line 188) is the single source of the
  `SELECT COUNT(*) ...` string.
- **`profiling.ts`**: every one of `profileColumn`'s internal query-issuing
  call sites (`buildGeneralMetricsSql`, `computeMostCommonValue` via
  `buildMostCommonValueSql`, `computeStringMetrics` via
  `buildStringMetricsSql`/`buildStringPopulatedCountSql`,
  `computeNumericMetrics` via `buildNumericMetricsSql`,
  `computeDateMetrics` via `buildDateEarliestLatestSql`/
  `buildDateFutureCountSql`, `computeBooleanMetrics` via
  `buildBooleanMetricsSql`) sources its SQL from exactly one small pure
  `build*Sql` helper (lines 340-401). `buildProfileQueries` (line 413)
  composes the *same* helper functions in the *same* type-dispatch order
  (lines 421-446) that `profileColumn`'s own dispatch uses (lines
  183-204). This is genuinely one code path, not two templates that look
  alike.
- **`planner.ts`**: `fetchAllRows` (line 317) calls
  `buildFetchAllRowsSql(connector, side)` directly and executes the
  returned string.

**Independent construction/diff test (brief's explicit ask, item 1):** I
wrote my own throwaway test (not derived from the implementer's test file)
that constructs one `ColumnDefinition` of each canonical family — String,
Decimal (Numeric), Timestamp (Date-family), Boolean — against the real
`sqlserver-customer` fixture, spies on `FixtureConnector.executeQuery`,
runs `profileColumn`, and asserts the captured SQL array equals
`buildProfileQueries`'s output for the same column/options. All four
categories passed byte-for-byte on first correct run (after fixing my own
column-name typos against the fixture schema — not an implementation
issue). The test file was deleted after use; `git status --short` is
clean.

**`now`-pinning fix (item 2):** Verified in `profiling.ts`, both
`profileColumn` (line 198: `options.now ?? new Date()`) and
`buildProfileQueries` (line 440: `options.now ?? new Date()`) still
independently default `now` when the caller omits it — the *function-level*
fallback logic was not removed, as expected (removing it would break
callers that legitimately want "now" semantics). The actual fix is at the
call site: `planner.ts`'s `runProfileChecks` (lines 394-401) computes `now
= new Date()` exactly once per column pair and builds `sourceProfileOptions`/
`targetProfileOptions` objects containing that single `now`, then passes
those same objects to both `buildProfileQueries` (lines 399-400) and
`profileColumn` (lines 403-404). I grepped every call site of
`profileColumn`/`buildProfileQueries` in non-test source across
`packages/` and confirmed `planner.ts` is the only non-test caller — so
there is no remaining place in the shipped code where preview and
execution `now` values could diverge. The disclosed risk is real and the
fix is real.

## `packages/shared/src/result.ts` diff

`git diff main -- packages/shared/src/result.ts` shows a single additive
hunk appending `queriesUsed?: string[]` (with doc comment) after the
existing `execution: ExecutionTiming;` field. No line touching
`SchemaDifference`, `ProfileDifference`, `AggregateDifference`, or
`RowDifference` appears in the diff — confirmed byte-for-byte unchanged as
claimed.

## Webview XSS / purity check (item 4)

`renderQueryPreviewSection` (resultsWebview.ts line 194) routes every
`queriesUsed` entry through the same `escapeHtml` function used by every
other rendered field in the file — no separate/weaker escaping path.

I wrote and ran (then deleted) my own adversarial test, independent of the
implementer's `<script>alert(1)</script>` case, using a more aggressive
payload designed to test HTML-context breakout and double-escape bypass:

```
SELECT * FROM t WHERE name = '</pre></ol><script>document.location=...
</script><img src=x onerror=alert(1)>'
```

Result: `<script>`, `</pre></ol>`, and `onerror=alert(1)>` all rendered
fully escaped (`&lt;script&gt;`, `&lt;/pre&gt;&lt;/ol&gt;`, etc.), and a
second probe with a raw `&` confirmed no double-unescape path exists
(`&` becomes `&amp;`, not silently passed through). Both probes passed.

Confirmed `resultsWebview.ts` has exactly one `vscode` reference —
`import type * as vscode from "vscode";` (type-only, line 1) — unchanged
from before this task. `renderResultsHtml` and `renderQueryPreviewSection`
have no reachable path to `vscode.workspace`, `SecretStorage`, or a
connector; `queriesUsed` is consumed only as already-materialized strings
from `ComparisonResult`, never reconstructed from `QueryInput`/
`ColumnDefinition` (grepped the webview file for any such construction —
none found), matching the brief's explicit prohibition and T-11/T-16's
established contract.

## Fresh verification performed

Ran independently on the `task/T-16b-sql-preview` branch, in the working
tree at commit `84f8e38`:

```
npm run verify
...
 Test Files  18 passed | 2 skipped (20)
      Tests  368 passed | 27 skipped (395)
```

Exit code 0. This matches the implementation report's claimed 368
passed/27 skipped (395 total) exactly. The baseline-before-task figure in
the report (359 passed/27 skipped, 386 total) was not independently
re-verified against `main` directly (not necessary to confirm this task's
own delta, and `main`'s tests are out of this task's scope), but the
post-task total is independently confirmed correct.

No WSL/Docker containers were needed; the two skipped test files
(`postgresConnector.test.ts`, `sqlServerConnector.test.ts`) skip for the
documented reason (integration env vars not set), consistent with this
task being fixture-only.

## Prior findings

No prior open finding was assigned to this task for resolution (T-16b is
a new gap-closing task following T-16's deferral, not a fix to a
previously-reviewed defect). Nothing to reconcile here.

## Findings

### Critical

NONE.

### Important

NONE.

### Minor

- **T-16b-01 — Query Preview section has no per-check grouping.** The
  webview renders `queriesUsed` as a flat ordered `<ol>` with no
  indication of which check (schema/profile/volume/row-level) or which
  side (source/target) issued which query. This is disclosed candidly in
  the implementation report's "Assumptions and risks" section, and is
  consistent with the brief's Interfaces table, which describes
  `queriesUsed` itself as a flat `string[]` and the section only as
  rendering "the SQL that was used to produce the displayed result"
  without a grouping requirement. Not a defect against the brief as
  written — flagged here only as a real, if minor, usability gap a future
  task could address (would require widening `queriesUsed`'s shape, which
  is out of this task's authorized `result.ts` edit). Non-blocking.

- **T-16b-02 — `runProfileChecks` calls `buildProfileQueries` a second
  time purely for preview collection**, i.e. once per column per side for
  preview strings, once again inside `profileColumn`'s own internal
  dispatch to build the same strings for execution. This is intentional
  and disclosed (the builder functions are pure/no I/O, so this costs
  string-building CPU only, not an extra query) and is explicitly framed
  by the brief itself as an acceptable pattern ("Pure function, no I/O").
  Noted only as a design tradeoff worth being aware of if a very large
  comparison run (many columns) is profiled and this doubling shows up in
  practice; not a correctness issue.

Neither Minor finding blocks approval.

## Disposition

**APPROVED.**

The central correctness property this task exists to deliver — previewed
SQL and executed SQL are provably the same string from the same code
path, not two independently-maintained templates — is genuinely true in
the shipped code, verified by tracing all three call sites myself and by
an independent spy-based diff test across all four canonical type
families (String, Numeric, Date-family, Boolean), not just re-running the
implementer's own tests. The disclosed `now`-pinning fix is real and
complete; no remaining independent-evaluation path exists in shipped
non-test code. Scope is exactly the brief's declared ownership, with no
prohibited files touched and `SchemaDifference`/`ProfileDifference`/
`AggregateDifference`/`RowDifference` confirmed byte-for-byte unchanged.
Webview escaping holds against adversarial payloads beyond what the
implementer's own tests covered, and the webview's purity/no-`vscode`-
reachable-path contract from T-11/T-16 is preserved. Fresh `npm run
verify` independently reproduces the claimed 368 passed/27 skipped (395
total), exit 0. Two Minor, non-blocking findings are recorded above for
future-task awareness only.

No throwaway test/script files were left behind — `git status --short` on
the branch is clean apart from this report.
