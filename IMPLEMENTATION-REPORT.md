# ParityLens — Implementation Report T-31

## Status and objective

- **Status:** COMPLETE (implementation only — pending independent review, per `AGENTS.md`: "No agent may substitute its own approval for the human approval gates.")
- **Objective:** Implement the Result Store component named in `DESIGN-SPEC.md`'s Architecture table: persist each `ComparisonResult` produced by a run as an immutable JSON record under a safe output root, reusing T-16's existing safe-output-root containment pattern (`packages/extension/src/export/writeExport.ts`) rather than reimplementing path-traversal checks, and provide a small read API (`listRecentRuns`, `loadRun`) for future consumers (T-33, a future "Open Last Result" command), per `TASK-BRIEF.md`'s exact wording.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/extension/src/runHistory/runHistory.ts` | New | Implements `RunRecord`/`RunSummary` types, `persistRun`, `listRecentRuns`, `loadRun`, per `TASK-BRIEF.md` Scope §1–5. |
| `packages/extension/src/runHistory/runHistory.test.ts` | New | Red/green evidence: byte-for-byte round trip, path-escape rejection for `loadRun`, and two-runs-no-overwrite / listing tests required by the brief's Green-state section. |
| `IMPLEMENTATION-REPORT.md` | Overwritten | This report, per this kit's per-task pattern (previous content was T-30's report, already reconciled). |

No files outside `packages/extension/src/runHistory/**` were touched. `packages/extension/src/export/**`, `packages/engine/**`, and `packages/shared/**` are untouched, per the brief's Prohibited Changes section.

## Behavior and interfaces

- **Behavior delivered:**
  - `persistRun(result, safeOutputRoot)` builds a filename stem from an ISO timestamp (colon/period-safe), the sanitized comparison `name`, and a short random suffix; serializes a `RunRecord` (`{id, name, timestamp, result}`) as JSON; writes it via `writeExport` (imported, not reimplemented); returns the `id`.
  - `listRecentRuns(safeOutputRoot)` reads the directory, parses each `.json` entry as a `RunRecord`, and returns `RunSummary[]` (`id`/`name`/`timestamp` only — no `result` body) sorted most-recent-first by timestamp. Returns `[]` if the directory doesn't exist yet (no runs persisted).
  - `loadRun(id, safeOutputRoot)` resolves `id` to a path using the same containment check `writeExport` applies (`path.relative`-based, resolved-path escape detection), reads and parses the record, and returns `record.result`.
- **Interfaces consumed:**
  - `ComparisonResult` (`@paritylens/shared`, `packages/shared/src/result.ts`) — read-only, type-only import.
  - `writeExport(targetPath, content, safeOutputRoot)` (`packages/extension/src/export/writeExport.ts`) — imported and called directly in `persistRun`; its containment logic is not duplicated there. `loadRun`'s `resolveRecordPath` mirrors (does not reimplement with divergent logic) the identical `path.relative`-based escape check `writeExport` itself performs, since `writeExport` has no symmetric "resolve for read" export to call directly — see Judgment calls below.
- **Interfaces produced:**
  - `RunRecord` (`{id: string; name: string; timestamp: string; result: ComparisonResult}`).
  - `RunSummary` (`Omit<RunRecord, "result">`) — the type `listRecentRuns` actually returns.
  - `persistRun(result: ComparisonResult, safeOutputRoot: string): Promise<string>`.
  - `listRecentRuns(safeOutputRoot: string): Promise<RunSummary[]>`.
  - `loadRun(id: string, safeOutputRoot: string): Promise<ComparisonResult>`.

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline (pre-change) | `npm run verify` | Exit 0. 428 passed, 27 skipped (455 total), 25 test files passed, 2 skipped. | Captured in this session before any edit. |
| Red state | `npx vitest run packages/extension/src/runHistory` (test file existed, module did not) | Exit 1. `Error: Cannot find module './runHistory' imported from '.../runHistory.test.ts'` — fails for the exact reason the brief predicts ("module does not exist"). | Captured in this session before creating `runHistory.ts`. |
| Focused green state | `npx vitest run packages/extension/src/runHistory` | Exit 0. `runHistory.test.ts (4 tests)` — `Test Files 1 passed (1), Tests 4 passed (4)`. | Captured in this session after creating `runHistory.ts`. |
| Full verification | `npm run verify` | Exit 0. typecheck clean, lint clean, `Test Files 26 passed \| 2 skipped (28)`, `Tests 432 passed \| 27 skipped (459)` — 4 more passing tests than baseline, same 2 skipped files (Postgres/SQL Server integration tests requiring env vars not set here), no regressions. | Captured in this session after full implementation. |

The four focused tests, each mapped to the brief's Green-state requirements:
1. "persists a ComparisonResult via persistRun and reads it back via loadRun as a byte-for-byte-equivalent object" — the brief's Red-state/primary Green-state test.
2. "rejects a loadRun id crafted to resolve outside the safe output root" — covers both a relative-traversal `id` (`../paritylens-runhistory-other/escaped`) and an absolute-path `id` pointing at a sibling temp directory, exercising the same containment behavior `writeExport`'s own tests verify (`exporters.test.ts`'s "rejects a write path that resolves outside..." tests), per the brief's second Green-state requirement.
3. "persists two runs in quick succession with the same name as distinct, non-overwriting records" — two `persistRun` calls with the identical `SAMPLE_RESULT` (same `comparison` name) in the same test, asserting distinct `id`s, `listRecentRuns` returning both, and both loading back correctly — the brief's third Green-state requirement.
4. "lists recent runs most recent first" — additional coverage for the ordering behavior `listRecentRuns` is specified to provide ("most recent first").

