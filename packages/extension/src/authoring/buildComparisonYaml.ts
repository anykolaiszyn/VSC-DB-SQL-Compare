// T-32: pure, `vscode`-free YAML scaffold builder for the
// `paritylens.newComparison` command.
//
// Mirrors this codebase's established pure-core / injected-VS-Code-glue
// split -- see `runComparisonCommand`'s `deps` pattern in
// `packages/extension/src/activation/activate.ts` and
// `resultsWebview.ts`'s `renderResultsHtml` (per TASK-BRIEF.md Scope item
// 1). This module never imports `vscode` and is directly unit-testable.
//
// SECURITY (TASK-BRIEF.md's "Prohibited changes"): `sourceConnection`/
// `targetConnection` are always written as bare YAML string values under
// `source.connection`/`target.connection` -- never as inline objects --
// matching `parseDefinition`'s (T-08) enforced `ParitySide.connection`
// shape (a bare string naming a connection profile). This holds
// regardless of what the user typed as a connection "name" (e.g. even if
// it looks credential-shaped) because this builder only ever interpolates
// it as a scalar string value into a `connection:` YAML mapping entry --
// there is no code path here that could turn a free-typed connection name
// into a structured/nested field.
//
// T-35b: extended to emit all three `ParitySide` kinds (T-35a's widened
// union in `packages/engine/src/orchestration/definition/definition.ts`)
// and `column_mapping`. `NewComparisonAnswerSide` below mirrors
// `ParitySide`'s discriminated union shape exactly -- one variant per
// `kind` -- rather than a single "all fields optional" bag type, so a
// caller cannot accidentally supply `object` on a `query`-kind side or
// `sql` on a `table`-kind side; TypeScript rejects that at the call site
// the same way `parseSide` rejects it at parse time.
//
// T-36: extended again to emit a `checks` block (`checks.schema.enabled`/
// `checks.rowCount.enabled`/`checks.profile.enabled`/`checks.rowLevel.enabled`)
// -- the comparison editor (T-36) is the first caller that needs this;
// T-35b's brief explicitly did not include `checks`. Only the four
// `enabled` toggles are supported here, per TASK-BRIEF.md T-36 Scope item
// 5 -- `tolerance`/`strategy`/`maxDifferences`/`topValues` sub-fields are
// out of this task's scope and stay hand-YAML-edited. See
// `NewComparisonAnswerChecks`'s own doc comment for the omit-when-default
// judgment call.

/** One source/target side of `NewComparisonAnswers`, mirroring
 * `ParitySide`'s (T-35a) discriminated union exactly. `query`/`sqlFile`
 * kinds have no `where` field of their own -- per TASK-BRIEF.md Scope item
 * 1, a row filter for those kinds belongs inside the `sql`/file contents
 * itself, matching `parseSide`'s own rejection of `where` on those kinds. */
export type NewComparisonAnswerSide =
  | { kind: "table"; object: string; where?: string }
  | { kind: "query"; sql: string }
  | { kind: "sqlFile"; filePath: string };

/** Answers for `checks` emission (T-36) -- four independent enabled
 * toggles, matching `ParityChecks`'s `schema`/`rowCount`/`profile`/
 * `rowLevel` sub-objects but restricted to just `enabled` (per
 * TASK-BRIEF.md T-36 Scope item 5, this task's caller -- the comparison
 * editor -- only builds UI for the enabled toggles, not
 * `tolerance`/`strategy`/`maxDifferences`/`topValues`). Each key is
 * independently optional: a key entirely absent from `checks` means "leave
 * this check's enabled state unspecified" (the emitted YAML omits that
 * sub-block, and `parseDefinition` leaves the corresponding `ParityChecks`
 * property `undefined`) -- distinct from `{ enabled: false }`, which
 * explicitly emits a disabled sub-block. */
export interface NewComparisonAnswerChecks {
  schema?: { enabled: boolean };
  rowCount?: { enabled: boolean };
  profile?: { enabled: boolean };
  rowLevel?: { enabled: boolean };
}

