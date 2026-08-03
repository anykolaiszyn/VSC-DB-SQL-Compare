# TASK-BRIEF.md — T-35: `buildComparisonYaml` — query/sqlFile kinds + column_mapping

## Objective

Extend the existing, pure `buildComparisonYaml` builder
(`packages/extension/src/authoring/buildComparisonYaml.ts`, from T-32) so
it can serialize the full range of data this project's engine layer
already supports, but that the builder currently cannot express:

1. **All three `QueryInput` kinds per side**, not just `table`/`object`.
   `QueryInput` (`packages/shared/src/types.ts`) is a discriminated union:
   `{ kind: "table"; object: string }` | `{ kind: "query"; sql: string }` |
   `{ kind: "sqlFile"; filePath: string }`. Today `buildComparisonYaml`
   only ever emits the `table` shape (`connection`/`object`/optional
   `where`) — it has no way to emit `query` or `sqlFile` sides at all.
2. **`column_mapping`** (`ColumnMappingEntry[]`, defined in
   `packages/engine/src/orchestration/definition/definition.ts`, already
   parsed by `parseDefinition` since T-08/T-28) — today
   `buildComparisonYaml` never emits this field at all (relies entirely on
   `parseDefinition`'s existing "absent → `[]`" default).

This is foundation work: Phase 5's custom comparison editor (T-36) and its
Column Mapping tab (T-37) both need to write through an extended
`buildComparisonYaml` that can express these shapes — this task delivers
that extension in isolation, fully tested via round-trips through
`parseDefinition`, before either UI consumer exists.

See `docs/superpowers/specs/2026-08-02-comparison-authoring-ui-design.md`
for the full Phase 5 design this task is the first step of.

## Scope

1. **Extend `NewComparisonAnswers`** (or introduce a clearly-named
   successor type — your call, but keep backward field-name compatibility
   for `comparisonName`/`keys`/`sourceConnection`/`targetConnection` where
   they still apply) so each side can independently specify:
   - `kind: "table"` (existing behavior: `object` + optional `where`)
   - `kind: "query"` (`sql: string`, no `where`/`object` — `QueryInput`'s
     `query` variant has no `where` field of its own; a WHERE clause for
     query-mode input belongs inside the `sql` string itself)
   - `kind: "sqlFile"` (`filePath: string`, same no-`where` reasoning)

   Design the type so a caller cannot accidentally supply `object` for a
   `query`-kind side or `sql` for a `table`-kind side — a discriminated
   union mirroring `QueryInput`'s own shape is the natural fit; do not
   invent a looser "all fields optional" bag type.

2. **Extend the YAML-rendering logic** (`renderSide` today, or its
   replacement) to emit the correct YAML shape for each kind, matching
   exactly what `parseDefinition`'s existing (already-implemented,
   already-tested, out of this task's ownership) parsing logic for
   `source`/`target` expects. Read `parseDefinition`'s parsing of
   `source`/`target` in
   `packages/engine/src/orchestration/definition/definition.ts` to confirm
   the exact expected YAML keys for each kind before writing the
   generator — do not guess the shape.

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
   confirm whether the flat string-map form is also worth emitting or
   whether the list form alone is sufficient — the list form is
   unambiguously correct for both `ColumnMappingEntry` variants, so prefer
   it unless you find a concrete reason the flat map form is needed).

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

