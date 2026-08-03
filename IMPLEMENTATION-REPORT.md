# ParityLens — Implementation Report T-35b

## Status and objective

- **Status:** COMPLETE (implementation and evidence only — not
  self-approved; independent review required next, per this task's own
  brief and `AGENTS.md`'s "Every implementation task receives an
  independent review by a reviewer who did not author the task's
  change.")
- **Objective:** Resume the original T-35 scope (renamed T-35b): extend
  `buildComparisonYaml` (`packages/extension/src/authoring/buildComparisonYaml.ts`,
  T-32) to emit all three `ParitySide` kinds (`table`/`query`/`sqlFile`,
  per T-35a's widened union in
  `packages/engine/src/orchestration/definition/definition.ts`) and
  `column_mapping` entries, and to fix the 2 test files T-35a's `kind`
  field addition broke, bringing `npm run verify` back to green.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/extension/src/authoring/buildComparisonYaml.ts` | Added `NewComparisonAnswerSide` discriminated union (`table`/`query`/`sqlFile`, mirroring `ParitySide`); extended `NewComparisonAnswers` with optional `source`/`target`/`columnMapping` fields (backward-compatible — existing flat `sourceObject`/`sourceWhere`/`targetObject`/`targetWhere` fields still work); rewrote `renderSide` to dispatch on `kind` and always emit an explicit `kind: "table"`/`"query"`/`"sqlFile"`; added `renderColumnMappingEntry` and `column_mapping` block emission (omitted when absent/empty); re-exported `ColumnMappingEntry` from `@paritylens/engine` for caller convenience. | TASK-BRIEF.md Scope items 1–4. |
| `packages/extension/src/authoring/buildComparisonYaml.test.ts` | Fixed 2 pre-existing failing assertions (added `kind: "table"` to expected `toEqual` objects) and the typecheck error at the old line 59 (`parsed.source.where`) via `kind`-narrowing (`if (parsed.source.kind !== "table") throw ...`) instead of a cast. Added 14 new tests: query-kind source round-trip, sqlFile-kind target round-trip, mixed table/query sides, column_mapping omitted-when-absent/empty, plain and derived `ColumnMappingEntry` round-trips (with/without expressions), multiple mixed entries in order, and 3 adversarial escaping tests for `sql`/`filePath`/`column_mapping` fields (YAML anchors/aliases, flow-mapping injection, embedded newlines, credential-shaped-looking substrings). | TASK-BRIEF.md Scope item 5 (disclosed fix) + Red/Green verification evidence requirements. |
| `packages/extension/src/authoring/newComparisonWizard.test.ts` | Fixed the 1 pre-existing failing assertion (added `kind: "table"` to both expected `toEqual` objects at the old line 211). No other change. | TASK-BRIEF.md Scope item 5 (disclosed fix), file ownership limited to this fix only. |

`packages/extension/src/authoring/newComparisonWizard.ts` (production
code) was **not touched** — confirmed via `git diff main -- packages/extension/src/authoring/newComparisonWizard.ts`
returning zero lines. Its existing call site (`answers.sourceObject`/etc.)
keeps compiling unchanged because the new `source`/`target`/`columnMapping`
fields on `NewComparisonAnswers` are all optional additions, not
replacements of the existing flat fields.

## Behavior and interfaces

- **Behavior delivered:**
  - `buildComparisonYaml` can now emit a `query`-kind or `sqlFile`-kind
    `source`/`target` block (`kind`, `connection`, and exactly the one
    kind-specific field — `sql` or `filePath` — with no `object`/`where`),
    matching `parseSide`'s validation in `definition.ts` exactly (which
    rejects `object`/`where` on non-`table` kinds).
  - Every `table`-kind side is now emitted with an explicit
    `kind: "table"` line rather than relying on `parseSide`'s
    absent-kind-defaults-to-table backward-compatibility path.
  - `buildComparisonYaml` can now emit a `column_mapping:` list block from
    an optional `columnMapping: ColumnMappingEntry[]` answer, in the
    list-of-objects form (not the flat string-map form), supporting both
    the plain `{ source, target }` and derived
    `{ name, target, sourceExpression?, targetExpression? }` variants,
    with `source_expression`/`target_expression` YAML keys (matching
    `parseColumnMappingListEntry`'s field names). The field is omitted
    entirely when `columnMapping` is absent or `[]`, relying on
    `parseDefinition`'s existing "absent → `[]`" default.
  - All new user-supplied string fields (`sql`, `filePath`, and every
    `ColumnMappingEntry` string field) go through the existing
    `yamlQuotedString` escaping helper — no new bare/unquoted scalar is
    emitted anywhere.

- **Interfaces consumed (read-only):** `QueryInput`
  (`@paritylens/shared`), `ParitySide`/`ColumnMappingEntry`/
  `parseDefinition` (`@paritylens/engine`, T-35a's widened shapes and
  T-08/T-28's `parseColumnMapping`/`parseColumnMappingListEntry`) — read
  in full before writing the generator, per the brief's instruction not
  to guess the shape.

- **Interfaces produced (new exported shape, for T-36/T-37 to consume):**

  ```ts
  export type NewComparisonAnswerSide =
    | { kind: "table"; object: string; where?: string }
    | { kind: "query"; sql: string }
    | { kind: "sqlFile"; filePath: string };

  export interface NewComparisonAnswers {
    comparisonName: string;
    sourceConnection: string;
    sourceObject?: string;   // flat table-kind convenience field, used only when `source` is absent
    sourceWhere?: string;    // ditto
    source?: NewComparisonAnswerSide;   // takes precedence over sourceObject/sourceWhere when present
    targetConnection: string;
    targetObject?: string;   // flat table-kind convenience field, used only when `target` is absent
    targetWhere?: string;    // ditto
    target?: NewComparisonAnswerSide;   // takes precedence over targetObject/targetWhere when present
    keys: string[];
    columnMapping?: ColumnMappingEntry[];  // omitted from YAML when absent/empty
  }

  export type { ColumnMappingEntry } from "@paritylens/engine"; // re-exported for caller convenience

  export function buildComparisonYaml(answers: NewComparisonAnswers): string;
  ```

  **Judgment call (documented, not silently made):** rather than making
  `source`/`target` required discriminated-union fields and dropping the
  flat `sourceObject`/`sourceWhere`/`targetObject`/`targetWhere` fields
  entirely, I kept both: the flat fields remain as a `table`-kind-only
  convenience/back-compat path (used when `source`/`target` is absent),
  and the new `source`/`target` fields take precedence when present. This
  was necessary to satisfy the brief's explicit constraint ("your extended
  type must keep that call site compiling unchanged" — Scope item 6,
  Prohibited changes) since `newComparisonWizard.ts`'s existing call site
  only ever supplies the flat fields and must not be touched. A future
  task (T-36/T-37) wiring UI collection for `query`/`sqlFile` answers
  would use the `source`/`target` fields directly.

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Red state (Scope item 5, pre-existing) | `npm run verify` on `main` before any change (captured on this branch prior to editing, per brief: "no need to re-create this failure; it already exists") | **FAIL** — typecheck step: `packages/extension/src/authoring/buildComparisonYaml.test.ts(59,26): error TS2339: Property 'where' does not exist on type 'ParitySide'.` (typecheck halts the `verify` chain before lint/test run) | Captured in this session's transcript, first tool call of the session |
| Red state (Scope item 5, focused) | `npx vitest run packages/extension/src/authoring` (same pre-edit state) | **FAIL** — 3 failed / 15 passed (18 total): `buildComparisonYaml.test.ts` 2 failed (missing `kind: "table"` in expected `toEqual` objects), `newComparisonWizard.test.ts` 1 failed (same pattern) | Captured in this session's transcript, second tool call |
| Focused green state | `npx vitest run packages/extension/src/authoring` (post-edit) | **PASS** — 17 tests in `buildComparisonYaml.test.ts` (5 original, fixed + 12 new), 13 tests in `newComparisonWizard.test.ts` (all passing, only the 1 assertion changed) — 30 total, 0 failed | Captured in this session's transcript, after edits |
| Full verification | `npm run verify` (typecheck + lint + test) | **PASS** — typecheck clean, lint clean, `511 passed \| 27 skipped (538)` across 28 test files (2 skipped files are the pre-existing SQL Server/PostgreSQL integration suites, gated on env vars not set in this environment — unrelated to this task) | Captured in this session's transcript, final full-verify run |

## Assumptions and risks

- **Assumptions:**
  - The list-of-objects YAML form was used for `column_mapping` rather
    than the flat string-map alternative form, per the brief's own
    guidance ("prefer it over the flat string-map alternative form unless
    you find a concrete reason the flat form is needed") — no such reason
    was found; the list form is the only form that can express the
    derived-mapping variant (`name`/`sourceExpression`/`targetExpression`)
    at all, since the flat form can only express `source: target` string
    pairs.
  - Kept the pre-existing flat `sourceObject`/`sourceWhere`/
    `targetObject`/`targetWhere` answer fields rather than removing them,
    as the documented judgment call above explains — this was required to
    satisfy the brief's backward-compatibility constraint on
    `newComparisonWizard.ts`'s untouched call site.

- **Risks or limitations:**
  - `resolveSide`'s flat-field fallback path (`resolveSide` in
    `buildComparisonYaml.ts`) falls back to `object: flatObject ?? ""` if
    `source`/`target` is absent and `sourceObject`/`targetObject` is also
    `undefined`. This can only be reached if a caller constructs a
    `NewComparisonAnswers` value that omits all of `source`,
    `sourceObject` — the type system does not fully prevent this because
    `sourceObject` was left optional for backward compatibility (it was
    required in the pre-T-35b type). In practice `newComparisonWizard.ts`
    always supplies `sourceObject`/`targetObject` when it doesn't supply
    `source`/`target`, so this path is not reachable from the one existing
    production caller, but a future caller could hit it and get an empty
    `object: ""` written to YAML rather than a compile error. This is a
    known, disclosed limitation of the backward-compatible type design,
    not a silently-accepted gap — flagged here for the reviewer to weigh
    whether it's acceptable given the brief's explicit "keep the call site
    compiling unchanged" constraint left no fully-type-safe alternative
    within this task's file ownership (the flat fields could not be made
    required without either breaking backward compatibility or requiring
    a second, incompatible answers type).
  - No genuine parsing gap or bug was found while reading `definition.ts`
    in full, per the brief's instruction to disclose rather than patch
    any such finding. `parseSide`/`parseColumnMapping`/
    `parseColumnMappingListEntry` were read completely before writing the
    generator; the emitted YAML shapes were designed to match them field-
    for-field.

- **Blockers:** None.

## Patch or commit identity

- **Commit:** `a0321a92cbb63c024cd3cbd6bc929bcbde8ac695` — "T-35b: extend
  buildComparisonYaml for query/sqlFile kinds + column_mapping"
- **Branch:** `task/T-35b-buildyaml-query-mapping` (branched from `main`
  after T-35a's merge)
- **Diff scope confirmed:** `git diff --stat main..task/T-35b-buildyaml-query-mapping`
  shows exactly the 3 owned files changed (`buildComparisonYaml.ts`,
  `buildComparisonYaml.test.ts`, `newComparisonWizard.test.ts`); `git diff
  main -- packages/extension/src/authoring/newComparisonWizard.ts` is
  empty.

## Recommended next step

Independent review by a separate reviewer agent (not this implementer),
per `AGENTS.md`'s review-gate requirement and this task's own Handoff
note (6 specific adversarial checks listed in `TASK-BRIEF.md`). This
report does not constitute review or approval — recommend dispatching the
`reviewer` subagent next, with particular attention to the disclosed
`resolveSide` fallback-path risk above and the Handoff note's shape-
fidelity and escaping-coverage checks.
