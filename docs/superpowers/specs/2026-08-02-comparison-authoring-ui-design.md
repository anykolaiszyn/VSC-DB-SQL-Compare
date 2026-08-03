# Phase 5 — Comparison Authoring UI

Date: 2026-08-02
Status: Approved (design stage) — not yet broken into `IMPLEMENTATION-PLAN.md` tasks

## Context

`IMPLEMENTATION-PLAN.md`'s Backlog section (added alongside Phase 4) names
three items deliberately excluded from Phase 4's scope:

- **Custom comparison editor/webview** — `DESIGN-SPEC.md`'s Extension Layer
  row and `Idea Prompt.md` section 6 describe a full custom editor as the
  eventual authoring surface, beyond T-32's scaffolding-wizard-only
  approach.
- **CodeLens actions** — inline "Run Profile | Run Schema Check | Run Full
  Comparison | Open Last Result" actions inside an open `.paritylens` file.
- **SQL preview panel wired into the run command** — T-16b built a real SQL
  preview panel and `queriesUsed` field, but it's only ever populated as a
  side effect of the planner's own internal execution, not exposed as a
  pre-execution confirmation step.

The Snowflake connector (T-18) is explicitly out of scope for this phase —
it remains deferred/blocked on an owner obtaining a trial account, unrelated
to this UI work.

This document scopes all three backlog items as **Phase 5**, plus a fourth
item raised during scoping: an SSIS-style column mapping tool.

## Goals

- Give users a real UI for authoring `.paritylens` definitions instead of
  hand-writing YAML from T-32's minimal scaffold.
- Let users map source→target columns visually, picking from live schema,
  instead of hand-typing `column_mapping` entries.
- Show generated SQL and require explicit confirmation before it executes
  against source/target — a literal reading of `DESIGN-SPEC.md`'s
  pre-execution preview requirement, not yet honored by `paritylens.runComparison`.
- Offer one-click run actions inline above an open `.paritylens` file,
  regardless of which editor has it open.

## Non-goals

- Run History and Differences tabs inside the editor — the editor stays
  scoped to authoring; reviewing past runs/results continues to happen via
  the existing results webview (T-11/T-16/T-34) and tree view (T-33).
- Live column-list fetch for Query/SQL File-mode `QueryInput` sides — the
  Column Mapping tab's live fetch only supports Table mode (see "Column
  Mapping tab" below); Query/SQL File sides use manual free-text mapping.
- Any change to `runComparison`'s existing signature, control flow, or
  purity/determinism contract.
- Any change to `SchemaDifference`/`ProfileDifference`/`AggregateDifference`
  — untouched, per this codebase's standing rule that each is owned by its
  originating task.
- Snowflake connector (T-18) — unrelated, separately tracked, blocked on
  the owner.

## Architecture

Three additive units, each following this codebase's established
pure-core / injected-VS-Code-glue split:

```
packages/engine/src/orchestration/planner/
  planQueries.ts          — NEW: dry-run query builder (pure, no executeQuery)

packages/extension/src/authoring/
  buildComparisonYaml.ts  — EXISTING (T-32): extended for query/sqlFile
                             QueryInput kinds and column_mapping
  comparisonEditorProvider.ts — NEW: CustomTextEditorProvider glue
  comparisonEditorHtml.ts     — NEW: pure webview HTML/state renderer
  columnMapping.ts            — NEW: pure column-mapping data helpers

packages/extension/src/codelens/
  comparisonCodeLensProvider.ts — NEW: CodeLensProvider for .paritylens files

packages/extension/src/activation/activate.ts
  — extended: registers the custom editor, CodeLens provider, and the
    pre-execution confirmation step in paritylens.runComparison
```

### 1. Custom comparison editor

A `vscode.CustomTextEditorProvider` registered for `.paritylens` files.
The underlying `TextDocument` (real YAML on disk) stays the source of
truth — `parseDefinition` (T-08) remains the sole parser, and
`buildComparisonYaml` (T-32, extended) remains the sole serializer. The
editor is a friendlier *view* onto the same file, not a parallel data
model — opening the same file as plain text (or via `git diff`) still
shows accurate, complete YAML.

