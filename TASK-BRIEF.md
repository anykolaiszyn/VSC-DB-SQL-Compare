# ParityLens — Task Brief T-08

## Objective

Implement the Parity YAML definition schema and parser: `parseDefinition(yaml: string): ParityDefinition`, matching the structure given verbatim in `Idea Prompt.md` section 7 (source/target connections and objects, `keys`, `column_mapping`, `exclude_columns`, `rules`, `checks`), and rejecting any inline credential-shaped field per `DESIGN-SPEC.md`'s security model.

## Dependencies

- **Required completed tasks:** T-02 (canonical shared types) — COMPLETE and
  APPROVED. T-04 (DuckDB fixture connector) — COMPLETE and APPROVED; used as
  a realistic `connection` reference target in test fixtures for this task.
- **Required decisions or approvals:** `DESIGN-SPEC.md` security section
  (approved): "Parity definition YAML files reference named connection
  profiles only — never inline secrets. This is enforced by the parity
  definition schema rejecting any credential-shaped field." This task
  implements that approved decision as a hard validation rule, not an
  optional lint.

## Files owned

- `packages/engine/src/orchestration/definition/**`

Do not touch `packages/shared/**`, `packages/engine/src/connector-sdk/**`,
or `packages/engine/src/comparison-core/**` (T-05/T-06/T-07's files).

## Interfaces

| Direction | Interface | Contract | Producer or consumer |
| --- | --- | --- | --- |
| Consumed | `QueryInput` (T-02) | The discriminated union (`kind`: `table` / `query` / `sqlFile`) that a parsed `source`/`target` object/query/SQL-file reference must map onto | `packages/shared/src/types.ts` |
| Produced | `ParityDefinition` type | Matches `Idea Prompt.md` section 7's YAML example structure exactly: `version`, `name`, `source` (`connection`, `object`, optional `where`), `target` (same shape), `keys` (string array, supports composite keys per section 6), `column_mapping` (string-to-string map, plus optional derived mappings per section 3's `source_expression`/`target_expression` pattern), `exclude_columns` (string array), `rules` (per-column normalization rules per section 4's example: `trim`, `case_sensitive`, `collapse_whitespace`, `numeric_tolerance`, `timezone`, `truncate_to`, `null_equivalents`), `checks` (per-check-type `enabled`/`tolerance` structure per section 7's example: `schema`, `row_count`, `profile`, `row_level`) | Consumed by T-09 (orchestration planner) |
| Produced | `parseDefinition(yaml: string): ParityDefinition` | Parses YAML into `ParityDefinition`. Throws a typed error (e.g. `InvalidDefinitionError`) on: malformed YAML, missing required fields (`version`, `name`, `source`, `target`, `keys`), and — critically — any field anywhere in the document that looks like a credential (field names such as `password`, `secret`, `token`, `api_key`, `connection_string` containing embedded credentials, or a `connection` field that is itself an object rather than a named-profile string reference). `source`/`target` must reference connections by name only (a bare string), never inline connection details | Consumed by T-09 |

## Prohibited changes

- Do not implement the orchestration planner itself (T-09) — parsing and
  validation only.
- Do not modify `packages/shared/**`, `packages/engine/src/connector-sdk/**`,
  or `packages/engine/src/comparison-core/**`.
- Do not add a YAML-parsing dependency without documenting the choice and
  why (e.g. `yaml` or `js-yaml` — pick one, both are reasonable; avoid
  anything that executes arbitrary code from the YAML document, such as
  enabling unsafe custom tag resolution).
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Test or check to add:** A focused Vitest test parsing a minimal valid
  YAML definition (matching `Idea Prompt.md` section 7's structure) and
  asserting the parsed `ParityDefinition` matches expected values. A second
  red-state case: a YAML document containing an inline `password:` field
  (anywhere in the document, including nested under `source`/`target`) must
  throw `InvalidDefinitionError`, not parse successfully.
- **Command:** `npx vitest run packages/engine`
- **Expected failure reason:** `parseDefinition` does not exist yet.
- **Captured output:** Exact command output and exit code, pasted into
  `IMPLEMENTATION-REPORT.md`.

## Green-state and full verification

- **Focused command:** `npx vitest run packages/engine`
- **Full command:** `npm run verify`
- **Expected evidence:** Focused command passes: the full worked example
  from `Idea Prompt.md` section 7 parses correctly end-to-end; the
  credential-rejection test throws as required; malformed/missing-required-
  field cases throw with a clear error. Full command passes with exit code
  0, no regression in the existing 249 tests.

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md` (project root)
- **Independent reviewer:** A separate Claude Code subagent instance, dispatched by the Lead Orchestrator, distinct from the T-08 implementer subagent. Given this task enforces a security-relevant rule (no inline credentials), the reviewer must specifically attempt to find a credential field shape that evades detection (e.g. nested under an unexpected key, or a differently-cased field name).
- **Review report location:** `REVIEW-REPORT.md` (project root)
- **Commit or patch checkpoint:** Branch `task/T-08-definition-parser`
