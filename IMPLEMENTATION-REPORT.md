# ParityLens — Implementation Report T-08a

## Status and objective

- **Status:** COMPLETE
- **Objective:** Harden `parseDefinition`'s credential-shaped-field
  blocklist (from T-08) by adding five concrete missing names the T-08
  independent review demonstrated bypass detection: `auth`, `pass`,
  `db_pass`, `key`, `passphrase`. Closes open finding R-01 before T-09
  begins resolving named connections into real credentials, per the
  owner's decision recorded in `PROGRESS-LEDGER.md` on 2026-07-27.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/engine/src/orchestration/definition/definition.ts` | Added `auth`, `pass`, `db_pass`, `key`, `passphrase` to the existing `CREDENTIAL_FIELD_NAMES` set, with a comment linking back to TASK-BRIEF.md T-08a. No other change — the matching mechanism (`isCredentialFieldName`, `assertNoCredentialFields`) is untouched. | TASK-BRIEF.md T-08a "Produced" interface: extend the existing rejected-field-name set with at minimum these five names. |
| `packages/engine/src/orchestration/definition/definition.test.ts` | Added one `it.each(["auth", "pass", "db_pass", "key", "passphrase"])` parameterized test block asserting each throws `InvalidDefinitionError`, placed alongside the existing T-08 credential-rejection tests and following the same pattern as the existing `it.each` for `secret`/`token`/etc. | TASK-BRIEF.md T-08a red-state evidence requirement. |

## Behavior and interfaces

- **Behavior delivered:** `parseDefinition` now throws
  `InvalidDefinitionError` when a YAML document contains any of `auth`,
  `pass`, `db_pass`, `key`, or `passphrase` as a mapping key, anywhere in
  the document (top level, nested under `source`/`target`, or nested
  arbitrarily deep), using the same case-insensitive and
  separator-insensitive exact-name matching as the original T-08
  blocklist (e.g. `AUTH`, `Db-Pass`, `db_pass`, `DB PASS` all match).
- **Interfaces consumed:** T-08's existing credential-detection
  mechanism (`CREDENTIAL_FIELD_NAMES` set, `isCredentialFieldName`,
  `assertNoCredentialFields`) in the same file — extended, not replaced.
- **Interfaces produced:** Extended credential-field blocklist, consumed
  by T-09 exactly as the original T-08 blocklist was intended to be
  consumed (no interface shape change — only more field names rejected).

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline green (pre-change) | `npm run verify` | Exit 0. `Test Files 7 passed (7)`, `Tests 274 passed (274)`. | Captured in this session's transcript before any edits. |
| Red state | `npx vitest run packages/engine` (after adding the 5 new tests, before extending the blocklist) | `definition.test.ts (30 tests \| 5 failed)`. All 5 new T-08a cases (`auth`, `pass`, `db_pass`, `key`, `passphrase`) failed with `AssertionError: expected function to throw an error, but it didn't`. All 25 pre-existing T-08 tests in the same file passed. Overall: `Test Files 1 failed \| 5 passed (6)`, `Tests 5 failed \| 263 passed (268)`. | Captured in this session's transcript. |
| Focused green state | `npx vitest run packages/engine` (after extending the blocklist) | `definition.test.ts (30 tests)` — all passing. `Test Files 6 passed (6)`, `Tests 268 passed (268)`. | Captured in this session's transcript. |
| Full verification | `npm run verify` | Exit 0. `typecheck` and `lint` both clean. `Test Files 7 passed (7)`, `Tests 279 passed (279)` (274 baseline + 5 new T-08a tests). Re-run a second time redirecting output to a file and checking `$?` directly confirmed `REAL_EXIT_CODE=0`. | Captured in this session's transcript. |

No regressions: all 25 pre-existing T-08 tests in `definition.test.ts`
pass unchanged, and all other 249 pre-existing tests across the
`shared`, `type-mapping`, `statement-safety`, `schema-diff`, `profiling`,
and `fixture-connector` suites are untouched and still pass.

## Assumptions and risks

- **Assumptions:** The five names in TASK-BRIEF.md are a floor
  ("adds at minimum") — they were added exactly as specified, with no
  additional names, per the brief's explicit prohibition on expanding
  scope without a revised brief/ledger decision.
- **Risks or limitations:** The blocklist remains an exact-field-name
  list, not a value-pattern/entropy heuristic — this is an explicit,
  deliberate scope boundary from TASK-BRIEF.md, not an oversight. Other
  common credential-shaped names not in this list (and not in T-08's
  original list) will still bypass detection until a further hardening
  pass adds them. The brief anticipates this: the independent reviewer
  is asked to do a fresh adversarial pass for any further obviously-
  missing common credential names.
- **Blockers:** None.

## Patch or commit identity

- **Commit:** `a2ef653b5b69cc6a78a94acdeb20d092e8d1ca96`
- **Branch:** `task/T-08a-credential-blocklist-hardening` (created from
  `main` at `6b4b215`, which was `main` HEAD at task start)

## Recommended next step

Independent review by a separate Claude Code subagent instance (per
TASK-BRIEF.md's Handoff section), distinct from this implementer. The
reviewer should: (1) verify the five required names are present and
correctly wired into the existing mechanism with no mechanism changes;
(2) verify the red-state/green-state evidence above is genuine (re-run
`npx vitest run packages/engine` and `npm run verify` independently);
(3) attempt a fresh adversarial pass for any further obviously-missing
common credential field names (e.g. names like `dsn`, `bearer`,
`sig`/`signature`, `cert`/`certificate`, `ssh_key`, `private`, `pat`, or
similar) and record any such findings in `REVIEW-REPORT.md` for a
possible follow-up task, without expanding this task's scope
retroactively. On approval, `REVIEW-REPORT.md` should record the
independent verification evidence per this project's standard review
process.
