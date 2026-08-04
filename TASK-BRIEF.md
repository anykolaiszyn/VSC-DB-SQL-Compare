# TASK-BRIEF.md — T-44: Fixture-fallback disambiguation

## Objective

Replace `runComparisonCommand`'s passive `MIXED_CONNECTION_NOTICE`/
`FIXTURE_ONLY_NOTICE` toast (`activate.ts`) with a blocking confirmation
requiring explicit acknowledgment before `runComparison` executes, whenever
at least one side of the run is falling back to fixture data (i.e. whenever
`buildRunNotice` would today show `MIXED_CONNECTION_NOTICE` or
`FIXTURE_ONLY_NOTICE` — both are fixture-fallback cases; only the
all-real-profile case, where `buildRunNotice` is never even called to show
either variant, stays low-friction). Addresses self-service gap-analysis
Finding 9 (silent fixture-fallback ambiguity) — today a typo'd connection
name in a `.paritylens` file silently falls back to fixture demo data with
only a passive, easy-to-miss `showInformationMessage` toast, so a user can
believe they compared their real databases when they actually compared
built-in fixture data.

## Current state (read before starting)

Read `packages/extension/src/activation/activate.ts` in full sections
around lines 140-260 and 380-460 before starting (already summarized here,
but confirm against the live file — it may have shifted):

- `FIXTURE_ONLY_NOTICE`/`MIXED_CONNECTION_NOTICE` (lines ~160-169): the two
  static notice strings. Both describe a fixture-fallback condition — the
  "only" variant applies when *neither* side matched a saved profile, the
  "mixed" variant when at least one side did but not both.
- `buildRunNotice(sourceProfile, targetProfile)` (lines ~178-180): picks
  between the two based on whether either resolved to a saved profile.
  **This function's binary choice is exactly this task's confirmation
  trigger**: it is called (mixed or fixture-only) whenever fixture fallback
  is happening at all; the *only* case it's never invoked for the
  all-real-profile check is when the caller's own logic already knows both
  sides matched (read `runComparisonCommand`'s call site, ~line 421-429, to
  confirm exactly which condition currently triggers a call to
  `buildRunNotice` versus not calling it at all — if `buildRunNotice` is
  unconditionally called every run regardless of profile match, the
  "trigger" for this task's blocking confirmation is instead "did
  `buildRunNotice` return `MIXED_CONNECTION_NOTICE` or
  `FIXTURE_ONLY_NOTICE`", not "was it called" — verify this distinction in
  the real code before implementing, do not assume).
- `runComparisonCommand`'s `RunComparisonCommandDeps` (the `deps` parameter
  type, look for its interface definition near the top of the function's
  signature) already has an established injected-dependency pattern for
  exactly this kind of blocking-choice gate: `confirmRun?: (result:
  PlanQueriesResult) => Promise<boolean>` (T-38), which
  `runComparisonCommand`'s body already awaits before calling
  `runComparison`. **Do not reuse `confirmRun` itself** — T-38's
  `confirmRun` is a *different* confirmation gate (SQL preview,
  content-based, shown for every real run) and this task's brief
  explicitly requires composing cleanly with it, not merging into it (see
  Prohibited changes). Add a **new**, separate injected dependency
  specifically for the fixture-fallback disambiguation.
- `deps.showInformationMessage(buildRunNotice(sourceProfile, targetProfile))`
  (line ~429) is today's passive toast call site — this is what changes.

## Scope

1. Add a new optional injected dependency to `RunComparisonCommandDeps`,
   e.g. `confirmFixtureFallback?: (notice: string) => Promise<boolean>` —
   a blocking yes/no confirmation (real `vscode` implementation: an
   awaited `vscode.window.showWarningMessage(notice, "Continue", "Cancel")`
   resolving to whether the user clicked "Continue", matching T-42's
   established narrow-injected-`showWarningMessage` style in
   `connectionCommands.ts` if useful as a reference — but this is
   `activate.ts`'s own dependency, add it independently, do not import
   from `connectionCommands.ts`).