/** Already-collected answers from `runNewComparisonWizard` (or any other
 * caller), sufficient to scaffold a minimal `.paritylens` definition.
 *
 * Backward-compatible field names: `comparisonName`/`keys`/
 * `sourceConnection`/`targetConnection` are unchanged from the pre-T-35b
 * shape (`newComparisonWizard.ts`'s existing call site keeps compiling and
 * behaving unchanged, per TASK-BRIEF.md Scope item 6). `sourceObject`/
 * `sourceWhere`/`targetObject`/`targetWhere` are now optional convenience
 * aliases for the common `table`-kind case: when `source`/`target` (the
 * new discriminated-union fields) are absent, they are synthesized from
 * these flat fields as `kind: "table"`. When `source`/`target` is present,
 * it takes precedence over the flat fields for that side. */
export interface NewComparisonAnswers {
  /** The parity definition's `name` field. */
  comparisonName: string;
  sourceConnection: string;
  /** Flat `table`-kind convenience field, used only when `source` is
   * absent. Ignored if `source` is present. */
  sourceObject?: string;
  /** Flat `table`-kind convenience field, used only when `source` is
   * absent. Ignored if `source` is present. */
  sourceWhere?: string;
  /** Discriminated-union side answer (T-35b). Takes precedence over
   * `sourceObject`/`sourceWhere` when present, enabling `query`/`sqlFile`
   * kinds. */
  source?: NewComparisonAnswerSide;
  targetConnection: string;
  /** Flat `table`-kind convenience field, used only when `target` is
   * absent. Ignored if `target` is present. */
  targetObject?: string;
  /** Flat `table`-kind convenience field, used only when `target` is
   * absent. Ignored if `target` is present. */
  targetWhere?: string;
  /** Discriminated-union side answer (T-35b). Takes precedence over
   * `targetObject`/`targetWhere` when present, enabling `query`/`sqlFile`
   * kinds. */
  target?: NewComparisonAnswerSide;
  /** One or more key column names (composite keys supported, per
   * `ParityDefinition.keys`). */
  keys: string[];
  /** Optional column mapping entries (T-35b). Omitted from the emitted
   * YAML entirely when absent or empty, matching this file's existing
   * convention for other optional fields (e.g. `where`) -- relies on
   * `parseDefinition`'s existing "absent -> `[]`" default rather than
   * emitting an explicit empty `column_mapping: []`. */
  columnMapping?: ColumnMappingEntry[];
  /** Optional `checks` enabled-toggle answers (T-36). Omitted from the
   * emitted YAML entirely when absent or when every provided toggle key is
   * itself absent (i.e. an empty `{}`), matching this file's existing
   * omit-when-absent convention for other optional fields -- relies on
   * `parseDefinition`'s existing "absent -> `{}`" default for `checks`
   * rather than emitting an explicit empty `checks: {}`. When present,
   * only the toggles actually supplied are emitted (this file's chosen
   * judgment call over "emit all four, defaulting unspecified ones to
   * `parseDefinition`'s implicit defaults" -- see this field's usage in
   * `buildComparisonYaml` and the header comment above for the reasoning:
   * a toggle a caller never mentioned should stay entirely unspecified in
   * the document, not silently written as an explicit value). */
  checks?: NewComparisonAnswerChecks;
}

/** A single column mapping entry -- re-exported from the engine's
 * `ColumnMappingEntry` (T-08/T-28, read-only consumed here) so callers of
 * this module don't need a separate `@paritylens/engine` import just to
 * type a `columnMapping` answer. */
import type { ColumnMappingEntry } from "@paritylens/engine";
export type { ColumnMappingEntry } from "@paritylens/engine";

