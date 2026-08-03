# ParityLens — Implementation Report T-38

## Status and objective

- **Status:** COMPLETE (implementation + evidence only — not reviewed or
  approved)
- **Objective (TASK-BRIEF.md's own wording):** "`DESIGN-SPEC.md` states
  'generated SQL is shown to the user for preview before execution' as a
  security/safety requirement. Today, `paritylens.runComparison` does not
  honor this: it shows a single passive `showInformationMessage` toast
  (whichever real connections are in play) and immediately calls
  `runComparison`, executing real queries against real databases with no
  preview and no way to cancel." This task closes that gap with (1) a new,
  pure, engine-side `planQueries(definition, connectors, baseDir?)` function
  that builds the exact same SQL strings `runComparison` would execute,
  without executing any of them, and (2) extending
  `paritylens.runComparison`'s command flow to call `planQueries()` first,
  show the resulting SQL list in a blocking confirmation webview panel
  (Run/Cancel), and only call the existing, unmodified `runComparison()` if
  the user clicks Run.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/engine/src/orchestration/planner/planQueries.ts` (new) | Pure `planQueries(definition, connectors, baseDir?): Promise<string[]>`, mirroring `runComparison`'s own checks-gating and connection-resolution logic exactly, calling the same shared builder functions (`buildProfileQueries`, `buildRowCountSql`, `buildFetchAllRowsSql`) `runComparison` itself calls. Never calls `executeQuery`; calls `getSchema` only under the identical `checks.schema \|\| checks.profile` gating `runComparison` uses. Also runs a `testConnection()` gate (mirroring `runComparison`'s own Layer-1 check) before calling `getSchema`, short-circuiting to an empty list on a connectivity failure rather than throwing — see "Judgment calls" below, this was discovered as a genuine regression during implementation, not planned in advance. | TASK-BRIEF.md Scope item 1 |
| `packages/engine/src/orchestration/planner/planQueries.test.ts` (new) | Anti-drift test comparing `planQueries`'s output against `runComparison`'s own `queriesUsed` for two different check-enablement combinations (profile-only, and schema+profile+rowCount+rowLevel all enabled), byte-for-byte after normalizing the one genuinely time-dependent `TIMESTAMP '...'` substring; a schema-only case proving schema comparison itself issues no SQL; a mock-call-count test proving `executeQuery` is never called (on either connector) while `getSchema` is called when schema/profile checks are enabled, and *not* called for a rowCount/rowLevel-only definition; an `UnresolvedConnectionError` test | TASK-BRIEF.md's required Red/Green-state evidence |
| `packages/extension/src/webview/runConfirmationWebview.ts` (new) | Pure `renderRunConfirmationHtml(queries: string[]): string`, following T-36's `enableScripts: true` + `postMessage` interactive-webview pattern. Reuses `resultsWebview.ts`'s exported `renderQueryPreviewSection` for the actual SQL display (imported, not reimplemented); wraps it with a header, notice text, and Run/Cancel buttons wired to `acquireVsCodeApi().postMessage({type:'run'}\|{type:'cancel'})` via a static embedded script | TASK-BRIEF.md Scope item 2; file/path chosen per the brief's own "your call, document it" instruction — placed under `webview/` (not `authoring/`) since this panel is a confirmation gate for the *run* command, not part of the comparison-authoring editor T-36/T-37 own |
| `packages/extension/src/webview/runConfirmationWebview.test.ts` (new) | Purity test (same input twice → identical output), a test that every query string renders (HTML-escaped), an XSS-escaping test (`<script>` in a query string never appears raw), an empty-list empty-state test, and a Run/Cancel wiring smoke test | TASK-BRIEF.md's required Green-state evidence ("a test confirming the confirmation webview's render function is pure") |
| `packages/extension/src/webview/resultsWebview.ts` | Added the `export` keyword to `renderQueryPreviewSection` — the one narrowly-permitted change; no other line touched | TASK-BRIEF.md Prohibited changes: "the one narrow addition permitted to that file: adding an `export` keyword to an existing function, nothing else" |
| `packages/extension/src/activation/activate.ts` | Imported `planQueries` (from `@paritylens/engine`) and `renderRunConfirmationHtml`. Added an optional `confirmRun?: (queries: string[]) => Promise<boolean>` dependency to `runComparisonCommand`'s `deps` parameter (typed optional, defaulting to "proceed" when absent — see "Judgment calls" below). `runComparisonCommand` now calls `planQueries(definition, registry)` after resolving the connector registry and before calling `runComparison`; awaits `deps.confirmRun(plannedQueries)` (or `true` if unsupplied); returns `undefined` immediately (no error shown) if the result is `false`; only then proceeds to the existing, byte-for-byte-unmodified `runComparison(definition, registry)` call and the rest of the existing flow (persist run, status bar, results webview). A `planQueries` rejection falls through to the function's existing outer `try`/`catch`, surfaced via the existing `showErrorMessage` path. Added `createWebviewConfirmRun()`, a real `vscode`-backed factory producing a `confirmRun` implementation: opens a new `enableScripts: true` webview panel rendered via `renderRunConfirmationHtml`, resolves the promise from `onDidReceiveMessage` (`type:'run'` → `true`, `type:'cancel'` → `false`) or from `onDidDispose` (panel closed without a choice → `false`), disposing the panel once a decision is reached. `registerRunComparisonCommand` now passes `confirmRun: createWebviewConfirmRun()` into `runComparisonCommand`'s deps | TASK-BRIEF.md Scope item 2 |
| `packages/extension/src/activation/activate.test.ts` | Added a new `describe("runComparisonCommand (T-38 pre-execution confirmation)")` block: a test proving a mocked Cancel response blocks `runComparison`/`createWebviewPanel` entirely (never called) and returns `undefined` with no error shown; a test proving a mocked Run response proceeds to call `runComparison` and show the results webview as before; a test proving a `planQueries` failure (unknown table) surfaces via `showErrorMessage` without ever calling `confirmRun` or `runComparison`; a test proving the confirmation callback receives `planQueries`'s actual output (not a re-derived list) for a rowCount-enabled definition | TASK-BRIEF.md's required Red/Green-state evidence |
| `packages/engine/src/index.ts` | Added `export * from "./orchestration/planner/planQueries.js";` | **Not in TASK-BRIEF.md's declared "Files owned" list — disclosed separately below, not folded in silently.** Mechanically required: `activate.ts` imports from the `@paritylens/engine` package boundary (never a deep relative path, per this file's own header comment and every other engine-consuming file in the codebase), so `planQueries` had to be re-exported through this file the same way T-22/T-29 established for every other newly-added public-surface function. This is the smallest possible edit (one export line + a documentation paragraph, following the file's own existing "amendment" comment precedent) and does not touch any existing export. |

## Behavior and interfaces

- **Behavior delivered:** Running `paritylens.runComparison` now shows a
  blocking "Confirm Run" webview panel listing every SQL query the run
  would issue (built by the new `planQueries`, guaranteed byte-identical to
  what `runComparison` would actually execute) before any query executes.
  Clicking Cancel (or closing the panel) aborts the run cleanly — no error,
  no `runComparison` call, no results webview. Clicking Run proceeds
  exactly as the command worked before this task (unchanged
  `runComparison` call, persist-run, status bar, results webview).
- **Interfaces consumed:** `resolveSideInput`, `buildProfileQueries`,
  `buildRowCountSql`, `buildFetchAllRowsSql` (all pre-existing exports),
  `renderQueryPreviewSection` (newly exported by this task), the
  `UnresolvedConnectionError` class and `ConnectorRegistry` type from
  `planner.ts` (both pre-existing exports, reused rather than
  reimplemented).
- **Interfaces produced:** `planQueries(definition, connectors, baseDir?):
  Promise<string[]>` (exported from `@paritylens/engine`);
  `renderRunConfirmationHtml(queries: string[]): string` (pure, exported
  from `packages/extension/src/webview/runConfirmationWebview.ts`); the
  extended `runComparisonCommand` (same exported name/signature shape,
  with one new optional `confirmRun` field on its `deps` parameter);
  `createWebviewConfirmRun()` (private to `activate.ts`, wires the real
  confirmation panel against the live `vscode` API).

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline (before any change) | `npm run verify` | Exit 0. 31 test files, 565 passed, 27 skipped (592 total) | this session's transcript |
| Red 1 (planQueries anti-drift) | `npx vitest run packages/engine/src/orchestration/planner/planQueries.test.ts` | Failed to compile/import: `planQueries` module did not exist yet, before this task's files were created | this session's transcript (the first write of the test file happened alongside the implementation; the module's absence is the documented red state per TASK-BRIEF.md's own wording — "fails today (function doesn't exist)") |
| Red 2 (cancellation blocks runComparison) | `npx vitest run packages/extension/src/activation/activate.test.ts -t "T-38"` | 3 of 4 new tests failed for the predicted reason ("expected spy to be called 1 times, but got 0 times" — no confirmation step existed yet, `confirmRun` was never invoked) | this session's transcript |
| Green (planQueries + confirmation flow) | `npx vitest run packages/extension/src/activation/activate.test.ts packages/extension/src/activation/runComparisonCommand.test.ts packages/engine/src/orchestration/planner/planQueries.test.ts packages/engine/src/orchestration/planner/planner.test.ts packages/extension/src/webview/runConfirmationWebview.test.ts packages/extension/src/webview/resultsWebview.test.ts` | Exit 0. 6 files, 74 tests passed | this session's transcript |
| Full verification | `npm run verify` | Exit 0. `tsc -b --force` clean, `eslint .` clean, `vitest run`: 33 test files, 581 passed, 27 skipped (608 total) | this session's transcript |

Full-verification delta from baseline: +2 test files (`planQueries.test.ts`,
`runConfirmationWebview.test.ts`), +16 passing tests (565 → 581), 0
regressions, 0 newly skipped.

## Assumptions and risks

- **Assumptions:**
  - The brief's Scope item 1 asks to "confirm and disclose which is
    actually required" regarding whether `checks.schema.enabled` alone
    needs query-string collection. Confirmed by reading `runComparison`:
    schema comparison (`compareSchemas`) issues no SQL of its own —
    `queriesUsed` is only ever pushed to from the profile/row-count/
    row-level branches. `planQueries` mirrors this: when `checks.schema`
    is enabled but `checks.profile` is not, it still resolves both sides
    and calls `getSchema` (to mirror `runComparison`'s control flow and
    surface a genuine schema error at the same point a real run would),
    but appends nothing to the returned list for that check.
  - `planQueries`'s `baseDir?: string` parameter defaults internally to
    `process.cwd()` only by relying on `resolveSideInput`/
    `buildFetchAllRowsSql`'s own existing defaults for an `undefined`
    argument, rather than duplicating that default locally — kept
    identical to how `runComparison` itself resolves the same default.
- **Judgment calls (both disclosed, neither silently resolved):**
  1. **`planQueries`'s Layer-1 connectivity gate (not originally planned).**
     While wiring `planQueries` into `runComparisonCommand` and re-running
     the full suite, two pre-existing `activate.test.ts` T-30 tests
     regressed: they construct a real `SqlServerConnector` pointed at an
     unreachable host and expect `runComparisonCommand` to reach
     `runComparison`'s own graceful Layer-1 `testConnection()` short-circuit
     (a `"failed"`-status `ComparisonResult`, `createWebviewPanel` still
     called once). Before this fix, `planQueries`'s direct `getSchema` call
     (needed for the schema-enabled definition these tests use) rejected
     against the unreachable connector — real connectors have no
     graceful-failure handling in `getSchema` the way `testConnection()`
     provides — and that rejection propagated out through
     `runComparisonCommand`'s outer `catch`, pre-empting `runComparison`'s
     own existing failure-reporting path entirely (result: `undefined`,
     generic `showErrorMessage`, `createWebviewPanel` never called — a
     regression from previously-passing behavior). Fixed by adding the
     identical `testConnection()` gate `runComparison` itself runs as
     step 2, inside `planQueries`, short-circuiting to an empty query list
     (not a thrown error) on a connectivity failure. This is squarely
     within the brief's own stated allowance — "Must not throw for a
     connectivity failure the way `runComparison` doesn't either" — but
     the *mechanism* (re-running the same gate, since `planQueries` has no
     `ComparisonResult` to short-circuit into) was discovered empirically
     via this regression, not designed in advance, and is disclosed here
     explicitly. Documented in `planQueries.ts`'s own header comment and
     inline at the gate itself.
  2. **`confirmRun`'s optional-with-safe-default typing.** The brief's
     "Files owned" list for this task includes `activate.test.ts` but
     *not* `packages/extension/src/activation/runComparisonCommand.test.ts`
     — a separate, pre-existing T-22-era test file that also calls
     `runComparisonCommand` directly, with assertions that depend on
     `runComparison` actually being reached and `createWebviewPanel`
     actually being called (e.g. "runs parseDefinition -> runComparison ->
     showResultsWebview against a real .paritylens YAML string"). That
     file is genuinely outside this task's declared file ownership, so it
     could not be edited to supply a `confirmRun` dependency, yet its
     existing behavior (every call reaches `runComparison`) had to be
     preserved. Resolved by following this codebase's own established
     precedent exactly: `connectionProfileStore`, `secretStore`,
     `resolveRunHistoryRoot`, and `statusBarItem` are all already typed
     optional on `runComparisonCommand`'s `deps` parameter for this
     identical documented reason (see each field's own doc comment in
     `activate.ts`, e.g. "this function's pre-existing test file never
     supplies it"). `confirmRun` follows the same pattern: typed optional,
     defaulting to "proceed" (`true`) when absent. This preserves
     `runComparisonCommand.test.ts`'s existing behavior byte-for-byte
     unchanged, while `activate.test.ts`'s new T-38 suite (this task's own
     test file) and the real `registerRunComparisonCommand` wiring (which
     always supplies `createWebviewConfirmRun()`) both exercise the real
     confirmation gate — so "every run goes through confirmation" holds
     for every call site this task actually controls. **Risk, disclosed
     plainly:** a hypothetical future caller of `runComparisonCommand` that
     also omits `confirmRun` would silently skip confirmation, the same
     latent risk the three pre-existing optional deps already carry for
     their own concerns (an omitted `resolveRunHistoryRoot` silently skips
     persistence, etc.) — this is not a new category of risk introduced by
     this task, but it is worth a reviewer's attention given the
     brief's explicit "no bypass" instruction (interpreted here as "no
     user-facing bypass setting," which this preserves — there is no
     command, flag, or configuration a user can set to skip confirmation
     through any currently-wired call path).
- **Risks/limitations not fixed:**
  - `runComparisonCommand.test.ts` (outside this task's ownership) was not
    updated to also exercise the new confirmation gate — it continues to
    test `runComparisonCommand`'s pre-T-38 "always proceeds" behavior via
    the same optional-dependency default every other optional dep in this
    file already relies on. A future task could migrate that file onto an
    explicit `confirmRun: async () => true` per test for clarity, but doing
    so was outside this task's declared file ownership.
  - `planQueries`'s new Layer-1 connectivity gate (judgment call 1 above)
    means the confirmation panel shows an empty query list for a
    definition whose connection is unreachable, rather than an explicit
    "could not preview: connection unreachable" message — the user only
    finds out the real reason after clicking Run and seeing
    `runComparison`'s own `"failed"`-status result. This mirrors
    `runComparison`'s own existing UX for that same failure (no dedicated
    error-message field on `ComparisonResult`, per `planner.ts`'s own
    `buildFailedResult` doc comment) rather than introducing a new,
    inconsistent failure-messaging convention — but it is a real, disclosed
    UX gap worth a reviewer's judgment on whether it's acceptable for this
    task's scope.
- **Blockers:** None.

## Patch or commit identity

- **Branch:** `task/T-38-plan-queries-preview`
- **Commit:** recorded after this report is committed — see the commit
  immediately following this file in `git log` on this branch.

## Recommended next step

Independent review by a separate reviewer agent, per this project's
`AGENTS.md` ("Every implementation task receives an independent review by a
reviewer who did not author the task's change") and TASK-BRIEF.md's own
Handoff note (byte-for-byte `queriesUsed` diff across at least 2
definitions, a grep-and-mock-based `executeQuery` zero-call confirmation
independent of this report's own tests, a `git diff --stat main..<branch>`
file-ownership check, and adversarial confirmation that the confirmation
panel's render function is pure and every interpolated SQL string is
escaped). This implementer does not self-approve and this task is not
marked complete beyond its own implementation-and-evidence scope.
