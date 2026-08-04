import type * as vscode from "vscode";
import type {
  ComparisonResult,
  ComparisonStatus,
  RowDifferenceCategory,
  SchemaDifference,
  ProfileDifference,
  AggregateDifference,
  RowDifference,
  Severity
} from "@paritylens/shared";

/**
 * Results webview panel (TASK-BRIEF.md T-11, extended by T-16, extended
 * again by T-16b, restyled by T-34).
 *
 * `renderResultsHtml` is deliberately a pure function: its only input is a
 * `ComparisonResult` object. It never reads `vscode.workspace`,
 * `SecretStorage`, or invokes a connector — per T-11's original Interfaces
 * table ("the function's only input is the `ComparisonResult` object")
 * and the reviewer note asking this to be scrutinized hardest. T-16 extends
 * this to also render `aggregateDifferences` ("Volume Parity" section) and
 * `rowDifferences` ("Row-Level Differences" section), now that T-15
 * populates them, while preserving the existing purity contract — no new
 * `vscode` API usage beyond the pre-existing type-only import.
 *
 * T-16b extends this again to render a "Query Preview" section from
 * `ComparisonResult.queriesUsed` when present — a post-hoc preview of the
 * SQL that was actually used to produce the displayed result, not a
 * pre-execution confirmation gate (no comparison-triggering command exists
 * yet to gate in the first place, per TASK-BRIEF.md's Prohibited Changes
 * section). Every string in `queriesUsed` originates from one of the three
 * engine-layer builder functions (`buildRowCountSql`, `buildProfileQueries`,
 * `buildFetchAllRowsSql`) via the planner — this module only ever displays
 * those strings, `escapeHtml`-sanitized like every other field already
 * rendered here, and never reconstructs SQL from a `QueryInput`/
 * `ColumnDefinition` itself (the exact drift risk the original T-16 SQL-
 * preview deferral decision was written to avoid).
 *
 * T-34 (this task) restyles the markup produced here using VS Code webview
 * theme CSS variables (`--vscode-*`), per the owner-approved design handoff
 * at `multi-agent-idea-to-app/design_handoff_paritylens_results_webview/`.
 * The handoff's prototype uses a fixed dark "Nocturne" design system and
 * live JS-driven tab/row state; neither is copied verbatim (per the
 * handoff's own "not production code to copy directly" instruction and
 * this task's Prohibited Changes). Instead:
 *  - colors/spacing map onto `--vscode-*` theme tokens so the panel follows
 *    the user's active VS Code theme rather than a hardcoded palette;
 *  - tab switching is implemented with a CSS-only radio-button + `:checked`
 *    sibling-selector technique (five hidden `<input type="radio">`
 *    elements plus `<label>` "tabs"), since `enableScripts` must stay
 *    `false` on this panel (see `showResultsWebview` below and this file's
 *    purity contract) and JS-driven tab state is therefore not an option;
 *  - the row-level expand/collapse interaction uses native
 *    `<details>`/`<summary>`, the simplest script-free way to get a
 *    click-to-toggle disclosure widget, per the brief's explicit
 *    preference for `<details>`/`<summary>` over a second radio/checkbox
 *    hack unless it conflicts with the visual spec (it doesn't here).
 *
 * T-43 adds a static plain-language legend/glossary (via a native
 * `<details>`/`<summary>` disclosure, the same script-free pattern the
 * row-level expand/collapse above already established) explaining every
 * `Severity` value from `@paritylens/shared` that actually appears as a
 * colored tag in this UI, plus a short static caption at the top of each
 * of the 4 check-family tab panels (Schema/Profile/Volume/Row-Level — not
 * SQL Preview, which isn't a findings tab). Premise correction from the
 * plan row (documented in IMPLEMENTATION-REPORT.md): the legend explains
 * the real `Severity` union (`Pass`/`Informational`/`Warning`/`Failure`/
 * `Error`/`Skipped`, six values per `packages/shared/src/result.ts`, not
 * the three illustrative values named in the task brief's own example),
 * since there is no separately-rendered `Compatible`/`Review`/`Risk` label
 * anywhere in this file — that classification
 * (`packages/engine/src/comparison-core/type-mapping/type-mapping.ts`) is
 * an internal input `compareSchemas` folds into a `SchemaDifference`'s
 * `severity`/`message`, never surfaced as its own literal UI label. All
 * new copy is a fixed string with no `ComparisonResult` field
 * interpolated into it, so none of it is passed through `escapeHtml` —
 * only dynamic, result-derived values need escaping.
 */

