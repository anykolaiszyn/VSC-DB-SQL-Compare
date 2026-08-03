# TASK-BRIEF.md — T-47: run-history status-colored icons

## Objective

Resolve finding **T-34-01** (OPEN, accepted non-blocking, recorded in
`PROGRESS-LEDGER.md`'s Open findings table): `ParityRecentRunTreeItem`
(`packages/extension/src/views/parityTreeDataProvider.ts`) currently
uses a fixed, uncolored `ThemeIcon("circle-outline")` for every "Recent
Runs" tree entry regardless of the run's actual outcome, because
`RunSummary` (`packages/extension/src/runHistory/runHistory.ts`) carries
no status field to key a color off of. T-34's implementer and reviewer
both confirmed this was a genuine, correctly-flagged scope boundary
(T-34 did not own `runHistory.ts`), not an avoidable shortcut.

The finding's recorded resolution path (verbatim, from
`PROGRESS-LEDGER.md`):

> unblock by additively extending `RunSummary` with an optional
> `status?: ComparisonStatus` field populated by `persistRun`, which
> already receives the full `ComparisonResult`, then key
> `ParityRecentRunTreeItem`'s `ThemeIcon` color off it.

Confirmed directly before writing this brief: `ComparisonResult.status`
(`packages/shared/src/result.ts`) is typed
`"passed" | "warning" | "failed" | "error"` (exported as
`ComparisonStatus`), and `persistRun(result, safeOutputRoot)`
(`runHistory.ts`) already receives the full `ComparisonResult` as its
first parameter — the status value is available at the exact point
`RunRecord`/`RunSummary` are constructed, no new data flow is needed.

## Scope

1. In `packages/extension/src/runHistory/runHistory.ts`:
   - Add an **optional** `status?: ComparisonStatus` field to the
     `RunRecord` interface (import `ComparisonStatus` from
     `@paritylens/shared` alongside the existing `ComparisonResult`
     import).
   - `RunSummary` is `Omit<RunRecord, "result">` — the new field is
     included automatically, no separate edit needed there.
   - In `persistRun`, populate `status: result.status` when building the
     `RunRecord` object.
   - In `listRecentRuns`'s per-entry parse/validate block, additively
     read `record.status` into the returned summary when present (it is
     optional, so pre-existing on-disk records written before this
     change — which have no `status` field — must continue to parse and
     list successfully with `status` simply `undefined`; do not treat a
     missing `status` as a malformed/skippable record).
2. In `packages/extension/src/views/parityTreeDataProvider.ts`, key
   `ParityRecentRunTreeItem`'s `ThemeIcon` color off `run.status`:
   - `"passed"` → a green-toned icon (e.g.
     `new vscode.ThemeIcon("pass", new vscode.ThemeColor("testing.iconPassed"))`
     or an equivalent recognized codicon id / theme color pairing — your
     call, document the specific ids chosen and why).
   - `"warning"` → a yellow/orange-toned icon.
   - `"failed"` / `"error"` → a red-toned icon (may share one visual
     treatment for both, or distinguish them — your call, document it).
   - `status === undefined` (pre-existing records with no recorded
     status) → keep the current neutral, uncolored
     `ThemeIcon("circle-outline")` — do not guess an outcome for data
     that doesn't carry one.
   - Use `vscode.ThemeColor` with real, existing VS Code theme color ids
     (e.g. the `testing.iconPassed`/`testing.iconFailed`/
     `testing.iconQueued` family, or the `charts.*`/`notificationsX`
     families) rather than inventing new ones — check VS Code's
     published theme color reference if unsure which ids exist.
3. Update or add focused tests in `runHistory.test.ts` and
   `parityTreeDataProvider.test.ts` covering: `persistRun` writing
   `status` correctly; `listRecentRuns` returning `status` when present
   and `undefined` when a stored record predates this change (simulate
   by writing/parsing a record object literal without a `status` key);
   `ParityRecentRunTreeItem` selecting the correct icon/color per status
   value, including the `undefined` fallback case.

## Files owned

- `packages/extension/src/runHistory/runHistory.ts`
- `packages/extension/src/runHistory/runHistory.test.ts`
- `packages/extension/src/views/parityTreeDataProvider.ts`
- `packages/extension/src/views/parityTreeDataProvider.test.ts` (exact
  filename may differ — locate the actual existing test file next to
  `parityTreeDataProvider.ts` first)

## Interfaces consumed

- `ComparisonStatus` (`@paritylens/shared`, read-only — do not modify
  `packages/shared/**`).
- `ComparisonResult.status` (already flows into `persistRun` unchanged).

## Prohibited changes

- Do not touch `packages/shared/**` — `ComparisonStatus` already exists
  and is sufficient; no shared-type change is needed.
- Do not touch `packages/extension/src/activation/activate.ts` — no call
  site changes are needed; `persistRun` already receives the full
  `ComparisonResult` today.
- Do not widen `RunRecord`/`RunSummary` with any field beyond the one
  `status?: ComparisonStatus` addition.
- Do not make `status` required — it must stay optional so pre-existing
  on-disk run records (written before this change, with no `status`
  key) continue to parse successfully in `listRecentRuns` rather than
  being silently skipped as malformed.
- Do not touch `ParityComparisonTreeItem`'s icon (unrelated to this
  finding — only `ParityRecentRunTreeItem` is in scope).

## Red-state evidence required

A focused test demonstrating the current gap: construct a `RunSummary`
(or the tree item directly) with a known status value and confirm
today's `ParityRecentRunTreeItem` produces the same neutral
`circle-outline` icon regardless of status — i.e., prove there is
currently no outcome-based color differentiation, run it, and confirm
it fails once the real fix's assertions are written against current
`main` (or write the new assertions first, confirm they fail against
unmodified code, per this project's standard red/green pattern).

## Green-state evidence required

1. The scoped diff across the 2-3 owned source files.
2. Focused tests passing, exercising: `persistRun` status population,
   `listRecentRuns` backward compatibility with status-less legacy
   records, and per-status icon/color selection including the
   `undefined` fallback.
3. A full fresh `npm run verify` passing with no regression versus the
   598/27/625 baseline (count will grow by however many new tests this
   task adds — that's expected).

## Handoff

- Write `IMPLEMENTATION-REPORT.md` using
  `multi-agent-idea-to-app/templates/IMPLEMENTATION-REPORT.md`.
- Commit on branch `task/T-47-run-history-status-icons`.
- Recommend independent review as the next step.
- Reviewer should specifically re-verify: (1) a pre-existing on-disk run
  record with no `status` field still lists and renders correctly
  (neutral icon, no crash/skip); (2) each of the four `ComparisonStatus`
  values maps to a real, valid VS Code codicon id + `ThemeColor` id pair
  (not an invented/nonexistent one); (3) no file outside the declared
  ownership changed; (4) a fresh full `npm run verify` is green.
