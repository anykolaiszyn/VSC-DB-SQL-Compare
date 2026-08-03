# TASK-BRIEF.md — T-35b: `buildComparisonYaml` — query/sqlFile kinds + column_mapping

## Objective

Resume the original T-35 scope (renamed T-35b after T-35a was inserted as
a prerequisite): extend the existing, pure `buildComparisonYaml` builder
(`packages/extension/src/authoring/buildComparisonYaml.ts`, from T-32) so
it can serialize the full range of data the engine layer now supports as
of T-35a, but that the builder still cannot express:

1. **All three `QueryInput` kinds per side**, not just `table`/`object`.
   `QueryInput` (`packages/shared/src/types.ts`) is a discriminated union:
   `{ kind: "table"; object: string }` | `{ kind: "query"; sql: string }` |
   `{ kind: "sqlFile"; filePath: string }`. `ParitySide`
   (`packages/engine/src/orchestration/definition/definition.ts`, widened
   by T-35a) now mirrors this exactly, with backward-compatible defaulting
   (an absent `kind` field parses as `table`). Today
   `buildComparisonYaml` only ever emits the `table` shape (`connection`/
   `object`/optional `where`) — it has no way to emit `query` or
   `sqlFile` sides at all.
2. **`column_mapping`** (`ColumnMappingEntry[]`, defined in
   `definition.ts`, already parsed by `parseDefinition` since T-08/T-28) —
   today `buildComparisonYaml` never emits this field at all (relies
   entirely on `parseDefinition`'s existing "absent → `[]`" default).

Additionally, **this task must fix a disclosed, known consequence of
T-35a**: `ParitySide` gaining a required `kind` field broke 2 existing
test files in this task's own ownership (see Scope item 5 below) — T-35a
was explicitly prohibited from touching `packages/extension/**`, so this
task inherits that fix as part of its own scope, not as separate cleanup.

This is foundation work: Phase 5's custom comparison editor (T-36) and its
Column Mapping tab (T-37) both need to write through an extended
`buildComparisonYaml` that can express these shapes.

See `docs/superpowers/specs/2026-08-02-comparison-authoring-ui-design.md`
for the full Phase 5 design this task is part of.

## Scope

1. **Extend `NewComparisonAnswers`** (or introduce a clearly-named
   successor type — your call, but keep backward field-name compatibility
   for `comparisonName`/`keys`/`sourceConnection`/`targetConnection` where
   they still apply) so each side can independently specify:
   - `kind: "table"` (existing behavior: `object` + optional `where`)
   - `kind: "query"` (`sql: string`, no `where`/`object` — `QueryInput`'s
     `query` variant has no `where` field of its own, and neither does
     `ParitySide`'s `query`-kind variant as of T-35a; a WHERE clause for
     query-mode input belongs inside the `sql` string itself)
   - `kind: "sqlFile"` (`filePath: string`, same no-`where` reasoning)

   Design the type so a caller cannot accidentally supply `object` for a
   `query`-kind side or `sql` for a `table`-kind side — a discriminated
   union mirroring `ParitySide`'s own shape (T-35a) is the natural fit;
   do not invent a looser "all fields optional" bag type.

2. **Extend the YAML-rendering logic** (`renderSide` today, or its
   replacement) to emit the correct YAML shape for each kind, matching
   exactly what `parseSide`'s parsing logic (widened by T-35a, in
   `definition.ts`) expects. Read `parseSide`'s current implementation in
   full before writing the generator — do not guess the shape. Emit an
   explicit `kind: "table"` for table-kind sides (do not rely on
   `parseSide`'s absent-kind-defaults-to-table backward-compatibility
   behavior — that exists for *old, pre-T-35a-written* documents; new
   documents this builder writes should be explicit).

3. **Add `column_mapping` serialization.** Accept an optional
   `columnMapping?: ColumnMappingEntry[]` (or equivalent) on the answers
   type. When present and non-empty, emit a `column_mapping` block; when
   absent or empty, omit the field entirely (matching the file's existing
   convention for other optional fields, e.g. `where`). Support both
   `ColumnMappingEntry` variants (`{ source, target }` plain mapping, and
   `{ name, target, sourceExpression?, targetExpression? }` derived
   mapping) — read `ColumnMappingEntry`'s definition and
   `parseColumnMapping`/`parseColumnMappingListEntry`'s parsing logic in
   `definition.ts` first to confirm the exact expected list-entry YAML
   shape `parseDefinition` accepts (it accepts a list-of-objects form;
   the list form is unambiguously correct for both `ColumnMappingEntry`
   variants — prefer it over the flat string-map alternative form unless
   you find a concrete reason the flat form is needed).

