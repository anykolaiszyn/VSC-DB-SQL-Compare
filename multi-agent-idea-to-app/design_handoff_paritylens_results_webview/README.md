# Handoff: ParityLens Results Webview + Sidebar Redesign

## Overview
A visual redesign of the ParityLens VS Code extension's two currently-unstyled surfaces: the "Data Parity" activity-bar tree view (`parityTreeDataProvider.ts`) and the comparison results webview (`resultsWebview.ts`). Today both render as bare, unstyled HTML/tree nodes. This design gives them a real visual language (dark, VS Code-native-feeling, on the Nocturne design system) and shows the intended populated states: connections, comparisons, recent runs, and a full results view across schema/profile/volume/row-level/SQL-preview.

## About the Design Files
The bundled HTML is a **design reference built as an interactive HTML prototype**, not production code to copy directly. Treat it as the visual and interaction spec. The real implementation target is TypeScript inside the existing VS Code extension:
- `packages/extension/src/webview/resultsWebview.ts` — currently a pure function (`renderResultsHtml`) that returns a plain unstyled HTML string for the results `WebviewPanel`. It has `enableScripts: false` today.
- `packages/extension/src/views/parityTreeDataProvider.ts` — currently an empty-state `TreeDataProvider` rendering only the three section headers with VS Code's native `TreeItem` rendering (no custom HTML).

Recreate the look and interactions below using **VS Code's own theming and webview conventions** (VS Code CSS variables like `--vscode-editor-background`, `--vscode-foreground`, codicons for icons, native `TreeItem`/`TreeItemCollapsibleState` for the sidebar — not custom HTML in the sidebar, since VS Code tree views are not webviews) rather than shipping the Nocturne stylesheet or this HTML file as-is. The sidebar tree in the prototype is a **mockup of what a populated TreeDataProvider would show** — it doesn't mean the real sidebar should become a webview.

## Fidelity
**High-fidelity for the results webview** (the part that legitimately can be a themed HTML webview): colors, spacing, table structure, tab behavior, and copy are final-intent. **Conceptual/structural only for the sidebar tree**: VS Code tree views can't render arbitrary custom HTML/icons/colors the way this mockup does — use it to understand hierarchy, sample content, and status affordances, then implement with native `TreeItem` (icon path/`ThemeIcon`, `description`, `contextValue`, collapsible state), not as an HTML recreation.

## Screens / Views

