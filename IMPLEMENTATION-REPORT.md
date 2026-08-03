# ParityLens — Implementation Report T-37

## Status and objective

- **Status:** COMPLETE (implementation + evidence only — not reviewed or approved)
- **Objective:** Add a 5th tab, Column Mapping, to the custom comparison
  editor built in T-36. An SSIS-style visual mapper — source columns on the
  left, a target-column dropdown per row on the right, writing
  `ColumnMappingEntry[]` (`column_mapping`) on Apply. Live column-list
  fetch (via `DataPlatformConnector.getSchema`) only when both Source and
  Target sides are in Table mode; other modes/fetch failures fall back to
  manual free-text entry.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/extension/src/authoring/columnMapping.ts` (new) | Pure, `vscode`-free data-shaping helpers: `buildMappingRowsFromColumns`, `buildManualMappingRows`, `mappingRowsToColumnMappingEntries`, `ColumnMappingRow` type | TASK-BRIEF.md Scope item 2 |
| `packages/extension/src/authoring/columnMapping.test.ts` (new) | Unit tests for the above | TASK-BRIEF.md's required evidence |
| `packages/extension/src/authoring/comparisonEditorHtml.ts` | Added `ComparisonEditorColumnMappingDraft` type, extended `ComparisonEditorDraft` with a required `columnMapping` field, added a `columnMapping` entry to `TAB_ORDER`/`TAB_LABELS`, replaced T-36's placeholder tab-strip span with a real 5th tab button, added `renderMappingTab`/`renderMappingTargetSelect`, added mapping-table CSS, extended the static client script (`currentColumnMapping()`, Add row/Remove row wiring for manual mode, `requestColumnFetch()` triggered on load and on Source/Target field change, `columnMapping` included in the Apply payload) | TASK-BRIEF.md Scope items 1, 3, 5 |
| `packages/extension/src/authoring/comparisonEditorHtml.test.ts` | Updated the two now-obsolete T-36 "placeholder tab" assertions to assert the real built tab instead; added `columnMapping` to `BASE_DRAFT`; added a new describe block covering fetched-mode dropdown rendering, manual-mode Add/Remove affordances, inline `fetchError` banner + other-tabs-still-render, HTML-escaping of fetched column names, and purity with a populated `columnMapping` sub-state | TASK-BRIEF.md's required Green-state evidence |
| `packages/extension/src/authoring/comparisonEditorProvider.ts` | Added `resolveConnectorByName` to `ComparisonEditorProviderDeps`; added `FetchColumnsMessage`/`isFetchColumnsMessage`; added `bothSidesReadyForLiveFetch` (Table-mode-only gate, checked before any connector resolution is attempted); added `fetchColumnMappingDraft` (resolves both connectors, calls `getSchema`, catches any rejection into a scoped `fetchError`, never throws); added `parseColumnMappingMessage` (validates an untrusted Apply-message `columnMapping` array, reuses `mappingRowsToColumnMappingEntries`); extended `ApplyMessage`/`buildAnswersFromApplyMessage` to read/validate/include `columnMapping`; extended `buildDraftFromText` and its parse-error fallback to always populate `columnMapping` via a new `defaultColumnMappingDraft()`; extended `resolveCustomTextEditor`'s message handler to dispatch `fetch-columns` messages independently of Apply handling (re-renders with an updated `columnMapping` sub-state, never touches `applyEdit`) | TASK-BRIEF.md Scope items 1, 4 |
| `packages/extension/src/authoring/comparisonEditorProvider.test.ts` | Added a fake `DataPlatformConnector` helper; added `resolveConnectorByName` to the existing `makeDeps` helper; added a new describe block (`ComparisonEditorProvider Column Mapping tab fetch handling (T-37)`) covering: both-sides-Table-mode live fetch and populated dropdowns; Query-mode source never calls `getSchema`; SQL-File-mode target never calls `getSchema`; Table-mode-but-no-object-yet never calls `getSchema`; a `getSchema` rejection shows an inline error and a subsequent Apply on the other 4 tabs still succeeds; `columnMapping` round-trips through Apply → `buildComparisonYaml` → `parseDefinition`; no credential-shaped value crosses into the rendered HTML from a fetch result | TASK-BRIEF.md's required Red/Green-state evidence |
| `packages/extension/src/activation/activate.ts` | Added `buildResolveConnectorByName(connectionProfileStore, secretStore)`, composing `findProfileByName` + `secretStore.get(secretKeyFor(profile.id))` + `resolveConnector` — the identical resolution pieces `buildConnectorRegistry` (defined earlier in the same file) already uses for `runComparisonCommand`, mirrored rather than reimplemented. Unlike `buildConnectorRegistry`, returns `undefined` for an unmatched name (no `FixtureConnector` fallback — see the new function's doc comment for why: silently substituting fixture data into an editing UI would be misleading). `registerComparisonEditorProvider` now takes `secretStore` as a second parameter and binds `resolveConnectorByName` into the provider's deps; its one call site in `activate()` updated accordingly. Added `DataPlatformConnector` to the existing `@paritylens/shared` type-only import | TASK-BRIEF.md Scope item 1 (new capability T-36 did not need; `comparisonEditorProvider.ts` never imports `SecretStore`/`ConnectionProfileStore` directly, per Prohibited changes) |

## Behavior and interfaces

- **Behavior delivered:**
  - A 5th "Column Mapping" tab is now rendered (previously a disabled
    placeholder span per T-36).
  - When the webview opens (and whenever Source/Target connection/mode/
    object fields change), the client script posts `{type:
    "fetch-columns", source, target}`. The provider checks
    `bothSidesReadyForLiveFetch` (both sides `kind: "table"` with non-blank
    `connection` and `object`) *before* attempting any connector
    resolution or `getSchema` call — if either side fails that check, no
    `resolveConnectorByName`/`getSchema` call happens at all, and the tab
    renders in manual free-text-entry mode with Add row/Remove row
    affordances.
  - When both sides qualify, the provider resolves both connectors via
    `deps.resolveConnectorByName`, calls
    `connector.getSchema({kind:"table",object})` on each, and on success
    renders one row per source column with a populated `<select>` of every
    target column name plus a "— no mapping / same name —" default option
    (pre-selected when a target column of the identical name exists).
  - Any failure in that path (connector unresolved, `getSchema` rejects)
    is caught inside `fetchColumnMappingDraft`, which never throws — it
    returns a manual-mode draft carrying `fetchError`, rendered as an
    inline banner scoped to the Mapping tab only. The other four tabs'
    Apply flow is untouched by a fetch failure (verified by a test that
    triggers a fetch failure and then successfully Applies the other four
    tabs).
  - On Apply, the client script's `currentColumnMapping()` reads either
    the fetched-mode `<select>` values or the manual-mode text inputs and
    includes them as `{source, target}` pairs in the Apply message's
    `draft.columnMapping`. The provider validates/converts this via
    `columnMapping.ts`'s `mappingRowsToColumnMappingEntries` (skipping
    rows with a blank source or no target selected — an unmapped column
    keeps relying on the engine's identical-name fallback, so no
    `column_mapping` entry is written for it) before passing the result to
    `buildComparisonYaml`, which was already capable of emitting
    `column_mapping` (T-35b) — untouched by this task.

- **Interfaces consumed:** `ColumnMappingEntry`, `ColumnDefinition`,
  `DataPlatformConnector.getSchema` (`@paritylens/shared`/
  `@paritylens/engine`, read-only); `ConnectionProfileStore`, `SecretStore`,
  `resolveConnector` (T-29, composed only inside `activate.ts`, never
  imported by the provider).
- **Interfaces produced:**
  - `ComparisonEditorProviderDeps.resolveConnectorByName: (name: string) => Promise<DataPlatformConnector | undefined>`
  - `ComparisonEditorDraft.columnMapping: ComparisonEditorColumnMappingDraft`
    (`{ mode: "fetched" | "manual"; rows: ColumnMappingRow[]; fetchError?: string }`)
  - `columnMapping.ts`: `ColumnMappingRow`,
    `buildMappingRowsFromColumns(sourceColumns, targetColumns)`,
    `buildManualMappingRows(existing?)`,
    `mappingRowsToColumnMappingEntries(rows)`

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline (pre-change) | `npm run verify` | Exit 0 — 543 passed, 27 skipped, 30 test files | Captured this session before any edit |
| Red state (columnMapping.ts) | `npx vitest run packages/extension/src/authoring/columnMapping.test.ts` | Exit 1 — `Cannot find module './columnMapping'` (module did not exist yet) | Captured this session |
| Red state (comparisonEditorHtml.ts) | `npx vitest run packages/extension/src/authoring/comparisonEditorHtml.test.ts` | Exit 1 — 4 of 18 failed: no `data-panel="columnMapping"`, no `getSchema failed...`/`could not fetch columns` banner text, no fetched-dropdown markup, purity test failing to compile against the new required `columnMapping` field (Mapping tab was still a T-36 placeholder) | Captured this session |
| Red state (comparisonEditorProvider.ts) | `npx vitest run packages/extension/src/authoring/comparisonEditorProvider.test.ts` | Exit 1 — 13 of 21 failed: `TypeError: Cannot read properties of undefined (reading 'fetchError')` (draft had no `columnMapping`, no fetch-columns handling, no `resolveConnectorByName` dependency yet) | Captured this session |
| Focused green (columnMapping.ts) | `npx vitest run packages/extension/src/authoring/columnMapping.test.ts` | Exit 0 — 10/10 passed | Captured this session |
| Focused green (comparisonEditorHtml.ts) | `npx vitest run packages/extension/src/authoring/comparisonEditorHtml.test.ts` | Exit 0 — 18/18 passed | Captured this session |
| Focused green (comparisonEditorProvider.ts) | `npx vitest run packages/extension/src/authoring/comparisonEditorProvider.test.ts` | Exit 0 — 21/21 passed, including: both-Table-mode dropdown population; Query/SQL-File-mode manual fallback with zero `getSchema` calls; Table-mode-but-blank-object skip with zero `getSchema` calls; a fetch-rejection scenario with an inline error and a subsequent successful 4-tab Apply; full round trip through `buildComparisonYaml`/`parseDefinition`; no credential-shaped string in the rendered HTML after a fetch | Captured this session |
| Full verification | `npm run verify` (`tsc -b --force` && `eslint .` && `vitest run`) | Exit 0 — typecheck clean, lint clean, **565 passed, 27 skipped, 33 test files** (31 run + 2 skipped integration suites requiring Docker containers not present in this environment) | Captured this session |

Test count delta: 543 → 565 passed (+22 net: 10 new in
`columnMapping.test.ts`, 7 new in `comparisonEditorProvider.test.ts`, and a
net +5 in `comparisonEditorHtml.test.ts`'s new Mapping-tab describe block
— its 2 pre-existing T-36 "placeholder tab" tests were reworded in place,
not counted as new). No pre-existing test's baseline passing count
decreased.

## Assumptions and risks

- **Assumptions:**
  - The message-protocol shape (`{type: "fetch-columns", source, target}`
    request; the response is a full webview HTML re-render, not a
    separate discrete `columns-result` message type) was left to my
    judgment per the brief's "your call on exact triggering, document it."
    I chose a synchronous full-page re-render over a discrete
    `columns-result` postMessage reply, matching this file's existing
    "call `render()` on every relevant event" pattern (already used for
    on-disk document changes) rather than introducing a second
    state-reconciliation path inside the client script that would need to
    duplicate `renderMappingTab`'s row/dropdown rendering logic in JS.
  - `ComparisonEditorDraft.columnMapping` is a **required** field (not
    optional), since `buildDraftFromText`/`defaultColumnMappingDraft()`
    always populate it before render — this keeps
    `renderComparisonEditorHtml` from needing an "unset" branch of its
    own, at the cost of every existing (T-36) test-authored
    `ComparisonEditorDraft` literal needing the new field added (done in
    `comparisonEditorHtml.test.ts`'s `BASE_DRAFT`).
  - `resolveConnectorByName` returning `undefined` (rather than throwing)
    for an unresolvable name matches the "gracefully fall back, never
    crash" contract the whole fetch path needs — `fetchColumnMappingDraft`
    turns that `undefined` into a thrown `Error` internally, which it then
    catches and converts to a scoped `fetchError`, so both failure modes
    (unresolvable connection, `getSchema` rejection) end up handled
    identically.
- **Risks or limitations:**
  - The client script's `requestColumnFetch()` fires on every `input`/
    `change` event of the six listened Source/Target fields, with no
    debounce — for a fast typist in a Table-mode `object` field this could
    issue several fetch-columns messages in quick succession, each
    triggering a real `getSchema` round trip once the gate passes. This
    was not optimized further since TASK-BRIEF.md did not call out a
    performance requirement, but it is a real, disclosed limitation a
    reviewer or future task may want to address (e.g. debouncing on the
    client side).
  - `fetchColumnMappingDraft`'s `Promise.all` resolves both connectors
    concurrently; if only one side's connection name is unresolvable, the
    reported `fetchError` message names whichever check fails first
    (source-connector-undefined is checked before target), which may be
    slightly less informative than surfacing both failures at once —
    judged acceptable given the brief's requirement is "show an inline
    error," not "enumerate every possible failure reason."
  - I did not add a discrete `columns-result` postMessage type distinct
    from Apply's existing `apply-result` — the fetch path returns via a
    full HTML re-render instead (see Assumptions above). A reviewer may
    reasonably prefer the discrete-message approach; I judged the
    re-render approach lower-risk since it reuses
    `renderComparisonEditorHtml`'s existing purity contract rather than
    adding new client-side DOM-patching logic.
  - `activate.ts`'s `buildResolveConnectorByName` performs `secretStore.get`
    (an async VS Code SecretStorage read) on every `fetch-columns` request
    that reaches connector resolution, once per side, exactly mirroring
    `buildConnectorRegistry`'s existing per-run behavior for
    `runComparisonCommand` — not a new pattern, but worth noting this
    tab's live-fetch path now also performs SecretStorage reads on every
    qualifying keystroke-triggered fetch, not just on Apply/Run.
- **Blockers:** None.

## Patch or commit identity

- **Commit:** recorded immediately after this report was written — see
  `git log -1` on the branch below for the exact hash.
- **Branch:** `task/T-37-column-mapping-tab` (matches TASK-BRIEF.md's
  Branch section)

## Recommended next step

Independent review by a separate reviewer agent, per this project's
operating contract (`AGENTS.md`: "Every implementation task receives an
independent review by a reviewer who did not author the task's change").
This implementer does not self-approve. The reviewer should work through
TASK-BRIEF.md's own "Handoff note for the reviewer" checklist (items 1–6):
confirm the Table-mode-only gating is genuine by tracing the actual code
path (not just trusting the passing test); confirm
`resolveConnectorByName`'s `activate.ts` implementation genuinely reuses
`ConnectionProfileStore`/`SecretStore`/`resolveConnector` rather than
reimplementing credential resolution; confirm no credential-shaped value
ever crosses into the webview from a fetch result; construct their own
`getSchema`-failure scenario to confirm the other four tabs' Apply
behavior is genuinely unaffected; confirm `renderComparisonEditorHtml`
purity and full `escapeHtml` coverage with a populated Mapping-tab draft;
and confirm via `git diff --stat main..task/T-37-column-mapping-tab` that
only the declared files changed. This report does not constitute review,
approval, or a completion claim beyond implementation-and-evidence scope.
