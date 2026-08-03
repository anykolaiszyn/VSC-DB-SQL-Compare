// T-37: pure, `vscode`-free data-shaping helpers for the Column Mapping
// tab (SSIS-style visual mapper) added to the custom comparison editor
// (T-36, `comparisonEditorProvider.ts`/`comparisonEditorHtml.ts`).
//
// Same pure-core pattern as `buildComparisonYaml.ts` (see that file's
// header comment): no `vscode` import, directly unit-testable, no I/O.
// The live `getSchema` round trip itself happens in
// `comparisonEditorProvider.ts` (which owns the `vscode`/connector-facing
// glue); this module only shapes the fetched or manually-entered data into
// the tab's row-based draft state, and converts that draft state back into
// `ColumnMappingEntry[]` on Apply.
//
// TASK-BRIEF.md Scope item 2: only the plain `{ source, target }`
// `ColumnMappingEntry` variant is produced here -- a dropdown pick is
// inherently a plain source->target pairing, not a derived-expression
// mapping. The derived `{ name, target, sourceExpression, targetExpression }`
// variant (which `buildComparisonYaml`, T-35b, already supports emitting)
// has no UI path through this module, per the brief's explicit scope
// boundary.

import type { ColumnDefinition } from "@paritylens/shared";
import type { ColumnMappingEntry } from "@paritylens/engine";

/**
 * One row of the Column Mapping tab's draft state: a source column name
 * paired with a currently-selected target column name (`""` meaning "no
 * mapping / same name" -- the identical-name fallback already handled at
 * comparison time by the engine, per T-28's precedent referenced in
 * TASK-BRIEF.md Scope item 3), plus the full list of selectable target
 * column names for that row's `<select>` (populated in live-fetch mode;
 * empty in manual-entry mode, where the target is a free-text input
 * instead of a dropdown).
 *
 * Judgment call (TASK-BRIEF.md's "Produced" section explicitly leaves this
 * shape's name/fields to this task): `targetOptions` is duplicated onto
 * every row (rather than hoisted once to a shared list alongside the row
 * array) because `comparisonEditorHtml.ts`'s render function operates on
 * one row at a time when building each row's `<select>` -- keeping the
 * options co-located with the row avoids that render function needing a
 * second parameter threaded through every row-rendering call. All rows
 * in a single fetched set share the identical `targetOptions` array
 * (same reference) rather than a per-row copy, so this is not a
 * meaningful memory duplication.
 */
export interface ColumnMappingRow {
  source: string;
  target: string;
  targetOptions: string[];
}

/**
 * Builds one `ColumnMappingRow` per fetched source column (live-fetch,
 * Table-mode-only path -- TASK-BRIEF.md Scope item 1). Every row carries
 * the same full `targetColumns` name list for its dropdown. A row's
 * `target` is pre-selected to the source column's own name when a target
 * column of that exact name exists (the "no mapping / same name" default
 * state becomes an explicit, visible selection when it would trivially
 * match -- purely a UX convenience; leaving it unselected would still
 * behave identically at comparison time per the identical-name fallback,
 * but a populated dropdown is expected UI-of-record for an SSIS-style
 * mapper). No match -> `target: ""`, rendered as the "no mapping / same
 * name" default option by `comparisonEditorHtml.ts`.
 */
export function buildMappingRowsFromColumns(sourceColumns: ColumnDefinition[], targetColumns: ColumnDefinition[]): ColumnMappingRow[] {
  const targetNames = targetColumns.map((c) => c.name);
  const targetNameSet = new Set(targetNames);
  return sourceColumns.map((source) => ({
    source: source.name,
    target: targetNameSet.has(source.name) ? source.name : "",
    targetOptions: targetNames
  }));
}

/**
 * Builds the manual free-text-entry fallback row set (non-Table-mode side,
 * or a `getSchema` fetch failure -- TASK-BRIEF.md Scope item 1/3). With no
 * existing rows supplied, returns a single blank editable row (the tab's
 * initial "Add row" starting point); when `existing` is supplied (e.g.
 * re-rendering after the user has already typed some rows, or restoring
 * from a previously-applied document's `column_mapping` entries), it is
 * returned unchanged -- this function's only job on that path is supplying
 * a sane default, not transforming already-valid manual rows.
 */
export function buildManualMappingRows(existing?: ColumnMappingRow[]): ColumnMappingRow[] {
  if (existing !== undefined) {
    return existing;
  }
  return [{ source: "", target: "", targetOptions: [] }];
}

/**
 * Converts the tab's current row-based draft state into `ColumnMappingEntry[]`
 * (T-08's shape, consumed as-is per TASK-BRIEF.md's Interfaces section) for
 * `buildComparisonYaml`. Only produces the plain `{ source, target }`
 * variant (see this file's header comment). A row is included only when
 * both `source` and `target` are non-blank after trimming -- a row with no
 * target selected relies on the engine's identical-name fallback and needs
 * no explicit `column_mapping` entry at all (per T-28 precedent,
 * TASK-BRIEF.md Scope item 3); a row with a blank source name is an
 * incomplete manual-entry row that cannot become a valid mapping entry.
 * Whitespace is trimmed from both fields so manually-typed entries with
 * incidental leading/trailing spaces don't silently fail to match a real
 * column name at comparison time.
 */
export function mappingRowsToColumnMappingEntries(rows: ColumnMappingRow[]): ColumnMappingEntry[] {
  const entries: ColumnMappingEntry[] = [];
  for (const row of rows) {
    const source = row.source.trim();
    const target = row.target.trim();
    if (source === "" || target === "") {
      continue;
    }
    entries.push({ source, target });
  }
  return entries;
}