/** Escapes a value for safe inclusion in the webview's HTML body. */
function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Maps a `Severity` value to a CSS class for the colored severity tag, per
 * the handoff's Design Tokens note: prefer VS Code semantic-color variables
 * over the prototype's raw Nocturne token mapping. `severity-tag--ok` uses
 * `--vscode-testing-iconPassed`-style green, `severity-tag--warn` uses
 * `--vscode-editorWarning-foreground`-style amber, and `severity-tag--bad`
 * uses `--vscode-testing-iconFailed`-style red; `Skipped`/`Informational`
 * get a neutral tag since they are not pass/warn/fail outcomes.
 */
function severityTagClass(severity: Severity): string {
  switch (severity) {
    case "Pass":
      return "severity-tag severity-tag--ok";
    case "Warning":
      return "severity-tag severity-tag--warn";
    case "Failure":
    case "Error":
      return "severity-tag severity-tag--bad";
    case "Informational":
    case "Skipped":
    default:
      return "severity-tag severity-tag--neutral";
  }
}

/** Maps overall `ComparisonStatus` to the header status tag's CSS class + label. */
function statusTag(status: ComparisonStatus): { className: string; label: string } {
  switch (status) {
    case "passed":
      return { className: "status-tag status-tag--ok", label: "Passed" };
    case "warning":
      return { className: "status-tag status-tag--warn", label: "Warning" };
    case "failed":
      return { className: "status-tag status-tag--bad", label: "Failed" };
    case "error":
      return { className: "status-tag status-tag--bad", label: "Error" };
    default:
      return { className: "status-tag status-tag--neutral", label: escapeHtml(status) };
  }
}

/** Human-readable labels for `RowDifferenceCategory`, per the handoff's Row-Level panel spec. */
const CATEGORY_LABELS: Record<RowDifferenceCategory, string> = {
  matching: "Matching",
  "missing-from-source": "Missing from source",
  "missing-from-target": "Missing from target",
  "duplicate-in-source": "Duplicate in source",
  "duplicate-in-target": "Duplicate in target",
  "matched-key-differing-values": "Matched key, differing values",
  "unable-to-compare": "Unable to compare",
  "ignored-by-rule": "Ignored by rule"
};

/**
 * T-43: plain-language explanation for every `Severity` value (the real
 * union from `packages/shared/src/result.ts`: `Pass` | `Informational` |
 * `Warning` | `Failure` | `Error` | `Skipped`), phrased so a junior
 * analyst with no data-engineering background understands what to do next
 * on seeing that colored tag. Order matches the rough severity-to-attention
 * ordering a reader scans top to bottom: worst-first, ending with the two
 * non-outcome states (Skipped/Informational).
 */
const SEVERITY_LEGEND: Array<{ severity: Severity; explanation: string }> = [
  {
    severity: "Failure",
    explanation: "A meaningful mismatch was found. Investigate before trusting that source and target are equivalent."
  },
  {
    severity: "Error",
    explanation: "The check itself could not run correctly (e.g. a connection or query problem), not a data mismatch. Investigate the run itself before trusting any result on this tab."
  },
  {
    severity: "Warning",
    explanation: "A difference exists but may be expected or low-risk. Review it to confirm it's not a problem."
  },
  {
    severity: "Pass",
    explanation: "This check found no meaningful difference. No action needed."
  },
  {
    severity: "Informational",
    explanation: "Shown for awareness only. Not necessarily a problem."
  },
  {
    severity: "Skipped",
    explanation: "This check did not run for this item (for example, it was disabled or not applicable). It was not evaluated either way."
  }
];

