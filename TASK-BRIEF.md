# TASK-BRIEF.md — T-34: Results webview + sidebar visual redesign

## Objective

Apply the owner-approved visual design handoff
(`multi-agent-idea-to-app/design_handoff_paritylens_results_webview/README.md`
+ `ParityLens Results.dc.html`) to the two currently-unstyled UI surfaces:

- `packages/extension/src/webview/resultsWebview.ts` — today renders a bare,
  unstyled HTML document (`renderResultsHtml`). This task gives it a real
  visual language mapped onto **VS Code theme CSS variables**
  (`--vscode-editor-background`, `--vscode-foreground`,
  `--vscode-testing-iconFailed`-style semantic tokens, etc.) — not the
  prototype's raw Nocturne hex/token values, which are reference only.
- `packages/extension/src/views/parityTreeDataProvider.ts` — T-33 populated
  this with real `Comparisons`/`Recent Runs` children, but every node uses
  default VS Code `TreeItem` rendering (no icons, no status color). This
  task adds `iconPath`/`ThemeIcon` (codicons), `description` text, and
  `contextValue`-driven affordances per the handoff.

**Read the handoff's own "Fidelity" section before starting**: the results
webview is high-fidelity (colors/spacing/table structure/tabs/copy are
final-intent); the sidebar is **conceptual/structural reference only** —
VS Code tree views cannot render custom HTML, custom left borders, or
arbitrary icon colors the way the HTML mockup shows. Native `TreeItem`
affordances (`ThemeIcon` with a `color` `ThemeColor` argument, `description`,
`contextValue`, selection state) are the only implementation vocabulary
available for the sidebar half — do not attempt to turn the sidebar into a
webview or inject HTML into it.

## Scope

