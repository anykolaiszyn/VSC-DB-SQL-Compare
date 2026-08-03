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

/** Already-collected answers from `runNewComparisonWizard` (or any other
 * caller), sufficient to scaffold a minimal `.paritylens` definition. */
export interface NewComparisonAnswers {
  /** The parity definition's `name` field. */
  comparisonName: string;
  sourceConnection: string;
  sourceObject: string;
  sourceWhere?: string;
  targetConnection: string;
  targetObject: string;
  targetWhere?: string;
  /** One or more key column names (composite keys supported, per
   * `ParityDefinition.keys`). */
  keys: string[];
}

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

/** Renders a `source`/`target` block for the scaffolded YAML. `where` is
 * omitted entirely when not provided (matches `ParitySide.where`'s
 * optional-field shape in `parseDefinition`). */
function renderSide(connection: string, object: string, where: string | undefined): string {
  const lines = [`  connection: ${yamlQuotedString(connection)}`, `  object: ${yamlQuotedString(object)}`];
  if (where !== undefined && where.trim() !== "") {
    lines.push(`  where: ${yamlQuotedString(where)}`);
  }
  return lines.join("\n");
}

/**
 * Builds a minimal `.paritylens` YAML document from already-collected
 * wizard answers. Sets exactly the fields `parseDefinition` (T-08)
 * requires -- `version`, `name`, `source`, `target`, `keys` -- per
 * TASK-BRIEF.md Scope item 1. `column_mapping`/`exclude_columns`/`rules`/
 * `checks` are all left absent; `parseDefinition` treats each as optional
 * and defaults them (empty array/object), so the scaffold stays genuinely
 * minimal rather than pre-populating fields the user hasn't specified yet.
 *
 * Free of any `vscode` API usage -- callers (the wizard, or a direct
 * caller/test) pass in already-resolved answers.
 */
export function buildComparisonYaml(answers: NewComparisonAnswers): string {
  const keysYaml = answers.keys.map((key) => `  - ${yamlQuotedString(key)}`).join("\n");

  return [
    `version: 1`,
    `name: ${yamlQuotedString(answers.comparisonName)}`,
    `source:`,
    renderSide(answers.sourceConnection, answers.sourceObject, answers.sourceWhere),
    `target:`,
    renderSide(answers.targetConnection, answers.targetObject, answers.targetWhere),
    `keys:`,
    keysYaml,
    ``
  ].join("\n");
}
