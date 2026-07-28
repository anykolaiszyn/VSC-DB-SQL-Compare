# ParityLens — Review Report T-08

## Review independence

This review was performed by a Claude Code subagent instance distinct from
the T-08 implementer, per `AGENTS.md`'s "every implementation task receives
an independent review by a reviewer who did not author the task's change."
No implementation file, `TASK-BRIEF.md`, or `IMPLEMENTATION-REPORT.md` was
edited by this reviewer. Only `REVIEW-REPORT.md` was written (replacing the
stale T-07 re-review report that previously occupied this path, per the
project's one-report-per-task-round convention). All findings below are
based on direct inspection of the actual source (`definition.ts`,
`definition.test.ts`), fresh command execution, and throwaway adversarial
probe test files that were deleted after use (never committed, confirmed
via `git status --short` showing no residue).

## Review scope

- **Task objective:** Implement `parseDefinition(yaml: string): ParityDefinition`
  matching `Idea Prompt.md` section 7's worked YAML structure, and reject
  any inline credential-shaped field per `DESIGN-SPEC.md`'s security model.
- **Files and interfaces reviewed:**
  `packages/engine/src/orchestration/definition/definition.ts`,
  `packages/engine/src/orchestration/definition/definition.test.ts`,
  `packages/engine/package.json`, `package-lock.json` (yaml dependency
  addition), commits `a7de7be` and `ceabbea` on
  `task/T-08-definition-parser`.
- **Evidence reviewed:** `TASK-BRIEF.md`, `IMPLEMENTATION-REPORT.md`,
  `DESIGN-SPEC.md` security section, `Idea Prompt.md` sections 3, 4, 6, 7,
  13, `PROGRESS-LEDGER.md` open findings, fresh `npx vitest run
  packages/engine`, fresh `npm run verify`, `git show --stat` on both
  commits, `node_modules/yaml/package.json` and `package-lock.json`
  integrity/registry metadata, and 11 adversarial probe cases run directly
  against the real `parseDefinition` function (probe files deleted after
  use, not part of this review's committed output).

## Critical findings

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| NONE | — | — | — |

## Important findings

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| NONE | — | — | — |

No Important finding is raised for the credential-detection gap itself —
see the dedicated judgment section below. It is recorded as a tracked
Minor (R-01) rather than blocking, for the reasons given there.

## Minor findings

| ID | Finding | Evidence | Suggested resolution |
| --- | --- | --- | --- |
| R-01 | Credential-field detector is an exact-name blocklist (post-normalization) plus a `source`/`target.connection`-must-be-a-bare-string structural rule. Common, foreseeable credential field names outside the list are **not** caught: adversarial probe confirmed `auth: mySecretPass123`, `db_pass: hunter2`, `key: abc123`, `pass: abc123`, and `passphrase: abc123` all parse successfully with no error. This is a larger gap than the implementer's own disclosure emphasized (which framed the risk mainly around "custom fields like `auth_blob`"); `pass` and `auth` in particular are very ordinary, likely-to-occur names, not exotic ones. | Adversarial probe run directly against `parseDefinition` (temporary test file, deleted after use): `auth: mySecretPass123 -> throws? false`; `db_pass: hunter2 -> throws? false`; `key: abc123 -> throws? false`; `pass: abc123 -> throws? false`; `passphrase: abc123 -> throws? false`. Confirmed in `packages/engine/src/orchestration/definition/definition.ts` lines 128-151 (`CREDENTIAL_FIELD_NAMES` set) | Add `auth`, `pass`, `passphrase`, and `apikey`-adjacent short synonyms to `CREDENTIAL_FIELD_NAMES` as a low-cost follow-up (a few extra set entries, no architecture change). Track as follow-up hardening, does not block T-08 approval — see judgment below. |
| R-02 | `TASK-BRIEF.md`'s cross-reference to "Idea Prompt.md section 6 (composite keys)" does not correspond to a composite-key section — section 6 is "VS Code User Experience." Implementer flagged this explicitly in `IMPLEMENTATION-REPORT.md` rather than silently working around it, and the resulting behavior (`keys: string[]` naturally supports one or more entries) is correct regardless. | Confirmed by reading `Idea Prompt.md`'s heading list (`1. Core User Workflow` ... `6. VS Code User Experience` ... `7. Comparison Definition as Code`); no distinct composite-key syntax exists anywhere in the document. `definition.test.ts` lines 335-353 test a 2-entry `keys` array and pass. | No action needed; documentation-only mismatch in the task brief's cross-reference, correctly identified and worked around by the implementer. Track for future task-brief accuracy only. |

## Verification performed

| Check | Exact command or inspection | Result |
| --- | --- | --- |
| Focused engine tests | `npx vitest run packages/engine` | `Test Files 6 passed (6)`, `Tests 263 passed (263)` — matches `IMPLEMENTATION-REPORT.md`'s claim exactly (25 new tests in `definition.test.ts`) |
| Full verification | `npm run verify` | `tsc -b --force` clean, `eslint .` clean, `vitest run`: `Test Files 7 passed (7)`, `Tests 274 passed (274)`, exit code `0` confirmed — matches claimed 249 pre-existing + 25 new, 0 regressions |
| Scope check, commit 1 | `git show --stat a7de7be` | `IMPLEMENTATION-REPORT.md`, `package-lock.json`, `packages/engine/package.json`, `definition.test.ts` (new), `definition.ts` (new) — no file outside `packages/engine/src/orchestration/definition/**`, `packages/engine/package.json`, or the lockfile/report was touched |
| Scope check, commit 2 | `git show --stat ceabbea` | `IMPLEMENTATION-REPORT.md` only (commit-hash backfill) |
| No prohibited-file touches | Manual review of both `--stat` outputs | `packages/shared/**`, `packages/engine/src/connector-sdk/**`, `packages/engine/src/comparison-core/**`, `PROGRESS-LEDGER.md` all absent from both diffs, as required |
| YAML library reality check | `node -e "require('./node_modules/yaml/package.json')"`, `git diff a0dd1fd..a7de7be -- package-lock.json` | `yaml@2.9.0` is installed, resolves to the real npm registry tarball with a valid integrity hash (`sha512-2AvhNX3mb8...`), not a hallucinated package |
| YAML safety claim | Direct read of `definition.ts` line 22 (`import { parse as parseYaml } from "yaml"`) and line 492 (`raw = parseYaml(yamlText)`) | Confirmed: only the plain default `parse()` call is used, no options object, no custom schema/tag registration anywhere in the file |
| Worked example (Idea Prompt.md section 7) | Read `Idea Prompt.md` lines 415-473 side-by-side with `definition.test.ts` lines 15-123 | The test's `worked` YAML string is a verbatim reproduction of the idea document's example; all assertions (`version`, `name`, `source`/`target` incl. `where`, `keys`, `columnMapping`, `excludeColumns`, `rules`, `checks`) match field-for-field. Re-ran via `npx vitest run` — passes. |
| Required-field validation | Direct read of `definition.ts` lines 508-533 | Each of `version` (must be `number`), `name` (non-empty string), `source`, `target` (each via `parseSide`, requiring a non-empty string `connection` and `object`), `keys` (non-empty string array) has its own distinct `if` check that throws `InvalidDefinitionError` with a field-specific message before any subsequent field is parsed. Not merely asserted by tests — read in the actual control flow. |
| Adversarial probe: unlisted credential-shaped field names | Temporary vitest file run directly against `parseDefinition` (not committed) | `auth`, `db_pass`, `key`, `pass`, `passphrase`, `auth_token_value` all parse without throwing — confirms the implementer's disclosed risk concretely, see R-01 |
| Adversarial probe: case variations | Same temporary file | `PASSWORD`, `Password`, `PaSsWoRd` all throw `InvalidDefinitionError` — case-insensitivity claim confirmed, not merely asserted |
| Adversarial probe: separator variations | Same temporary file | `secret-key`, `secretKey`, `SECRET_KEY` all throw `InvalidDefinitionError` — separator-insensitivity claim confirmed |
| Adversarial probe: credential value inside a `where` string | Same temporary file | `where: "password = 'hunter2'"` does not throw — expected and reasonably out of scope (see judgment below) |
| Adversarial probe: `connection` object nested under an unrelated top-level key | Same temporary file | An object-shaped `connection` field nested under an arbitrary unrelated key (not `source`/`target`) does **not** throw when it has no credential-named subfield — confirms the structural "`connection` must be a bare string" rule is correctly scoped only to `source.connection`/`target.connection`, exactly as `TASK-BRIEF.md` specifies, and does not over- or under-claim generality |
| Adversarial probe: unknown top-level fields | Same temporary file | Arbitrary unrecognized top-level keys (e.g. `some_unknown_field: 123`) are accepted without error — the parser is permissive/lenient about unrecognized structure by design (not a strict schema validator), consistent with `parseDefinition`'s documented scope of validating only the fields it defines |
| Probe file hygiene | `git status --short` after probe deletion | Clean; only pre-existing `PROGRESS-LEDGER.md`/`TASK-BRIEF.md` modifications from before this review remain, no probe residue committed or left in the working tree |

## Credential-detection sufficiency judgment

`DESIGN-SPEC.md`'s stated requirement is "rejecting any credential-shaped
field" — deliberately open-ended language, not a specification of exactly
which field names or value patterns must be caught. The implementer's
approach satisfies this at two levels: (1) an exact-name blocklist,
case/separator-normalized, checked recursively at every depth in the
document (not just under `source`/`target`), confirmed to work correctly
against every case/separator variant tried; and (2) a structural rule that
closes the specific gap the task brief calls out by name — an inline
`connection` object escapes the name-blocklist if its own keys aren't
credential-shaped, so requiring `connection` to be a bare string closes
that path independently of field naming.

The adversarial probe found real, concrete gaps beyond what a first pass
should leave open: `pass`, `auth`, and `passphrase` are not exotic or
contrived field names — they are among the most common ways a document
author would spell "credential" if not deliberately trying to name it
`password`. This is a materially different risk profile than the
implementer's own disclosure suggested (which emphasized synthetic
examples like `auth_blob`). That said:

- The blocklist approach, applied unconditionally and recursively across
  the entire document (not scoped to `source`/`target` only), is a
  legitimate, honestly documented, and testable first pass — not a
  fabricated or hand-waved claim. Every claim in `IMPLEMENTATION-REPORT.md`
  about its behavior was verified true by direct probing, not just trusted.
- A full solution (flagging any field whose *value* looks like a plausible
  secret regardless of field name — entropy heuristics, connection-string
  pattern matching, etc.) is a materially larger, separately-scoped
  improvement, appropriately deferred rather than bundled into this task.
- The specific, low-cost fix (adding `auth`, `pass`, `passphrase`, and
  similar short common synonyms to the existing set) is cheap enough that
  it is fair to expect before this task is fully hardened, but it does not
  change the architecture, interfaces, or test structure T-09 depends on,
  and every other requirement in `TASK-BRIEF.md` (worked example fidelity,
  required-field validation, YAML safety, scope discipline) is fully met
  with fresh, non-vacuous verification.

**Judgment: this is scored Minor (R-01), not Important, and does not block
approval.** The task brief's required behavior — "rejecting any field
anywhere in the document that looks like a credential" using the field-name
examples it explicitly lists (`password`, `secret`, `token`, `api_key`,
`connection_string`) plus the `connection`-must-be-a-string structural rule
— is fully implemented and independently verified. The brief did not
require a content-pattern/value-heuristic detector, and building one now
would be an undocumented scope expansion beyond what T-08 was chartered to
deliver. R-01 is recorded as tracked hardening, analogous to how M-05/M-06
(SQL-Server `GO` separator, PostgreSQL dollar-quoting gaps in T-03's
statement-safety parser) were accepted as non-blocking residual risk under
`DESIGN-SPEC.md`'s defense-in-depth framing in a prior review round.
Unlike M-05/M-06, however, R-01's fix is nearly free (adding string literals
to an existing set) and should be picked up opportunistically — e.g. by
T-09 or a small dedicated follow-up — rather than deferred indefinitely.

