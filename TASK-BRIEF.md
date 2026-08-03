# TASK-BRIEF.md — T-49: `planQueries` unreachable-connection disambiguation

## Objective

Resolve finding **T-38-01** (OPEN, accepted non-blocking, recorded in
`PROGRESS-LEDGER.md`'s Open findings table): `planQueries`'s Layer-1
`testConnection()` gate short-circuits to an empty query list (`[]`)
both when a connection is genuinely unreachable AND when a definition
legitimately produces zero queries (e.g. all checks disabled) — the
pre-execution confirmation panel (`runConfirmationWebview.ts`) currently
renders the exact same "no queries" empty state for both, giving the
user no signal that something is actually wrong before they click Run.

The finding's own recorded text (verbatim, from `PROGRESS-LEDGER.md`):

> `planQueries`'s Layer-1-gated empty-list return (when a connection is
> genuinely unreachable) is visually indistinguishable, in the
> confirmation panel, from a definition that legitimately produces zero
> queries ... Confirmed by the reviewer's own adversarial connector test
> to be a UX gap only: the real `runComparison` call, if the user clicks
> Run anyway, still correctly reports `status: "failed"` for the
> genuinely-unreachable case — no correctness or security impact, no
> silently-wrong result reaches the user.

Recorded candidate resolution: surface a distinguishing "connection
could not be reached" message in the confirmation panel itself, rather
than a bare empty-queries state.

**Confirmed directly before writing this brief**:
`planQueries(definition, connectors, baseDir?)`
(`packages/engine/src/orchestration/planner/planQueries.ts`) currently
returns `Promise<string[]>`. Its Layer-1 gate (lines ~137-160) already
computes `sourceConnectResult`/`targetConnectResult` via
`testConnection()` before returning `[]` on failure — the connectivity
information already exists at the exact point the ambiguous empty
array is returned; it is simply discarded today. `runComparisonCommand`
(`packages/extension/src/activation/activate.ts`, ~line 374-375) calls
`planQueries` and passes the result straight to
`deps.confirmRun(plannedQueries)`
(`confirmRun?: (queries: string[]) => Promise<boolean>`, line ~314).
The real `confirmRun` implementation (`createWebviewConfirmRun`, ~line
518-552) sets `panel.webview.html = renderRunConfirmationHtml(queries)`.
`renderRunConfirmationHtml(queries: string[])`
(`packages/extension/src/webview/runConfirmationWebview.ts`) is a pure
function rendering the query list and Run/Cancel buttons.

## Scope

This is a signature-widening change threading a connectivity-failure
signal from `planQueries` through to the confirmation panel's rendered
HTML. Work through it in this order:

1. **`planQueries.ts`**: widen the return type from `Promise<string[]>`
   to a small result shape distinguishing the three real outcomes:
   queries were built (possibly empty, because the definition legitimately
   has none enabled) vs. a connectivity failure occurred. A reasonable
   shape (your call on exact naming, document it):
   ```ts
   export interface PlanQueriesResult {
     queries: string[];
     /** True when either side's testConnection() failed — Layer 1 short-circuited before any query was built. */
     connectionUnreachable: boolean;
   }
   ```
   Update the Layer-1 gate to return
   `{ queries: [], connectionUnreachable: true }` instead of bare `[]`,
   and the normal path to return
   `{ queries: queriesUsed, connectionUnreachable: false }`. Keep every
   other control-flow/error-propagation behavior in this file byte-for-
   byte unchanged (this file's own extensive header comment documents
   those decisions — do not revisit them, only the return shape at the
   two `return` sites changes).
2. **`activate.ts`**: update `runComparisonCommand`'s local variable
   and `confirmRun`'s signature
   (`confirmRun?: (result: PlanQueriesResult) => Promise<boolean>` or
   equivalent) to carry the new shape through, and update the one call
   site (`deps.confirmRun(plannedQueries)`) accordingly. This is a
   mechanically-forced, in-file change following directly from step 1's
   signature widening — not new scope of its own.
