# ParityLens — Review Report T-30

## Review independence

This review was performed by a separate agent instance from whoever
implemented T-30. I did not author any of the changed files under review. I
did not edit any implementation-owned file, `TASK-BRIEF.md`, or
`IMPLEMENTATION-REPORT.md` while producing this report. All findings below
are based on my own inspection of the actual diff, my own fresh execution of
`npm run verify`, and my own read-only adversarial tracing (no throwaway test
files were needed — the two required adversarial checks could be confirmed
by direct code inspection plus the implementer's own new tests, which I
independently re-derived rather than trusted; `git status` confirms no
residue from this review beyond `REVIEW-REPORT.md` itself).

## Review scope

- **Task objective:** Wire `paritylens.runComparison`'s connector-registry
  resolution to consult saved `ConnectionProfile`s (T-29) before falling
  back to `FixtureConnector` (T-22), without a redundant try/catch — real
  connection failures must flow through `runComparison`'s existing Layer-1
  `"failed"`-status path.
- **Branch / commits reviewed:** `task/T-30-real-connector-wiring`, commits
  `165a665` (implementation) and `af06323` (report hash correction), diffed
  against `main`.
- **Files changed:**
  - `packages/extension/src/activation/activate.ts` (extended)
  - `packages/extension/src/activation/activate.test.ts` (extended)
  - `IMPLEMENTATION-REPORT.md`
