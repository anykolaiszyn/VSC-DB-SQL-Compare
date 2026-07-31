# ParityLens — Implementation Report T-15

## Status and objective

- **Status:** COMPLETE (implementation and evidence only — not reviewed or approved)
- **Objective:** Per `TASK-BRIEF.md`'s Objective section verbatim: "Extend
  the Orchestration API's planner (`runComparison`, T-09's file) to execute
  Phase-2 checks — volume parity (T-13's `compareVolume`) and row-level
  parity (T-14's `compareRows`) — honoring `checks.rowCount.enabled` and
  `checks.rowLevel.enabled` from the parsed `ParityDefinition`, and populate
  `ComparisonResult.rowCounts`, `.aggregateDifferences`, and
  `.rowDifferences` from real results instead of the empty/default
  placeholder values T-09 left in place."

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/engine/src/orchestration/planner/planner.ts` | Added steps 5/6 to `runComparison`: when `checks.rowCount?.enabled === true`, calls T-13's `compareVolume` once per run (passing `definition.checks.rowCount.tolerance` straight through) and populates `rowCounts`/`aggregateDifferences`; when `checks.rowLevel?.enabled === true`, fetches full row data for both sides via a new private `fetchAllRows` helper (bare `SELECT *`, honoring `ParitySide.where` when present) and calls T-14's `compareRows` with `definition.keys`/`.columnMapping`/`.rules`, populating `rowDifferences`. Extended the existing `allFindings` array (consumed by the untouched `summarizeFindings`/`deriveStatus` functions) to include `aggregateDifferences` and `rowDifferences`. Updated the file's header comment to describe the new steps. T-09's Phase-1 behavior (connectivity short-circuit, schema/profile checks, `summarizeFindings`/`deriveStatus` logic itself) is otherwise byte-for-byte unchanged. | `TASK-BRIEF.md` Objective + Interfaces table |
| `packages/engine/src/orchestration/planner/planner.test.ts` | Replaced the old "Phase 1 scope boundary" describe block (which asserted Phase-2 fields stayed empty even when enabled — now obsolete since T-15 makes them act) with four new tests under "Phase 2: row-count checks" and "Phase 2: row-level checks": (1) `checks.row_count.enabled: true` populates `rowCounts`/`aggregateDifferences` from real `compareVolume` results against the `sqlserver-customer` fixture (6 source rows, 7 target rows); (2) `checks.row_count.enabled: false` leaves those fields at the Phase-1 empty default; (3) `checks.row_level.enabled: true` populates `rowDifferences` (asserts a `missing-from-target` finding for the fixture's known missing `CustomerID 4`); (4) `checks.row_level.enabled: false` leaves `rowDifferences` empty. Added three new YAML fixtures (`ROW_COUNT_ONLY_YAML`, `ROW_LEVEL_ONLY_YAML`, `BOTH_DISABLED_YAML`) to isolate each check's enabled/disabled state independently, per the brief's red-state and green-state sections. Existing tests (acceptance-criterion-1, profile checks, connectivity short-circuit) left unmodified. | `TASK-BRIEF.md` Red-state evidence + Green-state and full verification sections |

No file outside `packages/engine/src/orchestration/planner/**` was modified. `comparison-core/volume/**`, `comparison-core/row-level/**`, `comparison-core/mapping/**`, `comparison-core/normalization/**`, `orchestration/definition/definition.ts`, and all four `result.ts` difference shapes were consumed read-only via `import`, exactly as the brief's Files owned / Prohibited changes sections require.

## Behavior and interfaces

- **Behavior delivered:** `runComparison` now executes volume and row-level
  checks when their respective `checks.*.enabled` flags are `true`, and
  leaves the corresponding result fields at T-09's original Phase-1
  defaults when disabled — no query is issued to either connector for a
  disabled check (verified by the four new tests; `ROW_LEVEL_ONLY_YAML`
  disables row-count and its test explicitly asserts `rowCounts` stays
  `{ source: 0, target: 0, difference: 0 }`, and vice versa for
  `ROW_COUNT_ONLY_YAML` asserting `rowDifferences` stays `[]`). Volume and
  row-level findings are folded into the same `allFindings` array that
  feeds `summarizeFindings`/`deriveStatus`, so a Phase-2 finding can flip
  `status` to `"failed"`/`"warning"` and increment `summary.failed`/
  `summary.warnings` exactly as schema/profile findings already do — no
  separate/duplicated status logic was written.
- **Interfaces consumed:**
  - `compareVolume(source, target, sourceInput, targetInput, tolerance?)`
    from `packages/engine/src/comparison-core/volume/volume.ts` (T-13,
    read-only import). Called with `{ kind: "table", object:
    definition.source.object }` / target equivalent and
    `definition.checks.rowCount?.tolerance` passed straight through,
    matching the Interfaces table's exact instruction.
  - `compareRows(sourceRows, targetRows, keys, mapping, rules?, options?)`
    from `packages/engine/src/comparison-core/row-level/row-level.ts`
    (T-14, read-only import). Called with `definition.keys`,
    `definition.columnMapping`, and `definition.rules` after fetching both
    sides' full row data.
  - `ParityDefinition.checks.rowCount`/`.rowLevel`, `.keys`,
    `.columnMapping`, `.rules`, `ParitySide.where` — all from
    `packages/engine/src/orchestration/definition/definition.ts` (T-08,
    read-only).
  - `DataPlatformConnector.executeQuery`/`.quoteIdentifier` (existing
    interface, unchanged) — used by the new `fetchAllRows` helper to issue
    a bare `SELECT * FROM <object> [WHERE <where>]` and consume the
    resulting `AsyncIterable<RecordBatch>` fully into one in-memory
    `RecordBatch`.
- **Interfaces produced:**
  - `ComparisonResult.rowCounts` — populated from
    `VolumeDifference.{sourceCount, targetCount, difference}` when
    row-count checking is enabled; unchanged `{ source: 0, target: 0,
    difference: 0 }` default otherwise.
  - `ComparisonResult.aggregateDifferences` — a single-element array
    `[compareVolume's result]` when row-count checking is enabled; `[]`
    otherwise.
  - `ComparisonResult.rowDifferences` — `compareRows`'s full returned array
    when row-level checking is enabled; `[]` otherwise.
  - No shape in `packages/shared/src/result.ts` was modified — this task
    consumes `AggregateDifference`/`RowDifference`/`SchemaDifference`/
    `ProfileDifference` exactly as already defined.

### T-13-01 (carried-forward finding) resolution

Per the brief: "either resolve the ambiguity explicitly in how you call
`compareVolume` (document which of `percentage`/`absolute` wins when a
definition supplies both, matching whatever `compareVolume`'s own
`evaluateTolerance` already does...) or flag it as still-open." I read
`volume.ts`'s `evaluateTolerance` directly (lines 148–157): it checks
`tolerance?.percentage !== undefined` first and returns based on that
alone if set; `tolerance?.absolute` is only consulted when `percentage` is
`undefined`. So **percentage takes precedence whenever both are
configured**. I documented this precedence rule at the `compareVolume` call
site in `planner.ts` (the comment directly around the call) rather than
re-deriving or overriding it, and pass
`definition.checks.rowCount.tolerance` straight through unchanged, exactly
as the brief instructed. This resolves T-13-01 rather than leaving it open.

### T-14-02 note

Per the brief, T-14-02 was "already resolved inside `compareRows` itself —
no action needed here beyond passing `rules` through so the fallback
actually engages." `runComparison` passes `definition.rules` as
`compareRows`'s `rules` argument, so the existing fallback
(`options.numericTolerance?.[col] ?? rules[col]?.numericTolerance`, inside
`row-level.ts`, unmodified by this task) is reachable end-to-end. No
`RowCompareOptions.numericTolerance` value is passed from the planner in
this task — the brief does not ask for a definition-level "row-level
numeric tolerance override" concept distinct from `rules`, and inventing
one would be scope expansion beyond "integration-only."

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Red state | `npx vitest run packages/engine/src/orchestration/planner` (after adding the new Phase-2 tests, before touching `planner.ts`) | 2 of 7 tests failed for the predicted reason: `expected { source: +0, target: +0, difference: +0 } to deeply equal { source: 6, target: 7, difference: 1 }` (row-count test) and `expected 0 to be greater than 0` on `result.rowDifferences.length` (row-level test); the other 5 tests (including the disabled-check tests, which pass trivially pre-change since nothing runs Phase 2 yet) passed. Test file result: `1 failed`, `2 failed | 5 passed (7)`. | Captured directly from command output during this session |
| Focused green state | `npx vitest run packages/engine/src/orchestration/planner` (after the `planner.ts` change) | `Test Files 1 passed (1)`, `Tests 7 passed (7)`. | Captured directly from command output during this session |
| Full verification | `npm run verify` | `tsc -b --force` clean, `eslint .` clean, `vitest run`: `Test Files 17 passed (17)`, `Tests 350 passed (350)` (347 baseline + 3 net new — 1 old test removed, 4 new tests added). Exit code 0 (confirmed via a separate `echo $?` check after a silent re-run of `npm run verify`). | Captured directly from command output during this session |

## Assumptions and risks

- **Assumptions:**
  - Row-level check's row-fetch query is a bare `SELECT * FROM <object>
    [WHERE <where>]`. The brief's Interfaces table says "build a plain
    `SELECT` over `definition.source.object`/`.target.object`" without
    specifying a column list — I used `SELECT *` rather than enumerating
    `keys` + `columnMapping` columns explicitly, since `compareRows`
    resolves columns from the returned `RecordBatch.columns` regardless of
    which columns are present (see `row-level.ts`'s `resolveColumns`), and
    `SELECT *` is simpler and matches "a plain SELECT" literally. This is a
    judgment call — a narrower column list would also have satisfied the
    interface, but `SELECT *` avoids needing to special-case derived
    mapping entries (`source_expression`) that don't have a plain source
    column name to select.
  - Row cap for the row-level fetch: I introduced
    `DEFAULT_ROW_LEVEL_MAX_ROWS = 1_000_000` (matching the order of
    magnitude of `profiling.ts`'s own `DEFAULT_MAX_ROWS` pattern for
    aggregate queries) and `DEFAULT_ROW_LEVEL_TIMEOUT_MS = 30_000`
    (matching every other query-issuing module in this codebase). The
    brief does not specify a row cap; T-14's own header comment says row
    sets are "assume[d] to fit in memory," so a generous-but-bounded cap
    consistent with the rest of the codebase's pattern seemed like the
    smallest reasonable choice rather than an unbounded fetch.
  - A `compareVolume`/`compareRows` failure (e.g. the underlying query
    throwing) is allowed to propagate and reject the whole `runComparison`
    call, the same as an unhandled exception anywhere else in this
    function already would (schema/profile checks above have identical
    behavior — neither is wrapped in try/catch). This is documented
    in-line at the call site in `planner.ts`. I chose this over silently
    catching and downgrading to an empty result because Layer-1
    connectivity failures are the only case Idea Prompt.md's design
    explicitly frames as "a basic execution status to report" rather than
    an exception; a query failure past that point reads as a genuine run
    failure, not a parity finding to report gracefully. The brief
    explicitly flags this as unspecified and asks the reviewer to judge
    whether the choice is reasonable — I'm flagging it here per that
    instruction, not asserting it's the only correct choice.
- **Risks or limitations:**
  - `fetchAllRows` loads the entire result set into memory as a single
    `RecordBatch` (no streaming/pagination) — this matches T-14's own
    documented scope boundary ("assume both sides fit in memory for now"),
    but is a real limitation for large tables; a future task would need to
    address true streaming row-level comparison.
  - `compareVolume`/`compareRows` failures currently propagate as thrown
    exceptions from `runComparison` rather than being captured as a
    `"failed"`-status `ComparisonResult` the way connectivity failures are.
    Callers of `runComparison` must be prepared to catch/handle a rejected
    promise for a Phase-2 query failure, which is a different failure mode
    than a Phase-1 connectivity failure. Flagged for reviewer judgment per
    the brief's explicit instruction on this point.
- **Blockers:** None.

## Patch or commit identity

- **Patch or commit:** `70e1fa29045269b2539454201818d3bca70fdbad` — "T-15: wire volume and row-level checks into runComparison (Phase 2)"
- **Branch or workspace:** `task/T-15-orchestration-phase2`

## Recommended next step

Independent review by the `reviewer` subagent (a separate instance from
this implementer), per `TASK-BRIEF.md`'s Handoff section — write
`REVIEW-REPORT.md`. This report documents implementation-and-evidence
scope only; it is not a claim of review or approval, and this task should
not be marked complete/approved until that independent review has run,
including the brief's explicitly-requested adversarial spy-connector probe
of the disabled-check no-silent-execution behavior and the
compareVolume/compareRows-failure-propagation judgment call.
