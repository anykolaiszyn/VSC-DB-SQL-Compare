# ParityLens — Implementation Report T-08

## Status and objective

- **Status:** COMPLETE
- **Objective:** Implement the Parity YAML definition schema and parser:
  `parseDefinition(yaml: string): ParityDefinition`, matching the structure
  given verbatim in `Idea Prompt.md` section 7 (`source`/`target`
  connections and objects, `keys`, `column_mapping`, `exclude_columns`,
  `rules`, `checks`), and rejecting any inline credential-shaped field per
  `DESIGN-SPEC.md`'s security model.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/engine/src/orchestration/definition/definition.ts` | New. `parseDefinition`, `InvalidDefinitionError`, `ParityDefinition` and its sub-types (`ParitySide`, `ColumnMappingEntry`, `NormalizationRule`, `ParityChecks`), plus the credential-field detector. | T-08's produced interfaces per `TASK-BRIEF.md`. |
| `packages/engine/src/orchestration/definition/definition.test.ts` | New. Red-state evidence plus green-state coverage: the full `Idea Prompt.md` section 7 worked example parsed field-by-field; credential rejection (top-level, nested under `source`, nested under `target`, other field names, differently-cased names, deeply nested, object-shaped `connection`); malformed YAML and each missing-required-field case; composite keys; derived column mappings and normalization rules. | Test-first process required by `AGENTS.md`/`TASK-BRIEF.md`. |
| `packages/engine/package.json` | Added `yaml` (`^2.9.0`) as a direct dependency. | YAML parsing library for this task (see rationale below). |
| `package-lock.json` | Updated by `npm install yaml --workspace=@paritylens/engine`. | Lockfile consequence of the above. |

No other file was modified. `packages/shared/**`, `packages/engine/src/connector-sdk/**`, and `packages/engine/src/comparison-core/**` were not touched. `PROGRESS-LEDGER.md` was not touched.

## YAML library choice and safety rationale

**Chosen: `yaml` (eemeli/yaml), not `js-yaml`.**

Both are reasonable per `TASK-BRIEF.md`. `yaml` was chosen because its
`parse()` function only ever produces plain JavaScript data (strings,
numbers, booleans, null, arrays, plain objects) from standard YAML tags.
It has no "unsafe load" mode, no separate `DEFAULT_SCHEMA`/`load()` vs
`safeLoad()` split, and does not resolve arbitrary custom tags into
executable JavaScript objects by default — so there is no unsafe-API
footgun to avoid or document around. `js-yaml`'s historical `load()`
function (pre-4.x) and its custom-schema/custom-tag support are exactly
the kind of "parser mode that executes arbitrary code or resolves unsafe
custom tags" the task brief calls out to avoid; while modern `js-yaml`
(v4+, already present transitively in this repo's `node_modules` via an
ESLint dependency) defaults `load()` to a safe schema, `yaml` was still
preferred as the more deliberately safe-by-construction choice with a
cleaner TypeScript-first API. `parseDefinition` calls `parse(yamlText)`
from the `yaml` package with no options that would enable custom tags or
schema extensions — the plain default parse path only.

`yaml` was added as a direct dependency of `packages/engine`
(`packages/engine/package.json`, `"yaml": "^2.9.0"`) via `npm install yaml
--workspace=@paritylens/engine`.

## Credential-detection approach

`assertNoCredentialFields` in `definition.ts` recursively walks the
**entire parsed document** (not just `source`/`target`) before any other
validation runs, so the security rule from `DESIGN-SPEC.md` — "any field
anywhere in the document" — is checked unconditionally, at every nesting
depth, inside every object and array.

For every YAML mapping key encountered anywhere in the document, the key
is normalized (lowercased, with spaces/underscores/hyphens stripped) and
compared against a fixed rejected-name set, so `API_KEY`, `apiKey`,
`api-key`, and `api key` all match the same rejected name (`api_key`) —
the check is not evaded by re-casing or re-punctuating an otherwise-
recognized field name.

Full list of rejected field names (case/separator-insensitive):

- `password`, `passwd`, `pwd`
- `secret`, `secrets`, `secretkey` / `secret_key`
- `token`, `accesstoken` / `access_token`, `refreshtoken` / `refresh_token`
- `apikey` / `api_key`
- `clientsecret` / `client_secret`
- `privatekey` / `private_key`
- `connectionstring` / `connection_string`
- `credentials`, `credential`