1. **Results webview restyling** (`resultsWebview.ts`):
   - Add a `<style>` block inside the existing `<head>` using VS Code webview
     theme variables for background/foreground/borders/accent, per the
     handoff's Design Tokens section (mapped to `--vscode-*` equivalents, not
     Nocturne raw values).
   - Header: small uppercase eyebrow, `<h1>` with comparison name, meta line
     (`Run <runId>` · source→target · duration), status tag colored by
     `result.status`.
   - Summary stat band: 4 stat tiles (Passed / Warnings / Failed / Row count
     delta) plus a source/target/difference row-count line.
   - Tab strip: Schema / Profile / Volume / Row-Level / SQL Preview, each
     (except SQL Preview) with a count-badge pill. **Keep `enableScripts:
     false`** (per `showResultsWebview`'s existing call and this file's own
     doc-comment purity contract) — implement tab switching with CSS-only
     radio/anchor-based technique (the handoff's own suggested
     scripts-disabled-compatible option), not JS. If after investigation
     CSS-only tab switching genuinely cannot work within this constraint,
     stop and flag it in the implementation report rather than silently
     flipping `enableScripts` to `true` — that is a prohibited change (see
     below).
   - Restyle the existing Schema/Profile/Volume/Row-Level tables with colored
     severity tags (map `DifferenceItem.severity` to a CSS class, using
     VS Code semantic-color variables per the handoff's Design Tokens note).
   - Row-Level panel: add the expand/collapse interaction for
     `matched-key-differing-values` rows showing `columnDifferences` — again
     CSS-only (e.g. a hidden checkbox/`:target` or `<details>`/`<summary>`
     element), since scripts stay disabled. `<details>`/`<summary>` is the
     simplest native-HTML way to do this without JS and should be preferred
     unless it conflicts with the visual spec.
   - SQL Preview panel: keep `renderQueryPreviewSection`'s existing escaping
     and one-`<pre>`-per-query structure; restyle only (card wrapper, header
     with query index).
   - `renderResultsHtml` **must remain a pure function** — same signature,
     same input (`ComparisonResult` only), deterministic output, no new
     `vscode` API usage beyond the pre-existing type-only import. This is
     the single most important constraint in this task (see Prohibited
     Changes).
   - If you add a stable row id for the row-level expand/collapse markup,
     prefer **keying by index within the render function** (e.g. an
     `id="row-differences-N"` anchor/checkbox pair) over adding a field to
     `RowDifference` — only touch `packages/shared/src/result.ts` if you
     conclude after implementation that an index-based key is genuinely
     insufficient (e.g. because row order isn't stable across renders of the
     same result, which it is, since `renderResultsHtml` is pure and
     `rowDifferences` is a plain array). If you do add a field, it must be
     optional and additive (matching every other difference-shape extension
     precedent in this codebase — see `CLAUDE.md`'s note that
     `RowDifference` is owned by T-14 but additive extensions by a later,
     disclosed task are the established pattern, same as T-16's
     `aggregateDifferences`/`rowDifferences` additions). Disclose this
     decision either way in the implementation report.

2. **Sidebar tree restyling** (`parityTreeDataProvider.ts`):
   - `ParityTreeItem` (section headers): no icon change needed (VS Code
     renders collapsible section chevrons natively) — leave as-is unless the
     handoff implies otherwise; do not over-engineer this node.
   - `ParityComparisonTreeItem`: add a file-type codicon (e.g.
     `new vscode.ThemeIcon("file")` or similar per the handoff's "file icon"
     description) via `iconPath`.
   - `ParityRecentRunTreeItem`: add a status-colored codicon dot reflecting
     the run's outcome (pass/warning/fail), via
     `new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor(...))`
     using a VS Code semantic color id (e.g.
     `testing.iconPassed`/`testing.iconFailed`/`editorWarning.foreground` —
     confirm exact valid `ThemeColor` ids before use). Requires
     `RunSummary` to expose an outcome/status field usable for this — check
     `packages/extension/src/runHistory/runHistory.ts`'s existing
     `RunSummary` shape first; if it already carries a status you can key
     off of, use it as-is (read-only consumption, this task doesn't own that
     file). If it doesn't carry anything sufficient, that's a scope
     boundary to flag and stop at, not silently work around.
   - No literal "Connections" row icons are needed since Connections stays
     empty-state (out of scope — T-33 explicitly left it empty and this task
     doesn't populate it either, only styles what T-33 already renders).
   - No custom left-border/active-state CSS — that's not available in
     `TreeItem`. If you want an "active comparison" affordance, a
     `description` suffix (e.g. "● active") or relying on VS Code's native
     selection highlight is the only available vocabulary; this is optional
     polish, not required scope, since the current single-result model
     doesn't yet track an "active" comparison concept at all (per the
     handoff's own Interactions note: "the current single-result
     `ComparisonResult` model doesn't need this yet").

## Dependencies

- T-33 (tree view populated with real `Comparisons`/`Recent Runs` data) —
  **complete**, merged to `main` at `43363bc`.
- T-11/T-16/T-16b (`resultsWebview.ts`'s existing structure and purity
  contract) — complete, this task extends them.

## Files owned

- `packages/extension/src/webview/resultsWebview.ts` (visual/structural
  only — preserve the pure-function contract)
- `packages/extension/src/views/parityTreeDataProvider.ts` (`TreeItem`
  presentation only — no data-fetching/dependency-shape changes beyond what
  T-33 already established)
- `packages/shared/src/result.ts` — **only** if, after investigation, an
  index-based row key genuinely proves insufficient for the row-level
  expand/collapse markup (see Scope item 1's last bullet); narrow, additive
  only (an optional field), never a breaking change to the existing shape

## Prohibited changes

- Do not touch `packages/extension/src/runHistory/`,
  `packages/extension/src/connections/`, `packages/extension/src/statusbar/
  parityStatusBar.ts`, `packages/extension/src/activation/activate.ts`, or
  any engine/`comparison-core`/`connector-sdk` code — this is a pure
  presentation-layer task.
- Do not flip `enableScripts` to `true` on the results webview panel. If
  CSS-only tab switching is genuinely infeasible for some required
  interaction, stop and disclose it in the implementation report — do not
  unilaterally decide to enable scripts.
- Do not widen `SchemaDifference`, `ProfileDifference`, or
  `AggregateDifference` — those are owned by their respective completed
  tasks and out of scope here regardless of any visual convenience it might
  offer.
- Do not add a "Connections" section data-populate — it stays empty-state
  (T-33's explicit scope boundary, unchanged by this task).
- Do not ship the Nocturne stylesheet (`_ds/styles.css`) or copy the
  prototype HTML file verbatim — the design handoff is explicit that this is
  a reference/spec, not code to reuse directly.

## Interfaces consumed / produced

- Consumed (read-only): `ComparisonResult` and all sub-shapes from
  `@paritylens/shared`; `RunSummary` from `runHistory.ts` (read-only, only
  if it already exposes what's needed per Scope item 2).
- Produced: restyled `renderResultsHtml` output (same exported function
  signature); restyled `ParityComparisonTreeItem`/`ParityRecentRunTreeItem`
  construction (same exported class signatures — only their internal
  `iconPath`/`description`/style construction changes). No new public
  interfaces.

## Red/Green/Full verification evidence required

- **Red**: a test asserting the *new* required markup (e.g. a specific CSS
  class name for the tab strip, or a summary-stat-tile element, or a
  severity-tag class) is **absent** from today's `renderResultsHtml` output
  — this is the meaningful red-state signal for a visual task (a "the old
  plain HTML doesn't match" assertion would be too weak/trivial, per the
  plan row's own note).
- **Green**: the same test passes after implementation. Additionally:
  - A test confirming `renderResultsHtml` remains pure: same input twice
    produces identical output (no hidden state/randomness/timestamps), and
    it still takes only a `ComparisonResult` argument.
  - A test confirming `showResultsWebview`'s `createWebviewPanel` call still
    passes `{ enableScripts: false }` (guards against silently flipping this
    — the exact regression Prohibited Changes calls out).
  - A test confirming every newly-rendered field that comes from
    `ComparisonResult` data (not a static label) goes through `escapeHtml`
    — at minimum, extend/re-run any existing XSS-probe-style test this file
    already has, and add one for any new field surfaced (e.g. if a tab badge
    count or stat tile pulls a message/column-name string anywhere, though
    most of these are `.length` numbers, not raw strings — verify which is
    which and escape whichever needs it).
  - A `parityTreeDataProvider.test.ts` assertion that
    `ParityComparisonTreeItem`/`ParityRecentRunTreeItem` construct an
    `iconPath` (or `ThemeIcon`) and that the run item's icon color reflects
    at least two distinct outcomes (e.g. pass vs. fail produce different
    `ThemeColor` ids) — not just that *an* icon exists.
- **Full**: `npm run verify` (typecheck + lint + test) green.

## Handoff note for the reviewer

Please adversarially confirm, independent of the implementation report:

1. **`renderResultsHtml` purity**: diff the function against `main` and
   confirm no new `vscode` runtime API usage crept in (only the pre-existing
   type-only import), no closures over external mutable state, no
   `Date.now()`/`Math.random()`/similar non-determinism, and that
   `showResultsWebview`'s `{ enableScripts: false }` call site is genuinely
   unchanged (or, if scripts were enabled, that this was explicitly
   disclosed and justified against the Prohibited Changes constraint — flag
   it as a finding if it wasn't disclosed).
2. **Escaping coverage**: walk every new piece of `ComparisonResult`-derived
   data surfaced in the restyled markup (stat tile numbers, tab badge
   counts, status tag text, meta line fields) and confirm each passes
   through `escapeHtml` if it's a string that could contain user-influenced
   content (e.g. `result.comparison`, `message` fields, column names) —
   numbers alone (counts, durations) are lower risk but should still be
   checked for how they're interpolated.
3. **Sidebar native-only compliance**: confirm no custom HTML/webview
   sneaks into `parityTreeDataProvider.ts` — only `vscode.ThemeIcon`,
   `vscode.ThemeColor`, `description`, `contextValue`, label text. Confirm
   any `ThemeColor` id used is a real, valid VS Code theme color id (spot
   check against VS Code's theme color reference, since an invalid id
   silently fails rather than erroring).
4. Confirm scope stayed within the two owned files (plus `result.ts` only
   if disclosed and justified per Scope item 1's last bullet) via a diff
   against `main`.

## Branch

`task/T-34-results-sidebar-visual-redesign`