/**
 * T-43: renders the static plain-language legend/glossary as a native
 * `<details>`/`<summary>` disclosure (script-free, matching the row-level
 * expand/collapse pattern already established in this file), explaining
 * every real `Severity` value that appears as a colored tag elsewhere in
 * this document. Every string here is a fixed literal — no
 * `ComparisonResult` field is interpolated — so nothing here needs
 * `escapeHtml`.
 */
function renderLegend(): string {
  const items = SEVERITY_LEGEND.map(
    ({ severity, explanation }) => `<li><span class="${severityTagClass(severity)}">${severity}</span><span>${explanation}</span></li>`
  ).join("\n");

  return `<details class="card legend">
    <summary>What do these mean?</summary>
    <ul class="legend-list">
      ${items}
    </ul>
  </details>`;
}

/**
 * T-43: short, plain-language "what this tab shows and what to do about a
 * finding" caption for each of the 4 check-family tab panels (Schema/
 * Profile/Volume/Row-Level — not SQL Preview, which isn't a findings tab).
 * Fixed static copy, not derived from `ComparisonResult`, so it needs no
 * `escapeHtml`.
 */
function renderTabCaption(text: string): string {
  return `<p class="tab-caption">${text}</p>`;
}

/**
 * The webview-wide `<style>` block, using VS Code webview theme CSS
 * variables (documented at
 * https://code.visualstudio.com/api/references/theme-color) instead of the
 * handoff prototype's raw Nocturne hex/token values, per this task's
 * Objective and the Design Tokens section's own preference for
 * `--vscode-*` semantic tokens when going fully native. This function
 * returns a fixed string (no `ComparisonResult` input), so it introduces no
 * risk to `renderResultsHtml`'s purity contract.
 */
