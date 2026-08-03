# TASK-BRIEF.md — T-48: results webview source/target header line

## Objective

Resolve finding **T-34-02** (OPEN, accepted non-blocking cosmetic,
recorded in `PROGRESS-LEDGER.md`'s Open findings table): the results
webview's header meta line omits the `source object → target object`
segment that T-34's own header spec called for (`Run <runId> ·
source→target · duration`) — currently only `Run <runId>` and the
duration render.

The finding's own recorded text (verbatim, from `PROGRESS-LEDGER.md`):

> The results webview's header meta line omits the `source object →
> target object` segment ... small follow-up to add the source/target
> object display — first confirm what `ComparisonResult` field(s)
> actually carry a displayable source/target object name, since none
> was obviously named in the brief's own review.

**This has been confirmed before writing this brief**: `ComparisonResult`
(`packages/shared/src/result.ts`) carries no source/target object-name
field at all today — only `comparison` (the definition's `name`),
`runId`, `status`, etc. The data that *would* produce a display label
lives one layer up, in `ParityDefinition.source`/`.target`
(`ParitySide`, `packages/shared/src/types.ts`), which is a discriminated
union:

```ts
export type QueryInput =
  | { kind: "table"; object: string }
  | { kind: "query"; sql: string }
  | { kind: "sqlFile"; filePath: string };
```

`runComparison` (`packages/engine/src/orchestration/planner/planner.ts`)
already receives the full `ParityDefinition` and constructs the
`ComparisonResult` object directly (`comparison: definition.name`, line
~362 and ~560) — this is the same pattern T-16b already used to
additively widen `ComparisonResult` with `queriesUsed` for an identical
reason (the pure `renderResultsHtml` needed data the original result
shape didn't carry, and the natural, already-available source was
`runComparison`'s own inputs).

## Scope

1. In `packages/shared/src/result.ts`, add two new **optional** fields
   to `ComparisonResult`: `sourceLabel?: string` and
   `targetLabel?: string` — a short, human-readable label for each
   side, for the results webview's header display only. Document (doc
   comment, following this file's existing style) that they are
   optional and derived, not semantically authoritative — a purely
   presentational convenience field, following the same
   pattern/reasoning `queriesUsed`'s own doc comment already
   establishes. This is the one narrowly-scoped exception to this
   project's usual "don't touch `packages/shared/**`" task-brief
   default — explicitly authorized here since it mirrors T-16b's own
   precedent exactly (widen `ComparisonResult`, not any of the
   difference-array shapes, which stay off-limits).
2. In `packages/engine/src/orchestration/planner/planner.ts`, populate
   `sourceLabel`/`targetLabel` when constructing the `ComparisonResult`
   object(s) (there are 2 construction sites — one for a Layer-1
   connectivity-failure short-circuit, one for the full-run result;
   check both). Derive the label from the corresponding `ParitySide`:
   - `kind: "table"` → the `object` string itself (e.g. `"dbo.Customer"`).
   - `kind: "query"` → a short, non-truncating-to-uselessness
     placeholder like `"(custom query)"` (a full SQL string is not a
     sensible header label — your call on exact wording, keep it short
     and clearly not a table name).
   - `kind: "sqlFile"` → the file's base name (e.g.
     `"customers.sql"`, not the full path — avoid leaking a local
     filesystem path into a UI header), or a similarly short label if
     you judge that clearer — your call, document it.
   - The Layer-1 connectivity-failure short-circuit path (which returns
     before any query executes) should still populate these labels if
     `definition.source`/`.target` are available at that point — check
     the actual code before assuming; if genuinely unavailable there,
     document why and leave them `undefined` for that one path only.
3. In `packages/extension/src/webview/resultsWebview.ts`'s
   `renderResultsHtml`, add the `source→target` segment to the header
   `meta-line`, between the existing `Run <runId>` span and the
   duration span, matching the originally-specified format (`Run
   <runId> · source→target · duration`) — only render the segment when
   both `sourceLabel`/`targetLabel` are present (`undefined` for either
   means omit the segment entirely, not render a broken/partial one);
   escape both values through the existing `escapeHtml` helper exactly
   like every other interpolated value in this function.
4. Update or add focused tests: `planner.test.ts` (or the relevant
   existing test file) confirming `sourceLabel`/`targetLabel` are
   populated correctly for at least one case of each `QueryInput` kind,
   and `resultsWebview.test.ts` confirming the header segment renders
   when both labels are present and is correctly omitted when either is
   `undefined`.

## Files owned

- `packages/shared/src/result.ts` (narrowly: add exactly the two new
  optional fields to `ComparisonResult` plus their doc comment — do not
  touch any difference-array shape or any other field)
- `packages/engine/src/orchestration/planner/planner.ts`
- `packages/engine/src/orchestration/planner/planner.test.ts` (or
  wherever `runComparison`'s existing tests actually live — locate the
  real file first)
- `packages/extension/src/webview/resultsWebview.ts`
- `packages/extension/src/webview/resultsWebview.test.ts`

## Interfaces consumed

- `ParitySide`/`QueryInput` (`@paritylens/shared`, read-only).
- `ParityDefinition.source`/`.target`, already available inside
  `runComparison`.

## Prohibited changes

- Do not touch any `DifferenceItem`-derived shape
  (`SchemaDifference`/`ProfileDifference`/`AggregateDifference`/
  `RowDifference`) — those remain owned exclusively by their respective
  originating tasks.
- Do not touch `packages/extension/src/activation/activate.ts` — no
  call-site changes are needed; `runComparison` already receives the
  full `definition` and constructs the result itself.
- Do not make `sourceLabel`/`targetLabel` required fields — every
  existing caller/test constructing a `ComparisonResult` object literal
  must keep compiling unchanged.
- Do not attempt to also fix the `reopenRunCommand`/persisted-run-replay
  path — a run persisted before this change has no `sourceLabel`/
  `targetLabel` in its stored JSON, so `loadRun` naturally returns
  `undefined` for both on old records; this is expected, not a defect,
  and requires no special handling (the header simply omits the segment
  for old runs, per Scope item 3's stated omit-when-absent rule).

## Red-state evidence required

A focused test on `renderResultsHtml` (or `runComparison`) demonstrating
the current gap: construct a `ComparisonResult` with both labels
present (once the type change exists) and confirm today's unmodified
`renderResultsHtml` output does not contain the `source→target` segment
— or, if writing the type-widening first makes a true "before" state
impractical, write the new assertions first, confirm they fail against
unmodified rendering code, per this project's standard red/green
pattern.

## Green-state evidence required

1. The scoped diff across the 5 owned files.
2. Focused tests passing: label derivation for each `QueryInput` kind,
   header segment presence/omission in the rendered HTML.
3. A full fresh `npm run verify` passing with no regression versus the
   current baseline (count will grow by however many new tests this
   task adds).

## Handoff

- Write `IMPLEMENTATION-REPORT.md` using
  `multi-agent-idea-to-app/templates/IMPLEMENTATION-REPORT.md`.
- Commit on branch `task/T-48-results-webview-header-line`.
- Recommend independent review as the next step.
- Reviewer should specifically re-verify: (1) `ComparisonResult`'s
  widening is genuinely additive/optional — no existing test or call
  site needed to change to keep compiling, except where a test is
  specifically asserting on the new fields; (2) no difference-array
  shape was touched; (3) the header segment is correctly omitted (not
  rendered with literal `"undefined"` text) when either label is
  absent, including for the Layer-1 connectivity-failure short-circuit
  path if that path still leaves them unset; (4) `escapeHtml` covers
  both new interpolations; (5) a fresh full `npm run verify` is green.
