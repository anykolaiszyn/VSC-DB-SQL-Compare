# ParityLens — Review Report T-42

## Review independence

This review was performed by an independent reviewer agent instance with no
memory of authoring the T-42 implementation. All findings below are derived
from direct inspection of the actual diff (`git diff main..task/T-42-connection-test-on-add`),
the current source of every changed file, and a fresh, independently-run
`npm run verify` — not from trusting IMPLEMENTATION-REPORT.md's claims.

## Review scope

- **Task objective:** Extend `paritylens.addConnection`'s flow
  (`addConnectionCommand`) to call the resolved connector's
  `testConnection()` after collecting profile fields and before persisting,
  showing a blocking "Testing connection..." progress notification, then
  either persisting on success or offering an explicit "Save Anyway"/"Don't
  Save" choice on failure — addressing self-service gap-analysis Finding 3.
- **Files and interfaces reviewed:**
  - `packages/extension/src/connections/connectionCommands.ts` (full file
    read; diff against `main` reviewed line-by-line)
  - `packages/extension/src/connections/connectionCommands.test.ts` (full
    file read; diff against `main` reviewed line-by-line)
  - `packages/extension/src/activation/activate.ts` (diff against `main`
    reviewed; confirmed only `buildConnectionCommandDeps` touched)
  - `packages/extension/src/connections/resolveConnector.ts` (read-only
    dependency; confirmed untouched, confirmed synchronous/non-throwing for
    valid platform values, confirmed called inside the new code's
    try/catch)
  - `packages/shared/src/connector.ts` (`ConnectionTestResult`,
    `DataPlatformConnector.testConnection()` contract)
- **Evidence reviewed:** `git diff main..task/T-42-connection-test-on-add`
  (full and per-file), `git diff --stat`, `git log` on the task branch, a
  fresh `npm run verify` run in this session, targeted greps for
  `password`/`prompted.password` across every changed line, and a
  file-existence check confirming `resolveConnector.ts`,
  `connectionProfile.ts`, `connectionProfileStore.ts`, and `package.json`
  files are unmodified.

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
| T-42-01 | IMPLEMENTATION-REPORT.md's "Patch or commit identity" cites `67ab448b519c98055acd6509fa9c3c7cdea439a5`, a 40-character string that does not match any actual commit hash on the branch (the real commit is `67ab448`, a valid 7-char abbreviated SHA; `git log task/T-42-connection-test-on-add --oneline` shows `67ab448 T-42: connection-test-on-add feedback for paritylens.addConnection`). Cosmetic documentation defect only — does not affect the code, tests, or verification outcome. | `git log task/T-42-connection-test-on-add --oneline -5` | Correct the cited hash in a follow-up edit to the report, or note it as a known transcription error; does not block approval. |
| T-42-02 | The new `withProgress`/`showWarningMessage` real-`vscode` wiring added to `buildConnectionCommandDeps()` in `activate.ts` has no dedicated unit test asserting the wiring itself (e.g. that `withProgress` invokes `vscode.window.withProgress` with `ProgressLocation.Notification`, or that `showWarningMessage` wraps the vscode call in `Promise.resolve`). `activate.test.ts`'s 23 tests show no reference to `withProgress`/`showWarningMessage`/`buildConnectionCommandDeps`. This is consistent with the pre-existing pattern in this file (`showInformationMessage`/`showErrorMessage` bindings are likewise untested at the activate.ts level), and the brief did not require such a test — `tsc -b` does structurally verify the returned object satisfies `ConnectionCommandDeps`. Not a regression, just a pre-existing coverage gap this task inherits and does not worsen. | `grep -n "withProgress\|showWarningMessage\|buildConnectionCommandDeps" packages/extension/src/activation/activate.test.ts` → no matches | No action required for this task; optional future hardening if activate.ts wiring ever grows more complex. |

## Verification performed