**Write model:** explicit Apply/Save. The webview holds an in-memory
draft reflecting the parsed document; edits update the draft only.
Clicking Apply serializes the draft back to YAML and calls
`WorkspaceEdit.replace` on the full document range, which flows through
VS Code's normal dirty-document/save lifecycle (matches
`CustomTextEditorProvider`'s standard document-model pattern; avoids a
live round-trip and undo-stack thrashing on every keystroke).

**Tabs:**

- **Source** / **Target** — each independently configurable as one of
  `QueryInput`'s three existing kinds (`table` / `query` / `sqlFile`) via
  a mode toggle, extending `buildComparisonYaml`'s current table-only
  writer to cover all three. Connection picker lists T-29's saved
  `ConnectionProfile`s by name.
- **Column Mapping** (new — see below).
- **Keys** — one or more key column names (composite keys), matching
  `ParityDefinition.keys`.
- **Checks** — toggles for `checks.schema` / `checks.profile` /
  `checks.rowCount` / `checks.rowLevel`, matching `ParityChecks`.

No Run History or Differences tab (see Non-goals).

### 2. Column Mapping tab (SSIS-style)

Two-column layout: left lists source columns, right is a dropdown per
row to pick the matching target column (plus a "no mapping / same name"
default state, since `column_mapping` is optional and
`resolveTargetKeyName`-style fallback-to-identical-name already exists
at the engine level per T-28). Writes to the existing
`ColumnMappingEntry[]` shape (`column_mapping` in YAML) — no new engine
type.

**Live fetch, Table mode only:** when both Source and Target are in
Table mode and have a resolved connection + object name, opening this
tab calls the resolved connectors' `getSchema(queryInput)` (already part
of `DataPlatformConnector`) to populate both column dropdowns with real
data. This is a genuine webview↔extension-host round trip (unlike the
rest of the editor, which stays purely local to the open document) —
gated behind having a valid, resolved connection already configured on
the Source/Target tabs.

If either side is in Query or SQL File mode, live fetch is unavailable
and the tab falls back to manual free-text entry for both source and
target column names. (Query/SQL File-mode schema description would
require new engine capability — e.g. probing an arbitrary query's result
shape — explicitly deferred; see Non-goals.)

### 3. Pre-execution SQL preview (blocking confirmation)

New pure function `planQueries(definition, connectors)` in
`packages/engine/src/orchestration/planner/planQueries.ts`, reusing the
same pure query-builders `runComparison` already calls internally
(`buildProfileQueries`, `buildRowCountSql`, the row-level query builder)
but making **zero** `executeQuery` calls — it only builds and returns the
query list, the same way `queriesUsed` is already assembled today except
decoupled from actual execution.

`paritylens.runComparison`'s extension-host command flow becomes:

1. Resolve connectors (same as today).
2. Call `planQueries()` → get the full list of SQL that *would* run.
3. Show the list in a confirmation UI (reusing T-16b's existing SQL
   preview panel structure) and block on explicit user confirmation
   (Run / Cancel).
4. On confirmation, call the existing, unmodified `runComparison()` for
   real.

`runComparison`'s exported signature, control flow, and purity
guarantees stay exactly as they are today — `planQueries` is a new,
separate, additive function, not a refactor of the planner.

### 4. CodeLens actions

A `vscode.CodeLensProvider` registered for the `.paritylens` language/file
pattern, active regardless of which editor has the file open (custom
editor or plain text). Four lenses at the top of the document:

- **Run Profile** — invokes the run command with a profile-only check
  subset.
- **Run Schema Check** — schema-only check subset.
- **Run Full Comparison** — all enabled checks (goes through the SQL
  preview confirmation from item 3, same as any other full run).
- **Open Last Result** — invokes T-33's existing "open past result"
  command path, using the same `listRecentRuns`/`loadRun` (T-31) lookup
  by comparison name that the tree view's "Recent Runs" section already
  uses — no new lookup mechanism.

