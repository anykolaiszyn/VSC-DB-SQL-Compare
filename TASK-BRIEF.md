# ParityLens — Task Brief T-16

## Objective

Extend the results webview to render the two Phase-2 difference arrays
(`aggregateDifferences`, `rowDifferences`) that T-15 now populates, and add
a new export module that writes a `ComparisonResult` to CSV, JSON, and
Markdown files under the configured safe output root.

**Explicit scope reduction from `IMPLEMENTATION-PLAN.md`'s T-16 row:** the
plan row also lists "SQL preview panel showing generated queries before
execution." Investigation before this brief was written found no existing
engine interface exposes generated SQL as a string — `volume.ts`,
`profiling.ts`, and `planner.ts`'s `fetchAllRows` each build a SQL string
privately and execute it immediately inline, with no shared preview
surface, and all three are files this task is prohibited from touching
(see Prohibited changes). The project owner was asked directly and chose
to **defer SQL preview to a future follow-up task** rather than widen this
task's file ownership into the engine layer or have the extension
independently re-derive SQL (risking drift from what actually executes).
Do not implement any SQL preview UI in this task. Record this deferral as
a new, explicit row/decision in `PROGRESS-LEDGER.md` during activation (a
future task, e.g. a new T-16b, will own adding a `buildXQuery`-style
string-returning function to each engine file's owned scope and a preview
surface that consumes it) — this is not a silent scope cut, it is a
recorded, owner-approved one.

Note to whoever dispatches an implementer against this brief: quote this
document's load-bearing requirements verbatim rather than paraphrasing
them. A paraphrase that loosens a requirement is a known failure mode from
this project's history (T-07's I-02 finding traced back to exactly this).

## Dependencies

- **Required completed tasks:** T-11 (results webview, Phase 1), T-15
  (orchestration planner Phase 2). Both COMPLETE and APPROVED per
  `PROGRESS-LEDGER.md`.
- **Required decisions or approvals:** SQL-preview deferral, confirmed
  directly by the project owner (see Objective above) — no other approval
  needed beyond the already-approved `IMPLEMENTATION-PLAN.md` T-16 row
  (as scoped down by that deferral).

## Files owned

- `packages/extension/src/webview/**` (extends T-11's ownership; T-11 is
  complete and merged, so this task now owns further changes to this
  directory)
- `packages/extension/src/export/**` (new directory, first task to own it)