2. Where `buildRunNotice` is called (~line 429): if the returned notice is
   `MIXED_CONNECTION_NOTICE` or `FIXTURE_ONLY_NOTICE` (a fixture-fallback
   case), call the new injected confirmation dependency instead of (or in
   addition to — implementer's call, but avoid double-prompting) the
   passive `showInformationMessage`. If the user declines, abort before
   `runComparison` is called — same "cancellation is not a failure, no
   error shown" pattern the existing `confirmRun`/`proceed` logic already
   uses a few lines below (~line 449-454), for consistency.
3. If *neither* notice variant applies (i.e., in the future, if both sides
   ever resolve to saved profiles — confirm today's actual code path for
   this: does `buildRunNotice` ever return something other than the two
   fixture-fallback strings, or is a third "all real" case not even
   representable by this function today? Read it before assuming), no
   blocking confirmation should appear — the all-real-profile case must
   stay low-friction, per the brief's explicit "avoiding notification
   fatigue for the common case."
4. This new confirmation must compose cleanly with T-38's existing
   `confirmRun` SQL-preview gate — both may fire for the same run (fixture
   fallback confirmation first, then the SQL-preview confirmation,
   matching the order the two concerns are already computed in the
   function: `buildRunNotice`'s call site precedes `planQueries`/
   `confirmRun`'s call site) — do not attempt to merge them into a single
   dialog or remove either.
5. When no injected `confirmFixtureFallback` dependency is supplied (e.g.
   existing test files not extended by this task), default to "proceed"
   (matching `confirmRun`'s own existing default-when-absent behavior at
   ~line 449, `deps.confirmRun !== undefined ? await deps.confirmRun(...)
   : true`) so this task does not silently break every pre-existing caller
   of `runComparisonCommand` that doesn't yet know about the new
   dependency.

## Files owned

- `packages/extension/src/activation/activate.ts` (extends T-10/T-22/T-29/
  T-30/T-32/T-33/T-38/T-39/T-40/T-42, `runComparisonCommand`'s notice/
  confirmation step and `RunComparisonCommandDeps`'s extension, plus
  `registerRunComparisonCommand`'s real-`vscode` wiring of the new
  dependency — no other change to this file)
- `packages/extension/src/activation/activate.test.ts` / the relevant
  `runComparisonCommand.test.ts` (whichever file actually holds
  `runComparisonCommand`'s own tests — check both, extend the correct one)

## Interfaces consumed

- `findProfileByName`/`sourceProfile`/`targetProfile` resolution (T-30,
  already computed in `runComparisonCommand`, read-only reuse — do not
  reimplement or duplicate this lookup)
- `buildRunNotice` (T-30, read-only — do not modify its own logic, only
  how its return value is consumed at the call site)

## Prohibited changes

- Do not modify `buildRunNotice`, `FIXTURE_ONLY_NOTICE`, or
  `MIXED_CONNECTION_NOTICE`'s own text/logic.
- Do not modify `confirmRun`/`createWebviewConfirmRun`/T-38's SQL-preview
  confirmation flow in any way — this task's confirmation must be a
  genuinely separate, additional gate, not a merge or replacement.
- Do not modify `buildConnectorRegistry`/`buildFixtureRegistry`/
  `findProfileByName`'s own logic.
- Do not weaken or remove the fixture-fallback path itself — this task
  only adds a confirmation step before it runs, never blocks fixture
  fallback outright (declining just cancels the run, same as declining
  T-38's SQL-preview confirmation).

## Red-state evidence required

A test running a comparison whose source connection name doesn't match any
saved profile, expecting the command to block on explicit confirmation
before calling `runComparison` — fails today (current flow shows a passive
toast via `showInformationMessage` and proceeds immediately regardless of
any confirmation).

## Green-state evidence required

1. The scoped diff across the owned files.
2. A test confirming the fixture-fallback confirmation blocks and, when
   declined, `runComparison` is never called.
3. A test confirming an all-real-profile run's confirmation stays
   low-friction — does NOT gain the new blocking treatment (verify this
   against the real "does `buildRunNotice` ever represent an all-real
   case" finding from Scope item 3 — if today's code has no such case
   representable, the test should instead confirm the fixture-only/mixed
   cases correctly trigger the blocking gate while documenting that no
   all-real case exists yet to test the negative against, per the brief's
   own "your call" allowance if the premise doesn't hold as stated).
4. A test confirming that when `confirmFixtureFallback` is not supplied,
   the run proceeds exactly as before this task (backward-compatible
   default).
5. A test confirming this new gate composes correctly with T-38's existing
   `confirmRun` gate for the same run (both can independently accept or
   decline; declining either one aborts before `runComparison`).
6. A full fresh `npm run verify` passing with no regression versus the
   659/659 baseline; report the before/after test count.

## Handoff

- Write `IMPLEMENTATION-REPORT.md` using
  `multi-agent-idea-to-app/templates/IMPLEMENTATION-REPORT.md`.
- Commit on branch `task/T-44-fixture-fallback-confirmation`.
- Recommend independent review as the next step.
- Reviewer should specifically re-verify: (1) the distinction between
  "some/all fixture fallback" and "fully real" is genuinely accurate —
  trace `sourceProfile`/`targetProfile` resolution and `buildRunNotice`'s
  actual return value for each case, don't just trust the toast text; (2)
  this task's scope doesn't overlap/conflict with T-38's `confirmRun`
  pre-execution confirmation — the two should compose cleanly, both firing
  independently for the same fixture-fallback run, not one silently
  suppressing the other; (3) declining the new confirmation genuinely
  aborts before any connector call (adversarially trace the code path,
  don't just trust a mock-call-count assertion); (4) the
  no-dependency-supplied default preserves every pre-existing caller's
  behavior (diff-check `activate.test.ts`'s pre-existing tests still pass
  unmodified); (5) a fresh full `npm run verify` is green with the
  reported test count.