### 1. Activity bar + sidebar tree (mockup reference only — see Fidelity)
- **Purpose**: Browse connections, saved comparisons, and recent run history.
- **Structure**: Three collapsible sections — Connections, Comparisons, Recent Runs — matching `PARITY_SECTIONS` in `parityTreeDataProvider.ts`.
- **Connections** row: platform icon (color-coded per platform), name, right-aligned platform tag (`SQLSERVER` / `SNOWFLAKE`), reflecting `ConnectionProfile.platform`.
- **Comparisons** row: file icon, comparison name; the active/open comparison gets a 2px accent-colored left border and a faint accent-tinted background — implement as `TreeItem.contextValue`/selection state, not literal border-left in VS Code (VS Code trees don't support custom left borders; use selection highlighting VS Code already provides, or a description suffix like "● active").
- **Recent Runs** row: small 7px status dot colored by outcome (amber = warning, `--color-accent-300`-equivalent = passed, red/`#e8918a`-equivalent = failed), run label, relative timestamp right-aligned and muted.
- Section header: 11px uppercase, letter-spacing 0.08em, chevron rotates -90deg when collapsed.

### 2. Results webview — header
- Small uppercase eyebrow "Parity Results" (11px, muted, letter-spacing .08em) above an `h1` (22px, Inter/heading font, weight 500) with the comparison name.
- Meta line beneath: `Run <runId>` · `<source object> → <target object>` · `<sourceDurationMs>ms source / <targetDurationMs>ms target`, all in muted 12px, separated by "·" glyphs.
- Top-right: overall status tag (Passed/Warning/Failed/Error via `ComparisonStatus`), an icon-only "Export" secondary button (download icon), and a ghost "Re-run" button.

### 3. Results webview — summary stat band
- 4-column grid of `.card.elev-sm` stat tiles: Passed, Warnings, Failed, Row count delta — each a small uppercase kicker label + a large (26px) heading-font number. Passed in default text color, Warnings in accent-300, Failed in a soft red (`#e8918a`), row-count delta as plain text.
- Below it, one wide card row: Source rows / Target rows / Difference (accent-300) / a muted right-aligned note about read-only isolation and which check layers ran.

### 4. Results webview — tabs
- Horizontal tab strip, bottom border 1px `--color-neutral-800`. Tabs: Schema, Profile, Volume, Row-Level, SQL Preview. Active tab: text color `--color-text`, 2px accent bottom border. Inactive: `--color-neutral-400` text, transparent border. Each tab (except SQL Preview) carries a small pill badge with its item count (`--color-neutral-800` background, `--color-neutral-300` text, 10px).

### 5. Results webview — Schema / Profile / Volume panels
- Each renders a `.table` (Nocturne's themed table component) with the exact columns already defined in `resultsWebview.ts`'s `render*Table` functions:
  - Schema: Severity, Column, Kind, Source Type, Target Type, Message.
  - Profile: Severity, Column, Metric, Source Value, Target Value, Message.
  - Volume: Severity, Source Count, Target Count, Difference, Difference Rate, Message.
- Severity is rendered as a colored tag, not plain text: Pass → accent-tinted tag; Warning/Informational → accent-outlined tag; Failure/Error/Skipped → neutral tag. (Map this onto whatever severity-color convention the real VS Code theme should use — the prototype's mapping is a starting point, not a hard requirement, since `--vscode-*` semantic colors for success/warning/error should be preferred in the real implementation.)

### 6. Results webview — Row-Level panel
- Table columns: expand-caret, Severity, Category, Key Values, Message.
- Rows whose `RowDifference.category === "matched-key-differing-values"` are the only ones with a caret; clicking the row toggles an inline expanded sub-table (indented) showing `RowColumnDifference[]`: Column / Source Value / Target Value. Caret rotates 90° when expanded.
- Category enum values are shown with human-readable labels (e.g. `missing-from-target` → "Missing from target").

### 7. Results webview — SQL Preview panel
- One card per string in `ComparisonResult.queriesUsed`, each with a small header ("Query N" + a terminal icon) and a `<pre>` block below in monospace, wrapping long lines, showing the exact SQL string (already escaped upstream, same as today's `renderQueryPreviewSection`).

## Interactions & Behavior
- Sidebar sections collapse/expand independently (click header row); chevron rotation is the only transition (120ms).
- Clicking a Comparisons row sets it "active" (drives which result is shown in the main panel in a real multi-comparison app; the current single-result `ComparisonResult` model doesn't need this yet).
- Tab clicks swap the visible panel; no animation needed beyond an instant swap (keep it cheap inside a `WebviewPanel`, which today runs with `enableScripts: false` — if you want live tab-switching JS in the real webview, `enableScripts` will need to become `true`, or ship all 5 panels stacked and use CSS-only radio/anchor-based tab switching to preserve the scripts-disabled constraint mentioned in `resultsWebview.ts`'s doc comments).
- Row-level rows with column differences toggle open/closed per row on click; only rows with `columnDifferences` are clickable (cursor changes accordingly).
- No loading/error states are designed here — `ComparisonStatus` values `"failed"`/`"error"` should still render the same layout with the status tag reflecting that outcome; a true Layer-1 connectivity-failure empty state is not covered by this design and should be discussed before implementing.

## State Management
Purely presentational — the real webview should keep `renderResultsHtml(result: ComparisonResult)` as a pure function per its existing doc contract. New state needed if scripts are enabled:
- `activeTab: 'schema' | 'profile' | 'volume' | 'rows' | 'sql'`
- `expandedRows: Record<string, boolean>` keyed by a stable row id (the prototype invents `rowId`; the real `RowDifference` type has no id field today — add one, or key by index, before wiring this up)
- Sidebar: `sections: { connections: boolean; comparisons: boolean; runs: boolean }`, `activeComparisonId: string`

## Design Tokens
Pull all of these from the Nocturne `styles.css` bundled here (`_ds/styles.css`) if staying on Nocturne for the webview, or map 1:1 to VS Code theme variables if going fully native:
- Background: `--color-bg` (#161826) → or `--vscode-editor-background`
- Text: `--color-text` (#e9e9ed) → or `--vscode-foreground`
- Accent: `--color-accent` (#9184d9) and its 100–900 ramp → or `--vscode-focusBorder`/a custom accent if the extension wants its own brand color distinct from the user's VS Code theme
- Neutral ramp: `--color-neutral-100…900` for borders, muted text, hover tints
- Heading/body font: `--font-heading` / `--font-body` (Inter) — note VS Code webviews conventionally use `--vscode-font-family` instead; decide whether ParityLens should override VS Code's font or inherit it
- Radius: 8px baseline (`--radius-md` etc.)
- Status colors used in the mock: accent-300 (warning/pass emphasis), `#e8918a` (failure) — these are placeholders; prefer `--vscode-testing-iconFailed` / `--vscode-editorWarning-foreground` style semantic tokens if targeting native VS Code theming

## Assets
- Icons: inline Phosphor SVGs (paths embedded directly in the prototype's JS). In the real extension, prefer VS Code's built-in **codicons** (`$(database)`, `$(chevron-down)`, etc.) for the sidebar (required, since custom SVG icons in `TreeItem` need a packaged icon file, not inline SVG) and either codicons or the same Phosphor set for the results webview HTML.
- No raster images used.

## Files
- `ParityLens Results.dc.html` — the full interactive prototype (sidebar + results webview), included in this folder.
- Real files to modify in the target repo:
  - `packages/extension/src/webview/resultsWebview.ts`
  - `packages/extension/src/views/parityTreeDataProvider.ts`
  - `packages/shared/src/result.ts` (reference only — defines `ComparisonResult` and all sub-shapes the tables above are driven by; no changes implied unless adding a row-difference id per the State Management note)