/** Quotes a YAML scalar as a double-quoted string, escaping backslashes,
 * double quotes, and embedded newlines/carriage returns so arbitrary user
 * input (including anything containing `:`, `#`, a literal newline, or
 * other YAML-significant characters) round-trips safely through the
 * `yaml` parser `parseDefinition` uses. Using an explicit double-quoted
 * scalar for every user-supplied value -- rather than emitting
 * bare/unquoted YAML -- avoids ever having to reason about which
 * characters are safe to leave unquoted. A double-quoted YAML scalar
 * cannot contain a literal, unescaped newline even with the closing quote
 * balanced (it would either break the mapping's flow or require YAML's
 * `\n` escape), so newlines are escaped the same way backslashes/quotes
 * are rather than left as literal line breaks. */
function yamlQuotedString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
  return `"${escaped}"`;
}

/** Resolves one side's answer into the `NewComparisonAnswerSide` shape,
 * preferring the discriminated-union `source`/`target` field when present
 * and falling back to synthesizing a `table`-kind side from the flat
 * `sourceObject`/`sourceWhere` (or `targetObject`/`targetWhere`)
 * convenience fields otherwise -- see `NewComparisonAnswers`'s header
 * comment for the precedence rule. */
function resolveSide(
  side: NewComparisonAnswerSide | undefined,
  flatObject: string | undefined,
  flatWhere: string | undefined
): NewComparisonAnswerSide {
  if (side !== undefined) {
    return side;
  }
  // Flat-field fallback is always `table`-kind (the only kind the flat
  // fields can express); `flatObject` is required in this path since a
  // side must resolve to *some* valid ParitySide shape.
  return flatWhere !== undefined && flatWhere.trim() !== ""
    ? { kind: "table", object: flatObject ?? "", where: flatWhere }
    : { kind: "table", object: flatObject ?? "" };
}

/** Renders a `source`/`target` block for the scaffolded YAML, dispatching
 * on `side.kind` to emit exactly the fields `parseSide` (T-35a,
 * `definition.ts`) expects for that kind -- `kind: "table"` is always
 * emitted explicitly (never relying on `parseSide`'s absent-kind-defaults-
 * to-table backward-compatibility path, which exists only for documents
 * written before T-35a), and `where` is omitted entirely when not provided
 * or blank (matches `ParitySide.where`'s optional-field shape). */
function renderSide(connection: string, side: NewComparisonAnswerSide): string {
  const lines = [`  connection: ${yamlQuotedString(connection)}`];

  if (side.kind === "query") {
    lines.push(`  kind: "query"`);
    lines.push(`  sql: ${yamlQuotedString(side.sql)}`);
    return lines.join("\n");
  }

  if (side.kind === "sqlFile") {
    lines.push(`  kind: "sqlFile"`);
    lines.push(`  filePath: ${yamlQuotedString(side.filePath)}`);
    return lines.join("\n");
  }

  // side.kind === "table"
  lines.push(`  kind: "table"`);
  lines.push(`  object: ${yamlQuotedString(side.object)}`);
  if (side.where !== undefined && side.where.trim() !== "") {
    lines.push(`  where: ${yamlQuotedString(side.where)}`);
  }
  return lines.join("\n");
}

/** Renders one `column_mapping` list entry, supporting both
 * `ColumnMappingEntry` variants -- plain `{ source, target }` and derived
 * `{ name, target, sourceExpression?, targetExpression? }` -- as the
 * list-of-objects form `parseColumnMappingListEntry` (`definition.ts`)
 * accepts. Uses the list form (not the flat string-map alternative form)
 * per TASK-BRIEF.md Scope item 3, since it unambiguously covers both
 * variants. `source_expression`/`target_expression` (the YAML field
 * names `parseColumnMappingListEntry` reads) are only emitted when
 * present, matching every other optional-field convention in this file. */
function renderColumnMappingEntry(entry: ColumnMappingEntry): string {
  const lines: string[] = [];
  if ("source" in entry) {
    lines.push(`  - source: ${yamlQuotedString(entry.source)}`);
    lines.push(`    target: ${yamlQuotedString(entry.target)}`);
    return lines.join("\n");
  }

  lines.push(`  - name: ${yamlQuotedString(entry.name)}`);
  lines.push(`    target: ${yamlQuotedString(entry.target)}`);
  if (entry.sourceExpression !== undefined) {
    lines.push(`    source_expression: ${yamlQuotedString(entry.sourceExpression)}`);
  }
  if (entry.targetExpression !== undefined) {
    lines.push(`    target_expression: ${yamlQuotedString(entry.targetExpression)}`);
  }
  return lines.join("\n");
}

