# ParityLens — Review Report T-08a

## Review independence

This review was performed by a separate Claude Code subagent instance,
distinct from the T-08a implementer. No implementation file,
`TASK-BRIEF.md`, or `IMPLEMENTATION-REPORT.md` was edited during this
review. Only this `REVIEW-REPORT.md` was written, replacing the prior
T-08 review report that previously occupied this path (per the project's
one-report-per-task-round convention). A throwaway adversarial probe test
file (`__adversarial.test.ts`) was created solely to exercise
`parseDefinition` from outside, run, and then deleted before finishing —
`git status --short` after cleanup confirms no trace remains and no
tracked file was modified by this review.

## Review scope

- **Task objective:** Harden `parseDefinition`'s credential-shaped-field
  blocklist by adding exactly five names — `auth`, `pass`, `db_pass`,
  `key`, `passphrase` — that the T-08 independent review demonstrated
  bypass detection, with no change to the detection mechanism itself.
  Closes finding R-01.
- **Files and interfaces reviewed:**
  `packages/engine/src/orchestration/definition/definition.ts`
  (`CREDENTIAL_FIELD_NAMES`, `isCredentialFieldName`,
  `assertNoCredentialFields`), and
  `packages/engine/src/orchestration/definition/definition.test.ts`.
- **Evidence reviewed:** `git show --stat` and full diff for commits
  `a2ef653` and `a21abc7`; `TASK-BRIEF.md`, `IMPLEMENTATION-REPORT.md`;
  fresh `npx vitest run packages/engine` and `npm run verify` runs; a
  fresh adversarial pass against the live parser using 27 additional
  candidate credential-shaped field names.

## Critical findings

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| NONE | — | — | — |

## Important findings

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| NONE | — | — | — |

## Minor findings

| ID | Finding | Evidence | Suggested resolution |
| --- | --- | --- | --- |
| R-03 | Blocklist is an exact-name list; many other plausible credential-shaped field names still bypass detection (informational, not blocking — see below). | Fresh adversarial run against `parseDefinition` on this branch: all 27 of `dsn`, `bearer`, `signature`, `sig`, `cert`, `certificate`, `ssh_key`, `private`, `pat`, `sas_token`, `service_account_key`, `private_key_path`, `user_pass`, `userpassword`, `login_pass`, `identity`, `jwt`, `oauth_token`, `session_token`, `cookie`, `encryption_key`, `master_key`, `seed`, `salt`, `pin`, `otp`, `recovery_key` parsed successfully (no `InvalidDefinitionError`) instead of being rejected. | No action required for T-08a (explicitly out of scope — see Prior-finding disposition below). Candidates worth a future bounded follow-up task if the owner wants further hardening, roughly in priority order: `dsn`, `bearer`, `jwt`, `oauth_token`, `session_token`, `cert`/`certificate`, `ssh_key`, `sas_token`, `service_account_key` — these are the ones most likely to appear verbatim in real connection/definition YAML. Names like `identity`, `seed`, `salt`, `pin`, `otp`, `cookie` are plausible but lower-priority and some (e.g. `identity`) risk false positives on legitimate non-credential fields, so any follow-up should be deliberate about the list, not exhaustive. |

## Verification performed

