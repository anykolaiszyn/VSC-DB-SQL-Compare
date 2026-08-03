# TASK-BRIEF.md — T-37: Column Mapping tab (SSIS-style)

## Objective

Add a 5th tab, **Column Mapping**, to the custom comparison editor built
in T-36 (`comparisonEditorProvider.ts`/`comparisonEditorHtml.ts`). This
is the SSIS-style visual mapping tool from the design spec: source
columns listed on the left, a target-column dropdown per row on the
right, writing `ColumnMappingEntry[]` (`column_mapping`) on Apply.

T-36 already reserved a visible-but-unbuilt tab slot for this — read
`comparisonEditorHtml.ts`'s existing tab-rendering structure before
starting so your new tab matches its exact layout/CSS conventions rather
than introducing a divergent style.

See `docs/superpowers/specs/2026-08-02-comparison-authoring-ui-design.md`
("Column Mapping tab" section) for the full design context.

## Scope

1. **Live column-list fetch, Table-mode-only.** When both Source and
   Target sides are in Table mode (per T-35a's `ParitySide`/T-36's
   `ComparisonEditorSideDraft` kind field) and each has a resolved
   connection name + non-empty object name, fetching the tab's data
   requires calling `getSchema({kind:"table",object})` (existing
   `DataPlatformConnector` method) against each side's **resolved
   connector** — not just a connection *name* string.
   - **This is new capability T-36 did not need**: T-36's
     `ComparisonEditorProviderDeps` only exposes
     `listConnectionNames(): string[]` (for the picker dropdown), with no
     way to resolve a name into an actual connector. Resolving a
     connector by name requires `ConnectionProfileStore` (find the
     profile) + `SecretStore` (read the password) + `resolveConnector`
     (T-29's factory) — read `activate.ts`'s `buildConnectorRegistry`
     (the existing pattern for exactly this resolution, used for real
     comparison runs) before designing your own version; mirror its
     structure rather than reinventing it.
   - Add a new injected dependency to `ComparisonEditorProviderDeps` (e.g.
     `resolveConnectorByName: (name: string) => Promise<DataPlatformConnector | undefined>`
     — exact name/shape your call, document it clearly), implemented in
     `activate.ts`'s custom-editor registration call site by composing the
     same `ConnectionProfileStore`/`SecretStore`/`resolveConnector` pieces
     `buildConnectorRegistry` already uses. Do not have
     `comparisonEditorProvider.ts` import `SecretStore`/
     `ConnectionProfileStore` directly and duplicate that resolution logic
     itself — inject the already-composed capability, matching this
     codebase's established `deps`-injection discipline throughout
     `activate.ts`.
   - If either side is not in Table mode, or has no resolved connection/
     object yet, skip the live fetch entirely — do not attempt it, do not
     show a loading spinner that never resolves. Fall back to manual
     free-text entry for both source and target column names on that row
     (per the design's explicit non-goal of describing arbitrary query
     result shapes for `query`/`sqlFile` modes).
   - A `getSchema` rejection (network/auth failure, object not found) must
     show an inline error in the Mapping tab specifically — it must not
     crash the provider or block the other 4 tabs from working normally.

2. **`columnMapping.ts`** (new) — pure data-shaping helpers, `vscode`-free,
   unit-testable directly (same pure-core pattern as `buildComparisonYaml.ts`):
   functions to build the two-column mapping-row draft state from fetched
   `ColumnDefinition[]` lists (or manual-entry mode when unavailable), and
   to convert the tab's draft state back into `ColumnMappingEntry[]` for
   `buildComparisonYaml`. Keep the exact `ColumnMappingEntry` shape (T-08):
   support emitting the plain `{source, target}` variant for a simple
   1:1 mapping row (this task's primary UI shape — a dropdown pick is
   inherently a plain source→target pairing, not a derived-expression
   mapping). You do not need to build UI for the derived `{name, target,
   sourceExpression, targetExpression}` variant — `buildComparisonYaml`
   already supports emitting it (T-35b), but authoring *that* variant via
   this visual tool is out of scope; only the plain variant needs a UI
   path here.

3. **Extend `comparisonEditorHtml.ts`'s tab rendering** to add the Column
   Mapping tab's actual content (replacing T-36's reserved-but-empty
   slot): a table with one row per source column, a `<select>` per row
   listing every target column name (plus a "— no mapping / same name —"
   default option, since `column_mapping` is optional per-column — a
   column with no explicit mapping falls back to identical-name matching
   at comparison time, per T-28's existing engine-level precedent). When
   in manual-entry fallback mode (non-Table-mode side, or a fetch
   failure), render plain text inputs for source/target column name pairs
   instead of populated dropdowns, with an "Add row"/"Remove row"
   affordance (the fetched case doesn't need this since the row set is
   determined by the fetched column list).

4. **Extend `comparisonEditorProvider.ts`'s message handling**: a new
   message type from the webview requesting the tab's data be fetched
   (e.g. `{type: "fetch-columns"}`, sent when the tab is opened or when
   Source/Target mode/connection/object changes — your call on exact
   triggering, document it), calling `resolveConnectorByName` +
   `getSchema` for both sides, and posting the result (or error) back to
   the webview to re-render the tab. Extend the Apply-message handling
   (`handleApplyMessage`) to also read and validate a `columnMapping`
   field from the incoming message, converting it via `columnMapping.ts`'s
   helpers before passing to `buildComparisonYaml`.

5. **Preserve every established guarantee**: `renderComparisonEditorHtml`
   stays pure for any given draft input (the live-fetch round trip
   happens *before* rendering — the fetch result becomes part of the
   draft state passed in, not a side effect during render itself); Apply
   still round-trips through `parseDefinition` before ever calling
   `applyEdit`; every string value flowing into emitted YAML still goes
   through `buildComparisonYaml`'s existing `yamlQuotedString` escaping.

## Dependencies

- T-08 (`ColumnMappingEntry`, `DataPlatformConnector.getSchema`) — complete.
- T-29 (`ConnectionProfileStore`, `SecretStore`, `resolveConnector`) — complete.
- T-36 (`comparisonEditorProvider.ts`, `comparisonEditorHtml.ts`,
  `ComparisonEditorProviderDeps`, `ComparisonEditorDraft` and its
  sub-types) — complete, this task extends all of it directly.

## Files owned

- `packages/extension/src/authoring/columnMapping.ts` (new)
- `packages/extension/src/authoring/columnMapping.test.ts` (new)
- `packages/extension/src/authoring/comparisonEditorProvider.ts` (extends
  T-36 — the `getSchema` round trip, `resolveConnectorByName` dependency,
  and Mapping-tab message handling only)
- `packages/extension/src/authoring/comparisonEditorProvider.test.ts`
  (extends T-36)
- `packages/extension/src/authoring/comparisonEditorHtml.ts` (extends
  T-36 — the Mapping tab's render content only, replacing its reserved
  empty slot)
- `packages/extension/src/authoring/comparisonEditorHtml.test.ts`
  (extends T-36)
- `packages/extension/src/activation/activate.ts` (extends T-10/T-22/
  T-29/T-33/T-36 — wiring the new `resolveConnectorByName` dependency
  into the custom-editor registration call site only)

## Prohibited changes

- Do not touch `packages/extension/src/authoring/buildComparisonYaml.ts`
  — its `column_mapping` emission (T-35b) already supports both
  `ColumnMappingEntry` variants; this task only needs to *produce* plain-
  variant entries from the UI, not change how they're serialized.
- Do not touch `packages/extension/src/webview/resultsWebview.ts` or
  `packages/extension/src/authoring/newComparisonWizard.ts`.
- Do not touch `packages/engine/**`.
- Do not build UI for the derived `{name, target, sourceExpression,
  targetExpression}` `ColumnMappingEntry` variant (Scope item 2).
- Do not attempt live column fetch for Query/SQL-File-mode sides — this
  is the design's explicit, deliberate boundary, not an oversight to
  route around.
- Do not have `comparisonEditorProvider.ts` read `SecretStore`/
  `ConnectionProfileStore` directly — inject the composed
  `resolveConnectorByName` capability instead (Scope item 1).

## Interfaces consumed / produced

- Consumed (read-only): `ColumnMappingEntry`, `ColumnDefinition`,
  `DataPlatformConnector.getSchema` (`@paritylens/shared`/
  `@paritylens/engine`); `ConnectionProfileStore`, `SecretStore`,
  `resolveConnector` (T-29, composed into the new dependency at the
  `activate.ts` call site, not imported directly by the provider).
- Produced: extended `ComparisonEditorProviderDeps` (new
  `resolveConnectorByName` field); extended `ComparisonEditorDraft`
  (a `columnMapping` sub-state — name/shape your call, document it
  clearly since no later task currently depends on it, but keep it
  consistent with this file's existing draft-type conventions); pure
  helpers in `columnMapping.ts` (exported, name your own — document them
  for future reference).

## Red/Green/Full verification evidence required

- **Red**: a test opening the Mapping tab with both sides in Table mode
  against a mocked `resolveConnectorByName`/connector (mocked `getSchema`
  returning column lists), expecting both dropdowns to be populated from
  the fetch, fails today (the tab is currently an empty reserved slot per
  T-36).
- **Green**:
  - The above test passes.
  - A test confirming a Query/SQL-File-mode side shows manual free-text
    entry instead of attempting a live fetch.
  - A test confirming a `getSchema` rejection shows an inline tab error
    without crashing the provider or affecting the other 4 tabs (e.g. a
    subsequent Apply on Source/Target/Keys/Checks still works normally
    even if the Mapping tab's fetch failed).
  - A test confirming `columnMapping` entries selected via the dropdown
    round-trip correctly through Apply → `buildComparisonYaml` →
    `parseDefinition`, producing the expected `ColumnMappingEntry[]`.
  - A test confirming `renderComparisonEditorHtml` purity is preserved
    (same draft input, including a populated `columnMapping` sub-state,
    twice → identical output).
- **Full**: `npm run verify` (typecheck + lint + test) green.

## Handoff note for the reviewer

Please adversarially confirm, independent of the implementation report:

1. **Table-mode-only gating is genuine**: construct a scenario with a
   Query-mode source and confirm no `getSchema` call is ever attempted
   for that side — grep/trace the actual code path, don't just trust a
   passing test.
2. **`resolveConnectorByName` composition mirrors `buildConnectorRegistry`
   correctly**: confirm the new dependency's `activate.ts` implementation
   genuinely reuses `ConnectionProfileStore`/`SecretStore`/
   `resolveConnector` (T-29) rather than reimplementing credential
   resolution with subtly different logic — diff the approach against
   `buildConnectorRegistry`'s existing pattern.
3. **No credential ever reaches the webview**: confirm `getSchema`
   results (column names/types) are the only data that crosses back to
   the webview from a fetch — never a password, connection string, or
   any other credential-shaped value.
4. **Failure isolation**: confirm a `getSchema` failure genuinely doesn't
   affect the other 4 tabs' Apply behavior — construct the failure
   scenario yourself, don't just read the implementer's test.
5. **Purity and escaping**: confirm `renderComparisonEditorHtml` purity
   holds with a populated Mapping-tab draft, and that every
   fetched/manual column name flowing into the rendered HTML is
   `escapeHtml`-covered (a malicious/unusual column name from a live
   database is untrusted-enough data to require this, same standard as
   every other `ComparisonResult`-derived field in this codebase).
6. **File-ownership diff**: confirm via `git diff --stat main..<branch>`
   that only the declared files changed — `buildComparisonYaml.ts`,
   `resultsWebview.ts`, `newComparisonWizard.ts`, and `packages/engine/**`
   untouched.

## Branch

`task/T-37-column-mapping-tab`