function renderStyles(): string {
  return `<style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 28px 36px 60px;
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family, sans-serif);
      font-size: 13px;
    }
    .content { max-width: 980px; }
    .eyebrow {
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 6px;
    }
    h1 {
      margin: 0;
      font-size: 22px;
      font-weight: 500;
    }
    .header-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 20px;
      flex-wrap: wrap;
    }
    .meta-line {
      margin-top: 8px;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    .meta-sep { color: var(--vscode-panel-border, currentColor); opacity: 0.6; }
    .status-tag, .severity-tag, .tab-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 500;
      line-height: 1.6;
      white-space: nowrap;
    }
    .status-tag--ok, .severity-tag--ok {
      color: var(--vscode-testing-iconPassed, #2e8b57);
      background: color-mix(in srgb, var(--vscode-testing-iconPassed, #2e8b57) 16%, transparent);
    }
    .status-tag--warn, .severity-tag--warn {
      color: var(--vscode-editorWarning-foreground, #cca700);
      background: color-mix(in srgb, var(--vscode-editorWarning-foreground, #cca700) 16%, transparent);
    }
    .status-tag--bad, .severity-tag--bad {
      color: var(--vscode-testing-iconFailed, #f14c4c);
      background: color-mix(in srgb, var(--vscode-testing-iconFailed, #f14c4c) 16%, transparent);
    }
    .status-tag--neutral, .severity-tag--neutral {
      color: var(--vscode-descriptionForeground);
      background: var(--vscode-badge-background, rgba(128,128,128,0.2));
    }
    .stat-band {
      margin-top: 22px;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
    }
    .card {
      border: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
      border-radius: 6px;
      background: var(--vscode-editorWidget-background, transparent);
    }
    .stat-tile { padding: 14px 16px; }
    .stat-tile-kicker {
      font-size: 11px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
    }
    .stat-tile-value {
      font-size: 26px;
      font-weight: 500;
      margin-top: 4px;
    }
    .stat-tile--warn .stat-tile-value { color: var(--vscode-editorWarning-foreground, #cca700); }
    .stat-tile--bad .stat-tile-value { color: var(--vscode-testing-iconFailed, #f14c4c); }
    .row-counts-card {
      margin-top: 14px;
      padding: 14px 18px;
      display: flex;
      align-items: center;
      gap: 28px;
      flex-wrap: wrap;
    }
    .row-counts-note {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    .row-counts-value { font-size: 15px; font-weight: 500; margin-top: 2px; }
    .row-counts-value--accent { color: var(--vscode-textLink-foreground); }
    .tab-strip {
      margin-top: 26px;
      display: flex;
      gap: 6px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
    }
    .tab-strip input[type="radio"] {
      position: absolute;
      opacity: 0;
      pointer-events: none;
    }
    .tab-strip label {
      padding: 9px 14px;
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      color: var(--vscode-descriptionForeground);
      border-bottom: 2px solid transparent;
      display: flex;
      align-items: center;
      gap: 7px;
      user-select: none;
    }
    .tab-badge {
      background: var(--vscode-badge-background, rgba(128,128,128,0.2));
      color: var(--vscode-badge-foreground, inherit);
      font-size: 10px;
      padding: 1px 6px;
    }
    .tab-panels { margin-top: 18px; }
    .tab-panel { display: none; }
    .panel-heading {
      font-size: 11px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
      font-weight: 500;
      margin: 0 0 10px;
    }
    #tab-schema:checked ~ .tab-panels .tab-panel--schema,
    #tab-profile:checked ~ .tab-panels .tab-panel--profile,
    #tab-volume:checked ~ .tab-panels .tab-panel--volume,
    #tab-rows:checked ~ .tab-panels .tab-panel--rows,
    #tab-sql:checked ~ .tab-panels .tab-panel--sql {
      display: block;
    }
    #tab-schema:checked ~ .tab-strip label[for="tab-schema"],
    #tab-profile:checked ~ .tab-strip label[for="tab-profile"],
    #tab-volume:checked ~ .tab-strip label[for="tab-volume"],
    #tab-rows:checked ~ .tab-strip label[for="tab-rows"],
    #tab-sql:checked ~ .tab-strip label[for="tab-sql"] {
      color: var(--vscode-foreground);
      border-bottom-color: var(--vscode-focusBorder, var(--vscode-textLink-foreground));
    }
    table.data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12.5px;
    }
    table.data-table th, table.data-table td {
      text-align: left;
      padding: 6px 10px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.25));
    }
    table.data-table th {
      font-weight: 500;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    table.column-differences {
      margin: 6px 0 12px 24px;
      width: calc(100% - 24px);
    }
    details.row-detail summary {
      cursor: pointer;
      list-style: none;
    }
    details.row-detail summary::-webkit-details-marker { display: none; }
    details.row-detail summary .row-caret {
      display: inline-block;
      margin-right: 6px;
      transition: transform 0.12s;
    }
    details.row-detail[open] summary .row-caret { transform: rotate(90deg); }
    .empty-state { color: var(--vscode-descriptionForeground); }
    .legend {
      margin-top: 14px;
      padding: 10px 14px;
    }
    .legend summary {
      cursor: pointer;
      font-size: 12.5px;
      font-weight: 500;
      color: var(--vscode-foreground);
    }
    .legend-list {
      margin: 10px 0 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 6px;
    }
    .legend-list li {
      font-size: 12.5px;
      display: flex;
      align-items: baseline;
      gap: 8px;
    }
    .legend-list .severity-tag { flex-shrink: 0; }
    .tab-caption {
      margin: 0 0 12px;
      color: var(--vscode-descriptionForeground);
      font-size: 12.5px;
      line-height: 1.5;
    }
    .sql-card { padding: 0; overflow: hidden; margin-bottom: 12px; }
    .sql-card-header {
      padding: 8px 14px;
      border-bottom: 1px solid var(--vscode-panel-border, rgba(128,128,128,0.35));
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .sql-card pre {
      margin: 0;
      padding: 14px;
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: 12.5px;
      line-height: 1.6;
      white-space: pre-wrap;
      overflow-x: auto;
    }
  </style>`;
}