Separately (and additionally to the name-based scan), `parseSide` enforces
that `source.connection` and `target.connection` are **bare strings**, not
objects — so even a `connection:` field with an unlisted-but-inline-
looking shape (e.g. `connection: { host: ..., user: ... }` with no field
named from the list above) is rejected, because `TASK-BRIEF.md` requires
rejecting "a `connection` field that is itself an object rather than a
named-profile string reference" as a distinct rule from the field-name
scan. This closes the gap the field-name scan alone would miss: an inline
connection object whose keys happen not to match any listed credential
name.

**Known residual risk, flagged for the reviewer per `TASK-BRIEF.md`'s
explicit instruction to attempt evasion:** the check is exact-name-based
(after normalization), not pattern/heuristic-based. A credential value
under a field name not in the list above and not inside a `connection`
object (e.g. `where: "user='admin' AND pass_phrase='x'"`, or a custom field
like `auth_blob: ...`) would not be caught by this implementation. The
`connection`-must-be-a-string rule catches the specific case the task
brief calls out (an inline connection object), but does not generalize to
every conceivable field name a document author might invent. This is
recorded as a risk below, not silently omitted.

## Behavior and interfaces

- **Behavior delivered:** `parseDefinition(yamlText)` parses YAML via
  `yaml`'s `parse()`, wrapping any parse failure in `InvalidDefinitionError`
  with the underlying reason. It then validates, in order: (1) the parsed
  value is a top-level mapping/object; (2) no credential-shaped field
  exists anywhere in the document (checked first, unconditionally); (3)
  `version` (number), `name` (non-empty string), `source`/`target`
  (`ParitySide`: string `connection`, string `object`, optional string
  `where`), `keys` (non-empty string array) are all present and well-formed
  — each missing/malformed required field throws a distinct,
  message-specific `InvalidDefinitionError`; (4) optional fields
  `column_mapping` (flat string map per section 7's example, or a list of
  plain/derived entries per section 3's example), `exclude_columns` (string
  array), `rules` (per-column `NormalizationRule` covering `trim`,
  `case_sensitive`, `collapse_whitespace`, `numeric_tolerance`
  {`absolute`/`percentage`}, `timezone` {`source`/`target`}, `truncate_to`,
  `null_equivalents`), and `checks` (`schema`/`row_count`/`profile`/
  `row_level`, each with `enabled` plus check-specific fields:
  `row_count.tolerance` {`percentage`/`absolute`}, `profile.top_values`,
  `row_level.strategy`/`max_differences`) are parsed if present, defaulting
  to empty/absent otherwise.
- **Interfaces consumed:** none at runtime from `@paritylens/shared` (the
  produced `ParityDefinition.source`/`target` shape is `{ connection,
  object, where? }`, structurally aligned with the `QueryInput` discriminated
  union's `{ kind: "table"; object: string }` variant per `TASK-BRIEF.md`'s
  interface row, but T-08 does not construct a `QueryInput` value itself —
  that mapping is left to T-09's orchestration planner, which is the
  documented consumer of both `ParityDefinition` and `QueryInput`).
