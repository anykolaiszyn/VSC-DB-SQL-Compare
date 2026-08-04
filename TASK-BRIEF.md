# TASK-BRIEF.md — T-43: Results webview legend/glossary

## Objective

Add a static legend/glossary to the results webview (`resultsWebview.ts`)
explaining `Severity` values (`Failure`/`Warning`/`Informational`, plus
`Pass`/`Error`/`Skipped` — the full `Severity` union from
`@paritylens/shared`) in plain-language terms, and a short "what this tab
shows and what to do about a finding" caption per tab (Schema/Profile/
Volume/Row-Level). Addresses self-service gap-analysis Finding 7 (results
not actionable for a non-engineer) — explicitly the one item Phase 5's own
Non-goals section named as out of its scope, so this task exists
independently of T-36–T-39.

## Current state (read before starting)

Read `packages/extension/src/webview/resultsWebview.ts` in full before
starting — it is large and has an established purity contract that must not
be broken (see its own header comment). Key facts already confirmed:

- `renderResultsHtml(result: ComparisonResult): string` (line ~633) is the
  pure entry point. It builds a tab strip (`tab-schema`/`tab-profile`/
  `tab-volume`/`tab-rows`/`tab-sql`, lines ~667-679) and 5 corresponding
  `tab-panel` divs (lines ~681-698), using the CSS-only radio-button +
  `:checked` sibling-selector tab-switching technique T-34 established.
  `enableScripts` stays `false` — see `showResultsWebview` and the file's
  own header comment. Do not introduce any JS.
- `severityTagClass(severity: Severity)` (line ~80) maps `Severity` (from
  `@paritylens/shared`) to a CSS class for the colored tag already shown
  next to every finding row. The full `Severity` union (check
  `@paritylens/shared`'s `result.ts` for the authoritative list; do not
  assume it matches only the four values named in the plan row) is what
  actually appears in the UI today — there is no separate, directly
  rendered "Compatible/Review/Risk" label anywhere in this file (that
  `TypeCompatibility` classification, from
  `packages/engine/src/comparison-core/type-mapping/type-mapping.ts`, is an
  internal input that `compareSchemas` folds into a `SchemaDifference`'s
  `severity`/`message` — it is not surfaced as its own literal UI label).
  **Correct the plan row's premise accordingly**: the legend should explain
  the `Severity` values that actually appear as colored tags in the UI
  (confirm the exact union and every value's real meaning by reading
  `result.ts` and `severityTagClass`/`statusTag`), not a `Compatible`/
  `Review`/`Risk` label that isn't rendered. Document this correction in
  `IMPLEMENTATION-REPORT.md`, mirroring how T-40 handled its own premise
  correction.
