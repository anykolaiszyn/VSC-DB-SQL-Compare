// T-08: Parity YAML definition schema and parser.
//
// Parses the "Comparison Definition as Code" YAML structure given verbatim
// in Idea Prompt.md section 7 into a strongly-typed `ParityDefinition`, and
// enforces the security rule from DESIGN-SPEC.md's "Security, privacy, and
// safety" section:
//
//   "Parity definition YAML files reference named connection profiles
//    only -- never inline secrets. This is enforced by the parity
//    definition schema rejecting any credential-shaped field."
//
// YAML library choice: `yaml` (eemeli/yaml), not `js-yaml`. `yaml`'s
// `parse()` only ever produces plain JS data (strings/numbers/
// booleans/null/arrays/objects) from standard YAML tags -- it has no
// "unsafe load" mode and does not support resolving arbitrary custom
// tags to executable JS by default, so there is no unsafe-vs-safe API
// footgun to document around (unlike js-yaml, where `load()` historically
// had an unsafe counterpart and custom-schema/tag support that can be
// misused to construct arbitrary objects or trigger code execution from a
// crafted document). `yaml` is added as a direct dependency of
// `packages/engine` (see package.json) specifically for this task.
import { parse as parseYaml } from "yaml";

/** Thrown by `parseDefinition` on any schema violation -- malformed YAML,
 * a missing required field, or a credential-shaped field anywhere in the
 * document. Never thrown for any other reason. */
export class InvalidDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDefinitionError";
  }
}

/** A source or target reference: a named connection profile plus the
 * object/query/SQL-file to read from that connection, per Idea Prompt.md
 * section 7's `source`/`target` shape. `connection` is always a bare
 * string naming a connection profile -- never an inline object with
 * connection details -- per DESIGN-SPEC.md's security model. */
export interface ParitySide {
  /** Named connection profile reference (never inline connection details). */
  connection: string;
  /** Table/view/object reference, e.g. "dbo.Customer". */
  object: string;
  /** Optional row filter applied on this side only. */
  where?: string;
}

/** A single column mapping entry. A plain `source` -> `target` name
 * mapping (Idea Prompt.md section 3's basic case), or a derived mapping
 * using a `name` plus a `source_expression` and/or `target_expression`
 * (section 3's "Derived mappings" case) mapping onto a `target` column. */
export type ColumnMappingEntry =
  | { source: string; target: string }
  | {
      name: string;
      target: string;
      sourceExpression?: string;
      targetExpression?: string;
    };

/** Per-column normalization rule, per Idea Prompt.md section 4's worked
 * example. Every field is optional; a rule may combine any subset. */
export interface NormalizationRule {
  trim?: boolean;
  caseSensitive?: boolean;
  collapseWhitespace?: boolean;
  numericTolerance?: {
    absolute?: number;
    percentage?: number;
  };
  timezone?: {
    source: string;
    target: string;
  };
  truncateTo?: string;
  nullEquivalents?: string[];
}

/** Per-check-type enabled/tolerance structure, per Idea Prompt.md section
 * 7's `checks` example (`schema`, `row_count`, `profile`, `row_level`). */
export interface ParityChecks {
  schema?: {
    enabled: boolean;
  };
  rowCount?: {
    enabled: boolean;
    tolerance?: {
      percentage?: number;
      absolute?: number;
    };
  };
  profile?: {
    enabled: boolean;
    topValues?: number;
  };
  rowLevel?: {
    enabled: boolean;
    strategy?: string;
    maxDifferences?: number;
  };
}

/** The parsed, validated Parity comparison definition -- Idea Prompt.md
 * section 7's YAML structure as a strongly-typed shape, consumed by the
 * orchestration planner (T-09). */
export interface ParityDefinition {
  version: number;
  name: string;
  source: ParitySide;
  target: ParitySide;
  /** Matching key column name(s). A single entry for a simple key, or
   * multiple entries for a composite key (Idea Prompt.md section 6). */
  keys: string[];
  columnMapping: ColumnMappingEntry[];
  excludeColumns: string[];
  rules: Record<string, NormalizationRule>;
  checks: ParityChecks;
}

// --- Credential detection ---------------------------------------------
//
// Field names (YAML mapping keys) that are always rejected, anywhere in
// the document, regardless of nesting depth or casing. This list
// intentionally covers common credential-shaped field names beyond just
// "password" per DESIGN-SPEC.md/TASK-BRIEF.md's explicit examples, plus a
// few additional common synonyms so the check is not trivially evaded by
// picking an unlisted-but-obviously-credential-shaped name.
const CREDENTIAL_FIELD_NAMES = new Set([
  "password",
  "passwd",
  "pwd",
  "secret",
  "secrets",
  "secretkey",
  "secret_key",
  "token",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "apikey",
  "api_key",
  "clientsecret",
  "client_secret",
  "privatekey",
  "private_key",
  "connectionstring",
  "connection_string",
  "credentials",
  "credential",
  // T-08a (R-01 hardening): names the T-08 independent review demonstrated
  // bypass the original list above -- see TASK-BRIEF.md T-08a.
  "auth",
  "pass",
  "db_pass",
  "key",
  "passphrase",
]);

