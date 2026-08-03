# TASK-BRIEF.md — T-50: hash-comparison column-name-mismatch disclosure

## Objective

Resolve finding **T-20-03** (OPEN, accepted non-blocking, recorded in
`PROGRESS-LEDGER.md`'s Open findings table): `compareByHash`
(`packages/engine/src/comparison-core/hash-comparison/hash-comparison.ts`)
reads the same `options.columns`/`options.keyColumns`/
`options.partitionColumn` name list against both the source and target
fetches (`fetchNormalizedRows`, called once per side with the identical
`fetchColumns` array). When source and target use different column
names for the same logical field (e.g. `sqlserver-customer`'s
`IsActive` vs `IS_ACTIVE`), a name that doesn't exist on one side
currently surfaces as a raw, unhelpful DuckDB/connector binder error
rather than a clear message pointing at the actual problem.

The finding's own recorded text (verbatim, from `PROGRESS-LEDGER.md`):

> `compareByHash` reads the same column-name list against both source
> and target fetches, so it cannot be used when source/target use
> different column names for the same logical field ... confirmed via a
> probe that raised a DuckDB binder error. Not a brief violation
> (`HashComparisonOptions` is new/task-owned and the brief doesn't
> require column-name mapping) ... Recommend disclosing as a known
> limitation in a future revision.

## Scope

This task does **not** add column-name-mapping support (that remains
explicitly out of scope, matching T-20's own original brief) — it only
makes the existing limitation visible and diagnosable instead of
surfacing as an opaque driver error.

1. In `hash-comparison.ts`'s `HashComparisonOptions` doc comment (and
   the file's own header comment, which already documents several
   other disclosed design tradeoffs in this same style), add a clear,
   explicit statement of this limitation: `columns`/`keyColumns`/
   `partitionColumn` names are read identically against both source and
   target — there is no per-side name mapping — so source and target
   must use the same column names for every field named in this option
   set. A caller with differently-named columns must alias them at the
   query/view level before calling `compareByHash`, or wait for a
   future task if column-name mapping is ever added.
2. In `fetchNormalizedRows` (or a small new helper called from it),
   after each side's `RecordBatch` is fetched, validate that every name
   in `fetchColumns` actually appears in that batch's `columns` array
   **before** any lookup that would otherwise throw a raw/opaque error.
   On a genuine mismatch, throw a clear, actionable `Error` naming: the
   missing column name(s), which side (source/target) was missing them,
   and a one-line pointer to the limitation (e.g. "compareByHash
   requires identical column names on both sides; no per-side mapping
   is supported — see HashComparisonOptions's doc comment"). Do not
   silently drop the missing column or attempt to proceed — the point
   is a clear, immediate failure instead of either a driver-level error
   or (worse) a silently wrong hash.
3. Since `fetchNormalizedRows` already receives the connector's actual
   `RecordBatch` (which carries its own `columns: string[]`), this
   validation requires no new connector call (no extra `getSchema`
   round-trip) — it is a pure check against data already fetched. Keep
   it that way; do not add a `getSchema` pre-flight call as part of
   this task.
4. Add a focused test constructing the exact scenario the finding's
   probe found (a fixture/mock connector pair where one side's real
   column name differs from the configured `columns`/`keyColumns` name)
   and confirm `compareByHash` now throws the new clear error message
   (containing the missing column name and which side) rather than
   whatever raw error the underlying connector would otherwise produce.
   Also add/keep a passing-case test confirming identical column names
   on both sides still work exactly as before (no regression to the
   existing, already-passing test suite's behavior).

## Files owned

- `packages/engine/src/comparison-core/hash-comparison/hash-comparison.ts`
- `packages/engine/src/comparison-core/hash-comparison/hash-comparison.test.ts`

## Interfaces consumed

- None new. `RecordBatch`/`DataPlatformConnector` (`@paritylens/shared`,
  read-only, already imported in this file).

## Prohibited changes

- Do not add column-name-mapping support (a `columnMapping`-style
  option translating source names to target names) — that is
  explicitly out of scope per this finding's own recorded text ("Not a
  brief violation... Recommend disclosing as a known limitation," not
  "add mapping support").
- Do not add a `getSchema` pre-flight call — the validation must use
  the already-fetched `RecordBatch.columns`, not a new connector round
  trip.
- Do not change `compareByHash`'s exported signature, `HashComparisonOptions`,
  `HashMismatch`, or `HashComparisonResult`'s field shapes — only the
  doc comment and the new internal validation/error path.
- Do not touch any other comparison-core subdirectory
  (`row-level/`, `profiling/`, `schema-diff/`, `volume/`,
  `normalization/`, `type-mapping/`) — this task is scoped to
  `hash-comparison/` only.

## Red-state evidence required

A focused test reproducing the finding's own scenario: a source/target
column-name mismatch in `options.columns`/`keyColumns`/
`partitionColumn`. Run it against today's unmodified code and confirm
it currently throws *some* error, but not the new clear one (or write
the new assertion first — asserting on the new error message/shape —
and confirm it fails against unmodified code, since the new message
text doesn't exist yet, per this project's standard red/green pattern).

## Green-state evidence required

1. The scoped diff across the 2 owned files.
2. The new test passing: a column-name mismatch now throws a clear,
   actionable error (assert on the message content — missing column
   name(s) and side).
3. Every pre-existing `hash-comparison.test.ts` test still passing
   unchanged (identical-column-name cases are unaffected by this
   change).
4. A full fresh `npm run verify` passing with no regression versus the
   current baseline.

## Handoff

- Write `IMPLEMENTATION-REPORT.md` using
  `multi-agent-idea-to-app/templates/IMPLEMENTATION-REPORT.md`.
- Commit on branch `task/T-50-hash-comparison-column-mismatch-disclosure`.
- Recommend independent review as the next step.
- Reviewer should specifically re-verify: (1) the new error message is
  genuinely clear and actionable (names the missing column(s) and
  side, not just "column not found"); (2) no `getSchema` call was
  added; (3) every pre-existing passing test in this file still passes
  unchanged; (4) no column-name-mapping capability was accidentally
  added (this task documents/errors on the gap, it does not close it);
  (5) a fresh full `npm run verify` is green.
