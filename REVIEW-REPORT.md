# ParityLens — Review Report T-13

## Review independence statement

This review was performed by a separate reviewer instance with no memory
of implementing T-13. Findings below are based on direct inspection of the
actual diff (`git diff main..task/T-13-volume-parity`), the current source
of every changed file, `Idea Prompt.md` section 2, `IMPLEMENTATION-PLAN.md`'s
T-13 row, `TASK-BRIEF.md`, and a fresh run of `npm run verify` performed by
this reviewer. `IMPLEMENTATION-REPORT.md`'s claims were treated as
assertions to verify, not evidence.

## Scope reviewed

Branch `task/T-13-volume-parity`, commits `05eccb5` (activate), `59adc9f`
(implement), `074e1ad` (record commit hash), on top of `main` at `6610ed0`.

Files changed (`git diff main..task/T-13-volume-parity --stat`):

- `packages/engine/src/comparison-core/volume/volume.ts` (new)
- `packages/engine/src/comparison-core/volume/volume.test.ts` (new)
- `packages/shared/src/result.ts` (refines `AggregateDifference`)
- `packages/shared/src/types.test.ts` (mechanical fix for the widened type)
- `IMPLEMENTATION-REPORT.md`

## Findings

### Critical

NONE.

### Important

NONE.

### Minor

| ID | Finding | Evidence | Resolution |
| --- | --- | --- | --- |
| T-13-01 | Tolerance precedence when both `percentage` and `absolute` are supplied is undocumented in `ParityChecks.rowCount.tolerance` (`definition.ts`) and `evaluateTolerance` (`volume.ts:148-157`) silently prefers `percentage`. The implementer disclosed this themselves in the report's "Assumptions" section rather than hiding it. | `volume.ts:148-153`: `if (tolerance?.percentage !== undefined) { ... } if (tolerance?.absolute !== undefined) { ... }` — no validation error, no doc-level statement of precedence anywhere `definition.ts` or its own tests assert on. No test in `volume.test.ts` exercises the both-supplied case. | Not blocking — this is genuinely a `definition.ts`-shape ambiguity T-13 could not resolve without editing T-08's owned file, which the brief prohibits. Track as a note for whichever task (T-08 revision or T-15) formalizes precedence or adds a validation rule against supplying both. Self-disclosed, not discovered by adversarial probing. |

## Verification performed

### Fresh `npm run verify` (this reviewer's own run, on `task/T-13-volume-parity`)

```
 Test Files  16 passed (16)
      Tests  339 passed (339)
```
Exit code: `0`. Matches `IMPLEMENTATION-REPORT.md`'s claimed 16 files / 339
tests / exit 0 exactly (334 pre-existing + 5 new volume tests, no
regressions).

### Independent re-derivation of the worked-example arithmetic (scrutinized hardest, per the brief's Handoff note)

Computed independently (not copied from the report or the test file):

```
difference = 12,402,991 - 12,405,128 = -2,137
rate = -2,137 / 12,405,128 * 100 = -0.01722674687435712...%
rounded to 4 decimal places = -0.0172%
|rate| = 0.01722674... > tolerance 0.0100  ->  True  ->  FAIL
```