/** True if `key` (a YAML mapping key, as-authored) matches one of the
 * rejected credential-shaped field names. Case-insensitive and
 * separator-insensitive (`API_KEY`, `apiKey`, `api-key`, `Api Key` all
 * match `api_key`) so the check is not evaded by re-casing or
 * re-punctuating an otherwise-recognized field name. */
function isCredentialFieldName(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[\s_-]+/g, "");
  for (const candidate of CREDENTIAL_FIELD_NAMES) {
    if (normalized === candidate.replace(/[\s_-]+/g, "")) {
      return true;
    }
  }
  return false;
}

/** Recursively walks the entire parsed document (not just `source`/
 * `target`) looking for any credential-shaped field name, per
 * DESIGN-SPEC.md: "any field anywhere in the document". `path` is tracked
 * only to produce a useful error message. */
function assertNoCredentialFields(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoCredentialFields(item, `${path}[${index}]`));
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      if (isCredentialFieldName(key)) {
        throw new InvalidDefinitionError(
          `Credential-shaped field "${childPath}" is not allowed in a parity definition. ` +
            `Reference connections by name only (a bare string) -- see DESIGN-SPEC.md's security model.`
        );
      }
      assertNoCredentialFields(child, childPath);
    }
  }
}

/** Validates that a `source`/`target` value is a well-formed `ParitySide`:
 * a plain object whose `connection` is a bare string (never an inline
 * connection object) and whose `object` is a non-empty string. */
function parseSide(value: unknown, label: "source" | "target"): ParitySide {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidDefinitionError(`"${label}" must be an object with "connection" and "object" fields.`);
  }
  const obj = value as Record<string, unknown>;

  const connection = obj["connection"];
  if (typeof connection !== "string" || connection.trim() === "") {
    throw new InvalidDefinitionError(
      `"${label}.connection" must be a bare string naming a connection profile ` +
        `(never inline connection details) -- got ${
          connection !== null && typeof connection === "object" ? "an object" : typeof connection
        }.`
    );
  }

  const object = obj["object"];
  if (typeof object !== "string" || object.trim() === "") {
    throw new InvalidDefinitionError(`"${label}.object" is required and must be a non-empty string.`);
  }

  const where = obj["where"];
  if (where !== undefined && typeof where !== "string") {
    throw new InvalidDefinitionError(`"${label}.where" must be a string when present.`);
  }

  return where === undefined ? { connection, object } : { connection, object, where };
}

function parseKeys(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new InvalidDefinitionError('"keys" is required and must be a non-empty array of column names.');
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new InvalidDefinitionError(`"keys[${index}]" must be a non-empty string.`);
    }
    return entry;
  });
}

function parseColumnMapping(value: unknown): ColumnMappingEntry[] {
  if (value === undefined) {
    return [];
  }

  // Idea Prompt.md section 7's example: a flat string-to-string map
  // (`customer_id: CUSTOMER_ID`).
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return Object.entries(value as Record<string, unknown>).map(([source, target]) => {
      if (typeof target !== "string") {
        throw new InvalidDefinitionError(`"column_mapping.${source}" must be a string.`);
      }
      return { source, target };
    });
  }

  // Idea Prompt.md section 3's example: a list of mapping entries, each
  // either { source, target } or a derived { name, target,
  // source_expression?, target_expression? }.
  if (Array.isArray(value)) {
    return value.map((entry, index) => parseColumnMappingListEntry(entry, index));
  }

  throw new InvalidDefinitionError('"column_mapping" must be a string-to-string map or a list of mapping entries.');
}