CodeLens has no data dependency on the custom editor's internals; it
only needs the file to be a valid (or at least parseable-enough)
`.paritylens` document, matching this project's read-only,
independent-surface pattern elsewhere (e.g. the tree view and status
bar both independently consume the same underlying data without
depending on each other).

## Data flow summary

```
.paritylens file (YAML, on disk)
        │
        ├── parseDefinition (T-08) ──► ParityDefinition ──► runComparison (unchanged)
        │                                     │
        │                                     └──► planQueries (NEW) ──► confirmation UI ──► runComparison
        │
        ├── CustomTextEditorProvider (NEW) ──► draft state ──► buildComparisonYaml (extended) ──► WorkspaceEdit
        │         │
        │         └── Column Mapping tab ──► getSchema() (existing connector API, Table mode only)
        │
        └── CodeLensProvider (NEW) ──► existing run/open-result commands
```

## Error handling

- **Editor Apply with an invalid draft** (e.g. missing required Source
  object, no keys defined): Apply is disabled/blocked client-side with
  inline validation messages, mirroring `parseDefinition`'s own required-
  field rules — never write a YAML document that would fail
  `parseDefinition` on next open.
- **Column Mapping live fetch failure** (connector unreachable, object
  not found): show an inline error in the Mapping tab; the tab remains
  usable via manual free-text entry, it doesn't block the rest of the
  editor.
- **`planQueries` failure** (e.g. connector resolution fails before any
  query can be built): surfaces the same Layer-1 connectivity-failure
  path `DESIGN-SPEC.md` already defines for `runComparison`, shown before
  the confirmation UI rather than silently falling through to execution.
- **CodeLens invoked against an unparseable file**: lens actions are
  simply not shown (or shown disabled) if `parseDefinition` fails on the
  current document content — no attempt to run against an invalid
  definition.

## Testing strategy

Following this codebase's established red/green/full pattern per task:

- `planQueries`: pure function, unit-testable against fixture connectors
  exactly like `runComparison`'s existing tests — assert the returned
  query list matches what `runComparison` would itself execute (no
  drift between preview and reality), and assert zero `executeQuery`
  calls occur (mock connector call-count assertion).
- `buildComparisonYaml` extension: table/query/sqlFile round-trip tests
  through `parseDefinition` for all three `QueryInput` kinds on each
  side, plus `column_mapping` round-trip tests.
- `comparisonEditorHtml`/draft-state helpers: kept pure and unit-tested
  the same way `resultsWebview.ts`'s `renderResultsHtml` is, independent
  of any live VS Code webview.
- `comparisonEditorProvider`/CodeLens glue: tested with mocked `vscode`
  APIs the same way `parityTreeDataProvider.test.ts` already mocks
  `vscode.ThemeIcon`/`ThemeColor`.
- Full: `npm run verify` green at every task boundary, per this
  project's standing rule.

## Task breakdown (for `IMPLEMENTATION-PLAN.md`)

To be finalized when writing the implementation plan, but the natural
dependency order is:

1. **T-35** — extend `buildComparisonYaml`/parsing round-trip helpers for
   `query`/`sqlFile` `QueryInput` kinds and `column_mapping` (foundation
   both the editor and its tests depend on).
2. **T-36** — custom comparison editor: Source/Target/Keys/Checks tabs,
   Apply/Save flow (depends on T-35).
3. **T-37** — Column Mapping tab, live `getSchema()` fetch for Table mode
   (depends on T-36).
4. **T-38** — `planQueries` dry-run function + pre-execution confirmation
   wiring into `paritylens.runComparison` (independent of T-36/T-37,
   could run in parallel with them).
5. **T-39** — CodeLens actions (depends on T-36 existing as the primary
   authoring surface, per the backlog's own sequencing note, though its
   actual data dependency is only on existing run/open-result commands).

## Open questions for the implementation-plan-writing step

None — all decisions above were made during brainstorming. The task
breakdown's exact file ownership boundaries and verification evidence
will be spelled out per-task in `IMPLEMENTATION-PLAN.md`, following this
project's existing task-row format.