4. **Preserve every existing safety property** unchanged:
   - Every user-supplied string value (`sql`, `filePath`, `columnMapping`
     entries' `source`/`target`/`name`/`sourceExpression`/
     `targetExpression`, same as `comparisonName`/`sourceConnection`/
     `sourceObject`/`sourceWhere` today) must go through the existing
     `yamlQuotedString` escaping helper — never emit any of these as bare/
     unquoted YAML scalars.
   - `connection` fields remain bare double-quoted string scalars only,
     never structured objects — same rule as today, now also verified
     against `query`/`sqlFile`-kind sides (a `query`-kind side still names
     a `connection`, just no `object`).
   - No new call sites or logic may write `password`/other
     credential-shaped field names anywhere in the emitted document (same
     class of guarantee T-32's original review adversarially probed with
     an 11-case YAML-injection test — this task's tests should include at
     least a few equivalently adversarial cases for the *new* fields
     specifically: `sql` containing YAML-significant characters, `filePath`
     containing YAML-significant characters, `column_mapping` entries
     containing YAML-significant characters or credential-shaped-looking
     strings).

5. **Fix the 2 test files broken by T-35a** (disclosed and reviewer-
   confirmed in T-35a's `IMPLEMENTATION-REPORT.md`/`REVIEW-REPORT.md` —
   read both for full context before starting):
   - `packages/extension/src/authoring/buildComparisonYaml.test.ts` — 2
     assertions (`toEqual(parsed.source, {...})`/`toEqual(parsed.target,
     {...})` style, lines ~40-41) need an explicit `kind: "table"` added
     to their expected objects, now that `parseDefinition` genuinely
     returns that field. There is also a typecheck error at line 59
     (`parsed.source.where` — TypeScript can no longer prove a bare
     `ParitySide` has a `.where` field without narrowing on `kind`, since
     the type is now a discriminated union). Fix by narrowing (e.g.
     `if (parsed.source.kind === "table") { expect(parsed.source.where)...
     }` or an equivalent type-narrowing assertion) rather than an `as`
     cast — the whole point of the discriminated union is that TypeScript
     can verify this correctly.
   - `packages/extension/src/authoring/newComparisonWizard.test.ts` — 1
     assertion (line ~211, same `toEqual` pattern) needs the same
     `kind: "table"` fix.

   These are the *existing* tests's expected-value fixes only — this is
   not license to weaken, remove, or loosen any assertion beyond adding
   the now-required `kind` field / narrowing the type access. If you find
   any other test in either file affected by T-35a's change beyond what's
   listed here, fix it the same minimal way and disclose it.

6. **Do not otherwise expand `newComparisonWizard.ts`'s interactive
   collection flow** to actually prompt for query/sqlFile/column-mapping
   answers — this task extends the pure builder function and fixes the
   2 disclosed breaks only. Wiring a UI to collect richer answers and call
   the extended builder is T-36/T-37's job. `newComparisonWizard.ts`'s
   existing call site may keep calling the builder with only `table`-kind
   answers exactly as it does today (beyond the one disclosed `kind`-field
   fix in its test file) — your extended type must keep that call site
   compiling unchanged.

## Dependencies

- T-08 (`parseDefinition`, `ColumnMappingEntry`) — complete, this task
  extends against it read-only.
- T-32 (`buildComparisonYaml`, `NewComparisonAnswers`, `yamlQuotedString`)
  — complete, this task extends it directly.
- T-35a (`ParitySide` widened to 3 kinds, `parseSide` updated) — complete
  and merged to `main`; this task's `query`/`sqlFile` round-trip is only
  possible because of T-35a's parser extension, and this task must also
  fix the 2 test files T-35a's change broke (Scope item 5).

## Files owned

- `packages/extension/src/authoring/buildComparisonYaml.ts`
- `packages/extension/src/authoring/buildComparisonYaml.test.ts`
- `packages/extension/src/authoring/newComparisonWizard.test.ts` (Scope
  item 5's fix only — do not otherwise change this file's behavior or
  assertions beyond the disclosed `kind`-field fix)

## Prohibited changes

- Do not touch `packages/extension/src/authoring/newComparisonWizard.ts`
  itself (only its `.test.ts` file, per Scope item 5) — UI wiring beyond
  the disclosed test fix is out of scope for this task (see Scope item
  6). If `newComparisonWizard.ts`'s existing call site to
  `buildComparisonYaml`/`NewComparisonAnswers` no longer compiles after
  your type change, that is a signal your type change was not
  backward-compatible — fix the type, not the wizard's production code.
- Do not touch `packages/engine/**` — `parseDefinition`, `ParitySide`,
  `QueryInput`, and `ColumnMappingEntry` are all pre-existing, already-
  approved shapes (the first three now current as of T-35a) this task
  consumes read-only. If you find what looks like a genuine parsing gap
  or bug while reading `definition.ts`, stop and disclose it in the
  implementation report rather than patching it — it is out of this
  task's file ownership regardless of how small the fix would be.
