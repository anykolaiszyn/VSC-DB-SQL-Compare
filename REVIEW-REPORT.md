# ParityLens — Review Report T-21

## Review independence statement

This review was performed by a separate reviewer agent instance from the
implementer that produced `063fbfb`/`8bb3a5c`/`7afabb1` on
`task/T-21-sampling`. No implementer session state, memory, or self-report
was trusted as fact; every claim in `IMPLEMENTATION-REPORT.md` below was
independently re-derived — fresh `npm run verify` run, fresh adversarial
probe scripts written from scratch (not reusing the implementer's test
inputs), and every cited document (`IMPLEMENTATION-PLAN.md`,
`DESIGN-SPEC.md`, `Idea Prompt.md`, `PROGRESS-LEDGER.md`) opened and read
directly rather than trusting the report's quotations. All throwaway probe
files were deleted after use; `git status --porcelain` confirmed zero
residue beyond this report.

## Scope reviewed

- `TASK-BRIEF.md` (task authority, read in full)
- `IMPLEMENTATION-REPORT.md` (claims, read in full, treated as assertions)
- `packages/engine/src/comparison-core/sampling/sampling.ts` (457 lines, read in full)
- `packages/engine/src/comparison-core/sampling/sampling.test.ts` (311 lines, read in full)
- `packages/engine/src/connector-sdk/fixture/fixture-connector.ts` (read in full — `executeQuery`, `quoteIdentifier`, `getCapabilities`)
- `packages/engine/src/connector-sdk/safety/statement-safety.ts` (read in full)
- `packages/engine/fixtures/snowflake-orders.ts` (read for fixture-shape confirmation)
- `IMPLEMENTATION-PLAN.md` T-21 row, `DESIGN-SPEC.md`'s row-cap/timeout section, `Idea Prompt.md`'s "Strategy A" section (all quoted-verbatim claims cross-checked against literal text)
- `PROGRESS-LEDGER.md` at `ac52a30` (T-20 baseline count, open-findings table — confirmed no prior finding routes to T-21)
- `git diff --stat main task/T-21-sampling` and commit log

## Findings

### Critical

NONE.

### Important

NONE.

### Minor

| ID | Description | Evidence | Suggested resolution |
| --- | --- | --- | --- |
| T-21-01 | `TABLESAMPLE SYSTEM (100 PERCENT)` (fixed, not derived from `sampleSize`) means the `TABLESAMPLE` clause itself performs no actual sampling — it samples 100% of the table, and the entire "randomness"/size-reduction of the result is delivered by the outer `LIMIT <sampleSize>`, which (on a table with no explicit ORDER BY) returns rows in whatever order DuckDB's scan happens to produce, not a statistically random subset. This is disclosed prominently (header comment, `IMPLEMENTATION-REPORT.md`'s dedicated subsection, and the `Assumptions and risks` table), and the brief only *authorized* (did not mandate) the branching, explicitly asking for disclosure rather than a specific percentage strategy — so this is not a violation of the brief. It is, however, a materially weaker interpretation of "random sample" than a caller might expect from the `supportsTableSampling === true` branch existing at all; a percentage genuinely proportional to an estimated table size (even a rough one) would give the `TABLESAMPLE` clause real sampling semantics instead of being a no-op wrapped by `LIMIT`. | `sampling.ts:312-323` (`buildRandom`); `DEFAULT_RANDOM_TABLESAMPLE_PERCENT = 100` at line 255; confirmed via my own probe that the fixture's `supportsTableSampling: true` branch is in fact exercised (`generated.sql.sql` contains `TABLESAMPLE`) | Non-blocking. Track as debt for the future planner-integration task (or a follow-up to T-21) to consider deriving a real percentage once `executeQuery`-based row-count estimation is in scope, or to rename/re-disclose this branch as "LIMIT-bounded, not statistically sampled" more prominently in any future consumer-facing documentation (e.g. a future webview UI string), not just the code comment. |
| T-21-02 | `supportsTableSampling: false` fallback branch (`ORDER BY RANDOM() LIMIT <sampleSize>`) is exercised only by code inspection, not by any passing test — no connector in this codebase currently reports `false` for that capability. This is self-disclosed accurately in `IMPLEMENTATION-REPORT.md`'s "Assumptions and risks" section (risk #2) and is a real, if narrow, coverage gap. | `sampling.ts:312-323`; confirmed no `FixtureConnector`/other connector in the repo returns `supportsTableSampling: false` (`fixture-connector.ts:216-228` returns `true` unconditionally; `sqlserver`/`postgres` connector tests are skipped, not usable to check without live containers) | Non-blocking, matches T-20's own precedent of disclosing an untested branch rather than fabricating fixture coverage for it. A future task with a connector reporting `false` should add this coverage. |

