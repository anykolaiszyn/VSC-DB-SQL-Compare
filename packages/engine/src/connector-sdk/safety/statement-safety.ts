// Statement-safety parser (T-03): implements the approved "hard block +
// parse check" query-safety posture from DESIGN-SPEC.md ("Security,
// privacy, and safety" > "Read-only systems"). Every connector's
// executeQuery() (fixture in T-04; SQL Server/Snowflake/PostgreSQL in
// T-17/T-18/T-19) must call `assertReadOnlyStatement()` on the raw SQL text
// before it reaches a driver, as defense in depth against a user
// accidentally supplying a writable credential.
//
// This is intentionally NOT a full SQL parser (no grammar, no AST). A full
// dialect-aware parser is out of scope for this task and would be a much
// larger dependency surface. Instead this module does a bounded, literal-
// and-comment-aware lexical scan: strip string/quoted-identifier literals
// and comments first (so keywords hidden inside them can't cause false
// positives, and — critically — content *inside* a comment can't be used to
// smuggle a real statement past a naive regex that only looks at the raw
// text), then split what remains on statement-terminating `;` boundaries,
// and check every resulting statement (not just the first) against a
// per-dialect deny-list of mutating leading/keyword patterns.
//
// Evasion cases this is specifically built to catch (see task brief):
//   - "-- comment\nDROP TABLE x"          (mutating statement after a line comment)
//   - "SELECT 1; DROP TABLE x;"            (multi-statement batch, mutation not first)
//   - "SELECT 1; -- comment\nUPDATE x ..." (comment + batching combined)

/** Dialects supported by the statement-safety parser and the Connector SDK. */
export type SqlDialect = "sqlserver" | "snowflake" | "postgres" | "duckdb";

/**
 * Thrown by `assertReadOnlyStatement` when a SQL statement contains a
 * mutating construct. `keyword` and `statement` are included so callers
 * (e.g. the extension's error surface, per DESIGN-SPEC.md's "Mutating
 * statement detected" row) can show the user which keyword/clause triggered
 * the block.
 */
export class MutatingStatementError extends Error {
  public readonly dialect: SqlDialect;
  public readonly keyword: string;
  public readonly statement: string;

  constructor(dialect: SqlDialect, keyword: string, statement: string) {
    super(
      `Statement rejected: mutating keyword "${keyword}" is not permitted for read-only ` +
        `dialect "${dialect}". Offending statement: ${statement.trim().slice(0, 200)}`
    );
    this.name = "MutatingStatementError";
    this.dialect = dialect;
    this.keyword = keyword;
    this.statement = statement;
  }
}

// Keywords that are considered mutating for every dialect. Matched as a
// leading statement keyword (see `LEADING_KEYWORD_PATTERN` below) so that
// e.g. a column literally named "insert" inside a SELECT list does not
// trigger a false positive — only a statement that *starts with* (optionally
// after whitespace/parentheses) one of these keywords is rejected.
const COMMON_MUTATING_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "TRUNCATE",
  "MERGE",
  "GRANT",
  "REVOKE",
  "CREATE",
  "EXEC",
  "EXECUTE",
  "CALL",
];

// Dialect-specific additions to the common list (platform-specific mutating
// or session/DDL constructs called out by the task brief as "equivalent
// platform-specific mutating constructs").
const DIALECT_MUTATING_KEYWORDS: Record<SqlDialect, string[]> = {
  sqlserver: ["EXEC", "SP_EXECUTESQL"],
  snowflake: ["COPY", "PUT", "GET", "UNLOAD"],
  postgres: ["COPY", "VACUUM", "REINDEX"],
  duckdb: ["COPY", "PRAGMA", "ATTACH", "DETACH", "EXPORT", "IMPORT"],
};

function mutatingKeywordsFor(dialect: SqlDialect): string[] {
  return [...COMMON_MUTATING_KEYWORDS, ...DIALECT_MUTATING_KEYWORDS[dialect]];
}

/**
 * Strips SQL line comments (`-- ...` to end of line), block comments
 * (`/* ... *\/`, including multi-line), and single/double-quoted string
 * literals, replacing each with a single space so token boundaries and
 * statement-terminating semicolons outside of literals/comments are
 * preserved for the splitter below. This must run BEFORE keyword scanning —
 * scanning raw text first is exactly what a `-- comment\nDROP TABLE x`
 * evasion defeats if the implementation naively bails out after finding a
 * comment marker instead of stripping through it.
 */
function stripCommentsAndLiterals(sql: string): string {
  let result = "";
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Line comment: -- ... through end of line (or end of string).
    if (ch === "-" && next === "-") {
      i += 2;
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }

    // Block comment: /* ... */ (does not nest in standard SQL).
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      i += 2; // consume closing */ (or run past end if unterminated)
      result += " ";
      continue;
    }

    // Single-quoted string literal, with '' as an escaped quote.
    if (ch === "'") {
      i += 1;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i += 1;
          break;
        }
        i += 1;
      }
      result += " ";
      continue;
    }

    // Double-quoted identifier (Postgres/Snowflake/DuckDB) or bracketed
    // identifier (SQL Server) — not a mutating-keyword carrier, strip so
    // quoted text can't be used to smuggle keywords past the splitter in a
    // way that confuses statement boundaries.
    if (ch === '"') {
      i += 1;
      while (i < n && sql[i] !== '"') i++;
      i += 1;
      result += " ";
      continue;
    }
    if (ch === "[") {
      i += 1;
      while (i < n && sql[i] !== "]") i++;
      i += 1;
      result += " ";
      continue;
    }

    result += ch;
    i += 1;
  }

  return result;
}