| Check | Exact command or inspection | Result |
| --- | --- | --- |
| Required names present, unchanged mechanism | Read `packages/engine/src/orchestration/definition/definition.ts` lines 128–158, 160–196 | `CREDENTIAL_FIELD_NAMES` contains `auth`, `pass`, `db_pass`, `key`, `passphrase` verbatim, appended after the original T-08 entries. `isCredentialFieldName` (exact-match, case/separator-normalized) and `assertNoCredentialFields` (recursive walk) are byte-for-byte unchanged from T-08; `parseSide`'s bare-string `connection` rule is unchanged. |
| Diff is additive-only | `git show a2ef653 -- packages/engine/src/orchestration/definition/definition.ts` and `...definition.test.ts` | `definition.ts`: +7/-0 lines, a comment plus 5 new set entries only. `definition.test.ts`: +13/-0 lines, one new `it.each` block. No lines removed or altered anywhere in either file. |
| Scope containment | `git show --stat a2ef653` and `git show --stat a21abc7` | `a2ef653` touches only `definition.test.ts` (+13) and `definition.ts` (+7) — both inside the owned `packages/engine/src/orchestration/definition/**` path. `a21abc7` touches only `IMPLEMENTATION-REPORT.md`. No other package or file touched by either commit. |
| Focused tests (fresh run) | `npx vitest run packages/engine` | `Test Files 6 passed (6)`, `Tests 268 passed (268)`, including `definition.test.ts (30 tests)` — the 25 original T-08 cases plus the 5 new T-08a cases, all passing. Matches implementation report's claimed green-state count. |
| Full verification (fresh run) | `npm run verify` | typecheck clean, lint clean, `Test Files 7 passed (7)`, `Tests 279 passed (279)`. Exit code confirmed 0 via a second run redirected to a file with explicit `$?` check (`REAL_EXIT_CODE=0`). Matches implementation report's claimed 279/279 and exit 0. |
| Fresh adversarial pass | Ad hoc test file constructed 27 additional candidate names (implementer's suggested `dsn`, `bearer`, `signature`, `cert`, `ssh_key`, `private`, `pat`, plus reviewer-added `sig`, `certificate`, `sas_token`, `service_account_key`, `private_key_path`, `user_pass`, `userpassword`, `login_pass`, `identity`, `jwt`, `oauth_token`, `session_token`, `cookie`, `encryption_key`, `master_key`, `seed`, `salt`, `pin`, `otp`, `recovery_key`), run via `npx vitest run` against the real `parseDefinition`, then deleted | All 27 bypass (parse succeeds, no throw) — expected and acceptable per the bounded scope of T-08a; recorded as Minor finding R-03 above, not blocking. |

## Prior-finding disposition

| Finding ID | Disposition | Evidence of resolution |
| --- | --- | --- |
| R-01 | RESOLVED | R-01, as raised by the T-08 independent review, specifically identified that `auth`, `pass`, `db_pass`, `key`, and `passphrase` bypassed the T-08 blocklist. TASK-BRIEF.md T-08a scoped a bounded fix for exactly those five names, explicitly excluding a comprehensive value-pattern/entropy heuristic (characterized as a separately-scoped improvement). This review confirms all five are now present in `CREDENTIAL_FIELD_NAMES` and rejected via the existing, unchanged detection mechanism (verified by inspection and by the passing `it.each` test block). The specific gap R-01 identified is closed. A blocklist is inherently open-ended — new plausible names can always be found later (see Minor finding R-03) — but that is an expected, ongoing property of this detection strategy, not evidence that the concrete gap R-01 raised remains open. Leaving R-01 open indefinitely for a property that will never fully close would misrepresent what R-01 asked for. Marking RESOLVED here; any further names are tracked informationally under R-03 for a possible future bounded follow-up, not as a continuation of R-01. |
| R-02 | NOT APPLICABLE | Not related to T-08a's scope (credential blocklist); no changes in this task's diff touch whatever R-02 concerned. |

## Approval status

- **Status:** APPROVED
- **Reviewer:** Claude Code Independent Reviewer subagent
- **Date:** 2026-07-28
- **Release or dependency impact:** T-08a's scoped objective (close R-01 by adding the five named fields) is fully met with a minimal, additive, mechanism-preserving diff, verified green on `npx vitest run packages/engine` (268/268) and `npm run verify` (279/279, exit 0), with no scope creep (only the two owned files plus the implementation report changed). T-09 is unblocked to begin resolving named connections into real credentials. The Minor finding (R-03: further plausible credential-shaped names still bypass, by design, since this is an exact-name list) does not block T-09 and should be left to the owner's discretion for a future bounded hardening task if desired.