## Verification performed

### 1. Fresh `npm run verify`

Ran independently, not copy-pasted from the report:

```
$ npm run verify
...
 Test Files  20 passed | 2 skipped (22)
      Tests  396 passed | 27 skipped (423)
```

Matches the report's claimed **396 passed / 27 skipped (423 total), exit 0**
exactly. Skip count (27) accounted for entirely by the pre-existing
PostgreSQL (14) and SQL Server (13) live-container integration suites,
consistent with `CLAUDE.md`'s documented environment.

**Arithmetic re-derivation:** `PROGRESS-LEDGER.md` at `ac52a30` records
T-20's post-merge baseline as "381/381 tests (408 total, 27 ... skips)".
381 (baseline passed) + 15 (this task's own new tests, confirmed by reading
`sampling.test.ts`'s 15 `it(...)` blocks) = 396. Matches the observed total
exactly — no regression, delta fully accounted for.

### 2. Row-cap/timeout bypass check (the review gate itself) — independent probe, not the implementer's test

Constructed a fresh throwaway test file (`__reviewer_probe.test.ts`, deleted
after use) exercising two strategies whose SQL carries its own
size-limiting clause, executed through the real `FixtureConnector` with
`maxRows` deliberately smaller than the strategy's own requested size:

- **first-n, `n=5`**, executed with `maxRows=1` → generated SQL contained
  `LIMIT 5`; actual returned row count was **exactly 1**, not 5. Confirmed
  by reading `FixtureConnector.executeQuery` (`fixture-connector.ts:203`):
  every executed SQL string is unconditionally wrapped as `SELECT * FROM
  (<sql>) AS fixture_query LIMIT <options.maxRows>`, regardless of what
  `LIMIT`/`TABLESAMPLE` clause the inner SQL already has — this is the
  actual enforcement mechanism, and it is outside `sampling.ts` entirely
  (`sampling.ts` never calls `executeQuery` and never threads
  `ExecutionOptions`, confirmed by reading the full file — `options:
  SampleQueryOptions` at line 272 has no `maxRows`/`timeoutMs` field, and
  is explicitly `void`-discarded at line 274).
- **random (`TABLESAMPLE` branch), `sampleSize=5`**, executed with
  `maxRows=1` → confirmed `FixtureConnector.getCapabilities()` reports
  `supportsTableSampling: true` so the `TABLESAMPLE` branch was actually
  exercised (generated SQL contained the literal string `TABLESAMPLE`);
  actual returned row count was ≤ 1.

**Conclusion: confirmed.** The connector's cap, not the sample strategy's
own clause, determines the final row count — the central correctness
property (the review gate) holds under my own independently constructed
probe, matching the brief's specific instruction to probe "at least one
strategy whose SQL includes its own size-limiting clause" (I probed two).

### 3. Deterministic-hash reproducibility — independent generate+execute, twice, diffed

Built a fresh probe using two **separate `FixtureConnector` instances**
(not one shared instance, to rule out any instance-level caching the
implementer's own test might not have ruled out) and two separately
constructed strategy objects. `buildSampleQuery` produced byte-identical
SQL text across both instances (`hash()`'s SQL expression contains no
non-deterministic input); executing both independently and comparing
sorted `ORDER_ID` sets after row-by-row extraction confirmed **identical
row sets**. Confirmed reproducibility independently, not by trusting the
implementer's own test.

### 4. Injection safety — independent adversarial identifiers, distinct from the implementer's

Read `FixtureConnector.quoteIdentifier` directly:

```typescript
quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}
```

Confirmed by direct inspection: this doubles every embedded `"` before
wrapping in an outer `"..."` pair — the standard SQL identifier-escaping
rule — so a malicious identifier string can never terminate the quoted
identifier early. Constructed my own adversarial payloads, distinct from
the implementer's (`ORDER_STATUS"; DROP TABLE ...`/`event_date"); DROP
TABLE ...`) to avoid re-testing exactly what was already tested:

- **Stratified strategy, `stratifyColumn`** with a payload combining a
  backslash and an `UPDATE ... SET ... WHERE 1=1` body (not `DROP`, to
  diversify from the implementer's coverage): generated SQL contained the
  correctly quote-doubled literal; `assertReadOnlyStatement(sql,
  "duckdb")` did not throw (still a well-formed read-only `SELECT`);
  executing it against the real `FixtureConnector` threw (DuckDB binder
  error on the nonexistent malicious column, not a successful `UPDATE`);
  re-querying `orders_source` for `ORDER_STATUS = 'HACKED'` afterward
  returned **0 rows** — direct proof no mutation occurred.
- **Deterministic-hash strategy, `keyColumn`** (a parameter path the
  implementer's own tests never adversarially probed) with a
  `"); DELETE FROM orders_source; --` payload: same result — safely
  quoted, passes `assertReadOnlyStatement`, execution throws a binder
  error, table intact afterward.
- **First-N strategy, `orderByColumn`** (also untested by the implementer)
  with a `"; DROP TABLE orders_source; --` payload: same result.
- **Date-window strategy, `startDate`** (a *value*, not identifier,
  parameter — exercising `sqlStringLiteral`'s single-quote-doubling path
  rather than `quoteIdentifier`'s double-quote-doubling path) with a
  `' OR '1'='1'; DROP TABLE orders_source; --` payload: generated SQL
  contained the correctly quote-doubled literal; `assertReadOnlyStatement`
  did not throw.
- **Key-range strategy, `startKey`** (string-typed value parameter) with
  the same class of payload: correctly quote-doubled; passes
  `assertReadOnlyStatement`; table intact afterward.

**Conclusion: confirmed, independently, on five parameter paths (three
identifier paths the implementer had not covered, plus two value/literal
paths), not just the two the implementer's own report investigated.**
`quoteIdentifier`'s escaping behavior is correct, and the implementer's
case-(a) conclusion (fix the tests, not the production code) is verified
sound — the tests as rewritten test the actual safety property the review
gate cares about.

**One step further, per the brief's instruction to try a case the
implementer didn't mention:** I also probed whether a malicious
`{ kind: "query" }` `QueryInput` **itself** (not a strategy parameter) —
e.g. `{ kind: "query", sql: "DELETE FROM orders_source" }` passed as the
object being sampled from — could smuggle a mutation through
`resolveObjectReference`'s bare `(${input.sql}) AS sampling_subquery`
wrapping, which does not sanitize `input.sql` at all. Generated SQL:
`SELECT * FROM (DELETE FROM orders_source) AS sampling_subquery LIMIT 3`.
Confirmed `assertReadOnlyStatement` does **not** throw on this text (its
lexical scanner sees no top-level mutating leading keyword — `DELETE`
appears nested inside a parenthesized subquery position, which the scanner
does not specifically check). However, executing this text against real
DuckDB (via `FixtureConnector.executeQuery`) produces a **DuckDB parser
syntax error** (`Parser Error: syntax error at or near "FROM"` — DuckDB
itself rejects a DML statement in FROM-subquery position as invalid SQL
grammar), and `orders_source` was confirmed to retain all 5 rows
afterward. So this specific case is inert in practice, not exploitable —
but the underlying gap in `assertReadOnlyStatement`'s coverage (a
subquery-nested mutating keyword is not specifically checked) is
pre-existing, shared identically by `volume.ts`'s and `profiling.ts`'s own
`resolveObjectReference` implementations (confirmed by reading both — same
bare `(${input.sql}) AS <name>_subquery` pattern, same lack of
sanitization) and by `FixtureConnector`'s own `resolveObjectReference`. It
is not introduced by T-21, is not in T-21's ownership to fix
(`statement-safety.ts` is explicitly T-03's owned file, off-limits to this
task per the brief), and DuckDB's own grammar happens to make it inert for
this exact shape — not something I am raising as a T-21 finding, but
disclosing here since the brief asked me to try a case the implementer
didn't test.

### 5. Scope check

```
$ git diff --name-only main task/T-21-sampling
IMPLEMENTATION-REPORT.md
TASK-BRIEF.md
packages/engine/src/comparison-core/sampling/sampling.test.ts
packages/engine/src/comparison-core/sampling/sampling.ts
```

Confirmed: only `sampling/**` (new directory, both files) plus the two
control documents were touched. No `packages/engine/src/orchestration/
planner/**` change, no `profiling.ts`/`row-level.ts`/`volume.ts`/
`hash-comparison/**`/`statement-safety.ts`/`fixture-connector.ts`/
`packages/shared/src/**` change. `packages/shared/src/connector.ts`'s
existing `GeneratedQuery` interface was left untouched — confirmed by
reading the file directly (`connector.ts:66`, `:114`) — the implementer's
claim of avoiding a naming collision by choosing `SampleGeneratedQuery`
instead of reusing/editing that interface is accurate.

### 6. `supportsTableSampling` branching judgment call

Read `sampling.ts:312-323` (`buildRandom`) directly: confirmed the
branching on `connector.getCapabilities().supportsTableSampling` was
actually implemented as declared —
`SELECT * FROM ${objectRef} TABLESAMPLE SYSTEM (100 PERCENT) LIMIT
${strategy.sampleSize}` when `true`, `SELECT * FROM ${objectRef} ORDER BY
RANDOM() LIMIT ${strategy.sampleSize}` when `false`. Confirmed
`FixtureConnector.getCapabilities()` (`fixture-connector.ts:216-228`)
returns `supportsTableSampling: true` unconditionally, so the fixture-based
tests (and my own probe) exercise the `TABLESAMPLE` branch, matching the
report's disclosure that the fallback branch has no fixture-driven test
coverage. See Minor findings T-21-01/T-21-02 above for the judgment
assessment on whether `TABLESAMPLE SYSTEM (100 PERCENT)` is a reasonable
interpretation of native sampling.

### 7. Deterministic-hash dialect disclosure

Confirmed the DuckDB-only limitation is disclosed prominently: in the
file's own header comment (`sampling.ts:91-110`, a dedicated paragraph),
in the `DeterministicHashStrategy` interface's own doc comment
(`sampling.ts:151-155`), in the `buildDeterministicHash` function's inline
comment (`sampling.ts:325`), and in `IMPLEMENTATION-REPORT.md`'s own
dedicated "Disclosed dialect limitation" subsection with explicit
comparison against SQL Server's `HASHBYTES`/PostgreSQL's `md5` and why
neither is a drop-in replacement. This matches T-20's own precedent
(`hash-comparison.ts`'s header comment discloses an analogous per-dialect
hashing gap) both in prominence and in category — not buried, not a
footnote.

### 8. Cross-checked verbatim quotations against source documents

- `IMPLEMENTATION-PLAN.md`'s T-21 row (line 73): quoted text in
  `TASK-BRIEF.md` matches the literal row text exactly, including the
  review-gate sentence "Independent reviewer confirms sampling never
  bypasses the row-cap/timeout safety limits from `DESIGN-SPEC.md`."
- `DESIGN-SPEC.md` lines 133-134: "default 100,000 rows for row-level
  previews" and "default 60 seconds" — matches the brief's and report's
  citation.
- `Idea Prompt.md` lines 335-340: the six strategy names ("First N rows",
  "Random sample", "Deterministic hash sample", "Stratified sample",
  "Date-window sample", "Key-range sample") match exactly what
  `sampling.ts`'s `SamplingStrategy` discriminated union implements.
- `PROGRESS-LEDGER.md` at `ac52a30`: confirmed 381-test baseline and
  confirmed the Open Findings table has no entry routing to T-21 (only
  M-01/M-02, both from T-01, unrelated) — this is a first-round review
  with no prior finding to re-verify as resolved.

## Disposition of prior findings

None apply to T-21 — this is the task's first review round, and
`PROGRESS-LEDGER.md`'s Open Findings table (as of the `ac52a30` baseline
this branch is built on) contains no finding routed to T-21.

## Adversarial probe residue check

```
$ git status --porcelain
```

returned no output (clean) after deleting both throwaway probe files
(`__reviewer_probe.test.ts`, `__reviewer_probe2.test.ts`) created and used
during this review — confirmed no residue beyond this report.

## Final disposition

**APPROVED.**

Rationale: the review gate's central correctness property — that a sample
strategy's own `LIMIT`/`TABLESAMPLE` clause is additive to, never a
replacement for, the caller's `ExecutionOptions.maxRows`/`timeoutMs` — is
confirmed true by my own independently constructed probe on two strategies
whose SQL carries its own size-limiting clause, not merely by re-running
the implementer's tests. Deterministic-hash reproducibility is confirmed
independently across two separate connector instances. Injection safety is
confirmed on five parameter paths beyond the two the implementer's own
report investigated, including one case (identifier-typed
`orderByColumn`/`keyColumn`) the implementer never adversarially tested,
plus a documented, non-blocking exploration of a `QueryInput`-level
mutation attempt (found inert due to DuckDB's own grammar, and a
pre-existing property shared by `volume.ts`/`profiling.ts`, not a
T-21-introduced gap). Scope is exactly the four files the brief owns.
`npm run verify` independently reproduces 396 passed/27 skipped/423
total/exit 0 exactly as claimed. The two Minor findings (T-21-01,
T-21-02) are disclosed judgment calls the brief explicitly authorized
without mandating a specific approach, do not weaken the review gate, and
do not block approval — routed as non-blocking debt for future
planner-integration work.
