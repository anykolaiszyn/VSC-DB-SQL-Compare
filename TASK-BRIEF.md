# TASK-BRIEF.md — T-38: Pre-execution SQL preview + confirmation

## Objective

`DESIGN-SPEC.md` states "generated SQL is shown to the user for preview
before execution" as a security/safety requirement. Today,
`paritylens.runComparison` does not honor this: it shows a single
passive `showInformationMessage` toast (whichever real connections are
in play) and immediately calls `runComparison`, executing real queries
against real databases with no preview and no way to cancel.

This task closes that gap in two pieces:

1. A new, pure, engine-side `planQueries(definition, connectors, baseDir?)`
   function that builds the exact same SQL strings `runComparison` would
   execute, **without executing any of them** (no `executeQuery` calls) —
   a "dry run" of query construction.
2. Extending `paritylens.runComparison`'s command flow to call
   `planQueries()` first, show the resulting SQL list in a blocking
   confirmation webview panel (Run / Cancel), and only call the existing,
   unmodified `runComparison()` if the user clicks Run.

See `docs/superpowers/specs/2026-08-02-comparison-authoring-ui-design.md`
("Pre-execution SQL preview" section) for the full design context.

**Scope clarification made before this brief, disclosed here**: "zero
execution" means zero `executeQuery` calls — the actual comparison
queries (row-count SQL, row-level fetch SQL, profile-metric SQL) are
never run. It does **not** mean zero connector contact: building an
accurate profile-check query preview requires knowing each column's
type, which requires a `getSchema()` call (schema introspection, not a
data-fetching query) exactly the way `runComparison` itself already does
before building profile queries (see `planner.ts`'s `runComparison`,
lines ~244-248). `planQueries` may call `getSchema()`; it must never call
`executeQuery()`.

## Scope

