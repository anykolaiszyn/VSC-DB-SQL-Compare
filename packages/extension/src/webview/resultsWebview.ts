import type * as vscode from "vscode";
import type {
  ComparisonResult,
  SchemaDifference,
  ProfileDifference,
  AggregateDifference,
  RowDifference
} from "@paritylens/shared";

/**
 * Results webview panel (TASK-BRIEF.md T-11, extended by T-16, extended
 * again by T-16b).
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

function renderSchemaDifferencesTable(differences: SchemaDifference[]): string {
  if (differences.length === 0) {
    return "<p>No schema differences.</p>";
  }

  const rows = differences
    .map(
      (d) => `<tr>
        <td>${escapeHtml(d.severity)}</td>
        <td>${escapeHtml(d.columnName)}</td>
        <td>${escapeHtml(d.kind)}</td>
        <td>${escapeHtml(d.sourceType ?? "")}</td>
        <td>${escapeHtml(d.targetType ?? "")}</td>
        <td>${escapeHtml(d.message)}</td>
      </tr>`
    )
    .join("\n");

  return `<table>
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
    return "<p>No profile differences.</p>";
  }

  const rows = differences
    .map(
      (d) => `<tr>
        <td>${escapeHtml(d.severity)}</td>
        <td>${escapeHtml(d.columnName)}</td>
        <td>${escapeHtml(d.metric)}</td>
        <td>${escapeHtml(d.sourceValue !== undefined ? String(d.sourceValue) : "")}</td>
        <td>${escapeHtml(d.targetValue !== undefined ? String(d.targetValue) : "")}</td>
        <td>${escapeHtml(d.message)}</td>
      </tr>`
    )
    .join("\n");

  return `<table>
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
    return "<p>No volume differences.</p>";
  }

  const rows = differences
    .map(
      (d) => `<tr>
        <td>${escapeHtml(d.severity)}</td>
        <td>${escapeHtml(d.sourceCount)}</td>
        <td>${escapeHtml(d.targetCount)}</td>
        <td>${escapeHtml(d.difference)}</td>
        <td>${escapeHtml(d.differenceRate)}</td>
        <td>${escapeHtml(d.message)}</td>
      </tr>`
    )
    .join("\n");

  return `<table>
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

  return `<table class="column-differences">
        <thead>
          <tr><th>Column</th><th>Source Value</th><th>Target Value</th></tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>`;
}

function renderRowDifferencesTable(differences: RowDifference[]): string {
  if (differences.length === 0) {
    return "<p>No row-level differences.</p>";
  }

  const rows = differences
    .map(
      (d) => `<tr>
        <td>${escapeHtml(d.severity)}</td>
        <td>${escapeHtml(d.category)}</td>
        <td>${escapeHtml(d.keyValues.map((k) => String(k)).join(", "))}</td>
        <td>${escapeHtml(d.message)}</td>
        <td>${d.columnDifferences && d.columnDifferences.length > 0 ? renderColumnDifferencesSubTable(d.columnDifferences) : ""}</td>
      </tr>`
    )
    .join("\n");

  return `<table>
    <thead>
      <tr><th>Severity</th><th>Category</th><th>Key Values</th><th>Message</th><th>Column Differences</th></tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>`;
}

/**
 * Renders `queriesUsed` (T-16b) as a "Query Preview" section: an ordered
 * list of the SQL strings actually issued for this run, each shown in its
 * own escaped `<pre>` block. Absent/empty `queriesUsed` (no check that
 * issues SQL ran, e.g. a Layer-1 connectivity failure) renders an
 * empty-state message, matching every other difference-array section's
 * empty-state pattern in this file.
 */
function renderQueryPreviewSection(queriesUsed: string[] | undefined): string {
  if (!queriesUsed || queriesUsed.length === 0) {
    return "<p>No queries recorded for this run.</p>";
  }

  const items = queriesUsed.map((sql) => `<li><pre>${escapeHtml(sql)}</pre></li>`).join("\n");

  return `<ol>
    ${items}
  </ol>`;
}

/**
 * Renders a `ComparisonResult` as the results webview's HTML content,
 * showing `schemaDifferences` and `profileDifferences` each as a table
 * (one row per item). Pure presentation: no side effects, no I/O beyond
 * building a string.
 */
export function renderResultsHtml(result: ComparisonResult): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Parity Results: ${escapeHtml(result.comparison)}</title>
</head>
<body>
  <h1>Parity Results: ${escapeHtml(result.comparison)}</h1>
  <p>Run ${escapeHtml(result.runId)} — status: ${escapeHtml(result.status)}</p>
  <p>Summary: ${escapeHtml(result.summary.passed)} passed | ${escapeHtml(
    result.summary.warnings
  )} warnings | ${escapeHtml(result.summary.failed)} failed</p>

  <h2>Schema Differences</h2>
  ${renderSchemaDifferencesTable(result.schemaDifferences)}

  <h2>Profile Differences</h2>
  ${renderProfileDifferencesTable(result.profileDifferences)}

  <h2>Volume Parity</h2>
  ${renderAggregateDifferencesTable(result.aggregateDifferences)}

  <h2>Row-Level Differences</h2>
  ${renderRowDifferencesTable(result.rowDifferences)}

  <h2>Query Preview</h2>
  ${renderQueryPreviewSection(result.queriesUsed)}
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
