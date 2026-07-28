# ParityLens — Implementation Report T-07

## Status and objective

- **Status:** COMPLETE
- **Objective:** Implement column profiling: `profileColumn` (general +
  string/numeric/date-timestamp/boolean-family metrics for one column,
  computed via read-only SQL against a `DataPlatformConnector`) and
  `compareProfiles` (source-vs-target profile comparison surfacing only
  meaningful changes — distinct-count change, null-percentage change beyond
  a documented threshold, most-common-value change, and new/missing
  categorical values — per `Idea Prompt.md`'s Layer 4 STATUS worked
  example), and refine `ProfileDifference` in `packages/shared/src/result.ts`.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/engine/src/comparison-core/profiling/profiling.ts` | New. `profileColumn`, `compareProfiles`, `ColumnProfile` and its metric-family sub-shapes (`StringMetrics`, `NumericMetrics`, `DateMetrics`, `BooleanMetrics`), `ProfileOptions`. | T-07's produced interfaces per `TASK-BRIEF.md`. |
| `packages/engine/src/comparison-core/profiling/profiling.test.ts` | New. Red-state evidence plus green-state coverage: one real-fixture `profileColumn` test per metric family (String, Timestamp, Decimal/numeric, Boolean), plus five `compareProfiles` tests (most-common-value change, new/missing categorical values, null-percentage threshold, no-change case). | Test-first process required by `AGENTS.md`/`TASK-BRIEF.md`. |
| `packages/shared/src/result.ts` | Refined `ProfileDifference` from the `DifferenceItem` alias into a real shape: `columnName`, `metric` (`ProfileDifferenceMetric` union), `sourceValue?`, `targetValue?`, extending `DifferenceItem` (`severity`, `message`). | T-07 is the designated owner of this specific shape, per `IMPLEMENTATION-PLAN.md`'s T-07 row and the same pattern T-06 used for `SchemaDifference`. `SchemaDifference`, `AggregateDifference`, `RowDifference`, and `Severity` left untouched. |
| `packages/shared/src/types.test.ts` | One-line fix: the pre-existing `ComparisonResult` construction test (around line 221) built a bare `{ severity, message }` `ProfileDifference` literal, which no longer type-checks now that `ProfileDifference` requires `columnName`/`metric`. Updated the literal to include both (`columnName: "STATUS"`, `metric: "distinctCount"`), mirroring how T-06 already updated the same test's `schemaDifferences` literal for `SchemaDifference`. No behavioral change — the test's assertions are unchanged. | Required so `npm run typecheck` passes after refining `ProfileDifference`; this is the direct, expected consequence of narrowing a previously-placeholder shared type, the same situation T-06's task brief anticipated for `SchemaDifference`. |

No other file was modified. `packages/engine/src/comparison-core/type-mapping/**`, `packages/engine/src/comparison-core/schema-diff/**`, and `packages/engine/src/connector-sdk/**` were read (consumed) but not changed. `PROGRESS-LEDGER.md` was not touched.

## Behavior and interfaces

- **Behavior delivered:**
  - `profileColumn(connector, column, options)` always computes general
    metrics (row count, populated count, null count, null percentage,
    distinct count, duplicate count) via a `COUNT(*)`/`COUNT(col)`/
    `COUNT(DISTINCT col)` aggregate query, plus a most-common-value lookup
    (`GROUP BY ... ORDER BY COUNT(*) DESC LIMIT 1`), all executed through
    `connector.executeQuery`, which — for `FixtureConnector` and every real
    connector per T-03/T-17-19 — routes through T-03's
    `assertReadOnlyStatement` automatically, so profiling never bypasses the
    read-only safety gate.
  - It then branches by `column.canonicalType` (falling back to
    `mapNativeType(column.nativeType, "duckdb")` only if `canonicalType` is
    somehow absent — defensive fallback for hand-built test inputs, not the
    normal path):
    - **String**: `emptyStringCount`, `whitespaceOnlyCount`, `minLength`,
      `maxLength`, `avgLength`, `uppercaseCount`, `lowercaseCount`,
      `mixedCaseCount`.
    - **Integer / Decimal / FloatingPoint**: `min`, `max`, `mean`,
      `zeroCount`, `negativeCount`, `positiveCount`.
    - **Date / Time / Timestamp / TimestampWithTimezone**: `earliest`,
      `latest`, `futureDateCount` (relative to `options.now`, defaulting to
      `new Date()`, overridable for deterministic tests).
    - **Boolean**: `countByValue`, `percentageByValue`, `cardinality`, plus
      `distinctValues` on the profile itself (used by `compareProfiles` for
      new/missing-value detection).
    - **Unknown / every other category**: general metrics only, no
      family-specific block populated.
  - `compareProfiles(source, target)` returns `ProfileDifference[]`
    containing only findings for meaningful changes:
    - `distinctCount`: any change (severity `Informational`).
    - `nullPercentage`: only when `|source - target| >= 0.5` percentage
      points (severity `Warning`) — see "Deliberately omitted / thresholds"
      below.
    - `mostCommonValue`: any change (severity `Warning`).
    - `newTargetValue` / `missingTargetValue`: one finding per value present
      in `distinctValues` on only one side (severity `Warning` each).
    - Two identical profiles produce `[]` (verified by a dedicated test) —
      confirms this is a targeted diff, not a side-by-side dump.
- **Interfaces consumed:** `DataPlatformConnector.executeQuery`/`quoteIdentifier` (T-02/T-04), `ColumnDefinition` (T-02), `mapNativeType` (T-05, used defensively only), `FixtureConnector` + `sqlserver-customer`/`postgres-products` fixtures (T-04).
- **Interfaces produced:** `profileColumn`, `compareProfiles`, `ColumnProfile` (and `StringMetrics`/`NumericMetrics`/`DateMetrics`/`BooleanMetrics`/`ProfileOptions`) from `packages/engine/src/comparison-core/profiling/profiling.ts`; refined `ProfileDifference` from `packages/shared/src/result.ts`. Both consumed by T-09's orchestration planner per the task brief's interface table.

## Metric families implemented and deliberate omissions

All five general metrics and all four type-family metric groups named in
the task brief are implemented. Two numeric sub-metrics are **deliberately
omitted**, per the task brief's explicit allowance ("median/stddev are
nice-to-have but not required if time-constrained — note if omitted"):

- **Median** and **standard deviation** are not computed for numeric
  columns. Reasoning (documented in `NumericMetrics`'s doc comment in
  `profiling.ts`): median requires a percentile/window-function aggregate
  whose exact syntax and availability differ per platform (`PERCENTILE_CONT`
  vs `MEDIAN` vs none), and standard deviation requires either a second
  query pass or an assumed `STDDEV`/`STDEV` function name — both are exactly
  the kind of per-platform pushdown-optimization decision the task brief
  says is explicitly out of scope for this task ("You do NOT need to
  implement query pushdown optimization — straightforward correct SQL is
  sufficient"). Both remain legitimate follow-up work once a specific
  connector's aggregate-function support is confirmed (T-17/T-18/T-19).
- Everything else in the idea doc's "General profile metrics", "Numeric-
  specific metrics", "Date and timestamp metrics", and "Boolean or
  categorical metrics" lists beyond what the task brief explicitly names
  (e.g. percentile distribution, outlier counts, invalid-date count,
  time-zone offset distribution, unexpected-category detection) was treated
  as out of scope for this task per the task brief's own metric list, which
  is a deliberately narrower subset of the idea doc's full (aspirational)
  catalog.

## Refined `ProfileDifference` shape

```ts
export type ProfileDifferenceMetric =
  | "distinctCount"
  | "nullPercentage"
  | "mostCommonValue"
  | "newTargetValue"
  | "missingTargetValue";

export interface ProfileDifference extends DifferenceItem {
  columnName: string;
  metric: ProfileDifferenceMetric;
  sourceValue?: unknown;
  targetValue?: unknown;
}
```

`sourceValue`/`targetValue` are typed `unknown` (not a discriminated union
keyed on `metric`) because the value shape varies by metric (numbers for
`distinctCount`/`nullPercentage`, strings for the other three) and this
task's consumers (T-09's planner, T-11's webview) only ever render the
values, never branch on their type — a discriminated union was considered
and rejected as unnecessary complexity for that usage. `sourceValue` is
absent on a `newTargetValue` finding (no source-side counterpart);
`targetValue` is absent on a `missingTargetValue` finding, matching how
`SchemaDifference`'s `sourceType`/`targetType` are already optional for the
analogous one-sided cases.

## Hand-counted verification example

Column: `CustomerName`, fixture `sqlserver-customer` / `source` (table
`customer_source`), from `packages/engine/fixtures/sqlserver-customer.ts`:

| CustomerID | CustomerName | length |
| --- | --- | --- |
| 1 | John Smith | 10 |
| 2 | Jane Roe | 8 |
| 3 | Alan Turing | 11 |
| 4 | Grace Hopper | 12 |
| 5 | Ada Lovelace | 12 |
| 6 | Margaret Hamilton | 17 |

Hand-counted expected values:
- `rowCount` = 6, `populatedCount` = 6 (column is `NOT NULL`), `nullCount` = 0, `nullPercentage` = 0
- `distinctCount` = 6 (all six names are distinct strings) → `duplicateCount` = 0
- No empty strings, no whitespace-only strings → `emptyStringCount` = 0, `whitespaceOnlyCount` = 0
- `minLength` = 8 ("Jane Roe"), `maxLength` = 17 ("Margaret Hamilton")
- `avgLength` = (10+8+11+12+12+17) / 6 = 70 / 6 = **11.6666...7 (repeating)**
- Case distribution: every name has mixed case (capitalized first letters, lowercase remainder) → `uppercaseCount` = 0, `lowercaseCount` = 0, `mixedCaseCount` = 6

Computed values (from the actual passing test run,
`packages/engine/src/comparison-core/profiling/profiling.test.ts`, test
"computes general + string metrics for CustomerName..."): `rowCount=6`,
`populatedCount=6`, `nullCount=0`, `nullPercentage=0`, `distinctCount=6`,
`duplicateCount=0`, `stringMetrics.emptyStringCount=0`,
`stringMetrics.whitespaceOnlyCount=0`, `stringMetrics.minLength=8`,
`stringMetrics.maxLength=17`, `stringMetrics.avgLength≈11.666667`,
`stringMetrics.uppercaseCount=0`, `stringMetrics.lowercaseCount=0`,
`stringMetrics.mixedCaseCount=6` — every value matches the hand count
exactly (all assertions pass; see full vitest output in the verification
evidence below).

Two additional real-fixture hand counts (also asserted in
`profiling.test.ts` and passing):

- **`price`** (Decimal, `postgres-products` / `source`, table
  `products_source`): values 9.99, 19.99, 49.99, 14.50, 89.00 (5 rows, all
  populated) → `min`=9.99, `max`=89.00, `mean`=(9.99+19.99+49.99+14.50+89.00)/5
  = 183.47/5 = **36.694**, `zeroCount`=0, `negativeCount`=0,
  `positiveCount`=5.
- **`in_stock`** (Boolean, `postgres-products` / `source`): values true,
  true, false, true, true (5 rows) → `true` count = 4 (80%), `false` count =
  1 (20%), `cardinality`=2.
- **`CreatedDate`** (Timestamp, `sqlserver-customer` / `source`): 6
  populated values, all in January 2024 → `futureDateCount`=0 relative to
  a fixed `now` of 2026-07-27; `earliest` contains "2024-01-05",
  `latest` contains "2024-01-10".

**Reviewer note per `TASK-BRIEF.md`:** please independently re-derive at
least one of these counts directly from
`packages/engine/fixtures/sqlserver-customer.ts` or
`packages/engine/fixtures/postgres-products.ts` (do not trust this report's
arithmetic) before approving.

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Red state | `npx vitest run packages/engine/src/comparison-core/profiling` | 1 failed suite: `Error: Failed to load url ./profiling.js ... Does the file exist?` (module did not exist yet) | Captured directly in this session's transcript before implementation began |
| Focused green state | `npx vitest run packages/engine/src/comparison-core/profiling` | `Test Files 1 passed (1)`, `Tests 8 passed (8)` | Session transcript |
| Focused green state (engine) | `npx vitest run packages/engine` | `Test Files 5 passed (5)`, `Tests 237 passed (237)` (229 pre-existing + 8 new) | Session transcript |
| Focused green state (shared) | `npx vitest run packages/shared` | `Test Files 1 passed (1)`, `Tests 11 passed (11)` | Session transcript |
| Full verification | `npm run verify` | Exit 0. `tsc -b --force` clean, `eslint .` clean, `vitest run`: `Test Files 6 passed (6)`, `Tests 248 passed (248)` (240 baseline + 8 new T-07 tests), 0 regressions | Session transcript |

## Assumptions and risks

- **Assumptions:**
  - `column.canonicalType` on the `ColumnDefinition` passed to `profileColumn`
    is trusted as authoritative (consistent with how T-06's schema-diff
    consumes it); `mapNativeType` is called only as a defensive fallback,
    not the primary path.
  - `ProfileOptions.now` (used for `futureDateCount`) defaults to
    `new Date()` at call time; tests supply a fixed `now` for determinism.
    This is a locally-defined `ProfileOptions` in the profiling module,
    distinct from (and not conflicting with) `packages/shared/src/connector.ts`'s
    `ProfileOptions` (which controls `buildProfileQuery`'s
    top-value-count/approximate-distinct pushdown options — a different,
    unrelated interface T-07 does not modify).
  - Null-percentage change threshold (0.5 percentage points) is a documented
    judgment call, not specified by the task brief, chosen to catch
    materially different null rates while ignoring floating-point noise.
- **Risks or limitations:**
  - Median and standard deviation are not computed (see "Deliberate
    omissions" above) — a consumer expecting those fields on
    `NumericMetrics` will not find them; this is documented in the type
    itself, not silently absent.
  - `distinctValues` (used for new/missing-categorical-value detection) is
    only populated for Boolean-category profiles in `profileColumn`'s
    current implementation. It is populated on the `ColumnProfile` type
    generally (not gated to Boolean by the type system), so future callers
    can construct it for other categorical-like String columns (e.g. the
    idea doc's own STATUS example, which is a String column with low
    cardinality) — `compareProfiles` already handles that case correctly
    (exercised by the STATUS-pattern tests), it is only `profileColumn`'s
    automatic population that is currently Boolean-only. Extending
    `profileColumn` to also populate `distinctValues` for low-cardinality
    String columns is reasonable follow-up scope, not attempted here to
    avoid an unbounded-cardinality query risk on arbitrary String columns.
  - SQL generated for string/date metrics uses DuckDB-compatible syntax
    (`LENGTH`, `TRIM`, `TIMESTAMP '...'` literals) verified only against
    `FixtureConnector`; real-platform connectors (T-17/T-18/T-19, not yet
    implemented) may require dialect-specific adjustments when they land —
    consistent with the task brief's "straightforward correct SQL is
    sufficient... no pushdown optimization" scope.
- **Blockers:** None.

## Patch or commit identity

- **Commit:** created in the same commit as this report (see `git log` on
  branch `task/T-07-profiling`); parent commit
  `e1e778a89df747c161328187f0509be44c75443c`.
- **Branch:** `task/T-07-profiling`

## Recommended next step

Independent review by a separate Claude Code subagent instance (per
`TASK-BRIEF.md`'s Handoff section), distinct from this implementer. The
reviewer must independently hand-verify at least one profile's counts
directly against `packages/engine/fixtures/sqlserver-customer.ts` or
`packages/engine/fixtures/postgres-products.ts` — not trust this report's
arithmetic — before approving, and confirm `ProfileDifference`'s refined
shape and `compareProfiles`'s meaningful-change filtering satisfy
`DESIGN-SPEC.md`/`Idea Prompt.md`'s Layer 4 STATUS worked example.
