import type { ComparisonResult, RowDifference } from "@paritylens/shared";

/**
 * Export module (TASK-BRIEF.md T-16), first task to own
 * `packages/extension/src/export/**`.
 *
 * Each `exportTo*` function is a pure, string-returning function mirroring
 * `renderResultsHtml`'s pure-function pattern from T-11/T-16's webview
 * module — none of these perform file I/O themselves. `writeExport`
 * (`./writeExport.ts`) is the separate, thin function that actually writes
 * to disk after validating the resolved path stays contained under a safe
 * output root.
 */

/** Escapes a single CSV field per RFC 4180: wraps in quotes and doubles any embedded quote whenever the field contains a comma, quote, or newline. */
function escapeCsvField(value: unknown): string {
  const s = value === undefined || value === null ? "" : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(fields: unknown[]): string {
  return fields.map(escapeCsvField).join(",");
}

/**
 * Renders `columnDifferences` (only present for `"matched-key-differing-values"`
 * row differences) as a single semicolon-joined field so it fits in one CSV
 * column without breaking row alignment.
 */
function formatColumnDifferences(columnDifferences: RowDifference["columnDifferences"]): string {
  if (!columnDifferences || columnDifferences.length === 0) {
    return "";
  }
  return columnDifferences
    .map((c) => `${c.columnName}: ${String(c.sourceValue)} -> ${String(c.targetValue)}`)
    .join("; ");
}

/**
 * Renders a `ComparisonResult` as CSV content. Judgment call: rather than
 * one CSV "file" mixing four structurally different row shapes (schema,
 * profile, aggregate, row differences) under one shared header — which
 * would force every row to carry mostly-empty columns for fields that
 * don't apply to its kind — this produces one section per difference
 * category, each with its own header row, concatenated with a blank line
 * between sections. All row-difference rows (the brief's required minimum)
 * include severity/category/keyValues/message columns.
 */
export function exportToCsv(result: ComparisonResult): string {
  const sections: string[] = [];

  sections.push(
    [
      csvRow(["Section", "Comparison", "RunId", "Status"]),
      csvRow(["Summary", result.comparison, result.runId, result.status])
    ].join("\n")
  );

  const schemaLines = [csvRow(["Severity", "ColumnName", "Kind", "SourceType", "TargetType", "Message"])];
  for (const d of result.schemaDifferences) {
    schemaLines.push(csvRow([d.severity, d.columnName, d.kind, d.sourceType ?? "", d.targetType ?? "", d.message]));
  }
  sections.push(["Schema Differences", ...schemaLines].join("\n"));

  const profileLines = [csvRow(["Severity", "ColumnName", "Metric", "SourceValue", "TargetValue", "Message"])];
  for (const d of result.profileDifferences) {
    profileLines.push(
      csvRow([
        d.severity,
        d.columnName,
        d.metric,
        d.sourceValue !== undefined ? String(d.sourceValue) : "",
        d.targetValue !== undefined ? String(d.targetValue) : "",
        d.message
      ])
    );
  }
  sections.push(["Profile Differences", ...profileLines].join("\n"));

  const aggregateLines = [
    csvRow(["Severity", "SourceCount", "TargetCount", "Difference", "DifferenceRate", "Message"])
  ];
  for (const d of result.aggregateDifferences) {
    aggregateLines.push(
      csvRow([d.severity, d.sourceCount, d.targetCount, d.difference, d.differenceRate, d.message])
    );
  }
  sections.push(["Volume (Aggregate) Differences", ...aggregateLines].join("\n"));

  const rowLines = [csvRow(["Severity", "Category", "KeyValues", "Message", "ColumnDifferences"])];
  for (const d of result.rowDifferences) {
    rowLines.push(
      csvRow([
        d.severity,
        d.category,
        d.keyValues.map((k) => String(k)).join(";"),
        d.message,
        formatColumnDifferences(d.columnDifferences)
      ])
    );
  }
  sections.push(["Row-Level Differences", ...rowLines].join("\n"));

  return sections.join("\n\n");
}

/**
 * Renders a `ComparisonResult` as JSON content.
 *
 * Judgment call: serializes the full `ComparisonResult` object as-is (via
 * `JSON.stringify`) rather than a documented subset — the brief's
 * Interfaces table offers both options ("serialize the full
 * `ComparisonResult` (or a documented equivalent subset — document the
 * choice)"). The full object is the simplest choice with no information
 * loss and no risk of a hand-picked subset silently dropping a field a
 * downstream JSON consumer needed; there is no size or sensitivity
 * concern here since `ComparisonResult` contains no credentials (per this
 * project's no-inline-credentials rule) and is already bounded by the
 * comparison run itself.
 */
export function exportToJson(result: ComparisonResult): string {
  return JSON.stringify(result, null, 2);
}

function mdEscape(value: unknown): string {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function mdTable(headers: string[], rows: unknown[][]): string {
  if (rows.length === 0) {
    return "_None._";
  }
  const headerLine = `| ${headers.join(" | ")} |`;
  const separatorLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const bodyLines = rows.map((r) => `| ${r.map(mdEscape).join(" | ")} |`);
  return [headerLine, separatorLine, ...bodyLines].join("\n");
}

/**
 * Renders a `ComparisonResult` as human-readable Markdown, mirroring the
 * webview's section structure (Schema Differences / Profile Differences /
 * Volume Parity / Row-Level Differences).
 */
export function exportToMarkdown(result: ComparisonResult): string {
  const lines: string[] = [];

  lines.push(`# Parity Results: ${result.comparison}`);
  lines.push("");
  lines.push(`Run ${result.runId} — status: **${result.status}**`);
  lines.push("");
  lines.push(
    `Summary: ${result.summary.passed} passed | ${result.summary.warnings} warnings | ${result.summary.failed} failed`
  );
  lines.push("");

  lines.push("## Schema Differences");
  lines.push("");
  lines.push(
    mdTable(
      ["Severity", "Column", "Kind", "Source Type", "Target Type", "Message"],
      result.schemaDifferences.map((d) => [d.severity, d.columnName, d.kind, d.sourceType ?? "", d.targetType ?? "", d.message])
    )
  );
  lines.push("");

  lines.push("## Profile Differences");
  lines.push("");
  lines.push(
    mdTable(
      ["Severity", "Column", "Metric", "Source Value", "Target Value", "Message"],
      result.profileDifferences.map((d) => [
        d.severity,
        d.columnName,
        d.metric,
        d.sourceValue !== undefined ? String(d.sourceValue) : "",
        d.targetValue !== undefined ? String(d.targetValue) : "",
        d.message
      ])
    )
  );
  lines.push("");

  lines.push("## Volume Parity");
  lines.push("");
  lines.push(
    mdTable(
      ["Severity", "Source Count", "Target Count", "Difference", "Difference Rate", "Message"],
      result.aggregateDifferences.map((d) => [d.severity, d.sourceCount, d.targetCount, d.difference, d.differenceRate, d.message])
    )
  );
  lines.push("");

  lines.push("## Row-Level Differences");
  lines.push("");
  lines.push(
    mdTable(
      ["Severity", "Category", "Key Values", "Message", "Column Differences"],
      result.rowDifferences.map((d) => [
        d.severity,
        d.category,
        d.keyValues.map((k) => String(k)).join(", "),
        d.message,
        formatColumnDifferences(d.columnDifferences)
      ])
    )
  );
  lines.push("");

  return lines.join("\n");
}