function parseColumnMappingListEntry(entry: unknown, index: number): ColumnMappingEntry {
  if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
    throw new InvalidDefinitionError(`"column_mapping[${index}]" must be an object.`);
  }
  const obj = entry as Record<string, unknown>;
  const target = obj["target"];
  if (typeof target !== "string" || target.trim() === "") {
    throw new InvalidDefinitionError(`"column_mapping[${index}].target" is required and must be a string.`);
  }

  const source = obj["source"];
  if (typeof source === "string") {
    return { source, target };
  }

  const name = obj["name"];
  if (typeof name !== "string" || name.trim() === "") {
    throw new InvalidDefinitionError(
      `"column_mapping[${index}]" must have either a "source" (plain mapping) or a "name" (derived mapping).`
    );
  }
  const sourceExpression = obj["source_expression"];
  const targetExpression = obj["target_expression"];
  if (sourceExpression !== undefined && typeof sourceExpression !== "string") {
    throw new InvalidDefinitionError(`"column_mapping[${index}].source_expression" must be a string.`);
  }
  if (targetExpression !== undefined && typeof targetExpression !== "string") {
    throw new InvalidDefinitionError(`"column_mapping[${index}].target_expression" must be a string.`);
  }

  const result: ColumnMappingEntry = { name, target };
  if (sourceExpression !== undefined) {
    (result as { sourceExpression?: string }).sourceExpression = sourceExpression;
  }
  if (targetExpression !== undefined) {
    (result as { targetExpression?: string }).targetExpression = targetExpression;
  }
  return result;
}

function parseExcludeColumns(value: unknown): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new InvalidDefinitionError('"exclude_columns" must be an array of column names.');
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string") {
      throw new InvalidDefinitionError(`"exclude_columns[${index}]" must be a string.`);
    }
    return entry;
  });
}

function parseRules(value: unknown): Record<string, NormalizationRule> {
  if (value === undefined) {
    return {};
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidDefinitionError('"rules" must be an object keyed by column name.');
  }
  const result: Record<string, NormalizationRule> = {};
  for (const [column, rawRule] of Object.entries(value as Record<string, unknown>)) {
    result[column] = parseNormalizationRule(rawRule, column);
  }
  return result;
}

function parseNormalizationRule(value: unknown, column: string): NormalizationRule {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidDefinitionError(`"rules.${column}" must be an object.`);
  }
  const obj = value as Record<string, unknown>;
  const rule: NormalizationRule = {};

  if (obj["trim"] !== undefined) {
    rule.trim = Boolean(obj["trim"]);
  }
  if (obj["case_sensitive"] !== undefined) {
    rule.caseSensitive = Boolean(obj["case_sensitive"]);
  }
  if (obj["collapse_whitespace"] !== undefined) {
    rule.collapseWhitespace = Boolean(obj["collapse_whitespace"]);
  }
  if (obj["numeric_tolerance"] !== undefined) {
    const nt = obj["numeric_tolerance"];
    if (nt === null || typeof nt !== "object" || Array.isArray(nt)) {
      throw new InvalidDefinitionError(`"rules.${column}.numeric_tolerance" must be an object.`);
    }
    const ntObj = nt as Record<string, unknown>;
    const tolerance: { absolute?: number; percentage?: number } = {};
    if (ntObj["absolute"] !== undefined) {
      tolerance.absolute = Number(ntObj["absolute"]);
    }
    if (ntObj["percentage"] !== undefined) {
      tolerance.percentage = Number(ntObj["percentage"]);
    }
    rule.numericTolerance = tolerance;
  }
  if (obj["timezone"] !== undefined) {
    const tz = obj["timezone"];
    if (
      tz === null ||
      typeof tz !== "object" ||
      Array.isArray(tz) ||
      typeof (tz as Record<string, unknown>)["source"] !== "string" ||
      typeof (tz as Record<string, unknown>)["target"] !== "string"
    ) {
      throw new InvalidDefinitionError(`"rules.${column}.timezone" must be an object with string "source" and "target".`);
    }
    const tzObj = tz as Record<string, unknown>;
    rule.timezone = { source: tzObj["source"] as string, target: tzObj["target"] as string };
  }
  if (obj["truncate_to"] !== undefined) {
    if (typeof obj["truncate_to"] !== "string") {
      throw new InvalidDefinitionError(`"rules.${column}.truncate_to" must be a string.`);
    }
    rule.truncateTo = obj["truncate_to"];
  }
  if (obj["null_equivalents"] !== undefined) {
    const ne = obj["null_equivalents"];
    if (!Array.isArray(ne)) {
      throw new InvalidDefinitionError(`"rules.${column}.null_equivalents" must be an array.`);
    }
    rule.nullEquivalents = ne.map((v) => String(v));
  }

  return rule;
}