/**
 * T-48 (finding T-34-02): renders the header meta-line's `source→target`
 * segment (plus its trailing separator, so callers just splice the return
 * value between the `Run <runId>` and duration spans), matching the
 * originally-specified `Run <runId> · source→target · duration` format.
 * Only rendered when both `result.sourceLabel`/`result.targetLabel` are
 * present -- per this task's Scope item 3, `undefined` for either means
 * omit the segment entirely rather than render a partial/broken one (e.g.
 * a run persisted before this field existed, per this task's Prohibited
 * Changes section on `reopenRunCommand`/persisted-run-replay). Both values
 * are escaped through `escapeHtml`, exactly like every other interpolated
 * value in this file.
 */
function renderSourceTargetSegment(result: ComparisonResult): string {
  if (result.sourceLabel === undefined || result.targetLabel === undefined) {
    return "";
  }

  return `<span>${escapeHtml(result.sourceLabel)}&rarr;${escapeHtml(result.targetLabel)}</span>
          <span class="meta-sep">&middot;</span>`;
}

function renderStatBand(result: ComparisonResult): string {
  const rowDelta = result.rowCounts.difference;
  return `<div class="stat-band">
    <div class="card stat-tile">
      <div class="stat-tile-kicker">Passed</div>
      <div class="stat-tile-value">${escapeHtml(result.summary.passed)}</div>
    </div>
    <div class="card stat-tile stat-tile--warn">
      <div class="stat-tile-kicker">Warnings</div>
      <div class="stat-tile-value">${escapeHtml(result.summary.warnings)}</div>
    </div>
    <div class="card stat-tile stat-tile--bad">
      <div class="stat-tile-kicker">Failed</div>
      <div class="stat-tile-value">${escapeHtml(result.summary.failed)}</div>
    </div>
    <div class="card stat-tile">
      <div class="stat-tile-kicker">Row count delta</div>
      <div class="stat-tile-value">${escapeHtml(rowDelta)}</div>
    </div>
  </div>
  <div class="card row-counts-card">
    <div><div class="stat-tile-kicker">Source rows</div><div class="row-counts-value">${escapeHtml(result.rowCounts.source)}</div></div>
    <div><div class="stat-tile-kicker">Target rows</div><div class="row-counts-value">${escapeHtml(result.rowCounts.target)}</div></div>
    <div><div class="stat-tile-kicker">Difference</div><div class="row-counts-value row-counts-value--accent">${escapeHtml(result.rowCounts.difference)}</div></div>
    <div style="flex:1"></div>
    <div class="row-counts-note">Comparison run at read-only isolation</div>
  </div>`;
}

function renderSchemaDifferencesTable(differences: SchemaDifference[]): string {
  if (differences.length === 0) {
    return '<p class="empty-state">No schema differences.</p>';
  }

  const rows = differences
    .map(
      (d) => `<tr>
        <td><span class="${severityTagClass(d.severity)}">${escapeHtml(d.severity)}</span></td>
        <td>${escapeHtml(d.columnName)}</td>
        <td>${escapeHtml(d.kind)}</td>
        <td>${escapeHtml(d.sourceType ?? "")}</td>
        <td>${escapeHtml(d.targetType ?? "")}</td>
        <td>${escapeHtml(d.message)}</td>
      </tr>`
    )
    .join("\n");

  return `<table class="data-table">
    <thead>
      <tr><th>Severity</th><th>Column</th><th>Kind</th><th>Source Type</th><th>Target Type</th><th>Message</th></tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>`;
}

function renderProfileDifferencesTable(differences: ProfileDifference[]): string {
  if (differences.length === 0) {
    return '<p class="empty-state">No profile differences.</p>';
  }

  const rows = differences
    .map(
      (d) => `<tr>
        <td><span class="${severityTagClass(d.severity)}">${escapeHtml(d.severity)}</span></td>
        <td>${escapeHtml(d.columnName)}</td>
        <td>${escapeHtml(d.metric)}</td>
        <td>${escapeHtml(d.sourceValue !== undefined ? String(d.sourceValue) : "")}</td>
        <td>${escapeHtml(d.targetValue !== undefined ? String(d.targetValue) : "")}</td>
        <td>${escapeHtml(d.message)}</td>
      </tr>`
    )
    .join("\n");

  return `<table class="data-table">
    <thead>
      <tr><th>Severity</th><th>Column</th><th>Metric</th><th>Source Value</th><th>Target Value</th><th>Message</th></tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>`;
}

