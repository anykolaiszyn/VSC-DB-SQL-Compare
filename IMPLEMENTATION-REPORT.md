# ParityLens — Implementation Report T-13

## Status and objective

- **Status:** COMPLETE (implementation and evidence only — not reviewed or approved; see Recommended next step)
- **Objective:** Per `TASK-BRIEF.md`'s Objective section: "Implement volume
  parity per `Idea Prompt.md` section 2 ("Layer 3: Volume Parity") and
  section 12 ("Severity and Tolerance Model"): compare total row count ...
  between source and target, evaluate the difference against a configured
  tolerance (exact equality / absolute / percentage / informational only),
  and classify the result per the severity model." Scoped per
  `IMPLEMENTATION-PLAN.md`'s T-13 row (quoted in the brief's Prohibited
  Changes section) to "row count with tolerance evaluation only" —
  distinct-key-count, duplicate-key-count, null-key-count, count-by-
  partition/date/segment, and min/max-key are explicitly NOT implemented.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/engine/src/comparison-core/volume/volume.ts` | New file. `compareVolume(source, target, sourceInput, targetInput, tolerance?)` implementation. | Brief's "Files owned": `packages/engine/src/comparison-core/volume/**`. |
| `packages/engine/src/comparison-core/volume/volume.test.ts` | New file. Red-state-then-green-state test suite (5 tests). | Brief's Red-state evidence + Green-state sections. |
| `packages/shared/src/result.ts` | Refined `AggregateDifference` from `export type AggregateDifference = DifferenceItem;` (placeholder alias, line 126) into a real interface extending `DifferenceItem` with `sourceCount`, `targetCount`, `difference`, `differenceRate`, `tolerance?`. | Brief's Interfaces table: "This is the ONE place `packages/shared/src/result.ts` may be edited by this task — refine `AggregateDifference` from the placeholder alias into a real interface." `SchemaDifference`/`ProfileDifference`/`RowDifference` were not touched. |
| `packages/shared/src/types.test.ts` | Updated one existing test literal (`aggregateDifferences: [{ severity: "Failure", message: "sum(order_amount) differs" }]`) to satisfy the now-required `AggregateDifference` fields. | **Not in this task's declared file ownership** (`packages/engine/src/comparison-core/volume/**` only) — called out separately per the brief's own anticipated-mechanical-edit rule ("If satisfying the brief mechanically forces a small edit outside the literal file list ... make the minimal such edit, and call it out explicitly"). This was a pre-existing test literal in `packages/shared/src/types.test.ts` that constructed a `ComparisonResult` with an `aggregateDifferences` entry using only `severity`/`message`; after widening `AggregateDifference` (a change the brief explicitly authorized), TypeScript's structural check on that literal failed with `TS2739: Type '{ severity: "Failure"; message: string; }' is missing the following properties from type 'AggregateDifference': sourceCount, targetCount, difference, differenceRate`. The minimal fix was adding four numeric literal fields (`sourceCount: 100, targetCount: 90, difference: -10, differenceRate: -10`) to that one test object; no assertions or other test content were changed. |

## Behavior and interfaces

- **Behavior delivered:** `compareVolume` executes `SELECT COUNT(*) FROM <objectRef>` against both `source` and `target` connectors (concurrently, via `Promise.all`), computes `difference = targetCount - sourceCount` and `differenceRate = (difference / sourceCount) * 100` (0 when `sourceCount === 0`), evaluates the difference against an optional `tolerance: { percentage?: number; absolute?: number }`, and returns a `VolumeDifference` (= `AggregateDifference`) with `severity` set to `"Pass"` (difference is exactly 0), `"Failure"` (nonzero and outside tolerance), or `"Informational"` (nonzero but within tolerance).
- **Interfaces consumed:**
  - `DataPlatformConnector` (`packages/shared/src/connector.ts`) — `executeQuery`, `quoteIdentifier` only, per the brief's Interfaces table; no new method added to this shared interface.
  - `QueryInput`, `ExecutionOptions` (`packages/shared/src/types.ts`) — read-only.
  - `ParityChecks.rowCount.tolerance` shape (`packages/engine/src/orchestration/definition/definition.ts:85-91`) — consumed structurally only. `definition.ts` was not imported from or edited; `compareVolume` declares its own local `VolumeTolerance` interface (`{ percentage?: number; absolute?: number }`) that is structurally identical, so T-15 (which does depend on both `definition.ts` and this module when wiring `compareVolume` into the planner) can pass `ParityChecks.rowCount.tolerance` straight through without a cast.
- **Interfaces produced:**
  - `compareVolume(source: DataPlatformConnector, target: DataPlatformConnector, sourceInput: QueryInput, targetInput: QueryInput, tolerance?: VolumeTolerance): Promise<VolumeDifference>` — exact exported signature in `packages/engine/src/comparison-core/volume/volume.ts`.
  - `VolumeTolerance` — `{ percentage?: number; absolute?: number }`, exported from `volume.ts`.
  - `VolumeDifference` — exported type alias for `AggregateDifference`, exported from `volume.ts` for call-site readability (per that file's doc comment).
  - `AggregateDifference` (`packages/shared/src/result.ts`) — refined interface: `extends DifferenceItem { sourceCount: number; targetCount: number; difference: number; differenceRate: number; tolerance?: { percentage?: number; absolute?: number } }`.

## Judgment calls (flagged per the brief's explicit instruction not to guess silently)

1. **Omitted-tolerance semantics.** The brief's Interfaces table states: "When `tolerance` is omitted, treat as exact-equality (any nonzero difference fails) — document this judgment call explicitly in the report since the idea doc lists 'informational comparison only' as a distinct mode this type doesn't cleanly express." Implemented exactly as instructed: `evaluateTolerance` returns `difference !== 0` when neither `tolerance.percentage` nor `tolerance.absolute` is supplied. `ParityChecks.rowCount.tolerance` (`definition.ts:85-91`) has no field distinguishing "informational only" from "no tolerance configured" — both would arrive at `compareVolume` as `tolerance: undefined`. Rather than invent an out-of-band sentinel or edit `definition.ts` (T-08's owned file, out of scope), an omitted tolerance is treated as the strictest mode (exact equality), not the loosest (informational-only / never-fails), reasoned as the safer default for a parity tool. This is documented in `volume.ts`'s doc comment on `compareVolume` and flagged here as a residual gap: expressing "informational comparison only" as its own explicit mode would require a `definition.ts` change, which is outside T-13's file ownership.
2. **Severity for a nonzero, within-tolerance difference.** Not explicitly specified by the brief. Chose `"Informational"` (not `"Warning"` or `"Pass"`) on the reasoning that a nonzero-but-tolerated difference is real signal worth surfacing (consistent with how T-07's `compareProfiles` uses `"Informational"` for a `distinctCount` change that isn't inherently a defect), but by definition satisfies the user's configured tolerance, so it should not read as `"Warning"`-level urgency. `"Pass"` is reserved for the difference being exactly 0.
3. **Message format.** Not specified by the brief beyond "at minimum: `severity` and `message`." `buildMessage` produces a human-readable one-line summary including locale-formatted counts, the difference, the rate to 4 decimal places, the tolerance description, and an explicit `PASS`/`FAIL` outcome word — modeled for eventual webview/log display (T-16 consumes this).
4. **`countRows`'s row-count extraction.** `executeQuery` batches are consumed generically (find `"row_count"` by column name, falling back to index 0) rather than assuming a fixed column position, mirroring defensive patterns already used elsewhere in the codebase (e.g. `profiling.ts`'s `runSingleRowQuery`/`runQuery` helpers, which this task could not import from since `profiling.ts` is T-07's owned file — the equivalent logic was reimplemented locally in `volume.ts`, same as `resolveObjectReference` was).

## Explicitly out of scope (per Prohibited Changes)

Per `TASK-BRIEF.md`'s Prohibited Changes section, this implementation does **not** include: distinct-key-count, duplicate-key-count, null-key-count, count-by-partition/date/segment, or min/max-key comparisons. Only total row count with tolerance evaluation was implemented. `compareVolume` was also **not** wired into `packages/engine/src/orchestration/planner/**` (explicitly T-15's job) and `packages/engine/src/orchestration/definition/definition.ts` was not modified (T-08's owned file, consumed read-only via a structurally-equivalent local type).

## Verification evidence

### Baseline (before any change)

Command: `npm run verify` — confirmed green before starting: 15 test files, 334 tests passed, exit 0 (typecheck, lint, and test all passed in sequence).

### Red state

Command: `npx vitest run packages/engine/src/comparison-core/volume`

Exit code: `1`

Captured output (relevant excerpt):

```
 ❯ packages/engine/src/comparison-core/volume/volume.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  packages/engine/src/comparison-core/volume/volume.test.ts [ packages/engine/src/comparison-core/volume/volume.test.ts ]
Error: Failed to load url ./volume.js (resolved id: ./volume.js) in V:/Secret Projects/VSC-DB-SQL-Compare/packages/engine/src/comparison-core/volume/volume.test.ts. Does the file exist?
 ❯ loadAndTransform ../../Secret%20Projects/VSC-DB-SQL-Compare/node_modules/vite/dist/node/chunks/dep-BK3b2jBa.js:51969:17

 Test Files  1 failed (1)
      Tests  no tests
```

This matches the brief's predicted failure reason exactly: "Module resolution failure — the directory doesn't exist yet under `packages/engine/src/comparison-core/`."

### Focused green state

Command: `npx vitest run packages/engine/src/comparison-core/volume`

Exit code: `0`

Captured output:

```
 ✓ packages/engine/src/comparison-core/volume/volume.test.ts (5 tests) 129ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
```

The 5 tests, matching the brief's Green-state requirements:
1. Reproduces `Idea Prompt.md` section 2's worked example literally (source 12,405,128 / target 12,402,991 / percentage tolerance 0.01 / `FAIL`).
2. An in-tolerance percentage case (`PASS`/non-failing).
3. An absolute-tolerance case, both within and exceeding tolerance.
4. Omitted-tolerance exact-equality behavior (both a matching and a mismatched pair).
5. An exactly-equal pair with a tolerance supplied, confirming `severity === "Pass"`.

**Worked-example arithmetic, shown for independent verification** (per `AGENTS.md`'s "never fabricate ... arithmetic" rule and the brief's note to the reviewer):
- `difference = 12,402,991 − 12,405,128 = −2,137` ✓ matches idea doc.
- `differenceRate = −2,137 / 12,405,128 × 100 = −0.0172267468...%`. The idea doc displays this rounded to `-0.0172%`. The test asserts `toBeCloseTo(-0.0172267, 6)` against the unrounded computed value (not a re-assertion of the rounded display string), independently computed via `python3 -c "print((12402991-12405128)/12405128*100)"` → `-0.01722674687435712`, which rounds to `-0.0172%` at 4 decimal places, matching the idea doc.
- `tolerance.percentage = 0.01` (i.e. 0.0100%). `abs(-0.01722674...) > 0.01` → `True` → `FAIL`. Matches idea doc's `Result: FAIL`.

### Full verification

Command: `npm run verify`

Exit code: `0`

Captured output (tail):

```
> paritylens@0.0.1 verify
> npm run typecheck && npm run lint && npm run test

> paritylens@0.0.1 typecheck
> tsc -b --force

> paritylens@0.0.1 lint
> eslint .

> paritylens@0.0.1 test
> vitest run

 ✓ packages/shared/src/types.test.ts (11 tests) 5ms
 ✓ packages/engine/src/comparison-core/type-mapping/type-mapping.test.ts (69 tests) 14ms
 ✓ packages/engine/src/connector-sdk/safety/statement-safety.test.ts (109 tests) 28ms
 ✓ packages/engine/src/comparison-core/normalization/normalization.test.ts (24 tests) 38ms
 ✓ packages/engine/src/comparison-core/mapping/mapping.test.ts (12 tests) 10ms
 ✓ packages/extension/src/webview/resultsWebview.test.ts (2 tests) 4ms
 ✓ packages/extension/src/secrets/secretStore.test.ts (3 tests) 9ms
 ✓ packages/extension/src/views/parityTreeDataProvider.test.ts (5 tests) 7ms
 ✓ packages/extension/src/activation/activate.test.ts (3 tests) 9ms
 ✓ packages/engine/src/orchestration/definition/definition.test.ts (30 tests) 67ms
 ✓ packages/extension/src/statusbar/parityStatusBar.test.ts (2 tests) 3ms
 ✓ packages/engine/src/comparison-core/schema-diff/schema-diff.test.ts (11 tests) 59ms
 ✓ packages/engine/src/comparison-core/profiling/profiling.test.ts (9 tests) 156ms
 ✓ packages/engine/src/comparison-core/volume/volume.test.ts (5 tests) 152ms
 ✓ packages/engine/src/orchestration/planner/planner.test.ts (4 tests) 212ms
 ✓ packages/engine/src/connector-sdk/fixture/fixture-connector.test.ts (40 tests) 905ms

 Test Files  16 passed (16)
      Tests  339 passed (339)
```

334 previously-passing tests + 5 new volume tests = 339, no regressions. `npm run verify` (typecheck → lint → test, in that order) exits 0.

## Assumptions and risks

- **Assumptions:**
  - The literal-count test fixtures use DuckDB's `generate_series(0, count - 1)` table function (via `{ kind: "query" }` input) to produce inputs whose row count is exactly a specified literal (e.g. exactly 12,405,128 rows), rather than relying on the small seeded fixture tables (`sqlserver-customer` etc. have only a handful of rows each, per `profiling.test.ts`'s own comments) — this was necessary to reproduce the idea doc's specific literal numbers exactly. This exercises the identical `executeQuery`/`assertReadOnlyStatement`/DuckDB code path a real connector or seeded-table input would use; only the SQL source differs, not the code path under test.
  - `ParityChecks.rowCount.tolerance`'s two fields (`percentage`, `absolute`) are assumed mutually exclusive in practice (per the brief's Interfaces table listing them as alternative tolerance modes); `evaluateTolerance` checks `percentage` first, falling back to `absolute` only if `percentage` is `undefined`. If a caller supplies both, `percentage` silently wins — this is not explicitly specified by the brief or `definition.ts`, and is a minor undocumented-precedence risk a reviewer may want to flag or a future task may want to make an explicit validation error.
- **Risks or limitations:**
  - "Informational comparison only" (one of the four tolerance modes `Idea Prompt.md` section 2 names) has no explicit representation in `ParityChecks.rowCount.tolerance` and is not distinctly implementable without a `definition.ts` change — see Judgment call #1 above. This is a known, documented gap, not a silent omission.
  - `compareVolume` is not wired into the planner (`runComparison`) — by design, per the brief (T-15's job). It cannot be exercised end-to-end through a `ParityDefinition` yet.
  - Concurrent tolerance precedence (percentage-over-absolute when both supplied) is an undocumented assumption, noted above.
- **Blockers:** None.

## Patch or commit identity

- **Branch:** `task/T-13-volume-parity`
- **Commit:** `59adc9f6cfbb176144de770c8c240897ed6b4cc0` — "T-13: implement volume parity (compareVolume, AggregateDifference refinement)".

## Recommended next step

Independent review by the `reviewer` subagent (a separate instance from this implementer), per `TASK-BRIEF.md`'s Handoff section, writing findings to `REVIEW-REPORT.md`. Per the brief's "Note to reviewer," scrutinize: (a) the percentage-rate arithmetic against the worked example (re-derive independently rather than trusting this report's own arithmetic shown above), (b) whether `AggregateDifference`'s refinement in `result.ts` followed the same additive, non-breaking pattern as `SchemaDifference`/`ProfileDifference` with no changes to sibling shapes, and (c) whether this implementation stayed within row-count-only scope (no distinct/duplicate/null-key, partition, or min/max-key logic was added — confirm against the actual diff, not just this report's characterization). This implementer does not self-approve and recommends no status beyond "implemented with recorded evidence, pending independent review."