function parseChecks(value: unknown): ParityChecks {
  if (value === undefined) {
    return {};
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidDefinitionError('"checks" must be an object.');
  }
  const obj = value as Record<string, unknown>;
  const checks: ParityChecks = {};

  if (obj["schema"] !== undefined) {
    checks.schema = { enabled: Boolean(requireEnabled(obj["schema"], "checks.schema")) };
  }

  if (obj["row_count"] !== undefined) {
    const rc = requireObject(obj["row_count"], "checks.row_count");
    const rowCount: { enabled: boolean; tolerance?: { percentage?: number; absolute?: number } } = {
      enabled: Boolean(requireEnabled(rc, "checks.row_count")),
    };
    if (rc["tolerance"] !== undefined) {
      const tol = requireObject(rc["tolerance"], "checks.row_count.tolerance");
      const tolerance: { percentage?: number; absolute?: number } = {};
      if (tol["percentage"] !== undefined) tolerance.percentage = Number(tol["percentage"]);
      if (tol["absolute"] !== undefined) tolerance.absolute = Number(tol["absolute"]);
      rowCount.tolerance = tolerance;
    }
    checks.rowCount = rowCount;
  }

  if (obj["profile"] !== undefined) {
    const p = requireObject(obj["profile"], "checks.profile");
    const profile: { enabled: boolean; topValues?: number } = {
      enabled: Boolean(requireEnabled(p, "checks.profile")),
    };
    if (p["top_values"] !== undefined) {
      profile.topValues = Number(p["top_values"]);
    }
    checks.profile = profile;
  }

  if (obj["row_level"] !== undefined) {
    const rl = requireObject(obj["row_level"], "checks.row_level");
    const rowLevel: { enabled: boolean; strategy?: string; maxDifferences?: number } = {
      enabled: Boolean(requireEnabled(rl, "checks.row_level")),
    };
    if (rl["strategy"] !== undefined) {
      if (typeof rl["strategy"] !== "string") {
        throw new InvalidDefinitionError('"checks.row_level.strategy" must be a string.');
      }
      rowLevel.strategy = rl["strategy"];
    }
    if (rl["max_differences"] !== undefined) {
      rowLevel.maxDifferences = Number(rl["max_differences"]);
    }
    checks.rowLevel = rowLevel;
  }

  return checks;
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidDefinitionError(`"${path}" must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireEnabled(value: unknown, path: string): boolean {
  const obj = requireObject(value, path);
  if (typeof obj["enabled"] !== "boolean") {
    throw new InvalidDefinitionError(`"${path}.enabled" is required and must be a boolean.`);
  }
  return obj["enabled"];
}

/**
 * Parses a Parity comparison definition YAML document (Idea Prompt.md
 * section 7's structure) into a validated `ParityDefinition`.
 *
 * Throws `InvalidDefinitionError` on:
 *  - malformed YAML (fails to parse);
 *  - a document that does not parse to a top-level mapping/object;
 *  - a missing required field (`version`, `name`, `source`, `target`,
 *    `keys`);
 *  - any credential-shaped field anywhere in the document (see
 *    `CREDENTIAL_FIELD_NAMES` above), including nested under `source` or
 *    `target`;
 *  - a `source`/`target.connection` that is not a bare string (e.g. an
 *    inline object with connection details).
 *
 * Never executes code from the YAML document and never resolves unsafe
 * custom tags -- `yaml`'s default `parse()` only produces plain data.
 */
export function parseDefinition(yamlText: string): ParityDefinition {
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new InvalidDefinitionError(`Malformed YAML: ${reason}`);
  }

  if (raw === null || raw === undefined || typeof raw !== "object" || Array.isArray(raw)) {
    throw new InvalidDefinitionError("A parity definition document must be a YAML mapping (object) at the top level.");
  }

  // Reject any credential-shaped field anywhere in the document before
  // doing anything else with it -- this must run even if other required
  // fields are also missing/invalid, since the security rule is
  // unconditional ("any field anywhere in the document").
  assertNoCredentialFields(raw, "");

  const obj = raw as Record<string, unknown>;

  const version = obj["version"];
  if (typeof version !== "number") {
    throw new InvalidDefinitionError('"version" is required and must be a number.');
  }

  const name = obj["name"];
  if (typeof name !== "string" || name.trim() === "") {
    throw new InvalidDefinitionError('"name" is required and must be a non-empty string.');
  }

  if (obj["source"] === undefined) {
    throw new InvalidDefinitionError('"source" is required.');
  }
  const source = parseSide(obj["source"], "source");

  if (obj["target"] === undefined) {
    throw new InvalidDefinitionError('"target" is required.');
  }
  const target = parseSide(obj["target"], "target");

  if (obj["keys"] === undefined) {
    throw new InvalidDefinitionError('"keys" is required.');
  }
  const keys = parseKeys(obj["keys"]);

  const columnMapping = parseColumnMapping(obj["column_mapping"]);
  const excludeColumns = parseExcludeColumns(obj["exclude_columns"]);
  const rules = parseRules(obj["rules"]);
  const checks = parseChecks(obj["checks"]);

  return {
    version,
    name,
    source,
    target,
    keys,
    columnMapping,
    excludeColumns,
    rules,
    checks,
  };
}
