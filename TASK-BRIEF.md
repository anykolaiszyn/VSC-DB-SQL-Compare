# ParityLens — Task Brief T-11

## Objective

Implement the Phase-1-scope results webview and status bar summary: given a
`ComparisonResult`, render its `schemaDifferences` and `profileDifferences`
as tables in a VS Code webview panel, and show a `Parity: N passed | N
warnings | N failed` summary in the status bar — using only the data passed
into the rendering functions, with no direct connector or credential access
from webview code.

Note to whoever dispatches an implementer against this brief: when briefing
the implementer, quote this document's load-bearing requirements verbatim
rather than paraphrasing them. A paraphrase that loosens a requirement (for
example, turning a required field into an offhand "nice to have if there's
time") is a known failure mode — the implementer treats the paraphrase as
authoritative and a real requirement quietly drops. If a dispatch prompt
must summarize this brief for brevity, it should still point back to this
file as the sole authority wherever the two could be read to disagree.

## Dependencies

- **Required completed tasks:** T-09 (orchestration planner, produces
  `ComparisonResult`), T-10 (extension scaffold — activation, tree view,
  `SecretStore`). Both COMPLETE/APPROVED per `PROGRESS-LEDGER.md`.
- **Required decisions or approvals:** NONE beyond the already-approved
  `IMPLEMENTATION-PLAN.md` row for T-11.

## Files owned

- `packages/extension/src/webview/**`
- `packages/extension/src/statusbar/**`

Do not touch `packages/extension/src/activation/activate.ts`,
`packages/extension/src/views/**`, or `packages/extension/src/secrets/**` —
those are T-10's owned files. If wiring the webview/status bar into
activation requires a change to `activate.ts` (e.g. registering a new
command or subscribing the status bar item), that is a **minimal,
mechanically-necessary companion change**, not new scope — following the
precedent set in `PROGRESS-LEDGER.md`'s T-04/T-06 decisions (2026-07-27):
note it explicitly and separately in the implementation report rather than
folding it in silently, and keep it to the smallest edit that makes T-11's
owned code reachable from activation.

## Interfaces

| Direction | Interface | Contract | Producer or consumer |
| --- | --- | --- | --- |
| Consumed | `ComparisonResult` (`packages/shared/src/result.ts`) | Full shape: `comparison`, `runId`, `status`, `summary: {passed, warnings, failed}`, `rowCounts`, `schemaDifferences: SchemaDifference[]`, `profileDifferences: ProfileDifference[]`, `aggregateDifferences`, `rowDifferences`, `execution`. T-11 renders `schemaDifferences` and `profileDifferences` only — `aggregateDifferences`/`rowDifferences` stay empty until T-13/T-14/T-15 exist; do not build UI that assumes they're populated. | T-02 (shape), T-09 (producer) |
| Consumed | `SchemaDifference` fields | `severity`, `message`, `columnName`, `kind` (`missing-in-target` \| `missing-in-source` \| `type-mismatch` \| `length-mismatch` \| `precision-mismatch` \| `scale-mismatch` \| `nullability-mismatch` \| `order-mismatch`), optional `sourceType`/`targetType` | T-06 |
| Consumed | `ProfileDifference` fields | `severity`, `message`, `columnName`, `metric` (`distinctCount` \| `nullPercentage` \| `mostCommonValue` \| `newTargetValue` \| `missingTargetValue`), optional `sourceValue`/`targetValue` (typed `unknown` — render via `String(value)`, do not assume a numeric or string type at compile time) | T-07 |
| Produced | Webview panel render function | Given a `ComparisonResult`, produces webview HTML/content showing schema differences and profile differences each as a table (one row per `DifferenceItem`, columns include at minimum `severity`, `columnName`, and the kind/metric-specific detail). Must not read `vscode.workspace`, `SecretStorage`, or invoke any connector — the function's only input is the `ComparisonResult` object (plus whatever `vscode.WebviewPanel`/webview API surface is needed to actually display it). | T-16 (extends in Phase 2) |
| Produced | Status bar item | Text format `Parity: {summary.passed} passed \| {summary.warnings} warnings \| {summary.failed} failed`, matching `Idea Prompt.md`'s "Status bar" worked example (`Parity: 18 passed | 2 warnings | 1 failed`) literally in format. Updates from a `ComparisonResult`'s `summary` field only. | Consumers: user-visible; no other task currently consumes this programmatically |

## Prohibited changes

- Do not modify `packages/shared/src/result.ts` — `SchemaDifference`,
  `ProfileDifference`, `AggregateDifference`, and `RowDifference` are each
  owned by a different, already-completed or future task (see
  `CLAUDE.md`: "a refined difference shape is owned by the task that
  created it"). T-11 only consumes these shapes, never edits them.
- Do not implement `aggregateDifferences`/`rowDifferences` rendering as if
  populated — those arrays are guaranteed empty until T-15 (Phase 2
  planner) exists; building real UI against them now is out of scope and
  would need rework once T-14 defines `RowDifference`'s real shape.
- Do not add any connection-management, run-triggering, or comparison
  YAML-editing UI — that is unscheduled/future scope, not T-11.
- Do not touch `packages/engine/**` or `packages/shared/**` — T-11 is an
  extension-only, presentation-layer task.
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Test or check to add:** A webview-rendering test asserting that a
  `SchemaDifference` item present in a `ComparisonResult` fixture produces
  a corresponding table row (assert on rendered content, e.g. the column
  name and severity both appear in the produced HTML/content string) — this
  must fail because the webview module doesn't exist yet. A second focused
  test for the status bar: given a `ComparisonResult` with
  `summary: {passed: 18, warnings: 2, failed: 1}`, the status bar item's
  text equals `Parity: 18 passed | 2 warnings | 1 failed` — must fail
  because the status bar module doesn't exist yet.
- **Command:** `npx vitest run packages/extension`
- **Expected failure reason:** Module resolution failure — `webview/**` and
  `statusbar/**` do not exist under `packages/extension/src/` yet.
- **Captured output:** Paste the actual failing command output and exit
  code into `IMPLEMENTATION-REPORT.md`, not a paraphrase.

## Green-state and full verification

- **Focused command:** `npx vitest run packages/extension`
- **Full command:** `npm run verify`
- **Expected evidence:** All new webview/status-bar tests pass; a
  `ComparisonResult` fixture with at least one `SchemaDifference` and one
  `ProfileDifference` (reuse or extend an existing engine-package fixture
  result shape rather than inventing an unrelated one, if a convenient one
  already exists — otherwise a small hand-built literal matching the real
  interface is fine) renders both as table rows; the previously-passing
  294 tests (per `PROGRESS-LEDGER.md`'s T-10 entry) still pass with no
  regression; `npm run verify` exits 0.

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md`
- **Independent reviewer:** `reviewer` subagent (separate instance from
  whichever `implementer` subagent does this task)
- **Review report location:** `REVIEW-REPORT.md`
- **Commit or patch checkpoint:** Branch `task/T-11-results-webview-phase1`

**Note to reviewer:** scrutinize hardest whether the webview-rendering
function has any path that reaches `vscode.workspace`, `SecretStorage`, a
connector, or any I/O beyond the `ComparisonResult` object and the webview
display API itself — the brief's Interfaces table states "webview only
renders data passed to it," and `IMPLEMENTATION-PLAN.md`'s T-11 review-gate
column says the reviewer must confirm "no direct connector/credential
access from webview code." Also verify any `activate.ts` edit is genuinely
minimal (wiring only) and not a reimplementation of T-10's activation
logic.