## Assumptions and risks

- **Assumptions:**
  - `RunRecord`'s minimal shape (`id`, `name`, `timestamp`, `result`) matches the brief's explicit "at minimum" list in Scope §1 exactly; no additional fields were added.
  - `listRecentRuns` returns a lighter `RunSummary` type (omitting the full `result` body) rather than `RunRecord[]`. The brief explicitly invites this as a judgment call in Scope §3 ("a lighter summary type if reading full ComparisonResult bodies for every listed run is wasteful — your call, document it"). This is a **deviation from the brief's own "Interfaces produced" list**, which states `listRecentRuns(safeOutputRoot): Promise<RunRecord[]>` — I judged the Scope section's explicit invitation to deviate (with a documentation requirement) as authoritative over the Interfaces-produced table's literal signature, since Scope is where the brief reasons about the tradeoff explicitly and the Interfaces table appears to just be carrying the same name forward for brevity. Flagging this explicitly for reviewer judgment rather than silently picking one reading.
  - Collision-avoidance for `persistRun` filenames: millisecond-resolution ISO timestamp + sanitized name, per the brief's suggested minimum, plus an added short random suffix as extra defense against same-millisecond collisions for programmatic/batch callers. This exceeds what the brief asked for ("document the judgment call rather than over-engineering a lock/retry scheme") — I judged a random suffix (cheap, no lock/retry machinery) as staying on the right side of that line, but flagging it since the brief only asked for timestamp+name to be documented as sufficient.
  - `resolveRecordPath` in `runHistory.ts` reimplements the identical `path.relative`-based escape-detection expression `writeExport.ts` uses (same four-condition check: empty relative, `".."`, `"..{sep}"` prefix, or absolute). This was necessary because `writeExport.ts` does not export a standalone "resolve and check" function separate from the read+write coupled `writeExport` itself — there is no existing read-path function to import for `loadRun`'s use case. The brief's Prohibited Changes section forbids modifying `packages/extension/src/export/**`, so extracting a shared helper there was not an option within this task's ownership. This is disclosed as the one place logic is duplicated rather than imported, per the brief's own Handoff note anticipating exactly this check ("safe-output-root reuse is genuine ... not reimplemented nearby with subtly different escape-path logic") — the expression here is copied verbatim from `writeExport.ts`, not independently re-derived, to minimize drift risk, but a reviewer should still verify it word-for-word against `writeExport.ts` lines 28–38.
- **Risks or limitations:**
  - `listRecentRuns` silently skips any `.json` file in the safe output root that fails to parse as a `RunRecord` (missing/wrong-typed `id`/`name`/`timestamp`), rather than surfacing an error. This is deliberate (a foreign or partially-written file should not break the whole listing) but means a corrupted record is invisible rather than flagged — acceptable for this task's read-API scope, but worth noting for a future "Recent Runs" UI (T-33) that might want to surface a warning instead.
  - The safe output root is currently expected to hold only run records (no subdirectory namespacing from other features). If a future task writes non-run JSON files into the same root, `listRecentRuns` would attempt to parse them and only skip them if they don't happen to coincidentally have `id`/`name`/`timestamp` string fields. This is a latent shared-directory risk, not something in scope for T-31 to solve (the brief does not specify a dedicated subdirectory), but flagged for whoever wires `safeOutputRoot` end-to-end (T-33 or later).
  - Sanitization strips any character outside `[a-zA-Z0-9_-]`, replacing runs of unsafe characters with a single `_` and trimming leading/trailing `_`. A `name` that is entirely unsafe characters (e.g. all punctuation) falls back to the literal string `"run"` — documented in the `sanitizeName` doc comment; not tested directly since `TASK-BRIEF.md` did not call out an edge-case test for it, but it is exercised implicitly by any real comparison name during normal use.
- **Blockers:** None.

## Patch or commit identity

- **Patch or commit:** (recorded after commit — see below)
- **Branch or workspace:** `task/T-31-result-store`

## Recommended next step

Recommend independent review by a separate reviewer agent (not this implementer), per `AGENTS.md`'s "Every implementation task receives an independent review by a reviewer who did not author the task's change" and the brief's Handoff note. The reviewer should specifically: (1) verify record immutability by inspecting `persistRun`/`buildIdStem` for any path where two calls could target the same filename; (2) verify `writeExport` is genuinely imported and called (not reimplemented) in `persistRun`, and separately scrutinize `resolveRecordPath` in `runHistory.ts` against `writeExport.ts`'s escape-check expression word-for-word, since that one piece of logic is necessarily duplicated (not imported) as disclosed above; (3) weigh in on the `RunSummary` vs. `RunRecord[]` return-type deviation from the brief's literal Interfaces-produced table, disclosed above as a judgment call. This report and its evidence do not constitute review or release approval.