Do not touch `packages/engine/**` at all — this task is extension-only,
consuming `ComparisonResult` (and its sub-shapes) read-only via
`import type` from `@paritylens/shared`. Do not touch
`packages/extension/src/activation/**`, `.../views/**`, `.../secrets/**`,
or `.../statusbar/**` (owned by T-10/T-11's other files respectively) —
if activation needs a new command to invoke export, add the minimal
wiring only if strictly necessary and flag it clearly in the
implementation report rather than assuming it's in scope.

## Interfaces

| Direction | Interface | Contract | Producer or consumer |
| --- | --- | --- | --- |
| Consumed | `ComparisonResult` and all sub-shapes (`AggregateDifference`, `RowDifference`, `RowColumnDifference`, `RowDifferenceCategory`) (`packages/shared/src/result.ts`) | Existing, complete, owned by T-13/T-14. Read-only `import type`. `aggregateDifferences` is a 0-or-1-element array (per T-13's doc comment: "one row-count check per run"). `rowDifferences` can be large — render every item, but do not assume any upper bound. | T-13/T-14 (producer) |
| Extended | `renderResultsHtml(result: ComparisonResult): string` (`packages/extension/src/webview/resultsWebview.ts`) | Existing pure function from T-11. Extend it to also render `aggregateDifferences` (a "Volume Parity" section, mirroring the existing schema/profile table pattern: one row per item showing severity/sourceCount/targetCount/difference/differenceRate/message) and `rowDifferences` (a "Row-Level Differences" section: one row per item showing severity/category/keyValues (joined, e.g. comma-separated)/message, with `columnDifferences` rendered as a nested sub-list or sub-table only when present — i.e. only for `"matched-key-differing-values"` items). Must remain a pure function: no new `vscode` API usage, no I/O beyond building the returned string, per T-11's established and reviewer-scrutinized contract ("only renders data passed to it"). Preserve all of T-11's existing behavior for `schemaDifferences`/`profileDifferences` — do not change those two functions except as strictly necessary for shared table styling. | This task (producer, extending T-11) |
| Produced (new) | An export function per format, e.g. `exportToCsv(result: ComparisonResult): string`, `exportToJson(result: ComparisonResult): string`, `exportToMarkdown(result: ComparisonResult): string` (`packages/extension/src/export/**`) | Each is a pure function returning file content as a string (mirroring `renderResultsHtml`'s pure-function pattern) — do not have these functions perform file I/O themselves. A separate, thin function (e.g. `writeExport(uri, content, safeOutputRoot)` or similar) performs the actual file write and must validate the resolved write path is contained under the safe output root before writing, rejecting (throwing) if the resolved path would escape it (path traversal check — e.g. reject `../` segments that resolve outside the root, matching `DESIGN-SPEC.md`'s "Write safety" principle: "All engine writes ... are contained under a configurable safe output root ... verified before write"). CSV must include row-difference rows with at least severity/category/keyValues/message columns. JSON should serialize the full `ComparisonResult` (or a documented equivalent subset — document the choice). Markdown should be human-readable, mirroring the webview's section structure. | This task (producer) |

## Prohibited changes

- Do not modify anything under `packages/engine/**` — this task is
  extension-only. If a genuine gap is found in `ComparisonResult` or its
  sub-shapes, stop and flag it as a blocker rather than editing
  `packages/shared/src/result.ts`.
- Do not implement SQL preview UI or any SQL-string-generation code in
  this task — explicitly deferred per the Objective section above.
- Do not change `renderResultsHtml`'s or `showResultsWebview`'s existing
  Phase-1 rendering behavior for `schemaDifferences`/`profileDifferences`
  beyond incidental shared-styling changes.
- Do not add a general-purpose templating engine, charting library, or
  other new runtime dependency — plain string-building HTML/CSV/Markdown,
  consistent with T-11's existing zero-dependency approach, unless a
  genuine blocker requires otherwise (flag and justify explicitly if so).
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Test or check to add:** A webview test asserting that a
  `ComparisonResult` with a non-empty `aggregateDifferences` entry (e.g. a
  volume-parity failure) renders as a table row containing its
  `sourceCount`/`targetCount`/`differenceRate` — must fail because
  `renderResultsHtml` doesn't render that array yet. A second red-state
  case: a `ComparisonResult` with a `rowDifferences` entry of category
  `"matched-key-differing-values"` including `columnDifferences` — must
  fail because it isn't rendered yet. A third red-state case: an export
  test asserting `exportToCsv`/`exportToJson`/`exportToMarkdown` exist and
  produce content containing a known row-difference's key values — must
  fail because the export module doesn't exist yet. A fourth: a test
  asserting a write attempt with a path that resolves outside the safe
  output root is rejected — must fail because no path-validation function
  exists yet.
- **Command:** `npx vitest run packages/extension`
- **Expected failure reason:** T-11's existing schema/profile tests still
  pass; new assertions fail because the corresponding rendering/export/
  path-validation code doesn't exist yet.
- **Captured output:** Paste the actual failing command output and exit
  code into `IMPLEMENTATION-REPORT.md`, not a paraphrase.

## Green-state and full verification

- **Focused command:** `npx vitest run packages/extension`
- **Full command:** `npm run verify`
- **Expected evidence:** All four red-state cases now pass; a test
  confirming `aggregateDifferences`/`rowDifferences` render nothing extra
  (e.g. "No volume differences." / "No row-level differences.") when
  empty, mirroring T-11's existing empty-state pattern for schema/profile
  tables; a test confirming the path-traversal rejection actually throws
  rather than silently writing outside the root; all of T-11's existing
  Phase-1 webview tests still pass unmodified; the previously-passing
  350 tests (per `PROGRESS-LEDGER.md`'s T-15 entry) still pass with no
  regression; `npm run verify` exits 0.

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md`
- **Independent reviewer:** `reviewer` subagent (separate instance from
  whichever `implementer` subagent does this task)
- **Review report location:** `REVIEW-REPORT.md`
- **Commit or patch checkpoint:** Branch `task/T-16-diff-viewer-export`

**Note to reviewer:** per `IMPLEMENTATION-PLAN.md`'s T-16 review-gate
column, "confirms export paths cannot escape the safe output root
(path traversal check)" — construct your own adversarial path (e.g. a
relative path with `../../` segments, or an absolute path outside the
root) and confirm the write function actually rejects it rather than
trusting the implementer's own test. Also confirm `renderResultsHtml`
remains a pure function with no new `vscode` import beyond types (grep
the diff for `from "vscode"` outside type-only imports). Confirm the
SQL-preview deferral was not quietly reinterpreted as "implement a
partial version" — there should be zero SQL-generation code in this
diff. Finally, confirm CSV/JSON/Markdown outputs are independently
sampled against a hand-built `ComparisonResult` fixture (not reused
from the implementer's own fixture) and actually contain the expected
row/column values, not just non-empty strings.
