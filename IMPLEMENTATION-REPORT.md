# ParityLens — Implementation Report T-03

## Status and objective

- **Status:** COMPLETE (implementation and evidence for this task's scope only; not independently reviewed; not self-approved)
- **Objective:** Implement the statement-safety parser in the Connector SDK:
  given a raw SQL statement and a target dialect, reject the statement if it
  contains INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE, MERGE, or an
  equivalent platform-specific mutating construct, before any statement
  reaches a database driver. Implements the approved "hard block + parse
  check" decision in `DESIGN-SPEC.md`'s Security section.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/engine/src/connector-sdk/safety/statement-safety.ts` | New. Implements `SqlDialect`, `MutatingStatementError`, and `assertReadOnlyStatement(sql, dialect): void`. | Task's produced interface per `TASK-BRIEF.md` T-03. |
| `packages/engine/src/connector-sdk/safety/statement-safety.test.ts` | New. Focused Vitest suite: mutating-statement matrix × 4 dialects, comment/batch/CTE evasion cases, safe-statement matrix, case-insensitivity check. | Red/green evidence per `TASK-BRIEF.md` T-03 red-state requirement. |

`packages/engine/src/index.ts` (T-01 placeholder) was **not** modified — the
task brief allows updating it only "if needed" to re-export this module's
public API, and nothing in this task's scope requires that yet (T-04/T-17/
T-18/T-19 will import directly from
`connector-sdk/safety/statement-safety.js` once they exist). Recorded here
per the brief's instruction to note if this file is touched — it was not.

No files under `packages/shared/**`, `packages/extension/**`, or any other
`packages/engine/**` path were touched. No database driver dependency was
added.

## Behavior and interfaces

- **Behavior delivered:** `assertReadOnlyStatement(sql: string, dialect: SqlDialect): void`
  throws a `MutatingStatementError` (subclass of `Error`, carrying `dialect`,
  `keyword`, and `statement` fields for UI surfacing per `DESIGN-SPEC.md`'s
  "Mutating statement detected" error-behavior row) if `sql` contains a
  mutating statement for the given dialect; returns normally (`undefined`)
  for safe statements. Detection survives comment-based, multi-statement
  batch, and CTE-prefix evasion (see "Evasion-resistance approach" below).
- **Interfaces consumed:** No `@paritylens/shared` type is imported at
  runtime — this function's own signature (`sql: string`, not
  `QueryInput`) is exactly what the task brief's Interfaces table specifies
  as the produced interface. `QueryInput` is the type a connector uses to
  decide what raw SQL string to pass in (its `"query"` variant's `sql`
  field, or the resolved contents of a `"sqlFile"` variant) — that
  extraction happens in the connector, not in this module, so no shared
  import was needed here. No shared types were modified.
- **Interfaces produced:**
  - `SqlDialect = "sqlserver" | "snowflake" | "postgres" | "duckdb"`
  - `MutatingStatementError extends Error` with `dialect`, `keyword`, `statement` fields
  - `assertReadOnlyStatement(sql: string, dialect: SqlDialect): void`

## Evasion-resistance approach