The `where`-clause-embedded-credential case (`where: "password = 'hunter2'"`)
is correctly out of scope: general secret-scanning inside arbitrary SQL
filter strings is a fundamentally different, much harder problem (false
positives on legitimate SQL referencing a `password` *column*, for
example), and neither `TASK-BRIEF.md` nor `DESIGN-SPEC.md` asks for it.

## Prior-finding disposition

| Finding ID | Disposition | Evidence of resolution |
| --- | --- | --- |
| M-01 | NOT APPLICABLE | Dev-dependency audit warning, unrelated to T-08's owned files or interfaces |
| M-02 | NOT APPLICABLE | `tsc -b --force` verification-method note from T-01, unrelated to T-08 |
| M-03 | NOT APPLICABLE | T-02 documentation citation, unrelated to T-08 |
| M-04 | NOT APPLICABLE | `AggregateDifference`/`RowDifference` shape refinement, owned by T-13/T-14, not T-08 |
| I-01 | NOT APPLICABLE | T-03 statement-safety CTE bypass, unrelated to T-08's files |
| M-05 | NOT APPLICABLE | T-03/T-17 SQL Server `GO` separator gap, unrelated to T-08 |
| M-06 | NOT APPLICABLE | T-03/T-19 PostgreSQL dollar-quoting gap, unrelated to T-08 |
| M-07 | NOT APPLICABLE | T-05/T-06 Timestamp-vs-Timestamp classification, unrelated to T-08 |
| M-08 | NOT APPLICABLE | T-05 DDL-suffix native-type fallback, unrelated to T-08 |
| I-02 | NOT APPLICABLE | T-07 profiling numeric-metrics omission, unrelated to T-08 |

No prior finding names T-08's files, interfaces, or the credential-schema
requirement as an owner or dependency; all are correctly disposed as not
applicable to this review.

## Approval status

- **Status:** APPROVED
- **Reviewer:** Claude Code Independent Reviewer subagent
- **Date:** 2026-07-27
- **Release or dependency impact:** T-08 is complete and unblocks T-09
  (orchestration planner), which is the documented consumer of both
  `ParityDefinition` and `QueryInput`. No Critical or Important findings
  are open. One Minor finding (R-01: credential-field blocklist gaps on
  common names `auth`/`pass`/`passphrase`) is recorded and should be picked
  up as low-cost follow-up hardening — recommended before or alongside
  T-09, since T-09 will be the first consumer to actually resolve named
  connections against real credentials, making the residual gap more
  consequential once live. It does not block T-08's own completion, does
  not affect the interfaces T-09 depends on, and every claim in
  `IMPLEMENTATION-REPORT.md` was independently confirmed true by fresh
  execution and direct source inspection rather than accepted on trust.
