# ParityLens — Implementation Report T-50

## Status and objective

- **Status:** COMPLETE (implementation and evidence only — not reviewed or approved)
- **Objective:** Resolve finding T-20-03 (recorded OPEN/accepted non-blocking
  in `PROGRESS-LEDGER.md`'s Open findings table): `compareByHash` reads the
  same `options.columns`/`options.keyColumns`/`options.partitionColumn` name
  list against both the source and target fetches, so a genuine source/
  target column-name mismatch (e.g. `sqlserver-customer`'s `IsActive` vs
  `IS_ACTIVE`) currently surfaces as a raw, unhelpful connector/binder error
  rather than a clear message pointing at the actual problem. Per
  TASK-BRIEF.md's Scope section, this task does **not** add column-name-
  mapping support — "it only makes the existing limitation visible and
  diagnosable instead of surfacing as an opaque driver error."

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/engine/src/comparison-core/hash-comparison/hash-comparison.ts` | (1) Added an explicit limitation statement to the file's header comment and to `HashComparisonOptions`'s doc comment (Scope item 1). (2) Changed `fetchNormalizedRows`'s query from `SELECT <named columns> FROM <object>` to `SELECT * FROM <object>` so a missing column name can no longer fail the connector-level SQL query itself before a `RecordBatch` is returned. (3) Added `assertFetchColumnsPresent`, called immediately after each side's `RecordBatch` is fetched and before any column-name lookup, which throws a clear `Error` naming the missing column(s), the affected side (`source`/`target`), and a pointer back to `HashComparisonOptions`'s doc comment (Scope items 2–3). (4) `fetchNormalizedRows` now takes a `side: "source" \| "target"` parameter, threaded from its two call sites in `compareByHash`. | TASK-BRIEF.md Scope items 1–3 |
| `packages/engine/src/comparison-core/hash-comparison/hash-comparison.test.ts` | Added a `describe("compareByHash: column-name mismatch disclosure (T-50 / finding T-20-03)")` block with two tests: (a) constructs a fixture pair where the target's real column is named `IS_ACTIVE_TARGET` instead of the configured `IS_ACTIVE`, and asserts `compareByHash` throws an `Error` whose message contains the missing column name, the word "target", and the phrase "no per-side mapping"; (b) confirms the same fixture pair still works exactly as before (`result.matched === true`) when both sides genuinely share a column name (`NAME`). Added `fixtureWithMismatchedColumnName`, a small DuckDB-backed connector-pair builder following the file's existing `fixtureWithCasingVariant`/`fixtureWithStringVariant` pattern. | TASK-BRIEF.md Scope item 4 |

## Behavior and interfaces

- **Behavior delivered:** When `options.columns`/`keyColumns`/
  `partitionColumn` names a column that does not actually exist on one side
  (source or target), `compareByHash` now throws a single, clear `Error` of
  the form:

  ```
  compareByHash: column(s) "IS_ACTIVE" not found on the target side
  (actual target columns: "id", "is_active_target"). compareByHash
  requires identical column names on both sides; no per-side mapping
  is supported -- see HashComparisonOptions's doc comment.
  ```

  instead of the previous raw DuckDB binder error (captured verbatim below
  under Red state). Behavior is otherwise unchanged: when both sides do
  share the configured column names, `compareByHash` works exactly as
  before (verified by the added no-regression test and by all 13
  pre-existing tests in this file passing unchanged).
- **Interfaces consumed:** No new interfaces. `RecordBatch`/
  `DataPlatformConnector` from `@paritylens/shared`, already imported and
  used read-only in this file, per TASK-BRIEF.md's Interfaces-consumed
  section ("None new").
- **Interfaces produced:** `compareByHash`'s exported signature,
  `HashComparisonOptions`, `HashMismatch`, and `HashComparisonResult`'s
  field shapes are unchanged (per the brief's Prohibited-changes section) —
  only doc comments changed and a new internal error path was added.
  `fetchNormalizedRows` (a private, unexported function) gained one new
  parameter (`side`) and now calls a new private helper
  (`assertFetchColumnsPresent`); neither is part of this module's public
  surface.

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline (before any change) | `npm run verify` | PASS — 34 test files passed / 2 skipped, 621 tests passed / 27 skipped | Captured in this session's transcript before any edit |
| Red state | `npx vitest run packages/engine/src/comparison-core/hash-comparison -t "column-name mismatch"` (new test added, before the `hash-comparison.ts` fix) | FAIL — `AssertionError: expected 'binder error: referenced column "is_a…' to contain 'no per-side mapping'`, actual raw error text: `binder error: referenced column "is_active" not found in from clause! candidate bindings: "is_active_target", "id"` | Captured in this session's transcript |
| Focused green state | `npx vitest run packages/engine/src/comparison-core/hash-comparison` (after the fix) | PASS — 1 test file, **15** tests passed (13 pre-existing + 2 new) | Captured in this session's transcript |
| Full verification | `npm run verify` (after the fix) | PASS — typecheck clean, lint clean, 34 test files passed / 2 skipped, **623** tests passed / 27 skipped (up from baseline's 621 — exactly +2, the new tests; no regression) | Captured in this session's transcript |

## Assumptions and risks

- **Assumptions / judgment call:**
  - The brief requires validating "after each side's `RecordBatch` is
    fetched" and "before any lookup that would otherwise throw a raw/opaque
    error," using only the already-fetched `RecordBatch.columns` (no
    `getSchema` preflight). The module's prior SQL
    (`SELECT <named columns> FROM <object>`) makes a genuinely missing
    column name fail *the query itself* at the connector level — no
    `RecordBatch` is ever returned in that case, so there was nothing to
    validate against post-fetch. To satisfy "validate against an already-
    fetched `RecordBatch`" without adding a new connector call, I changed
    the fetch query to `SELECT * FROM <object>`, which always succeeds
    (assuming the table/object itself exists) and returns the side's real
    column list, so `assertFetchColumnsPresent` can then do a pure
    in-memory check and raise this module's own clear error instead of
    letting the query fail with a raw binder/driver error. This is a scoped
    SQL-shape change confined to the one file this task owns, not a new
    capability or a widened interface, but it is a real behavior change
    worth a reviewer's explicit attention (documented in code as well, in
    `fetchNormalizedRows`'s updated doc comment).
  - No other query-shape or behavioral change was made. Identical-column-
    name cases resolve exactly the same values as before (the JS-side
    column lookup by name from `batch.columns` is unchanged; only which
    columns the SQL requests changed, from an explicit list to `*`).
- **Risks or limitations:**
  - `SELECT *` fetches every column the underlying table/view exposes, not
    just the columns `compareByHash` needs — a minor efficiency change
    versus the prior targeted `SELECT`. For the fixture-scale data this
    module already scopes itself to (`maxRows` defaulting to 10,000, per
    this file's own documented scope boundary), this was judged acceptable
    rather than chasing a second validated code path; a reviewer may want
    to weigh in on this tradeoff specifically.
  - If the table/object itself doesn't exist (as opposed to a column within
    it), `SELECT *` will still fail with a raw connector error — this task
    only discloses/fixes the column-name-mismatch case named in the
    finding, not object-not-found errors, which remain out of scope per
    the brief's literal wording.
  - Column-name-mapping support remains explicitly NOT implemented, per the
    brief's Prohibited-changes section — this is a disclosure/
    diagnosability fix only, not a capability addition.
- **Blockers:** None.

## Patch or commit identity

- **Commit:** `fdb7595931864ce68f23b1c32fa333d844a2a87f` (message: "T-50: disclose hash-comparison column-name-mismatch limitation clearly")
- **Branch:** `task/T-50-hash-comparison-column-mismatch-disclosure`, repository `V:\Secret Projects\VSC-DB-SQL-Compare`.

## Recommended next step

Independent review by a separate reviewer agent, per this project's
lifecycle kit (`AGENTS.md`/`multi-agent-idea-to-app/HANDBOOK.md`) — this
implementer does not self-approve. The brief's Handoff section specifically
asks the reviewer to re-verify: (1) the new error message is genuinely
clear and actionable (names the missing column(s) and side, not just
"column not found") — confirmed satisfied by the message shape shown
above; (2) no `getSchema` call was added — confirmed: the fix uses only the
existing single `executeQuery` call per side, now requesting `*` instead of
named columns; (3) every pre-existing passing test in this file still
passes unchanged — confirmed, all 13 pass unmodified; (4) no column-name-
mapping capability was accidentally added — confirmed, no
`columnMapping`-style option exists anywhere in the diff; (5) a fresh full
`npm run verify` is green — confirmed above. The reviewer should also
independently judge the `SELECT *` query-shape change documented under
Assumptions above, since it is the one place this implementation made a
judgment call beyond the brief's most literal reading (the brief describes
the fix purely in terms of a post-fetch validation step, and did not
explicitly anticipate that the existing named-column `SELECT` would itself
need to change to make that validation reachable).