function renderAggregateDifferencesTable(differences: AggregateDifference[]): string {
  if (differences.length === 0) {
    return '<p class="empty-state">No volume differences.</p>';
  }

  const rows = differences
    .map(
      (d) => `<tr>
        <td><span class="${severityTagClass(d.severity)}">${escapeHtml(d.severity)}</span></td>
        <td>${escapeHtml(d.sourceCount)}</td>
        <td>${escapeHtml(d.targetCount)}</td>
        <td>${escapeHtml(d.difference)}</td>
        <td>${escapeHtml(d.differenceRate)}</td>
        <td>${escapeHtml(d.message)}</td>
      </tr>`
    )
    .join("\n");

  return `<table class="data-table">
    <thead>
      <tr><th>Severity</th><th>Source Count</th><th>Target Count</th><th>Difference</th><th>Difference Rate</th><th>Message</th></tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>`;
}

/**
 * Renders `columnDifferences` as a nested sub-table, only present for
 * `"matched-key-differing-values"` row differences per
 * `RowDifference.columnDifferences`'s doc comment in
 * `packages/shared/src/result.ts`.
 */
function renderColumnDifferencesSubTable(columnDifferences: NonNullable<RowDifference["columnDifferences"]>): string {
  const rows = columnDifferences
    .map(
      (c) => `<tr>
          <td>${escapeHtml(c.columnName)}</td>
          <td>${escapeHtml(c.sourceValue !== undefined ? String(c.sourceValue) : "")}</td>
          <td>${escapeHtml(c.targetValue !== undefined ? String(c.targetValue) : "")}</td>
        </tr>`
    )
    .join("\n");

  return `<table class="data-table column-differences">
        <thead>
          <tr><th>Column</th><th>Source Value</th><th>Target Value</th></tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>`;
}

/**
 * Renders one `RowDifference` as a table row. Rows whose category is
 * `"matched-key-differing-values"` (i.e. carry a non-empty
 * `columnDifferences`) get the expand/collapse affordance via a native
 * `<details>`/`<summary>` pair wrapped around the row's caret + message
 * cell, per the brief's CSS/native-only requirement for this interaction
 * (`enableScripts` stays `false`). All other categories render a plain row
 * with no caret, matching the handoff's "only rows with columnDifferences
 * are clickable" spec.
 *
 * `index` is used only to key the id-scoped `id="row-detail-N"` anchor for
 * a stable per-render DOM id — see this file's Row Id Judgment Call note
 * near `renderRowDifferencesTable` for why an index key (not a new
 * `RowDifference` field) is sufficient here.
 */
function renderRowDifferenceRow(d: RowDifference, index: number): string {
  const severityCell = `<span class="${severityTagClass(d.severity)}">${escapeHtml(d.severity)}</span>`;
  const categoryLabel = CATEGORY_LABELS[d.category] ?? d.category;
  const keyValuesLabel = d.keyValues.map((k) => String(k)).join(", ");
  const hasColumnDifferences = d.columnDifferences !== undefined && d.columnDifferences.length > 0;

  if (!hasColumnDifferences) {
    return `<tr data-category="${escapeHtml(d.category)}">
        <td></td>
        <td>${severityCell}</td>
        <td>${escapeHtml(categoryLabel)}</td>
        <td>${escapeHtml(keyValuesLabel)}</td>
        <td>${escapeHtml(d.message)}</td>
      </tr>`;
  }

  return `<tr class="row-detail-row" data-category="${escapeHtml(d.category)}">
      <td colspan="5" style="padding:0">
        <details class="row-detail" id="row-detail-${index}">
          <summary>
            <table class="data-table" style="width:100%">
              <tbody>
                <tr>
                  <td style="width:18px"><span class="row-caret">&#9656;</span></td>
                  <td>${severityCell}</td>
                  <td>${escapeHtml(categoryLabel)}</td>
                  <td>${escapeHtml(keyValuesLabel)}</td>
                  <td>${escapeHtml(d.message)}</td>
                </tr>
              </tbody>
            </table>
          </summary>
          ${renderColumnDifferencesSubTable(d.columnDifferences!)}
        </details>
      </td>
    </tr>`;
}

