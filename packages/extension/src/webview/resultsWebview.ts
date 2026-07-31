import type * as vscode from "vscode";
import type { ComparisonResult, SchemaDifference, ProfileDifference } from "@paritylens/shared";

/**
 * Phase-1 results webview panel (TASK-BRIEF.md T-11).
 *
 * `renderResultsHtml` is deliberately a pure function: its only input is a
 * `ComparisonResult` object. It never reads `vscode.workspace`,
 * `SecretStorage`, or invokes a connector — per the brief's Interfaces
 * table ("the function's only input is the `ComparisonResult` object")
 * and the reviewer note asking this to be scrutinized hardest. Only
 * `schemaDifferences` and `profileDifferences` are rendered:
 * `aggregateDifferences`/`rowDifferences` stay empty until T-13/T-14/T-15
 * exist, per the brief's explicit Phase-1 scope boundary — this function
 * does not read those two arrays at all.
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