A full SQL parser/AST was judged out of scope (per the brief: "doesn't need
to be a full SQL parser"). Instead, `assertReadOnlyStatement` does a bounded
lexical pass in three stages before any keyword check runs:

1. **Strip comments and literals first, unconditionally.** `stripCommentsAndLiterals`
   walks the raw string character-by-character and removes `--` line
   comments (to end of line), `/* ... */` block comments (including
   multi-line), single-quoted string literals (with `''` escape handling),
   double-quoted identifiers, and `[bracketed]` identifiers — replacing each
   with a single space so token/statement boundaries are preserved. This
   defeats the `-- comment\nDROP TABLE x` evasion directly: a naive
   implementation that only regex-matches raw text can be fooled if it
   treats the first line as "the statement" and stops, or conversely can
   produce a false positive if a comment merely *mentions* a keyword (tested
   explicitly: `-- note: do not DROP TABLE in prod\nSELECT * FROM x` must
   NOT throw, and does not, because the comment content is stripped away
   before scanning).
2. **Split what remains on top-level `;` boundaries and check every
   statement independently, not just the first.** Because comments and
   string/identifier literals are already stripped, every remaining `;` is a
   genuine statement separator for the dialects in scope. This defeats the
   `SELECT 1; DROP TABLE x;` evasion: a naive implementation that only
   checks the first statement (or the first line) would miss a mutation
   batched after a leading SELECT.
3. **Resolve each statement's *effective* leading keyword, walking past any
   CTE prefix.** Every check is anchored to a statement's leading token
   (`^[\s(]*KEYWORD\b`, case-insensitive) rather than a bare substring
   search, so a mutating keyword only trips the check when it is the
   statement's own leading construct — this avoids false positives like a
   column named `delete_flag`. But a bare "leading token" check is itself
   defeated by `WITH cte AS (SELECT ...) DELETE FROM x WHERE id IN (SELECT
   id FROM cte)`, whose literal leading token is always `WITH` no matter
   what mutating clause follows the CTE body. **This bypass was found during
   this task's own testing** (see "Judgment call" below) and closed by
   `effectiveLeadingKeyword()`, which walks past `WITH`, each `<name> AS
   ( ... )` CTE body (tracking parenthesis depth so content inside the CTE
   body can't confuse the scan, and handling multiple comma-separated CTEs),
   and returns whatever keyword follows the last CTE body — the keyword that
   actually determines whether the statement reads or mutates. That
   effective keyword, not the literal `WITH` token, is what gets checked
   against the mutating-keyword list.

Per-dialect keyword lists: a common set (`INSERT, UPDATE, DELETE, DROP,
ALTER, TRUNCATE, MERGE, GRANT, REVOKE, CREATE, EXEC, EXECUTE, CALL`) plus
dialect-specific additions (SQL Server: `EXEC, SP_EXECUTESQL`; Snowflake:
`COPY, PUT, GET, UNLOAD`; PostgreSQL: `COPY, VACUUM, REINDEX`; DuckDB: `COPY,
PRAGMA, ATTACH, DETACH, EXPORT, IMPORT`) covering session/DDL/data-movement
constructs beyond the seven keywords named explicitly in the brief.

## Judgment call: CTE-prefixed mutation bypass found and fixed mid-task

`IMPLEMENTATION-PLAN.md`'s T-03 review-gate column names "CTE-wrapped
mutations" as a bypass class the reviewer should check. Before writing the
implementation report, I wrote a throwaway probe test
(`WITH cte AS (SELECT id FROM x) DELETE FROM x WHERE id IN (SELECT id FROM
cte)` against a first version of the parser that only checked each split
statement's literal leading token) and confirmed it did **not** throw — a
real, working bypass, not a hypothetical one. I treated this as a defect to
fix within this task's scope (it's the same file, same function, same
acceptance criterion — "must not be naively fooled by trivial evasions" —
rather than a scope expansion), added `effectiveLeadingKeyword()` to resolve
past CTE prefixes, added four new test cases (single-CTE DELETE/UPDATE/
INSERT and multi-CTE DELETE, all must throw, plus a multi-CTE SELECT that
must not throw), and reran full verification. This raised the focused suite
from 69 to 89 tests and is included in the final commit, not left as an open
finding for the reviewer to catch.

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline (pre-change) | `npm run verify` | Exit 0 — `packages/shared/src/types.test.ts`: 11 tests passed; no engine tests existed yet. | This session's transcript. |
| Red state | `npx vitest run packages/engine` | 1 failed suite, 0 tests run: `Error: Failed to load url ./statement-safety.js ... Does the file exist?` — confirms `assertReadOnlyStatement` did not exist yet. Vitest process itself exits 0 (it reports the failed run without a non-zero process exit under this invocation), but the suite result is unambiguously failing/red. | This session's transcript (see raw output below). |
| Focused green state (first pass, pre-CTE-fix) | `npx vitest run packages/engine` | `Test Files 1 passed (1)`, `Tests 69 passed (69)`. | This session's transcript. |
| CTE bypass probe (throwaway, not committed) | ad hoc Vitest probe file | Confirmed `WITH cte AS (SELECT id FROM x) DELETE FROM x ...` did NOT throw under the first-pass implementation — a real bypass, fixed before finalizing (see Judgment call above). Probe file deleted; its cases are now permanent tests in `statement-safety.test.ts`. | This session's transcript. |
| Focused green state (final) | `npx vitest run packages/engine` | `Test Files 1 passed (1)`, `Tests 89 passed (89)`. | This session's transcript (see raw output below). |
| Full verification | `npm run verify` (runs `tsc -b --force`, `eslint .`, `vitest run`) | Exit 0. Typecheck clean (after fixing 3 `TS2345`/`noUncheckedIndexedAccess` strict-mode errors in `effectiveLeadingKeyword` by switching raw index access to `String.charAt`), lint clean, `Test Files 2 passed (2)`, `Tests 100 passed (100)` (11 pre-existing `packages/shared` tests + 89 engine tests). | This session's transcript (see raw output below). |

### Red state — raw output

```text
 ❯ packages/engine/src/connector-sdk/safety/statement-safety.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  packages/engine/src/connector-sdk/safety/statement-safety.test.ts [ packages/engine/src/connector-sdk/safety/statement-safety.test.ts ]
Error: Failed to load url ./statement-safety.js (resolved id: ./statement-safety.js) in .../statement-safety.test.ts. Does the file exist?

 Test Files  1 failed (1)
      Tests  no tests
```

### Final full verify — raw output

```text
> paritylens@0.0.1 verify
> npm run typecheck && npm run lint && npm run test

> paritylens@0.0.1 typecheck
> tsc -b --force

> paritylens@0.0.1 lint
> eslint .

> paritylens@0.0.1 test
> vitest run

 RUN  v2.1.9 V:/Secret Projects/VSC-DB-SQL-Compare

 ✓ packages/shared/src/types.test.ts (11 tests) 4ms
 ✓ packages/engine/src/connector-sdk/safety/statement-safety.test.ts (89 tests) 16ms

 Test Files  2 passed (2)
      Tests  100 passed (100)
```

## Assumptions and risks

- **Assumptions:**
  - The seven keywords named in `AGENTS.md`/`DESIGN-SPEC.md`
    (INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/MERGE) are the mandatory
    floor; additional keywords (GRANT/REVOKE/CREATE/EXEC/EXECUTE/CALL, plus
    dialect-specific data-movement/session commands) were added as a
    reasonable reading of "equivalent platform-specific mutating construct"
    but were a judgment call, not explicitly enumerated in the brief.
  - `QueryInput` of kind `"sqlFile"` resolves to a `sql: string` before
    reaching this function (file-reading is a connector/orchestration
    concern, not this module's) — consistent with the brief's contract
    table, which specifies the function signature as `(sql: string,
    dialect: SqlDialect)`, not `(input: QueryInput, ...)`.
  - This module has zero runtime dependencies (no database driver, no
    external SQL-parsing library), consistent with "Do not add a database
    driver dependency" and keeping this a lightweight primitive every future
    connector can call cheaply and synchronously.

- **Risks or limitations (security-sensitive — flagging explicitly for
  reviewer):**
  - **This is a lexical scanner, not a real SQL parser.** It has no concept
    of SQL grammar beyond comment/string/identifier stripping, `;`
    splitting, and CTE-prefix resolution. The threat model per
    `DESIGN-SPEC.md`'s stated rationale is defense against user error /
    accidental writable-credential misuse, not a hardened defense against a
    malicious user who already has DB access — but listing known gaps for
    completeness since the brief asks the reviewer to hunt for bypasses:
    - **Stored-procedure or function calls that mutate internally.** A
      `SELECT` that invokes a UDF/stored function with a side effect (e.g.
      `SELECT some_mutating_udf()`) is not caught — this scanner only
      recognizes mutating *leading statement keywords* (now including
      CTE-resolved ones), not arbitrary function-call side effects reachable
      from a SELECT's expression list. `CALL` and `EXEC` themselves are
      blocked as leading keywords.
    - **SQL Server's `GO` batch separator is not a recognized statement
      boundary.** `GO` is a client-tool (`sqlcmd`/SSMS) convention, not a
      T-SQL keyword, so it is not stripped or split on by this scanner. I
      verified this with an ad hoc probe: `SELECT 1\nGO\nDROP TABLE x`
      against the `sqlserver` dialect does **not** throw, because the whole
      string is treated as one statement whose effective leading keyword is
      `SELECT`. This is a real, confirmed gap specific to the `sqlserver`
      dialect. Whether it is exploitable in practice depends on T-17 (SQL
      Server connector): most driver-level execution paths (`mssql`/Tedious)
      do not interpret `GO` either and will send the literal text to the
      server as-is, so the actual behavior depends on what SQL Server itself
      does with an un-batched multi-statement string containing `GO` as
      plain text (likely a syntax error, not silent execution of the DROP,
      since `GO` is not valid mid-statement T-SQL) — but this has not been
      verified against a real driver/server and should not be assumed safe.
      Recommend T-17 either handle `GO`-splitting explicitly or confirm via
      a live/documented test that the driver layer rejects such input before
      it can execute.
    - **PostgreSQL dollar-quoted strings (`$$...$$` or `$tag$...$tag$`) are
      not recognized as literals.** The stripper handles `'...'`, `"..."`,
      and `[...]` but not `$$...$$`. A payload embedding a `;` inside a
      dollar-quoted string could in principle alter statement splitting in
      an untested way. This did not surface as a false negative in the
      tested cases (no test payload used dollar-quoting) but is an
      unverified gap, not a confirmed-safe case — flagging for the reviewer
      to probe specifically, since PostgreSQL is one of the four in-scope
      dialects.
  - **No length/complexity limits.** Very large SQL strings are scanned in
    O(n) but there is no upper bound enforced by this module itself (row
    caps/timeouts are a separate, already-planned control per
    `DESIGN-SPEC.md`, not this task's scope).

- **Blockers:** None.

## Patch or commit identity

- **Patch or commit:** `a4fb5c440ea2f831fa1d40ff5a9a1cec5be0b754`
  ("Close CTE-prefixed mutation bypass in statement safety parser"), on top
  of `36f0e025f21ffad3da95f03aa3b42ebec4fea047` ("Add statement-safety parser
  (T-03)"). Both commits are on the task branch.
- **Branch or workspace:** `task/T-03-statement-safety` (branched from
  `main` at a clean tree containing T-01+T-02; `PROGRESS-LEDGER.md` and
  `TASK-BRIEF.md` had pre-existing working-tree modifications made by the
  Lead Orchestrator to activate T-03 before this task started — per this
  task's ownership scope and the rule against touching
  `PROGRESS-LEDGER.md`, those files were left unstaged/uncommitted by this
  task and are the Lead Orchestrator's to commit).

## Recommended next step (superseded — see I-01 fix section below)

Independent review required, by a separate Claude Code subagent instance
distinct from this implementer, per `TASK-BRIEF.md`'s handoff section.
Given this is a security control (primary defense against accidental data
mutation per `AGENTS.md`), the reviewer must specifically attempt to find a
bypass the test matrix missed — the CTE-prefix class was found and closed
during this task, so the reviewer's marginal value is highest checking the
two gaps disclosed above and left open: (1) the `sqlserver`-specific `GO`
batch-separator gap, and (2) PostgreSQL dollar-quoted string handling. Do
not merge to `main` or start a dependent task (T-04, T-17, T-18, T-19) until
review findings (if any Critical/Important) are resolved, per `AGENTS.md`
verification rules. This implementer does not have authority to approve or
mark this task complete/reviewed.

This section documented the state as of commit `a4fb5c4`, before the
independent review pass (see `REVIEW-REPORT.md`). That review found finding
I-01, an Important/blocking bypass distinct from the two gaps disclosed
above. See the next section for the fix.

## I-01 regression fix (post-review)

- **Status:** COMPLETE (fix and evidence for finding I-01 only; not
  independently re-reviewed; not self-approved).
- **Finding being fixed:** `REVIEW-REPORT.md` I-01 (Important, blocking
  approval): a CTE-prefixed mutating statement wrapped in a single pair of
  outer parentheses, e.g. `(WITH cte AS (SELECT 1) DELETE FROM x)`, evaded
  `assertReadOnlyStatement` on all four in-scope dialects (`sqlserver`,
  `snowflake`, `postgres`, `duckdb`).

### What was broken

`WITH_KEYWORD_PATTERN` was `/^\s*WITH\b/i` — it required `WITH` to be the
literal first token after only whitespace, with no tolerance for a leading
`(`. `leadingKeywordPattern` (used for every ordinary mutating keyword)
already tolerates `^[\s(]*KEYWORD\b`, but the CTE-detection gate in
`effectiveLeadingKeyword()` did not extend the same tolerance to `WITH`.
When the statement was `(WITH cte AS (SELECT 1) DELETE FROM x)`,
`WITH_KEYWORD_PATTERN.test(...)` was `false`, so `effectiveLeadingKeyword()`
returned the statement unchanged (still starting with `(WITH...`), and
`assertReadOnlyStatement`'s keyword scan then tested `leadingKeywordPattern`
for each mutating keyword against that whole string — none matched, because
the statement's literal leading token sequence is `( WITH`, not any mutating
keyword, and `DELETE` is buried after the CTE body, not at the front. Net
effect: the statement was treated as safe and no error was thrown, across
all four dialects — a near-total regression of the CTE-bypass fix already
committed in `a4fb5c4`, defeated by one extra pair of parentheses around the
exact payload shape the existing test suite already asserted must throw.

Root cause confirmed to be scoped narrowly to the CTE-detection gate: the
already-existing "paren-wrapped plain mutation, no CTE" case (e.g.
`(DELETE FROM x)`) was **not** affected — `leadingKeywordPattern`'s own
`[\s(]*` tolerance already caught that shape correctly (confirmed by writing
it as a test case; it passed both before and after this fix, so it was
added as a permanent regression guard rather than left unverified).

### Red-state evidence (regression test written first, confirmed failing)

Five new test cases were added per dialect (20 total across `sqlserver`,
`snowflake`, `postgres`, `duckdb`) to
`packages/engine/src/connector-sdk/safety/statement-safety.test.ts`:

1. `(WITH cte AS (SELECT 1) DELETE FROM x)` — single paren wrap, must throw.
2. `(\n  WITH cte AS (SELECT 1)\n  DELETE FROM x\n)` — paren wrap with
   internal whitespace/newlines, must throw (rules out a fix that only
   special-cases the exact reviewer payload string).
3. `( ( WITH cte AS (SELECT 1) DELETE FROM x ) )` — doubly-paren-wrapped,
   must throw (rules out a fix that only tolerates exactly one `(`).
4. `(DELETE FROM x)` — plain paren-wrapped mutation, no CTE, must throw
   (same class of bug per the task instructions; confirms this path was
   already correctly handled and stays handled).
5. `(WITH cte AS (SELECT id FROM x) SELECT * FROM cte)` — paren-wrapped
   CTE-wrapped **SELECT**, must NOT throw (false-positive guard).

Ran `npx vitest run packages/engine` against the pre-fix code (statement
tested at that point: only the test file had changed, `statement-safety.ts`
was still the reviewed `a4fb5c4` version). Result: **12 of the 20 new tests
failed** (the 3 "must throw" CTE-paren variants × 4 dialects; the
plain-paren-wrap and negative-SELECT cases passed even before the fix,
confirming the bug is specifically in CTE resolution, not paren-tolerance in
general):

```text
 × assertReadOnlyStatement > dialect: sqlserver > throws for a paren-wrapped CTE-prefixed DELETE
   → expected function to throw an error, but it didn't
 × assertReadOnlyStatement > dialect: sqlserver > throws for a paren-wrapped CTE-prefixed DELETE with internal whitespace/newlines
   → expected function to throw an error, but it didn't
 × assertReadOnlyStatement > dialect: sqlserver > throws for a doubly-paren-wrapped CTE-prefixed DELETE
   → expected function to throw an error, but it didn't
 (same 3 failures repeated for dialect: snowflake, postgres, duckdb)

 Test Files  1 failed (1)
      Tests  12 failed | 97 passed (109)
```

This reproduces I-01 exactly as described by the reviewer, across all four
dialects, confirming the bug before any fix was applied.

### The fix

In `packages/engine/src/connector-sdk/safety/statement-safety.ts`, changed:

```ts
const WITH_KEYWORD_PATTERN = /^\s*WITH\b/i;
```

to:

```ts
const WITH_KEYWORD_PATTERN = /^[\s(]*WITH\b/i;
```

This is the same `[\s(]*` leading-paren tolerance `leadingKeywordPattern`
already grants ordinary mutating keywords, applied to the CTE-detection
gate. No other logic in `effectiveLeadingKeyword()` needed to change: once
the gate recognizes the paren-wrapped `WITH`, the existing skip-past-`WITH`
and skip-past-CTE-body walk (which already starts its scan from
`.search(/\S/)` after stripping the matched prefix) correctly resolves past
the CTE to the real trailing keyword (`DELETE`), and the outer closing `)`
after it is then within `leadingKeywordPattern`'s existing trailing-content
tolerance (that pattern only anchors the *start* of the string, so trailing
characters after the matched keyword — including a closing paren — do not
prevent a match).

Checked whether outer parens wrapping a non-CTE mutation (`(DELETE FROM
x)`) were already handled: yes — `leadingKeywordPattern`'s own `[\s(]*`
prefix tolerance already covers that case directly (it never goes through
`effectiveLeadingKeyword`'s CTE branch at all, since `WITH_KEYWORD_PATTERN`
doesn't match), confirmed by test case 4 above passing both before and
after this change.

### Green-state evidence (regression test now passes, no prior test broke)

`npx vitest run packages/engine` after the fix:

```text
 ✓ packages/engine/src/connector-sdk/safety/statement-safety.test.ts (109 tests) 18ms

 Test Files  1 passed (1)
      Tests  109 passed (109)
```

All 109 tests pass: the 89 pre-existing tests (unchanged, none modified)
plus the 20 new I-01 regression tests, including the 12 that were
previously red.

`npm run verify` (`tsc -b --force && eslint . && vitest run`):

```text
> paritylens@0.0.1 verify
> npm run typecheck && npm run lint && npm run test
...
 ✓ packages/shared/src/types.test.ts (11 tests) 4ms
 ✓ packages/engine/src/connector-sdk/safety/statement-safety.test.ts (109 tests) 19ms

 Test Files  2 passed (2)
      Tests  120 passed (120)
```

Exit code: `0`. Typecheck and lint both clean, no changes required beyond
the one-line regex fix. No prior test (of the 89 original or the 11 in
`packages/shared`) regressed.

### Scope

Only `packages/engine/src/connector-sdk/safety/statement-safety.ts` (1 line
changed) and `packages/engine/src/connector-sdk/safety/statement-safety.test.ts`
(20 new test cases appended) were touched, consistent with `TASK-BRIEF.md`'s
file-ownership boundary for T-03. `PROGRESS-LEDGER.md` and
`REVIEW-REPORT.md` were not modified by this fix (reviewer/orchestrator
owned).

### Patch or commit identity

- **Commit:** `afae34f` ("Fix I-01: paren-wrapped CTE mutation bypass in
  statement safety"), on branch `task/T-03-statement-safety`, on top of
  `a4fb5c4` / `36f0e02`.

### Recommended next step

A fresh independent review pass is required to confirm I-01 is resolved and
that this fix does not introduce a new bypass, per `AGENTS.md`'s rule
against self-approval. M-05 (`GO` separator) and M-06 (dollar-quoting) were
explicitly out of scope for this fix per the reviewer's and orchestrator's
disposition (tracked for T-17/T-19) and were not touched.