5. **Do not touch `newComparisonWizard.ts`** (the interactive
   `paritylens.newComparison` command flow) — this task extends the pure
   builder function only. Wiring the wizard (or any other UI) to actually
   collect query/sqlFile/column-mapping answers and call the extended
   builder is out of scope here; T-36/T-37 are where that UI-level wiring
   happens. The existing `newComparisonWizard.ts` may keep calling the
   builder with only `table`-kind answers exactly as it does today — your
   extended type must keep that call site compiling unchanged (i.e. the
   `table` kind's fields must remain exactly as they are today, just now
   as one arm of a discriminated union rather than the type's only shape).

## Dependencies

- T-08 (`parseDefinition`, `ColumnMappingEntry`, `QueryInput` parsing) —
  complete, this task extends against it read-only.
- T-32 (`buildComparisonYaml`, `NewComparisonAnswers`, `yamlQuotedString`)
  — complete, this task extends it directly.

## Files owned

- `packages/extension/src/authoring/buildComparisonYaml.ts`
- `packages/extension/src/authoring/buildComparisonYaml.test.ts`

## Prohibited changes

- Do not touch `packages/extension/src/authoring/newComparisonWizard.ts`
  or `newComparisonWizard.test.ts` — UI wiring is out of scope for this
  task (see Scope item 5). If `newComparisonWizard.ts`'s existing call
  site to `buildComparisonYaml`/`NewComparisonAnswers` no longer compiles
  after your type change, that is a signal your type change was not
  backward-compatible — fix the type, not the wizard.
- Do not touch `packages/engine/src/orchestration/definition/definition.ts`
  or any other file under `packages/engine/**` — `parseDefinition`,
  `QueryInput`, and `ColumnMappingEntry` are all pre-existing, already-
  approved shapes this task consumes read-only. If you find what looks
  like a genuine parsing gap or bug while reading `definition.ts`, stop
  and disclose it in the implementation report rather than patching it —
  it is out of this task's file ownership regardless of how small the fix
  would be.
- Do not touch `packages/extension/src/activation/activate.ts` or any
  other command-registration file — no new command, no new UI, pure
  builder-function work only.
- Do not add a `build`-time or `dev`-time schema/live column fetch of any
  kind (that is explicitly T-37's scope, gated on a real connector round
  trip) — this task is offline, pure, `vscode`-free string generation
  only, exactly like the existing `buildComparisonYaml.ts` is today.

## Interfaces consumed / produced

- Consumed (read-only): `QueryInput`, `ColumnMappingEntry` from
  `@paritylens/shared`/`@paritylens/engine`; `parseDefinition` (for
  round-trip test verification only, not called from the builder itself
  — `buildComparisonYaml` produces YAML *text*, it does not parse its own
  output at runtime, same as today).
- Produced: an extended `buildComparisonYaml(answers): string` accepting
  the new discriminated-union answers shape; the exact new type name(s)
  and field layout are your call within this task's scope, but must be
  exported from `buildComparisonYaml.ts` so T-36/T-37 can consume them
  later. Document the final shape clearly in the implementation report
  so a future task's brief can reference it precisely.

## Red/Green/Full verification evidence required

- **Red**: a test constructing `query`-kind or `sqlFile`-kind answers (or
  answers including a non-empty `columnMapping`) and calling
  `buildComparisonYaml`, expecting it to compile and round-trip correctly
  through `parseDefinition`, fails today — either a type error (the
  current `NewComparisonAnswers` shape has no way to express this input)
  or, if you stub around the type gap to get a red run at all, a runtime
  assertion failure showing the emitted YAML lacks the expected
  `query`/`sqlFile`/`column_mapping` structure. Document clearly in the
  implementation report which red-state form you used, since a pure type
  gap can't literally "fail a test run" the way a runtime gap can — a type
  error in a dedicated scratch/red-state file, deleted once green, is
  acceptable evidence if that's what the type-gap case requires.
- **Green**: round-trip tests through `parseDefinition` for:
  - Both `query`-kind and `sqlFile`-kind sides (each side independently,
    and a mixed source-is-table/target-is-query case).
  - `column_mapping` with both `ColumnMappingEntry` variants (plain
    `source`/`target`, and derived `name`/`target` with/without
    `sourceExpression`/`targetExpression`).
  - The existing 5 tests in `buildComparisonYaml.test.ts` (table-kind
    round-trip, optional `where`, composite keys, YAML-significant-
    character escaping, connection-field-never-structured) continue to
    pass unmodified in behavior (adjust call sites for the new type shape
    only if required, but do not weaken or remove any existing assertion).
  - At least 2 new adversarial escaping tests for the new fields (`sql`/
    `filePath`/`column_mapping` entries containing YAML-significant
    characters or credential-shaped-looking strings), per Scope item 4.
- **Full**: `npm run verify` (typecheck + lint + test) green.

## Handoff note for the reviewer

Please adversarially confirm, independent of the implementation report:

1. **Shape fidelity against `parseDefinition`**: for each of the 3
   `QueryInput` kinds and both `ColumnMappingEntry` variants, confirm the
   emitted YAML, when parsed, produces an object deep-equal to what you'd
   expect from reading `definition.ts`'s parsing logic directly — not
   merely "no error was thrown."
2. **Escaping coverage**: construct your own adversarial strings (YAML
   anchors/aliases, flow-mapping injection, quote-escape-and-reopen
   attempts, control characters) for `sql`, `filePath`, and
   `column_mapping` entry fields, going beyond whatever cases the
   implementation report discloses — mirroring T-32's original 11-case
   independent probe.
3. **Backward compatibility**: confirm `newComparisonWizard.ts`'s existing
   call site to `buildComparisonYaml` still compiles and its existing
   tests (`newComparisonWizard.test.ts`) still pass, completely
   unmodified, via a diff against `main` showing zero changes to either
   file.
4. **File-ownership diff**: confirm via `git diff --stat main..<branch>`
   that only `buildComparisonYaml.ts` and `buildComparisonYaml.test.ts`
   changed.
5. Confirm no credential-shaped field name appears anywhere reachable
   from the new code paths (same class of check T-32's review applied).

## Branch

`task/T-35-buildyaml-query-mapping`