3. **`runConfirmationWebview.ts`**: update `renderRunConfirmationHtml`'s
   signature to accept the new shape (or an additional
   `connectionUnreachable: boolean` parameter — your call on exact
   signature shape, document it) and render a clear, distinct message
   when `connectionUnreachable` is true (e.g. replacing or
   supplementing the current "ParityLens will issue N queries..." notice
   with something like "One or both connections could not be reached —
   review your connection settings, or click Run to see the full
   failure detail" — exact wording is your call, keep it accurate and
   non-alarmist since `runComparison`'s own Layer-1 check will still
   produce the authoritative `"failed"`-status result if the user clicks
   Run anyway, per this finding's own confirmed-safe framing). Preserve
   the existing pure-function contract (same input → same output,
   `escapeHtml` coverage for anything dynamic — though the new message
   itself is static text, not dynamic).
4. Update or add focused tests across the 3 touched files' existing test
   files, covering: `planQueries` returning
   `connectionUnreachable: true` for an unreachable-connector case (a
   test double whose `testConnection()` fails) and `false` for both a
   normal case and a legitimately-zero-queries case (all checks
   disabled); `runComparisonCommand`/`confirmRun` plumbing the new shape
   through unchanged otherwise; `renderRunConfirmationHtml` rendering
   the distinguishing message when `connectionUnreachable` is true and
   the original "no queries" empty state when it's false with an empty
   list.

## Files owned

- `packages/engine/src/orchestration/planner/planQueries.ts`
- `packages/engine/src/orchestration/planner/planQueries.test.ts`
- `packages/extension/src/activation/activate.ts` (narrowly: the
  `confirmRun` type/call site and the `plannedQueries` variable's
  mechanically-forced follow-through only — do not touch any other
  logic in this file)
- `packages/extension/src/activation/activate.test.ts`
- `packages/extension/src/webview/runConfirmationWebview.ts`
- `packages/extension/src/webview/runConfirmationWebview.test.ts`

## Interfaces consumed

- `planner.ts`'s existing `testConnection()`-based Layer-1 pattern
  (read-only reference — do not touch `planner.ts` itself).

## Prohibited changes

- Do not touch `packages/engine/src/orchestration/planner/planner.ts`
  — `runComparison`'s own Layer-1 short-circuit and `ComparisonResult`
  construction are out of scope and must stay byte-for-byte unchanged.
- Do not change any error-propagation behavior `planQueries.ts`'s
  header comment already documents (e.g. a genuine `getSchema`
  rejection past the Layer-1 gate must still propagate as it does
  today) — only the two `return` statements' shape changes.
- Do not touch `resultsWebview.ts` — unrelated to this finding.
- Do not add any new `vscode` API surface usage to
  `runConfirmationWebview.ts` — it must remain a pure function exactly
  as it is today, just with a richer input.

## Red-state evidence required

A focused test on `planQueries` demonstrating the current gap: with an
unreachable-connector double, confirm today's unmodified `planQueries`
returns a bare `[]` indistinguishable from a legitimately-zero-queries
case — or write the new `connectionUnreachable`-asserting test first,
confirm it fails against unmodified code (since `[]` has no such
property at all, the type itself won't compile until the shape change
lands — document this as this task's natural red-state form, per this
project's standard red/green pattern applied to a type-level change).

## Green-state evidence required

1. The scoped diff across the 6 owned files.
2. Focused tests passing: `planQueries` distinguishing
   connectivity-failure from legitimately-zero-queries; `activate.ts`'s
   plumbing unchanged in behavior otherwise; the confirmation panel
   rendering the distinguishing message correctly.
3. A full fresh `npm run verify` passing with no regression versus the
   current baseline.

## Handoff

- Write `IMPLEMENTATION-REPORT.md` using
  `multi-agent-idea-to-app/templates/IMPLEMENTATION-REPORT.md`.
- Commit on branch `task/T-49-planqueries-unreachable-disambiguation`.
- Recommend independent review as the next step.
- Reviewer should specifically re-verify: (1) a genuinely
  legitimately-zero-queries definition (all checks disabled, reachable
  connections) still renders the original empty-state message, not the
  new connectivity-failure one — construct this exact adversarial case
  directly; (2) an unreachable-connection case renders the new
  distinguishing message; (3) `planner.ts` has zero diff; (4) no
  `getSchema`/other-error propagation behavior changed past the Layer-1
  gate; (5) a fresh full `npm run verify` is green.