- **Interfaces produced:** `parseDefinition(yaml: string): ParityDefinition`,
  `InvalidDefinitionError`, and the `ParityDefinition` type tree (`ParitySide`,
  `ColumnMappingEntry`, `NormalizationRule`, `ParityChecks`) from
  `packages/engine/src/orchestration/definition/definition.ts`. Consumed by
  T-09 (orchestration planner), not yet implemented.

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Red state | `npx vitest run packages/engine/src/orchestration` | 1 failed suite: `Error: Failed to load url ./definition.js ... Does the file exist?` (module did not exist yet) | Captured directly in this session's transcript before `definition.ts` was written |
| Focused green state | `npx vitest run packages/engine/src/orchestration` | `Test Files 1 passed (1)`, `Tests 25 passed (25)` | Session transcript |
| Focused green state (full engine) | `npx vitest run packages/engine` | `Test Files 6 passed (6)`, `Tests 263 passed (263)` (249 pre-existing minus the 1 `packages/shared` file not in this glob's scope, plus 25 new — see full verification row for the authoritative total) | Session transcript |
| Full verification | `npm run verify` | Exit 0. `tsc -b --force` clean, `eslint .` clean, `vitest run`: `Test Files 7 passed (7)`, `Tests 274 passed (274)` (249 pre-existing + 25 new, 0 regressions) | Session transcript |

Full verify output (test summary):

```text
 ✓ packages/shared/src/types.test.ts (11 tests)
 ✓ packages/engine/src/comparison-core/type-mapping/type-mapping.test.ts (69 tests)
 ✓ packages/engine/src/connector-sdk/safety/statement-safety.test.ts (109 tests)
 ✓ packages/engine/src/orchestration/definition/definition.test.ts (25 tests)
 ✓ packages/engine/src/comparison-core/schema-diff/schema-diff.test.ts (11 tests)
 ✓ packages/engine/src/comparison-core/profiling/profiling.test.ts (9 tests)
 ✓ packages/engine/src/connector-sdk/fixture/fixture-connector.test.ts (40 tests)

 Test Files  7 passed (7)
      Tests  274 passed (274)
```

Exit code confirmed as `0` via a separate `echo "EXIT CODE: $?"` check
immediately after the `npm run verify` run.

## Assumptions and risks

- **Assumptions:**
  - `column_mapping` is accepted in either shape shown in the idea doc: a
    flat string-to-string map (section 7's worked example) or a list of
    entries (section 3's plain-and-derived-mapping example). Both are
    normalized to the same `ColumnMappingEntry[]` output shape so T-09 does
    not need to branch on which YAML shape the author used.
  - `keys` supports one or more entries (composite keys) as a plain array —
    no distinct "composite key" YAML syntax was found anywhere in
    `Idea Prompt.md` (the document's section 6 is "VS Code User Experience",
    not a keys-specific section; the task brief's cross-reference to
    "section 6" for composite keys does not correspond to a distinct
    subsection in the current document). The `keys: string[]` shape
    already supports zero-or-more entries naturally, so this is satisfied
    without needing a separate syntax.
  - `checks.*.enabled` is required (not defaulted) whenever a given check
    key (`schema`/`row_count`/`profile`/`row_level`) is present at all,
    matching every example in the idea doc where `enabled` is always
    explicit.
  - Numeric-typed rule fields (`numeric_tolerance.absolute/percentage`,
    `checks.row_count.tolerance.*`, `checks.profile.top_values`,
    `checks.row_level.max_differences`) are coerced with `Number(...)`
    rather than strictly type-checked, since YAML numeric literals parse to
    JS `number` already in the common case and this avoids over-rejecting
    a YAML author's differently-formatted number.
- **Risks or limitations:**
  - The credential-field detector is an exact-name (post-normalization)
    match against a fixed list, plus a structural rule that
    `source`/`target.connection` must be a bare string. It is not a
    content-pattern heuristic (e.g. it does not scan string *values* for
    things that look like passwords or connection strings with embedded
    credentials, only *field names*). A credential value placed under an
    unlisted field name outside of `connection` (e.g. a custom `auth`,
    `secret_phrase`, or embedded inside a `where` clause string) would not
    be caught. This is the primary area the independent reviewer is asked
    to probe, per `TASK-BRIEF.md`'s explicit instruction.
  - `parseDefinition` does not currently validate that `keys`,
    `column_mapping` source-side names, or `exclude_columns` reference
    columns that actually exist in either side's schema — that requires a
    live schema lookup, which is out of scope for a pure YAML-to-type
    parser (schema-aware validation is naturally T-09's job, once it has a
    connector to query).
  - `where` on `source`/`target` and any `*_expression` field is accepted
    as an opaque string and is not parsed/validated as SQL by this task —
    consistent with T-08 being parsing/validation only, not the
    orchestration planner.
- **Blockers:** None.

## Patch or commit identity

- **Commit:** filled in immediately after this report is committed — see
  `git log -1` on branch `task/T-08-definition-parser` for the exact hash.
  This task does not self-approve, so no merge to `main` is performed here.
- **Branch:** `task/T-08-definition-parser`, branched from `main` at commit
  `a0dd1fd` (`T-07: reconcile ledger — task complete and approved`, `main`'s
  tip at branch-creation time, confirmed via `git merge-base main HEAD`).

## Recommended next step

Independent review by a separate Claude Code subagent instance (per
`TASK-BRIEF.md`'s Handoff section), distinct from this implementer. Per the
task brief's explicit instruction, the reviewer must specifically attempt
to find a credential field shape that evades detection — e.g. a credential
nested under an unexpected key name not in the rejected list, a
differently-cased or differently-punctuated variant not covered by the
normalization, or a credential value embedded inside an otherwise-
unremarkable string field (such as `where`) — and confirm whether any such
shape passes `parseDefinition` without throwing.