- `renderSchemaDifferencesTable`/`renderProfileDifferencesTable`/
  `renderAggregateDifferencesTable`/`renderRowDifferencesTable` are the four
  table-renderers behind the Schema/Profile/Volume/Row-Level tabs
  respectively (read each briefly to see what columns/fields it renders,
  so your caption text is accurate to what's actually on that tab).

## Scope

1. Add a static legend/glossary panel. Implementer's call on placement
   within the CSS-only/`enableScripts:false` constraint — e.g. a small
   `<details><summary>What do these mean?</summary>...</details>` block
   near the header or stat band (native disclosure widget, same
   script-free pattern the row-level expand/collapse already uses,
   per this file's header comment), or a persistently visible compact
   block. Content: one short plain-language sentence per `Severity` value
   actually used in the UI (read the real union first), e.g. (illustrative
   only — write accurate final copy against the real enum, and phrase each
   line so a junior analyst unfamiliar with data engineering jargon
   understands what to do next):
   - `Failure` — "A meaningful mismatch was found; investigate before
     trusting these two datasets are equivalent."
   - `Warning` — "A difference exists but may be expected or low-risk;
     review to confirm."
   - `Informational` — "For awareness only; not necessarily a problem."
   - (cover every other real `Severity` value the same way, e.g. `Pass`/
     `Error`/`Skipped` if present in the shared union)
2. Add a short caption (1-2 sentences, plain language) to each of the 4
   check-family tab panels (Schema/Profile/Volume/Row-Level — not the SQL
   Preview tab, which isn't a findings tab) explaining what that tab shows
   and what a non-engineer should do about a finding there. Place each
   caption at the top of its `tab-panel` div, above the existing table
   render call. Example shape only (write accurate final copy per tab):
   "Schema differences show column-level mismatches between source and
   target (missing columns, type changes, etc.) — a Failure here usually
   means the two tables aren't structurally compatible yet."
3. Preserve `renderResultsHtml`'s pure-function contract exactly: same
   signature, same `ComparisonResult`-only input, deterministic output for
   the same input, no new `vscode` API usage, `enableScripts` unchanged
   (`false`).
4. All new static copy requires **no** `escapeHtml` calls, since it is
   fixed text, not derived from `ComparisonResult` fields — if you find
   yourself interpolating any `result.*` field into the new legend/caption
   text, stop and reconsider (the brief's scope is static copy only).

## Files owned

- `packages/extension/src/webview/resultsWebview.ts` (extends T-11/T-16/
  T-16b/T-34, visual/copy-only)
- `packages/extension/src/webview/resultsWebview.test.ts` (extends
  existing test coverage)

## Interfaces consumed

- `ComparisonResult` and `Severity` (`@paritylens/shared`, read-only — read
  the authoritative `Severity` union before writing legend copy)

## Prohibited changes

- Do not change `renderResultsHtml`'s exported signature.
- Do not add any new `vscode` API usage or flip `enableScripts` to `true`.
- Do not modify any existing table-renderer function's column set or
  underlying data logic — captions are additive text only, not changes to
  what data is shown.
- Do not modify `parityTreeDataProvider.ts` or any file outside
  `resultsWebview.ts`/its test file.

## Red-state evidence required

A test asserting legend/explanatory text is absent from today's rendered
`renderResultsHtml` output (run against the current, pre-change file).

## Green-state evidence required

1. The scoped diff across the owned files.
2. A test confirming the legend/glossary content is present in
   `renderResultsHtml`'s output and covers every real `Severity` value
   (cross-reference against `@paritylens/shared`'s actual union, not a
   hardcoded assumed list).
3. A test confirming each of the 4 check-family tab panels contains its new
   caption text.
4. A test confirming `renderResultsHtml` purity is unchanged: same input
   twice produces identical output (byte-for-byte).
5. A test confirming `enableScripts` stays `false` (same guard-test pattern
   T-34 established — locate and reuse/extend it if it already exists,
   otherwise add one).
6. Confirmation that no `escapeHtml` call was added for the new static
   copy (grep the diff — new lines should contain plain string literals,
   not `escapeHtml(...)` wrapping a static string).
7. A full fresh `npm run verify` passing with no regression versus the
   650/650 baseline; report the before/after test count.

## Handoff

- Write `IMPLEMENTATION-REPORT.md` using
  `multi-agent-idea-to-app/templates/IMPLEMENTATION-REPORT.md`.
- Commit on branch `task/T-43-results-webview-legend`.
- Recommend independent review as the next step.
- Reviewer should specifically re-verify: (1) the added copy is genuinely
  plain-language (not just restating the engineering term differently —
  read each line and judge whether a junior analyst with no data-engineering
  background would understand it); (2) no new escaping gap was introduced
  by the added static text (should require zero new `escapeHtml` calls,
  since it's static copy, not `ComparisonResult`-derived — flag if any
  interpolation was used where it shouldn't have been); (3) the legend
  actually covers every real `Severity` value in `@paritylens/shared`, not
  a stale/assumed subset; (4) `renderResultsHtml`'s purity and
  `enableScripts:false` guarantees are genuinely unchanged (diff against
  `main`, re-run the purity/guard tests independently); (5) a fresh full
  `npm run verify` is green with the reported test count.