/**
 * Splits a comment/literal-stripped SQL string into individual statements on
 * top-level `;` boundaries. Because comments and string/quoted-identifier
 * literals have already been stripped, every remaining `;` is a genuine
 * statement separator (SQL does not permit `;` inside any other syntactic
 * construct at the top level for the dialects in scope).
 */
function splitStatements(strippedSql: string): string[] {
  return strippedSql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Matches a mutating keyword only when it appears as the statement's leading
// token, optionally preceded by whitespace and/or opening parentheses (e.g.
// a statement wrapped in redundant parens). This avoids false positives on
// keywords appearing later in a statement (e.g. a string/identifier named
// "update", or a SELECT list column called "delete_flag") while still
// catching the batched/second-statement case, because each statement in the
// batch is checked independently as its own "leading token" after splitting.
function leadingKeywordPattern(keyword: string): RegExp {
  return new RegExp(`^[\\s(]*${keyword}\\b`, "i");
}

const WITH_KEYWORD_PATTERN = /^\s*WITH\b/i;

/**
 * A statement that begins with `WITH` is a CTE-prefixed statement:
 * `WITH cte AS (SELECT ...) [, cte2 AS (...)] <SELECT|INSERT|UPDATE|DELETE|MERGE ...>`.
 * The leading token of such a statement is always `WITH`, regardless of what
 * follows the CTE definitions — so checking only the leading token (as
 * `leadingKeywordPattern` does for every other statement shape) would let a
 * real mutating statement like `WITH cte AS (SELECT id FROM x) DELETE FROM x
 * WHERE id IN (SELECT id FROM cte)` through undetected. This finds the
 * statement's *effective* leading keyword by skipping past the `WITH` token,
 * each `<name> AS ( ... )` CTE body (tracking paren depth so commas and
 * keywords inside the CTE body don't confuse the scan), and the comma
 * separators between multiple CTEs, then returns whatever keyword comes
 * after the last CTE body — the keyword that actually determines whether
 * this statement reads or mutates.
 */
function effectiveLeadingKeyword(statement: string): string {
  if (!WITH_KEYWORD_PATTERN.test(statement)) {
    return statement;
  }

  let i = statement.replace(WITH_KEYWORD_PATTERN, (m) => " ".repeat(m.length)).search(/\S/);
  if (i < 0) return statement;

  const n = statement.length;
  for (;;) {
    // Skip the CTE name and optional column list, up to "AS".
    const asMatch = /\bAS\b/i.exec(statement.slice(i));
    if (!asMatch) return statement.slice(i);
    i += asMatch.index + asMatch[0].length;

    // Skip whitespace to the opening paren of the CTE body.
    while (i < n && /\s/.test(statement.charAt(i))) i++;
    if (statement.charAt(i) !== "(") {
      // Not the shape we expect (e.g. RECURSIVE keyword variants) — bail
      // out conservatively and return the remainder from here so the
      // caller's keyword scan still runs against it.
      return statement.slice(i);
    }

    // Walk the balanced parenthesised CTE body.
    let depth = 0;
    do {
      const c = statement.charAt(i);
      if (c === "(") depth++;
      else if (c === ")") depth--;
      i++;
    } while (i < n && depth > 0);

    // Skip whitespace after the CTE body.
    while (i < n && /\s/.test(statement.charAt(i))) i++;

    if (statement.charAt(i) === ",") {
      // Another CTE follows; skip the comma and continue the loop.
      i++;
      while (i < n && /\s/.test(statement.charAt(i))) i++;
      continue;
    }

    // No more CTEs — whatever remains is the statement's effective leading
    // keyword (SELECT, INSERT, UPDATE, DELETE, MERGE, ...).
    return statement.slice(i);
  }
}

/**
 * Throws `MutatingStatementError` if `sql` contains a mutating statement for
 * the given `dialect` — INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/MERGE or a
 * dialect-specific equivalent — whether it is the only statement, follows a
 * `--`/`/* *\/` comment, or appears as a later statement in a `;`-separated
 * batch. Returns normally (void) for safe statements (SELECT, CTE-wrapped
 * SELECT, SHOW/DESCRIBE, etc.).
 */
export function assertReadOnlyStatement(sql: string, dialect: SqlDialect): void {
  const stripped = stripCommentsAndLiterals(sql);
  const statements = splitStatements(stripped);
  const keywords = mutatingKeywordsFor(dialect);

  for (const statement of statements) {
    // For CTE-prefixed statements (`WITH cte AS (...) DELETE FROM ...`),
    // check the keyword that actually follows the CTE definitions, not the
    // literal leading `WITH` token — otherwise a CTE-wrapped mutation would
    // never match any leading-keyword pattern below.
    const effective = effectiveLeadingKeyword(statement);
    for (const keyword of keywords) {
      if (leadingKeywordPattern(keyword).test(effective)) {
        throw new MutatingStatementError(dialect, keyword, statement);
      }
    }
  }
}