/**
 * Judgment call (TASK-BRIEF.md Scope item 1's last bullet): the expand/
 * collapse markup above keys each row's `<details id="row-detail-N">` by
 * its index within `differences`, not by a new field added to
 * `RowDifference` in `packages/shared/src/result.ts`. This is sufficient
 * because `renderResultsHtml` is a pure function of its `ComparisonResult`
 * argument and `rowDifferences` is a plain array — the same
 * `ComparisonResult` object always produces `rowDifferences` in the same
 * order, so the same row always gets the same index-derived id across
 * repeated renders of that result (verified by this file's own purity
 * test: "the same input rendered twice produces identical output"). Since
 * each `<details>` only needs a *locally unique, stable-for-this-render*
 * id (there is no cross-render client-side state to persist — scripts are
 * disabled, so "expanded" state lives only in the browser's native
 * `<details open>` DOM state for the lifetime of that one rendered
 * document), an index key never needs to survive a *different* result
 * being rendered into the same id space. `packages/shared/src/result.ts`
 * is therefore left untouched by this task.
 */
function renderRowDifferencesTable(differences: RowDifference[]): string {
  if (differences.length === 0) {
    return '<p class="empty-state">No row-level differences.</p>';
  }

  const rows = differences.map((d, index) => renderRowDifferenceRow(d, index)).join("\n");

  return `<table class="data-table">
    <thead>
      <tr><th></th><th>Severity</th><th>Category</th><th>Key Values</th><th>Message</th></tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>`;
}

/**
 * Renders `queriesUsed` (T-16b) as a "Query Preview" section: an ordered
 * list of the SQL strings actually issued for this run, each shown in its
 * own escaped `<pre>` block, restyled (T-34) as one card per query with a
 * "Query N" header, preserving the existing escaping and one-`<pre>`-per-
 * query structure. Absent/empty `queriesUsed` (no check that issues SQL
 * ran, e.g. a Layer-1 connectivity failure) renders an empty-state
 * message, matching every other difference-array section's empty-state
 * pattern in this file.
 */
export function renderQueryPreviewSection(queriesUsed: string[] | undefined): string {
  if (!queriesUsed || queriesUsed.length === 0) {
    return '<p class="empty-state">No queries recorded for this run.</p>';
  }

  const cards = queriesUsed
    .map(
      (sql, index) => `<div class="card sql-card">
        <div class="sql-card-header">Query ${index + 1}</div>
        <pre>${escapeHtml(sql)}</pre>
      </div>`
    )
    .join("\n");

  return `<div class="sql-cards">${cards}</div>`;
}

/**
 * Renders a `ComparisonResult` as the results webview's HTML content:
 * header (eyebrow/title/meta/status tag), a summary stat band, a CSS-only
 * tab strip (Schema/Profile/Volume/Row-Level/SQL Preview), and each tab's
 * panel content. Pure presentation: no side effects, no I/O beyond
 * building a string, no `vscode` runtime API usage.
 */