This matches `Idea Prompt.md` section 2's worked example (`Source rows:
12,405,128 / Target rows: 12,402,991 / Difference: -2,137 / Difference
rate: -0.0172% / Tolerance: 0.0100% / Result: FAIL`) exactly, and matches
the implementer's report and `volume.test.ts`'s
`toBeCloseTo(-0.0172267, 6)` assertion. `difference = targetCount -
sourceCount` (sign convention: target below source -> negative), matching
the worked example's sign. No discrepancy found.

### `AggregateDifference` refinement additivity (scrutinized hardest, item b)

`git diff main..task/T-13-volume-parity -- packages/shared/src/result.ts`
shows only the `AggregateDifference` hunk changed — replacing `export type
AggregateDifference = DifferenceItem;` with a full interface extending
`DifferenceItem` (`sourceCount`, `targetCount`, `difference`,
`differenceRate`, optional `tolerance`). `SchemaDifference`,
`ProfileDifference`, and `RowDifference` do not appear anywhere in the
diff hunk — confirmed byte-for-byte unchanged by inspecting the diff
context lines directly (the `RowDifference` placeholder line immediately
following `AggregateDifference` in the file is present in the diff only as
unchanged trailing context). This is a purely additive, non-breaking
refinement consistent with the pattern `SchemaDifference` (T-06) and
`ProfileDifference` (T-07) established.

The only other file touched as a consequence is
`packages/shared/src/types.test.ts`, where one pre-existing test literal
gained four new required numeric fields to satisfy the now-widened
interface (`TS2739` would otherwise fire). This is a minimal, mechanically
forced consequence of the authorized `result.ts` change, not scope
expansion — no assertions were altered, only the object literal's shape.

### Scope-creep check (scrutinized hardest, item c)

Searched `volume.ts` and `volume.test.ts` for any distinct-key-count,
duplicate-key-count, null-key-count, count-by-partition/date/segment, or
min/max-key logic. None found — all occurrences of "distinct" in
`volume.ts` are inside doc comments explicitly listing what was *excluded*
(lines 10-15, 48, 85, 88). `compareVolume`'s only executed query is
`SELECT COUNT(*) AS row_count FROM <objectRef>` (`volume.ts:188`) — a
single scalar total row count, nothing else. `IMPLEMENTATION-PLAN.md`'s
literal T-13 row text does say "row count, distinct count, duplicate/null
key counts, tolerance evaluation," which is broader than what was built —
but `TASK-BRIEF.md`'s Prohibited Changes section explicitly quotes and
narrows that same plan-row language down to "row count with tolerance
evaluation only," and the brief is the authoritative scope document per
`AGENTS.md`. The implementer followed the brief, not a loose reading of
the plan row, and flagged the narrowing explicitly in both the code
comment and the report. No scope creep found.

### File-ownership / prohibited-changes check

- `git diff main..task/T-13-volume-parity -- packages/engine/src/orchestration/` -> empty. No planner or definition.ts changes.
- `git diff main..task/T-13-volume-parity -- packages/shared/src/connector.ts` -> empty. No new method added to `DataPlatformConnector`.
- `git diff main..task/T-13-volume-parity -- packages/engine/src/comparison-core/profiling/profiling.ts` -> empty. T-07's owned file untouched.
- `git diff main..task/T-13-volume-parity -- packages/extension/` -> empty. Engine-only, as required.
- All changed files fall within `packages/engine/src/comparison-core/volume/**` (declared ownership), the one authorized `result.ts` refinement, and the mechanically-forced `types.test.ts` fix (called out explicitly in the report, consistent with the brief's anticipated-mechanical-edit allowance).

### Connector-interaction pattern check (item 4)

Compared `volume.ts`'s `resolveObjectReference`/`countRows` against
`profiling.ts`'s `resolveObjectReference`/query-execution pattern
(`profiling.ts:369-401`). Both independently reimplement the same shape:
`quoteIdentifier` for `{ kind: "table" }`, a wrapped subquery for `{ kind:
"query" }`, and iteration over `connector.executeQuery(...)`'s
`AsyncIterable<RecordBatch>`. No shared import between the two files (as
required, since `profiling.ts` is T-07's owned file) — `volume.ts`
reimplements the pattern locally rather than importing it, exactly as the
brief instructed ("model your query-execution pattern on it ... but do
not import from or edit it"). `FixtureConnector.executeQuery` calls
`assertReadOnlyStatement` internally (`fixture-connector.ts:188`), so
`compareVolume`'s generated `SELECT COUNT(*) ...` SQL is routed through
the existing read-only defense-in-depth control automatically — no
mutating statement is possible through this path, and no new bypass was
introduced.

### Adversarial probing

- Attempted to identify a case where `evaluateTolerance` could be tricked
  into a false PASS: `Math.abs(differenceRate) > tolerance.percentage`
  and `Math.abs(difference) > tolerance.absolute` are both strict
  inequalities using `Math.abs`, so sign is neutralized correctly on both
  branches (a target *higher* than source is treated symmetrically with
  target *lower* than source) — verified against `differenceRate`'s
  computed sign in the worked-example test (negative) and confirmed the
  logic is sign-agnostic by inspection, no asymmetric bug found.
- `differenceRate` div-by-zero guard (`sourceCount === 0 ? 0 : ...`,
  `volume.ts:129`) was checked: if `sourceCount === 0` and
  `targetCount > 0`, `differenceRate` reports `0` (misleading in
  isolation) but `difference` is still nonzero, and `evaluateTolerance`'s
  percentage branch would then compare `0` against the configured
  tolerance and always pass — a real latent gap for an empty-source/
  populated-target case under percentage tolerance specifically.
  Investigated further: with no tolerance configured (the default/
  no-tolerance path), `difference !== 0` still correctly fails, and
  `severity` is independently gated on `difference === 0` (not
  `differenceRate`), so `severity` is not silently masked to `"Pass"` —
  only a percentage-tolerance FAIL could theoretically be missed in this
  one edge case. Not classified Important because: (a) it requires a
  specific unlikely configuration (percentage tolerance across an empty
  source table) not central to the tool's primary use case, (b) `severity`
  still correctly reports `"Informational"` rather than `"Pass"` when
  `difference !== 0` even in this case (the finding is downgraded from
  Failure to Informational, not silently eliminated — the user still sees
  a nonzero-difference finding), and (c) this is an edge case within a
  documented, brief-endorsed judgment call rather than an unflagged
  omission. Recorded here as an observation for future hardening rather
  than a blocking finding; no test currently exercises it.
- Confirmed `buildMessage`'s tolerance-description branch is consistent
  with `evaluateTolerance`'s precedence (percentage checked first in
  both), so the human-readable message cannot describe a different
  tolerance mode than the one actually evaluated.

### Prior findings disposition

No prior open finding in `PROGRESS-LEDGER.md` is scoped to this task (only
`T-12-01` exists as a task-ID-prefixed finding at the time of this review;
no `T-13-*` findings existed before this review). This review introduces
one new Minor finding, `T-13-01`, and does not close any pre-existing
finding.

## Disposition of the omitted-tolerance judgment call (item 5)

The brief explicitly instructed: "When `tolerance` is omitted, treat as
exact-equality (any nonzero difference fails) — document this judgment
call explicitly in the report ... do not guess silently."
`evaluateTolerance`'s final branch (`volume.ts:155-156`, `return
difference !== 0`) implements exactly this. It is documented in three
places: the `compareVolume` doc comment (`volume.ts:81-100`), the
implementation report's Judgment Calls section (#1), and exercised by a
dedicated test (`volume.test.ts:108-119`, "treats an omitted tolerance as
exact equality"). This satisfies the brief's requirement — the call is
reasonable (documented as "the safer default for a parity tool" rather
than silently defaulting to informational-only/never-fails) and is not a
silent assumption.

## Final disposition

**APPROVED.**

Rationale: fresh verification matches the implementer's claims exactly
(339/339 tests, exit 0). The worked-example arithmetic was independently
re-derived from raw inputs and matches both the idea doc and the
implementation. `AggregateDifference`'s refinement in `result.ts` is
confirmed purely additive with no changes to `SchemaDifference`,
`ProfileDifference`, or `RowDifference`. No scope creep beyond row-count
comparison was found in the actual diff, despite the plan row's broader
literal wording — the brief's explicit narrowing was followed and
documented. No edits exist to `orchestration/**`, `definition.ts`, or
`connector.ts`; the connector-interaction pattern correctly mirrors
`profiling.ts` without importing from it, and generated SQL is routed
through the existing `assertReadOnlyStatement` control. One Minor finding
(`T-13-01`, undocumented tolerance precedence when both `percentage` and
`absolute` are supplied) is self-disclosed by the implementer, narrow in
impact, and does not block approval — it is recorded for future-task
follow-up (T-08 revision or T-15).
