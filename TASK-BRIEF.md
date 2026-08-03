# TASK-BRIEF.md — T-35a: `ParitySide`/planner support for query & sqlFile kinds

## Objective

`QueryInput` (`packages/shared/src/types.ts`) has always supported three
kinds — `table`, `query`, `sqlFile`. But the parsed-definition shape
`ParitySide` (`packages/engine/src/orchestration/definition/definition.ts`)
and the planner (`packages/engine/src/orchestration/planner/planner.ts`)
have never supported anything but `table`: `parseSide` unconditionally
requires an `object` field, and `runComparison` hardcodes
`{ kind: "table", object: definition.source.object }` (and the target
equivalent) at 5 separate call sites, plus `buildFetchAllRowsSql` builds a
literal `SELECT * FROM {quotedObject}` string that assumes a table
identifier exists to quote.

This gap was discovered mid-brief for T-35 (originally scoped as "extend
`buildComparisonYaml` to emit query/sqlFile-kind YAML") — the implementer
correctly stopped rather than writing tests that could never honestly pass
against the real `parseDefinition`. This task (T-35a) is the inserted
prerequisite that closes the actual engine-level gap; T-35b (the original
`buildComparisonYaml` extension) resumes once this lands.

**Before writing any code, read `packages/engine/src/comparison-core/
profiling/profiling.ts`'s private `resolveObjectReference` function
(around line 449) in full.** It already solves almost exactly this
problem one layer down — it accepts a `QueryInput` and returns a bare
object reference usable after `FROM`, handling `table` (quoted identifier)
and `query` (subquery-wrapped: `` (${sql}) AS profiling_subquery ``) kinds,
and explicitly documents that `sqlFile` is unsupported at that layer
("supply `{ kind: "query" }` with the file's contents instead"). This
task's design mirrors that pattern rather than reinventing it — read it
first so your implementation is consistent, not a subtly different
reimplementation.

**Also read, before writing any code**, the `sqlFile`-rejection comments
in `SqlServerConnector`, `PostgresConnector`, and `FixtureConnector`
(each has a `case "sqlFile":` branch that throws
`"<Connector> does not read SQL files from disk"`). This confirms
`sqlFile`→`query` resolution (reading the file's contents) must happen
once, at the planner boundary, before any connector method is ever
called — it cannot be deferred to or pushed down into a connector.

## Scope

1. **Extend `ParitySide`** (`definition.ts`) to a discriminated union
   mirroring `QueryInput`'s three kinds:
   - `{ kind: "table"; connection: string; object: string; where?: string }`
     (today's shape, `kind` newly added — see backward-compatibility note
     below)
   - `{ kind: "query"; connection: string; sql: string }` (no `where` — a
     WHERE clause for query-mode input belongs inside the `sql` string
     itself, consistent with T-35b's already-settled design)
   - `{ kind: "sqlFile"; connection: string; filePath: string }` (same
     no-`where` reasoning)

   **Backward compatibility**: existing `.paritylens` YAML documents (and
   every existing test fixture) have no `kind` field on `source`/`target`
   at all — they only ever have `connection`/`object`/optional `where`.
   `parseSide` must treat an **absent** `kind` field as `table`-kind
   (defaulting, not erroring) so every existing parsed definition and
   existing test continues to produce the exact same `ParitySide` value it
   does today. Only an explicit `kind: "query"` or `kind: "sqlFile"` value
   should select those branches. Validate each kind's required fields
   strictly (e.g. a `kind: "query"` side with no `sql` field, or with an
   `object` field present, should be a clear `InvalidDefinitionError`, not
   silently ignored).

2. **Add `resolveSideInput(side: ParitySide, baseDir: string):
   Promise<QueryInput>`** to `planner.ts` (or a new small module under
   `packages/engine/src/orchestration/planner/` if that keeps the file
   from growing unwieldy — your call). Behavior:
   - `table`-kind → `{ kind: "table", object: side.object }` (unchanged
     from today's inline construction).
   - `query`-kind → `{ kind: "query", sql: side.sql }` (pass through
     as-is).
   - `sqlFile`-kind → read `side.filePath` via Node's `fs/promises`,
     resolved relative to `baseDir` (the caller supplies this — mirror
     T-16/T-31's existing safe-root-as-parameter precedent, do not invent
     a different convention), reject any path that resolves outside
     `baseDir` (same containment discipline `writeExport.ts`/`runHistory.ts`
     already established — a mirrored check is fine, importing isn't
     required unless a clean import path already exists), then return
     `{ kind: "query", sql: fileContents }`.

3. **Update `runComparison`'s 5 hardcoded call sites** (`getSchema` ×2,
   row-count ×2, profile-options construction ×2 — re-count exactly by
   reading the current file; the brief's count may be off by one depending
   on how you group them) to call `resolveSideInput` instead of
   constructing `{ kind: "table", object: definition.source.object }`
   inline. `runComparison`'s own exported signature may need a new
   parameter (e.g. `baseDir`) to thread through to `resolveSideInput` —
   if so, make it clearly documented and, if every existing caller always
   has a sensible default (e.g. the workspace root), consider whether an
   optional parameter with a safe default avoids breaking every existing
   call site; if no safe default exists, an explicit required parameter is
   fine — just confirm and disclose which existing call sites needed
   updating as a result (there are `runComparison` callers in `activate.ts`
   test files and `planner.test.ts` — do not edit `activate.ts` itself,
   see Prohibited changes, but you may need to note in your report that a
   later task must update it if the signature changes in a
   non-backward-compatible way).

4. **Update `buildFetchAllRowsSql`** to handle all 3 kinds:
   - `table`-kind: unchanged (`SELECT * FROM {quotedObject}` +
     optional `WHERE {side.where}`).
   - `query`/`sqlFile`-kind: resolve to the actual SQL (via
     `resolveSideInput`, or a shared inner helper if that avoids
     duplicating the `sqlFile`-read logic — your call) and wrap it as a
     subquery source: `` SELECT * FROM ({resolvedSql}) AS row_level_subquery ``
     (no separate `WHERE`, since query/sqlFile-mode input has none).
     This function's signature may need to become `async` and/or take a
     `baseDir` parameter — confirm and update its one caller
     (`fetchAllRows`) accordingly. `buildFetchAllRowsSql` is exported and
     documented as "the SQL string `fetchAllRows` executes ... so the
     previewed and executed SQL can never drift apart" (T-16b's stated
     invariant) — preserve that invariant exactly for all 3 kinds, not
     just `table`.

## Dependencies

- T-08 (`parseDefinition`, `ParitySide`, `QueryInput`) — complete, this
  task extends `ParitySide` directly.
- T-09 (`runComparison`, `buildFetchAllRowsSql`) — complete, this task
  extends both directly.

## Files owned

- `packages/engine/src/orchestration/definition/definition.ts`
- `packages/engine/src/orchestration/definition/definition.test.ts`
- `packages/engine/src/orchestration/planner/planner.ts`
- `packages/engine/src/orchestration/planner/planner.test.ts`
- A new file under `packages/engine/src/orchestration/planner/` only if
  you judge `resolveSideInput` deserves its own module (your call, keep
  it narrowly scoped to this task's concern if you do)

## Prohibited changes

- Do not touch `packages/extension/**` at all, including
  `activate.ts` — if `runComparison`'s signature changes in a way that
  would require an update there, disclose it clearly in the
  implementation report as a follow-up for T-35b or a dedicated small
  task, but do not make that edit yourself. Confirm via `npm run verify`
  whether `packages/extension`'s existing tests still typecheck/pass
  against your changed engine signature — if they don't, that confirms
  the follow-up is real and necessary, not speculative.
- Do not touch `packages/shared/**` — `QueryInput` is already correct and
  unchanged; this task only extends the engine's own parsed/execution
  shapes to actually use the existing `QueryInput` kinds.
- Do not touch `packages/engine/src/comparison-core/profiling/
  profiling.ts` or any other `comparison-core/**` file — `profiling.ts`'s
  `resolveObjectReference` is read-only reference material for this task
  (read it, mirror its pattern, do not import from it — it's private to
  that module — and do not modify it).
- Do not touch any connector file
  (`packages/engine/src/connector-sdk/**`) — the `sqlFile`-rejection
  behavior in each real connector is correct and intentional; this task's
  whole point is resolving `sqlFile` before ever reaching a connector, not
  changing connector behavior.
- Do not add a `vscode` dependency anywhere in `packages/engine` — file
  reading uses plain Node `fs/promises`, consistent with this package
  having no VS Code runtime dependency anywhere today.
- Do not widen `ColumnMappingEntry`, `SchemaDifference`,
  `ProfileDifference`, or `AggregateDifference` — unrelated to this task,
  each owned by its own prior task.

## Interfaces consumed / produced

- Consumed (read-only): `QueryInput` (`@paritylens/shared`);
  `resolveObjectReference`'s pattern in `profiling.ts` (read for
  reference only, not imported); each real connector's `getSchema`/
  `executeQuery` (unchanged, called exactly as `runComparison` already
  calls them today, just with a resolved `QueryInput` instead of an
  inline-constructed one).
- Produced: extended `ParitySide` discriminated union (exported, consumed
  by T-35b next); `resolveSideInput(side, baseDir): Promise<QueryInput>`
  (exported, and its exact signature/location must be documented clearly
  in the implementation report, since T-35b and later Phase 5 tasks may
  need to know it exists); updated `buildFetchAllRowsSql` signature (if
  changed — document the exact new signature).

## Red/Green/Full verification evidence required

- **Red**: a test constructing a `ParityDefinition` (via a literal object,
  not YAML parsing — that's `parseSide`'s own separate test surface) with
  a `query`-kind or `sqlFile`-kind `source`, calling `runComparison`
  against it with a mock/fixture connector, and expecting the connector to
  receive a `query`-kind `QueryInput` (not `table`-kind with an undefined
  `object`), fails today — either a TypeScript error against today's
  `ParitySide` shape, or, if you stub around the type gap to get a runtime
  red state, an assertion showing the connector actually received
  `{kind:"table", object: undefined}` or similar. A separate red-state
  test for `parseSide` itself: parsing a YAML `source` block with
  `kind: "query"` and `sql: "..."` fails today (either throws, since
  `object` is required, or silently drops the `sql` field).
- **Green**:
  - `parseSide`/`parseDefinition` correctly parses all 3 kinds, including
    the backward-compatible "absent `kind` defaults to `table`" behavior
    (a test using today's exact YAML shape, no `kind` field, must produce
    an identical `ParitySide` to what it produces today — this is the
    single most important regression guard in this task).
  - `resolveSideInput` correctly resolves all 3 kinds, including a real
    temporary `.sql` file for the `sqlFile` case (written and cleaned up
    within the test) and a rejected out-of-`baseDir` path (adversarial
    containment test, mirroring T-16/T-31's existing path-escape test
    style — at minimum a sibling-directory-prefix bypass and a `../`
    traversal case).
  - `runComparison` executes correctly end-to-end against a `query`-kind
    and a `sqlFile`-kind source/target pair (via `FixtureConnector` or a
    mock — confirm which fixture setup makes this practical; disclose if
    `FixtureConnector` needs any accommodation, though per Prohibited
    changes you may not modify it — if it turns out `FixtureConnector`
    itself cannot support this test scenario, that is itself a disclosed
    finding, not something to route around by editing
    `connector-sdk/fixture/**`).
  - `buildFetchAllRowsSql` produces the correct subquery-wrapped SQL for
    `query`/`sqlFile` kinds and is provably unchanged for `table`-kind
    (a byte-for-byte string comparison against today's exact output for
    an existing test case).
  - Every pre-existing test in `definition.test.ts` and `planner.test.ts`
    continues to pass with zero behavioral changes for `table`-kind input.
- **Full**: `npm run verify` (typecheck + lint + test) green — including
  confirming (per Prohibited changes) whether `packages/extension`'s tests
  still pass unmodified against your changed engine exports, and
  disclosing clearly if they don't.

## Handoff note for the reviewer

Please adversarially confirm, independent of the implementation report:

1. **Backward compatibility**: parse several of this repo's *actual*
   existing fixture `.paritylens`-shaped test YAML (no `kind` field) and
   confirm the resulting `ParitySide` is identical to what `main`'s
   current `parseSide` produces for the same input — a real diff, not a
   description of one.
2. **`sqlFile` containment**: construct your own adversarial path-escape
   probes for `resolveSideInput`'s `baseDir` check (absolute path escape,
   `../` traversal, sibling-directory-prefix bypass, backslash traversal
   on Windows) beyond whatever the implementation report discloses,
   mirroring T-16/T-31's original adversarial review depth.
3. **No `sqlFile` reaches a connector directly**: grep the full diff (and
   ideally the full `planner.ts`) for any code path where a
   `sqlFile`-kind `QueryInput` (as opposed to `ParitySide`) could reach
   `connector.getSchema`/`connector.executeQuery` without first passing
   through `resolveSideInput`'s file-read-and-convert-to-`query` step.
4. **`buildFetchAllRowsSql`/`fetchAllRows` invariant**: confirm the
   previewed SQL (whatever `buildFetchAllRowsSql` returns) and the
   actually-executed SQL remain provably identical for all 3 kinds, not
   just `table` — this was T-16b's original stated invariant and must not
   regress.
5. **File-ownership diff**: confirm via `git diff --stat main..<branch>`
   that only the declared `definition.ts`/`planner.ts` (+ their test
   files, + any new narrowly-scoped module) changed — nothing under
   `packages/extension/**`, `packages/shared/**`,
   `comparison-core/profiling/**`, or `connector-sdk/**`.
6. If the implementation report discloses a `runComparison` signature
   change requiring a future `activate.ts` update, confirm that disclosure
   is accurate (does `packages/extension` actually still typecheck/pass
   as-is, or not) rather than accepting the claim at face value.

## Branch

`task/T-35a-parityside-query-kinds`