1. **`planQueries(definition, connectors, baseDir?): Promise<string[]>`**
   in a new file `packages/engine/src/orchestration/planner/planQueries.ts`.
   Read `runComparison`'s current implementation in `planner.ts` in full
   first — this function must mirror its query-building logic exactly
   (same gating on `definition.checks.*.enabled`, same `resolveSideInput`
   calls, same builder functions: `buildProfileQueries`, `buildRowCountSql`,
   `buildFetchAllRowsSql`), so the preview can never drift from what a
   real run would execute. Concretely, for each enabled check:
   - `checks.schema.enabled` or `checks.profile.enabled`: resolve both
     sides via `resolveSideInput`, call `source.getSchema`/
     `target.getSchema` (needed for `checks.profile` specifically, to get
     column types; also needed if you determine `checks.schema` alone
     doesn't need query-string collection — confirm and disclose which is
     actually required by reading `runComparison`'s current code, since
     schema *comparison* itself doesn't issue a "query" in the
     `queriesUsed` sense today, only profile does). Only if
     `checks.profile.enabled`: call `buildProfileQueries` for every
     source/target column pair, exactly as `runProfileChecks` does today,
     and append every returned SQL string.
   - `checks.rowCount.enabled`: resolve both sides via `resolveSideInput`,
     call `buildRowCountSql` for both, append both strings.
   - `checks.rowLevel.enabled`: resolve both sides via `resolveSideInput`,
     call `buildFetchAllRowsSql` for both (now `async`, per T-35a), append
     both strings.
   - Return the accumulated list, same order `runComparison`'s own
     `queriesUsed` accumulation would produce (schema/profile first, then
     row-count, then row-level) — this ordering match matters for the
     Handoff note's diff-based verification.
   - **Never call `source.executeQuery`/`target.executeQuery`** anywhere
     in this function, directly or transitively. `getSchema` calls are
     fine (see Objective's scope clarification).
   - Must not throw for a connectivity failure the way `runComparison`
     doesn't either — but since this is a preview-only, no-side-effects
     function, propagating a genuine error (e.g. `getSchema` rejecting)
     is acceptable; document your choice and reasoning either way.

2. **Extend `paritylens.runComparison`'s command flow**
   (`runComparisonCommand` in `activate.ts`) to, after resolving the
   connector registry and before calling `runComparison`:
   - Call `planQueries(definition, registry, baseDir)` (thread through
     whatever `baseDir` value is appropriate — check how T-35a's
     `runComparison` call site in this same file already handles `baseDir`
     today, if at all; if it doesn't pass one yet, that's worth noting and
     resolving consistently with how a real workspace root would be
     determined, mirroring T-33's `resolveRunHistoryRoot` pattern).
   - Show the resulting query list in a **blocking confirmation webview
     panel** (new, `enableScripts: true` since it needs Run/Cancel buttons
     to `postMessage` back — same interactive pattern T-36 established,
     not the read-only `resultsWebview.ts` pattern). Reuse
     `resultsWebview.ts`'s exported `renderQueryPreviewSection` function
     (it already takes a bare `string[]` and renders SQL cards — do not
     reimplement this rendering, import and call it) for the actual SQL
     display; wrap it in your own new pure render function with Run/
     Cancel buttons and the same static-script pattern T-36 uses.
   - **Block**: `runComparisonCommand` must `await` the user's choice
     (via the webview panel's message channel, same pattern T-36's
     Apply-message handling uses) before proceeding. If the user clicks
     Cancel (or closes the panel without choosing), `runComparison` must
     **never** be called, and the command should exit cleanly (no error
     shown — cancellation is not a failure).
   - If the user clicks Run, proceed with the existing,
     completely-unmodified `runComparison(definition, registry, ...)` call
     and the rest of the existing flow (persist run, status bar, results
     webview) exactly as it works today.
   - A `planQueries` failure (e.g. a connectivity/schema-introspection
     error before any confirmation is even shown) should be handled the
     same way this function's existing outer `try`/`catch` handles other
     pre-execution failures — surfaced via `showErrorMessage`, not a
     crash, and `runComparison` never called.

3. **Preserve `runComparison`'s existing signature/behavior completely
   unchanged** — `planQueries` is a new, separate, additive function; this
   is the brief's single most important correctness property, mirroring
   T-38's own Prohibited Changes below.

## Dependencies

- T-08/T-35a (`ParityDefinition`, `resolveSideInput`, `QueryInput`) —
  complete.
- T-09/T-30 (`runComparison`, `ConnectorRegistry` resolution) — complete.
- T-16b (`renderQueryPreviewSection`, exported from `resultsWebview.ts`)
  — complete, this task imports and reuses it directly.
- T-36 (the `enableScripts: true` + `postMessage` interactive-webview
  pattern this task's confirmation panel follows) — complete, read
  `comparisonEditorProvider.ts`/`comparisonEditorHtml.ts` for the
  established pattern before building a divergent one.

## Files owned

- `packages/engine/src/orchestration/planner/planQueries.ts` (new)
- `packages/engine/src/orchestration/planner/planQueries.test.ts` (new)
- `packages/extension/src/activation/activate.ts` (extends T-22/T-30,
  the confirmation step only — no change to how `runComparison` itself is
  called once confirmed, no change to persist/status-bar/results-webview
  logic that already exists after it)
- `packages/extension/src/activation/activate.test.ts` (extends, for the
  new confirmation-flow tests)
- A new file for the confirmation webview's pure render function (e.g.
  `packages/extension/src/webview/runConfirmationWebview.ts` or under
  `activation/` — your call on the exact path/name, keep it consistent
  with this codebase's existing `webview`/`authoring` directory
  conventions; document your choice)

## Prohibited changes

- Do not modify `runComparison`'s exported signature, control flow, or
  behavior in `planner.ts` in any way.
- Do not modify `resultsWebview.ts` beyond importing
  `renderQueryPreviewSection` (it must already be exported — confirm; if
  it isn't, that's the one narrow addition permitted to that file: adding
  an `export` keyword to an existing function, nothing else).
- Do not touch `comparisonEditorProvider.ts`/`comparisonEditorHtml.ts`
  (T-36/T-37's files) — read them for pattern reference only.
- Do not touch `packages/engine/src/comparison-core/**` or any
  connector-sdk file.
- Do not add a way to skip or bypass the confirmation (e.g. a "don't ask
  again" setting) — out of scope; every run goes through confirmation.

## Interfaces consumed / produced

- Consumed (read-only): `resolveSideInput`, `buildProfileQueries`,
  `buildRowCountSql`, `buildFetchAllRowsSql` (all already exported by
  `planner.ts`/`profiling.ts`/`volume.ts`); `renderQueryPreviewSection`
  (`resultsWebview.ts`, T-16b).
- Produced: `planQueries(definition, connectors, baseDir?): Promise<string[]>`
  (exported from the new `planQueries.ts`); a new confirmation-webview
  render function (pure, exported, document its name/signature clearly);
  extended `runComparisonCommand` (same exported name, extended internal
  flow only).

## Red/Green/Full verification evidence required

- **Red**: a test calling `planQueries` against a fixture definition with
  various checks enabled, expecting the returned list to match exactly
  what `runComparison`'s own `queriesUsed` would produce for the same
  definition/connectors, fails today (function doesn't exist). A second
  red-state test: a test running `paritylens.runComparison`'s command
  flow with a mocked "cancel" confirmation response, expecting
  `runComparison` to never be called, fails today (no confirmation step
  exists — `runComparison` is always called immediately).
- **Green**:
  - `planQueries`'s output, compared against `runComparison`'s actual
    `queriesUsed` for the same fixture definition/connectors, matches
    exactly (same strings, same order) — this is the core anti-drift
    guarantee.
  - A test asserting the mocked connectors' `executeQuery` was never
    called during a `planQueries` run (mock-call-count inspection).
  - A test confirming `runComparisonCommand` blocks on a mocked "cancel"
    response and never calls `runComparison` (or the real connector's
    `executeQuery`/`getSchema` beyond what `planQueries` itself needs).
  - A test confirming a mocked "run" response does proceed to call
    `runComparison` and the rest of the existing flow unchanged.
  - A test confirming the confirmation webview's render function is pure
    (same input twice → identical output).
- **Full**: `npm run verify` (typecheck + lint + test) green.

## Handoff note for the reviewer

Please adversarially confirm, independent of the implementation report:

1. **No drift**: diff `planQueries`'s output against `runComparison`'s
   actual `queriesUsed` for at least 2 different fixture definitions
   (varying which checks are enabled) — confirm byte-for-byte string
   equality, not just "similar."
2. **Zero `executeQuery` calls**: grep `planQueries.ts` and everything it
   transitively calls for any `executeQuery` invocation; confirm via a
   mock call-count assertion of your own construction, not just the
   implementer's test.
3. **`runComparison` genuinely untouched**: diff `planner.ts` against
   `main` — confirm zero changes.
4. **Cancellation genuinely blocks execution**: construct your own test
   simulating a Cancel response and confirm no connector method beyond
   what `planQueries` itself calls is ever invoked.
5. **Confirmation panel purity/escaping**: confirm the new render
   function is pure and every SQL string interpolated into it (via
   `renderQueryPreviewSection`, reused, or your own wrapper) is properly
   escaped — same standard as every other webview in this codebase.
6. **File-ownership diff**: confirm via `git diff --stat main..<branch>`
   that only the declared files changed, and that any change to
   `resultsWebview.ts` is narrowly an `export` keyword addition if
   needed, nothing else.

## Branch

`task/T-38-plan-queries-preview`