- Do not touch `packages/extension/src/activation/activate.ts` or any
  other command-registration file — no new command, no new UI, pure
  builder-function work (plus the disclosed test fix) only.
- Do not add a `build`-time or `dev`-time schema/live column fetch of any
  kind (that is explicitly T-37's scope, gated on a real connector round
  trip) — this task is offline, pure, `vscode`-free string generation
  only, exactly like the existing `buildComparisonYaml.ts` is today.

## Interfaces consumed / produced

- Consumed (read-only): `QueryInput`, `ColumnMappingEntry`, `ParitySide`
  (T-35a's widened shape) from `@paritylens/shared`/`@paritylens/engine`;
  `parseDefinition` (for round-trip test verification only, not called
  from the builder itself — `buildComparisonYaml` produces YAML *text*,
  it does not parse its own output at runtime, same as today).
- Produced: an extended `buildComparisonYaml(answers): string` accepting
  the new discriminated-union answers shape; the exact new type name(s)
  and field layout are your call within this task's scope, but must be
  exported from `buildComparisonYaml.ts` so T-36/T-37 can consume them
  later. Document the final shape clearly in the implementation report so
  a future task's brief can reference it precisely.

## Red/Green/Full verification evidence required

- **Red**: two categories:
  - The 2 already-failing tests in `buildComparisonYaml.test.ts` /
    `newComparisonWizard.test.ts` (currently failing on `main` due to
    T-35a's disclosed break) — run `npx vitest run
    packages/extension/src/authoring` on `main` before your changes and
    capture the exact failure output as your red-state evidence for Scope
    item 5 (no need to re-create this failure; it already exists).
  - A test constructing `query`-kind or `sqlFile`-kind answers (or answers
    including a non-empty `columnMapping`) and calling
    `buildComparisonYaml`, expecting it to compile and round-trip
    correctly through `parseDefinition`, fails today — either a type
    error (the current `NewComparisonAnswers` shape has no way to express
    this input) or, if you stub around the type gap to get a red run at
    all, a runtime assertion failure showing the emitted YAML lacks the
    expected `query`/`sqlFile`/`column_mapping` structure.
- **Green**:
  - Both previously-failing tests pass again (Scope item 5), with the
    typecheck error at `buildComparisonYaml.test.ts:59` resolved via type
    narrowing, not a cast.
  - Round-trip tests through `parseDefinition` for both `query`-kind and
    `sqlFile`-kind sides (each side independently, and a mixed
    source-is-table/target-is-query case).
  - `column_mapping` round-trip tests for both `ColumnMappingEntry`
    variants (plain `source`/`target`, and derived `name`/`target`
    with/without `sourceExpression`/`targetExpression`).
  - The existing 5 tests in `buildComparisonYaml.test.ts` (table-kind
    round-trip, optional `where`, composite keys, YAML-significant-
    character escaping, connection-field-never-structured) continue to
    pass, adjusted only for the new explicit `kind: "table"` field where
    needed.
  - At least 2 new adversarial escaping tests for the new fields (`sql`/
    `filePath`/`column_mapping` entries containing YAML-significant
    characters or credential-shaped-looking strings), per Scope item 4.
- **Full**: `npm run verify` (typecheck + lint + test) green — this is
  the first task since T-35a where a fully green `npm run verify` is
  expected again (T-35a left it deliberately, disclosedly red pending
  this task).

## Handoff note for the reviewer

Please adversarially confirm, independent of the implementation report:

1. **`main`'s full `npm run verify` is green again** after this task —
   confirm the 2 previously-broken tests now pass and the typecheck error
   is genuinely resolved via type narrowing (read the actual diff, don't
   just trust green CI-style output).
2. **Shape fidelity against `parseSide`**: for each of the 3 `ParitySide`
   kinds and both `ColumnMappingEntry` variants, confirm the emitted YAML,
   when parsed, produces an object deep-equal to what you'd expect from
   reading `definition.ts`'s parsing logic directly — not merely "no
   error was thrown."
3. **Escaping coverage**: construct your own adversarial strings (YAML
   anchors/aliases, flow-mapping injection, quote-escape-and-reopen
   attempts, control characters) for `sql`, `filePath`, and
   `column_mapping` entry fields, going beyond whatever cases the
   implementation report discloses — mirroring T-32's original 11-case
   independent probe.
4. **Backward compatibility**: confirm `newComparisonWizard.ts`'s
   production code (not its test file) still compiles and behaves
   unchanged, via a diff against `main` showing zero changes to that file.
5. **File-ownership diff**: confirm via `git diff --stat main..<branch>`
   that only `buildComparisonYaml.ts`, `buildComparisonYaml.test.ts`, and
   `newComparisonWizard.test.ts` changed.
6. Confirm no credential-shaped field name appears anywhere reachable
   from the new code paths (same class of check T-32's review applied).

## Branch

`task/T-35b-buildyaml-query-mapping`