| Check | Exact command or inspection | Result |
| --- | --- | --- |
| Fresh full verification | `npm run verify` (run independently in this review session) | Exit 0. Typecheck clean, lint clean. `Test Files 36 passed \| 2 skipped (38)`, `Tests 650 passed \| 27 skipped (677)`. Matches the implementer's claimed 650/27/677 exactly — no discrepancy. |
| Scope/ownership check | `git diff main..task/T-42-connection-test-on-add --name-only` | Exactly 4 files changed: `IMPLEMENTATION-REPORT.md`, `packages/extension/src/activation/activate.ts`, `packages/extension/src/connections/connectionCommands.test.ts`, `packages/extension/src/connections/connectionCommands.ts` — matches the brief's declared file ownership exactly, no scope expansion. |
| `resolveConnector.ts`/`connectionProfile.ts`/`connectionProfileStore.ts`/`package.json` untouched | `git diff main..task/T-42-connection-test-on-add -- <those paths>` | Empty diff for all — confirms "do not modify" constraints honored and no new npm dependency added. |
| `editConnectionCommand`/`deleteConnectionCommand` genuinely untouched | Read full current `connectionCommands.ts`; reviewed the file diff hunk-by-hunk | No diff hunk touches either function's body — all changes are confined to imports, `ConnectionCommandDeps`, a new `testConnectionProfile()` helper inserted before `addConnectionCommand`, and `addConnectionCommand`'s own body. `editConnectionCommand`/`deleteConnectionCommand` source is byte-identical to `main`. |
| `editConnectionCommand`/`deleteConnectionCommand` own tests pass unmodified | `git diff` of `connectionCommands.test.ts`; full fresh `npm run verify` run | The `describe("editConnectionCommand", ...)` and `describe("deleteConnectionCommand", ...)` blocks contain zero diff hunks — genuinely unmodified, and passed in the fresh full run above (part of the 650 passed). The shared `createDeps()` helper gained two new optional/mock fields, which is additive and backward compatible with the existing edit/delete tests. |
| Save-Anyway path preserves original profile fields and password (traced, not just test-asserted) | Read `addConnectionCommand`'s body directly (`connectionCommands.ts` lines 164-197) | `prompted` (containing `.fields` and `.password`) is captured once at the top from `promptForProfileFields`, never reassigned. `profile` is built once from `prompted.fields` + a fresh `id`, never reassigned. On the failure branch, `store.add(profile, prompted.password)` at line 189 references the exact same `profile`/`prompted.password` bindings used for the test call and the success path — there is no intermediate mutation, no second prompt, no re-collection of fields between the test and the persist call. The originally-typed input is provably what gets persisted on "Save Anyway", not a re-derived or defaulted value. |
| No password ever interpolated into a message | `git diff main..task/T-42-connection-test-on-add -- connectionCommands.ts activate.ts \| grep -n "^\+" \| grep -i password` | 4 matches, all non-interpolating: a doc-comment reference, a parameter declaration (`password: string`), a call-site pass-through (`resolveConnector(profile, password)`), and a call-site pass-through (`testConnectionProfile(deps, profile, prompted.password)`). Zero occurrences of `password` inside any backtick template-string literal in the diff. The only new user-visible string literals are the `"Testing connection..."` progress title and the warning message template `` `ParityLens: connection test failed for "${profile.name}" — ${reason}"` ``, where `reason` derives from `ConnectionTestResult.message` or a caught error's `.message` — never from `password`/`prompted.password`. |
| Thrown-vs-resolved-failure adversarial coverage | Read `connectionCommands.test.ts` in full; read `testConnectionProfile()`'s implementation | Confirmed both shapes are genuinely tested and both reach the identical "Save Anyway"/"Don't Save" branch: (1) `"shows the failure reason and, on 'Save Anyway', still persists the profile when testConnection resolves a failure"` mocks a **resolved** `{ success: false, message: ... }`; (2) `"handles testConnection throwing/rejecting the same as a failed result"` mocks `resolveConnector` to return a connector whose `testConnection` **throws** (`async () => { throw new Error(...) }`). Both tests assert `showWarningMessage` is called once with the failure reason in the message, and both assert the generic outer catch's `showErrorMessage`/`"add connection failed"` path never fires. Traced the implementation: `testConnectionProfile()` wraps `resolveConnector(...).testConnection()` in an inner `try/catch` inside the `withProgress` callback, normalizing a thrown error into `{ success: false, message }` — structurally guaranteed (not just incidentally tested) that a throw cannot reach the outer generic catch in `addConnectionCommand`, since it's caught one layer before that. |
| `ConnectionTestResult` contract vs. implementer's stated ambiguity claim | Read `packages/shared/src/connector.ts` lines 7-13, 96 | Confirmed: `testConnection(): Promise<ConnectionTestResult>` with `ConnectionTestResult { success: boolean; message?: string; latencyMs?: number }` — no throw-vs-always-resolve guarantee is documented anywhere in the interface or its doc comments. The implementer's claim that the contract is ambiguous on this point, and that Scope item 5's "if ambiguous, handle both defensively" therefore applies, is accurate — not a misremembered or fabricated citation. |
| No `.only`/`.skip`/`console.*` residue | `grep -n "console\.\|\.only(\|\.skip("` on both changed source/test files | No matches. |
| No stray review artifacts left behind | `git status` after all probing | Clean tree aside from this report; no throwaway scripts created during this review needed cleanup. |

## Prior-finding disposition

No open prior finding from `PROGRESS-LEDGER.md` was scoped to this task
(T-42 addresses a fresh self-service gap-analysis item, Finding 3, not a
reopened review finding from an earlier task). Nothing to re-verify here.

| Finding ID | Disposition | Evidence of resolution |
| --- | --- | --- |
| NONE | N/A — first review round for T-42 | — |

## Approval status

- **Status:** APPROVED
- **Reviewer:** Independent reviewer agent (Sonnet 5), separate instance from the T-42 implementer
- **Date:** 2026-08-03
- **Release or dependency impact:** None blocking. Two Minor findings recorded (a cosmetic commit-hash transcription error in the implementation report, and a pre-existing/inherited activate.ts wiring test-coverage gap that this task does not worsen). Neither is Critical or Important; both are safe to leave as tracked follow-up rather than blocking this task's completion. All five of the brief's Handoff re-verification items were independently confirmed: (1) Save-Anyway path traced end-to-end and proven to persist the originally-collected fields/password, not a re-derived value; (2) zero password interpolation in any new message string; (3) `editConnectionCommand`/`deleteConnectionCommand` bodies and their own tests are byte-for-byte/behaviorally unchanged; (4) both thrown and resolved-failure shapes of `testConnection()` are genuinely tested and structurally guaranteed to reach the same choice branch; (5) fresh `npm run verify` reproduced exit 0 with the exact claimed 650 passed / 27 skipped (677 total) count.