export function renderResultsHtml(result: ComparisonResult): string {
  const status = statusTag(result.status);
  const schemaCount = result.schemaDifferences.length;
  const profileCount = result.profileDifferences.length;
  const volumeCount = result.aggregateDifferences.length;
  const rowCount = result.rowDifferences.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Parity Results: ${escapeHtml(result.comparison)}</title>
  ${renderStyles()}
</head>
<body>
  <div class="content">
    <div class="header-row">
      <div>
        <div class="eyebrow">Parity Results</div>
        <h1>${escapeHtml(result.comparison)}</h1>
        <div class="meta-line">
          <span>Run ${escapeHtml(result.runId)}</span>
          <span class="meta-sep">&middot;</span>
          ${renderSourceTargetSegment(result)}
          <span>${escapeHtml(result.execution.sourceDurationMs)}ms source / ${escapeHtml(result.execution.targetDurationMs)}ms target</span>
        </div>
      </div>
      <div>
        <span class="${status.className}">${status.label}</span>
      </div>
    </div>

    ${renderStatBand(result)}

    ${renderLegend()}

    <input type="radio" name="paritylens-tab" id="tab-schema" class="tab-strip-input" checked />
    <input type="radio" name="paritylens-tab" id="tab-profile" class="tab-strip-input" />
    <input type="radio" name="paritylens-tab" id="tab-volume" class="tab-strip-input" />
    <input type="radio" name="paritylens-tab" id="tab-rows" class="tab-strip-input" />
    <input type="radio" name="paritylens-tab" id="tab-sql" class="tab-strip-input" />

    <div class="tab-strip">
      <label for="tab-schema">Schema <span class="tab-badge">${escapeHtml(schemaCount)}</span></label>
      <label for="tab-profile">Profile <span class="tab-badge">${escapeHtml(profileCount)}</span></label>
      <label for="tab-volume">Volume <span class="tab-badge">${escapeHtml(volumeCount)}</span></label>
      <label for="tab-rows">Row-Level <span class="tab-badge">${escapeHtml(rowCount)}</span></label>
      <label for="tab-sql">SQL Preview</label>
    </div>

    <div class="tab-panels">
      <div class="tab-panel tab-panel--schema">
        ${renderTabCaption(
          "Schema differences show column-level mismatches between source and target (missing columns, type changes, length/precision/scale/nullability changes, or column order). A Failure here usually means the two tables aren't structurally compatible yet and should be fixed before trusting other checks; a Warning is worth a quick look to confirm it's expected."
        )}
        ${renderSchemaDifferencesTable(result.schemaDifferences)}
      </div>
      <div class="tab-panel tab-panel--profile">
        ${renderTabCaption(
          "Profile differences show meaningful changes in the shape of the data itself for a column (how many distinct values it has, what percent are blank, its most common value, or new/missing categories) — not every field is compared, only changes considered notable. A finding here suggests the data may have changed in a way worth understanding, even if the schema matches."
        )}
        ${renderProfileDifferencesTable(result.profileDifferences)}
      </div>
      <div class="tab-panel tab-panel--volume">
        ${renderTabCaption(
          "Volume differences compare how many rows exist on each side against an allowed tolerance. A finding here means the row counts don't line up as expected — check whether rows are missing, duplicated, or filtered differently before assuming source and target hold the same data."
        )}
        ${renderAggregateDifferencesTable(result.aggregateDifferences)}
      </div>
      <div class="tab-panel tab-panel--rows">
        ${renderTabCaption(
          "Row-Level differences compare individual matched rows between source and target (missing rows, duplicate rows, or rows whose values differ). Expand a row marked \"Matched key, differing values\" to see exactly which column(s) differ and their source/target values."
        )}
        ${renderRowDifferencesTable(result.rowDifferences)}
      </div>
      <div class="tab-panel tab-panel--sql">
        <h2 class="panel-heading">Query Preview</h2>
        ${renderQueryPreviewSection(result.queriesUsed)}
      </div>
    </div>
  </div>
</body>
</html>`;
}

/**
 * Creates and shows a VS Code webview panel displaying `result` via
 * `renderResultsHtml`. This is the only place in this module that touches
 * the `vscode` API surface beyond types; it takes a `createWebviewPanel`
 * function injected by the caller (activation code) rather than importing
 * `vscode.window` directly, keeping `renderResultsHtml` itself fully
 * decoupled from any live VS Code API and testable as a pure function.
 */
export function showResultsWebview(
  createWebviewPanel: (
    viewType: string,
    title: string,
    showOptions: vscode.ViewColumn,
    options?: vscode.WebviewPanelOptions & vscode.WebviewOptions
  ) => vscode.WebviewPanel,
  viewColumn: vscode.ViewColumn,
  result: ComparisonResult
): vscode.WebviewPanel {
  const panel = createWebviewPanel(
    "paritylens.resultsWebview",
    `Parity Results: ${result.comparison}`,
    viewColumn,
    { enableScripts: false }
  );
  panel.webview.html = renderResultsHtml(result);
  return panel;
}