- **Files confirmed untouched (read-only consumption / prohibited-change
  compliance):**
  - `packages/extension/src/activation/runComparisonCommand.test.ts` (T-22's
    file, not in this task's Files owned) — `git diff main..HEAD` empty.
  - `packages/extension/src/connections/**` (T-29's owned files) — empty
    diff.
  - `packages/engine/**` (planner, connectors, `index.ts`) — empty diff.
  - `paritylens.addConnection`/`editConnection`/`deleteConnection` command
    registrations/handlers — unchanged apart from the two-line construction
    reorder discussed below (call arguments and handler bodies identical).
- **Evidence reviewed:** `TASK-BRIEF.md`, `IMPLEMENTATION-REPORT.md`, the
  full `git diff main..HEAD` for every changed file, `git show main:...` of
  the pre-T-30 `activate.ts` for byte-level comparison, the full text of
  `connectionProfileStore.ts`, `resolveConnector.ts`, `connectionProfile.ts`,
  `secretStore.ts`, `connectionCommands.ts`, and `planner.ts`'s Layer-1
  connectivity-check section, plus my own fresh `npm run verify` run.

## Critical findings

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| NONE | | | |

## Important findings

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| NONE | | | |

## Minor findings

| ID | Finding | Evidence | Suggested resolution |
| --- | --- | --- | --- |
| T-30-01 | `findProfileByName` resolves via `store.list().find((p) => p.name === connectionName)`, the first list-order match. If two saved profiles share the same `name` (nothing prevents this — same limitation already recorded as T-29-03 for `connectionCommands.ts`'s own quick-pick lookups), a `.paritylens` definition naming that connection silently resolves to whichever profile happens to be first in `list()`, with no error or disclosure that the match was ambiguous. Not a new risk class introduced by this task — it inherits an already-accepted T-29 limitation — but this task adds a second call site with the same ambiguity, worth noting for the same future-task follow-up T-29-03 already flagged. | `packages/extension/src/activation/activate.ts`, `findProfileByName` (uses `Array.prototype.find`, first match wins); same pattern as `connectionCommands.ts` lines 162/205, already recorded as T-29-03. | No action required to approve T-30; track alongside T-29-03 if a future task disambiguates duplicate profile names (e.g. requiring unique `name` at save time). |
| T-30-02 | When a matched profile's stored password is missing from `SecretStore` (e.g. deleted out-of-band, or `get` returns `undefined`), `buildConnectorRegistry` substitutes `""` (`(await secretStore.get(...)) ?? ""`) and still constructs a real connector with an empty password rather than falling back to fixtures or surfacing a distinct "credential missing" signal. Functionally safe — the resulting connector will fail `testConnection()`/authentication and correctly flow through Layer-1's existing `"failed"`-status path (same mechanism as any other connection failure, confirmed working via this task's own third test) — but the failure will read as a generic connectivity failure rather than distinguishing "no credential stored" from "bad host/network," which could confuse a user debugging why a previously-working profile now fails. | `packages/extension/src/activation/activate.ts`, `buildConnectorRegistry`, both `(await secretStore.get(secretKeyFor(...))) ?? ""` lines. | No action required to approve; a future task could have `runComparisonCommand`/`buildConnectorRegistry` distinguish a missing-secret case with a clearer message, if this proves confusing in practice. |

## Verification performed

| Check | Exact command or inspection | Result |
| --- | --- | --- |
| Fresh full verification | `npm run verify` | Exit 0. `typecheck` clean, `lint` clean, `test`: **25 passed / 2 skipped (27) test files, 428 passed / 27 skipped (455) tests** — matches `IMPLEMENTATION-REPORT.md`'s claimed numbers exactly (428/27/455, net +3 tests vs. T-29 baseline of 425/27/452, skip count unchanged — same two Docker-gated integration suites). |
| Fixture-fallback byte-for-byte adversarial check (Handoff item 1) | `git show main:packages/extension/src/activation/activate.ts` vs. current, diffed by hand for `buildFixtureRegistry` specifically | `buildFixtureRegistry` (the actual function body, its `sqlserver-customer`/`"source"`/`"target"` construction) is **untouched** in the diff — zero lines changed inside that function. It is still called, unconditionally per-side, whenever `findProfileByName` returns `undefined` for that side (`buildConnectorRegistry`'s two `else` branches use the exact same two `new FixtureConnector(...)` calls `buildFixtureRegistry` uses) or whenever `deps.connectionProfileStore`/`deps.secretStore` are absent entirely (the `runComparisonCommand.test.ts` call sites, confirmed unmodified). Also independently re-derived the implementer's own second test (`"falls back to FixtureConnector for a connection name with no matching saved profile"`) by reading its assertions against the known fixture data (`CreditLimit` "missing-in-target" schema finding) rather than trusting the pass — this is the same known fixture mismatch `runComparisonCommand.test.ts`'s pre-existing T-22 test asserts, confirming identical behavior, not just superficially similar output. |
| Layer-1 failure-path adversarial check (Handoff item 2) | Read `runComparisonCommand`'s full body (the only `try/catch` in the function, unchanged position/scope from T-22) plus `buildConnectorRegistry`'s full body (no `try/catch` at all) plus `planner.ts`'s Layer-1 `testConnection()`/`buildFailedResult` section | Confirmed: (1) `buildConnectorRegistry` contains no try/catch of its own — `resolveConnector` only constructs option objects and connector instances (`new SqlServerConnector(options)`), it does not connect, so nothing here can throw on a bad host; (2) the sole `try/catch` in `runComparisonCommand` is T-22's original outer backstop, unchanged in scope — it wraps `parseDefinition`/registry-building/`runComparison`/`showResultsWebview` exactly as before, with no new inner catch added around the new registry-building call; (3) `runComparison`'s own Layer-1 `testConnection()` check (`planner.ts`, confirmed unmodified — empty diff) is what actually converts a real connectivity failure into a `"failed"`-status `ComparisonResult`, which then flows through `runComparisonCommand`'s normal `showResultsWebview` success path, not the outer catch. Independently re-derived the implementer's third test's reasoning: a `SqlServerConnector` pointed at `db.example.internal` (non-existent host) with a saved profile produces `result.status === "failed"`, `result.summary.failed === 1`, `result.schemaDifferences === []` (no fixture data leaked into the result), and `showErrorMessage` is never called — this is the correct falsifiable signature distinguishing "Layer-1 handled it" from "a redundant catch reshaped it into a generic error," and the test's own comment correctly identifies why. |
| Scope / file-ownership check | `git diff main..HEAD --name-only` | Exactly `IMPLEMENTATION-REPORT.md`, `packages/extension/src/activation/activate.ts`, `packages/extension/src/activation/activate.test.ts` — matches "Files owned" exactly, no unauthorized file touched. |
| Read-only consumption check | `git diff main..HEAD -- packages/extension/src/connections/ packages/engine/` | Empty diff on both paths — `ConnectionProfileStore`, `resolveConnector`, `SecretStore`, and all of `packages/engine/**` confirmed unmodified. |
| `runComparisonCommand.test.ts` untouched | `git diff main..HEAD -- packages/extension/src/activation/runComparisonCommand.test.ts` | Empty diff — confirms the implementer's stated judgment call (did not touch this out-of-scope file) was actually honored, not just claimed. |
| No existing test weakened | `git diff main..HEAD -- packages/extension/src/activation/activate.test.ts \| grep '^-' \| grep -v '^---'` | Only removed lines are an import statement and a mock-object literal being widened (`window: { createTreeView }` → `window: { createTreeView, createWebviewPanel, showInformationMessage, showErrorMessage }`), both additive changes to the shared mock scaffold; no existing `it(...)`/`expect(...)` assertion was deleted or altered. |
| `activate()` reorder judgment call | Read `activate()`'s full body before/after | The reorder moves `new ConnectionProfileStore(...)` two lines earlier so `registerRunComparisonCommand` (now requiring it as a parameter) can receive it. `ConnectionProfileStore`'s constructor is pure (stores two references, no I/O), so the reorder has no observable side-effect difference — the three `addConnection`/`editConnection`/`deleteConnection` command registrations below are registered in the same relative order with identical arguments. Confirmed via diff that neither those three registration calls nor their handler bodies changed. Judged acceptable as a minimal, mechanically-forced consequence of Scope item 2's own instruction, consistent with `AGENTS.md`'s "minimal, mechanically-forced consequence of authorized work" carve-out. |
| Judgment call: `deps` fields optional vs. required | Inspected `runComparisonCommand`'s type signature and both call sites (`runComparisonCommand.test.ts`, unmodified; `registerRunComparisonCommand`, always supplies both) | Confirmed optional typing is the only choice that (a) keeps `runComparisonCommand.test.ts` working unmodified (that file is out of scope) and (b) still lets the fixture-fallback path stay reachable when no store is supplied at all, which is exactly what a bare-`deps` T-22-style caller needs. Real call site (`activate()` → `registerRunComparisonCommand`) always supplies both, so production code never exercises the "absent" branch — the optionality only matters for the pre-existing test file's continued compatibility. Agreed with the implementer's reasoning as the lowest-risk resolution available within this task's declared ownership. |
| Judgment call: lookup by `.name` not `.id` | Read `ConnectionProfileStore.get(id)` (id-keyed) vs. `connectionCommands.ts`'s own `profiles.find((p) => p.name === selectedName)` pattern (lines 162, 205) | Confirmed `ConnectionProfileStore.get()` is genuinely id-keyed, not name-keyed, so a literal reading of Scope item 1 ("by name via `ConnectionProfileStore`") could not mean calling `.get()` with a connection name. `findProfileByName`'s `store.list().find(...)` by `.name` is the same convention T-29's own command handlers already use, confirmed by direct comparison of both implementations. Read-only consumption of `ConnectionProfileStore` (`.list()` only) — no modification to that file. Agreed this is the correct, brief-consistent resolution; see T-30-01 above for the pre-existing duplicate-name caveat this inherits. |

## Disposition of prior findings

T-30 does not carry forward any specific open finding from `PROGRESS-LEDGER.md` as required scope (T-29's open Minor findings T-29-01 through T-29-04 were accepted debt, not blocking, and none was assigned to T-30 specifically). No prior finding required re-verification for this task.

## Approval status

**APPROVED**

0 Critical, 0 Important, 2 Minor (both non-blocking, tracked for optional
future follow-up). Fresh `npm run verify` matches the implementation
report's claimed numbers exactly (428 passed / 27 skipped / 455 total, exit
0). Both Handoff-flagged adversarial checks hold: the fixture-fallback path
is confirmed byte-for-byte unchanged in behavior for any unmatched
connection name (same `buildFixtureRegistry` function body, same
`sqlserver-customer` fixture pair, same side mapping), and a real-profile
connection failure is confirmed to flow through `runComparison`'s existing
Layer-1 `"failed"`-status path with no redundant try/catch added anywhere
in `activate.ts`. All three disclosed judgment calls are sound and
consistent with the brief's literal text and this codebase's established
conventions. File ownership matches the brief exactly — no unauthorized
file touched, `runComparisonCommand.test.ts` confirmed genuinely untouched,
no existing test coverage deleted or weakened.
