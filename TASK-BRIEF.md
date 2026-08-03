# ParityLens — Task Brief T-33

## Objective

Tree-view/status-bar wiring: populate the "DATA PARITY" sidebar's
`Comparisons` section with `.paritylens` files discovered in the current
workspace, populate `Recent Runs` with T-31's persisted run history, and
wire the currently-unused `parityStatusBar.ts` (T-11) to show
`Parity: N passed | N warnings | N failed` after each run — per
`IMPLEMENTATION-PLAN.md`'s T-33 row.

`Recent Runs` is meaningless while nothing ever calls T-31's `persistRun`
— confirmed this session that `runComparisonCommand`
(`packages/extension/src/activation/activate.ts`, owned by T-22/T-30) does
not currently persist any run. Making `Recent Runs` genuinely populatable
therefore requires one narrow, additive call to `persistRun` inside that
existing command flow, in addition to the two files
`IMPLEMENTATION-PLAN.md`'s T-33 row names. This amends this task's file
ownership beyond the plan row (see "Files owned" below) — a working
`Recent Runs` section is the actual deliverable the plan row promises, and
leaving it wired-but-permanently-empty would not satisfy T-33's own stated
green-state test ("a second test confirms 'Recent Runs' lists a persisted
run from T-31").

## Scope

1. `packages/extension/src/views/parityTreeDataProvider.ts`: extend
   `ParityTreeDataProvider.getChildren` so that when `element.section.id`
   is `"comparisons"`, it returns one child `ParityTreeItem`-like node per
   `.paritylens` file found via an injected workspace-file-discovery
   dependency (do not call `vscode.workspace.findFiles` directly inside
   the provider — inject it, matching this codebase's established
   pure-core/injected-glue split, so the provider stays testable without
   `@vscode/test-electron`). Each comparison node's `command` should
   invoke the existing `paritylens.runComparison` command (T-22/T-30),
   pre-selecting that file if the command supports it — if
   `runComparisonCommand`'s existing file-picking flow does not accept a
   pre-selected URI as an argument, it is acceptable for the click to just
   invoke the command and let the existing open-dialog flow run (do not
   modify `runComparisonCommand`'s picking behavior itself to add this —
   that would exceed this task's narrow persist-only amendment below).
2. Same file: when `element.section.id` is `"recentRuns"`, return one
   child node per `RunSummary` from T-31's `listRecentRuns`, most-recent
   first (already sorted that way by `listRecentRuns`). Each node's label
   should show the run's `name` and `timestamp`; its `command` should
   invoke `loadRun` for that `id` and pass the result to
   `showResultsWebview` (T-11/T-16) to reopen it.
3. Inject both the file-discovery function and `listRecentRuns`/`loadRun`
   (and the safe output root string they need) into
   `ParityTreeDataProvider`'s constructor rather than importing
   `runHistory.ts`'s live filesystem calls directly — same
   dependency-injection rationale as item 1.
4. `packages/extension/src/statusbar/parityStatusBar.ts`: no change to
   `formatParitySummary`/`createParityStatusBarItem` themselves (T-11's
   existing, already-correct implementation) — this task's job is calling
   `updateFromResult` and `.show()` from the run-comparison flow, not
   changing the status bar module itself.
5. **Narrow amendment**: in
   `packages/extension/src/activation/activate.ts`, inside
   `runComparisonCommand`, after a successful `runComparison` call and
   before/alongside `showResultsWebview`, add one call to T-31's
   `persistRun(result, safeOutputRoot)` and one call to the status bar's
   `updateFromResult(result)` + `.show()`. Inject both the safe output
   root — confirmed this session that no existing command wires a concrete
   `safeOutputRoot` value yet (`writeExport.ts` only defines the
   containment check; nothing currently supplies it a real path), so pick
   a straightforward convention and document it, e.g. the first open
   workspace folder's path (mirroring `registerRunComparisonCommand`'s own
   `defaultUri` pattern a few lines above in the same file), with a clear
   `showErrorMessage` (not a crash) if no workspace folder is open — and
   the `ParityStatusBarItem`
   instance as new fields on `runComparisonCommand`'s existing `deps`
   object, following the same "typed optional, defaults to a no-op-safe
   absent state" pattern already used for `connectionProfileStore`/
   `secretStore` in that same `deps` object (see that function's own
   header comment for why they're optional there). A `persistRun` failure
   (e.g. no workspace open, no writable output root) must not crash or
   block showing the results webview — the run's results should still
   display even if persistence fails; catch and surface via
   `showErrorMessage` (or silently skip, your call — document whichever)
   rather than letting it propagate into the existing outer catch and
   replace the success path with an error message.
6. Update `activate()` itself to construct the status bar item once (via
   `createParityStatusBarItem`), pass it into `registerRunComparisonCommand`
   /`runComparisonCommand`'s deps, and add it to `context.subscriptions`
   for disposal — the same wiring pattern already used for
   `connectionProfileStore`/`secretStore`.

## Dependencies

T-30 (COMPLETE, APPROVED — real-connector-aware run command). T-31
(COMPLETE, APPROVED — `persistRun`/`listRecentRuns`/`loadRun`).

## Files owned

- `packages/extension/src/views/parityTreeDataProvider.ts` (extends T-10)
- `packages/extension/src/statusbar/parityStatusBar.ts` (extends T-11 —
  expected to need little or no change; do not alter
  `formatParitySummary`'s output format)
- `packages/extension/src/activation/activate.ts` (extends T-10/T-22/T-29/
  T-30/T-32 — **amendment**: narrowly, `runComparisonCommand`'s `deps`
  shape/body for the `persistRun`/status-bar calls described in Scope
  item 5, and `activate()`'s construction/subscription wiring described in
  Scope item 6. Do not touch the connection-management or
  comparison-authoring command registrations/handlers.)

## Interfaces consumed

- `listRecentRuns`, `loadRun`, `RunSummary` (T-31,
  `packages/extension/src/runHistory/runHistory.ts`) — read-only.
- `persistRun` (T-31) — called once, additively, per Scope item 5.
- `showResultsWebview` (T-11/T-16, `packages/extension/src/webview/resultsWebview.ts`).
- `formatParitySummary`, `createParityStatusBarItem`, `ParityStatusBarItem`
  (T-11, `packages/extension/src/statusbar/parityStatusBar.ts`) — consumed
  as-is, not modified.
- `vscode.workspace.findFiles` — only via an injected dependency, never
  called directly inside `parityTreeDataProvider.ts`.

## Interfaces produced

- A `ParityTreeDataProvider` whose `Comparisons` and `Recent Runs`
  sections render real children.
- A live status bar item showing `Parity: N passed | N warnings | N
  failed` after each successful run.
- `persistRun` genuinely gets called from the real run-comparison command
  flow for the first time in this codebase.

## Prohibited changes

- Do not modify `packages/engine/**`.
- Do not modify `packages/extension/src/runHistory/**` (T-31's owned
  files) — read-only consumption only.
- Do not modify `packages/extension/src/connections/**` or
  `packages/extension/src/authoring/**` (T-29/T-32's owned files).
- Do not change `runComparisonCommand`'s existing file-picking,
  parsing, connector-registry-resolution, or error-handling behavior for
  the run itself — the only permitted change to that function is the
  additive persist/status-bar calls described in Scope item 5.
- Do not implement the "Connections" or "Saved Profiles" tree sections —
  out of this task's scope per `IMPLEMENTATION-PLAN.md`'s T-33 row (only
  "Comparisons" and "Recent Runs" are named).
- Do not build the visual redesign (colors, icons, styled markup) — that
  is T-34, which explicitly depends on this task's structural wiring
  existing first.

## Red-state evidence required

A test opening the tree view in a workspace containing a `.paritylens`
file, expecting it to appear under "Comparisons" — fails today (section is
always empty). A second red-state test: after a comparison run,
`listRecentRuns` shows no persisted record — fails today (nothing ever
calls `persistRun`).

## Green-state verification required

Both tests above pass. Additionally: a test confirms clicking a listed
"Recent Runs" item invokes `loadRun` for the correct `id` and passes its
result to `showResultsWebview` (not just that the tree item renders); a
test confirms the status bar's text updates to match
`formatParitySummary(result.summary)` after a run; a test confirms a
`persistRun` failure does not prevent `showResultsWebview` from being
called with the run's result. `npm run verify` passes in full.

## Handoff

Note to reviewer: please adversarially confirm (1) clicking a listed
comparison or recent-run item genuinely invokes the correct
command/loads the correct result — not just that tree items render with
plausible-looking labels, and (2) the Scope-item-5 amendment to
`runComparisonCommand` is genuinely narrow — diff it against T-30's
version and confirm no existing behavior (fixture fallback, error
messages, connector resolution) changed, only the additive persist/status-
bar calls were added.