/** Renders the `checks:` block from `NewComparisonAnswerChecks`, emitting
 * only the sub-blocks the caller actually supplied (see
 * `NewComparisonAnswers.checks`'s doc comment for the judgment call). YAML
 * key names are snake_case (`row_count`, `row_level`) matching
 * `parseChecks` (`definition.ts`, lines ~502-558) reading `obj["row_count"]`/
 * `obj["row_level"]` -- the TS/`ParityChecks` fields are camelCase
 * (`rowCount`/`rowLevel`), matching this codebase's established
 * camelCase-TS/snake_case-YAML convention already used for
 * `source_expression`/`target_expression`/`exclude_columns` elsewhere in
 * this file. Returns `undefined` (rather than an empty string) when no
 * toggle was actually supplied, so the caller can omit the `checks:` key
 * entirely instead of emitting a value-less mapping key. */
function renderChecks(checks: NewComparisonAnswerChecks | undefined): string | undefined {
  if (checks === undefined) {
    return undefined;
  }

  const lines: string[] = [];
  if (checks.schema !== undefined) {
    lines.push(`  schema:`);
    lines.push(`    enabled: ${checks.schema.enabled}`);
  }
  if (checks.rowCount !== undefined) {
    lines.push(`  row_count:`);
    lines.push(`    enabled: ${checks.rowCount.enabled}`);
  }
  if (checks.profile !== undefined) {
    lines.push(`  profile:`);
    lines.push(`    enabled: ${checks.profile.enabled}`);
  }
  if (checks.rowLevel !== undefined) {
    lines.push(`  row_level:`);
    lines.push(`    enabled: ${checks.rowLevel.enabled}`);
  }

  return lines.length > 0 ? lines.join("\n") : undefined;
}

/**
 * Builds a minimal `.paritylens` YAML document from already-collected
 * wizard answers. Sets exactly the fields `parseDefinition` (T-08)
 * requires -- `version`, `name`, `source`, `target`, `keys` -- per
 * TASK-BRIEF.md Scope item 1, plus `column_mapping` when non-empty
 * (T-35b, Scope item 3). `exclude_columns`/`rules`/`checks` are all left
 * absent; `parseDefinition` treats each as optional and defaults them
 * (empty array/object), so the scaffold stays genuinely minimal rather
 * than pre-populating fields the user hasn't specified yet.
 *
 * Free of any `vscode` API usage -- callers (the wizard, or a direct
 * caller/test) pass in already-resolved answers.
 */
export function buildComparisonYaml(answers: NewComparisonAnswers): string {
  const keysYaml = answers.keys.map((key) => `  - ${yamlQuotedString(key)}`).join("\n");

  const sourceSide = resolveSide(answers.source, answers.sourceObject, answers.sourceWhere);
  const targetSide = resolveSide(answers.target, answers.targetObject, answers.targetWhere);

  const lines = [
    `version: 1`,
    `name: ${yamlQuotedString(answers.comparisonName)}`,
    `source:`,
    renderSide(answers.sourceConnection, sourceSide),
    `target:`,
    renderSide(answers.targetConnection, targetSide),
    `keys:`,
    keysYaml
  ];

  if (answers.columnMapping !== undefined && answers.columnMapping.length > 0) {
    lines.push(`column_mapping:`);
    lines.push(...answers.columnMapping.map(renderColumnMappingEntry));
  }

  const checksBlock = renderChecks(answers.checks);
  if (checksBlock !== undefined) {
    lines.push(`checks:`);
    lines.push(checksBlock);
  }

  lines.push(``);
  return lines.join("\n");
}
