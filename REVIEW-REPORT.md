# REVIEW-REPORT.md — T-34: Results webview + sidebar visual redesign

## Review independence statement

I am a separate reviewer instance from whoever implemented T-34. I did not
author `resultsWebview.ts`, `parityTreeDataProvider.ts`, or their test
files. All findings below are based on my own fresh reading of the diff and
my own command execution on branch `task/T-34-results-sidebar-visual-redesign`
(commit `33e6ccd`), not on the implementer's characterization in
`IMPLEMENTATION-REPORT.md`.

## Scope reviewed

- `TASK-BRIEF.md` (root) — sole scope authority.
- `IMPLEMENTATION-REPORT.md` (root) — implementer's self-report, treated as
  a claim, not a fact.
- `multi-agent-idea-to-app/design_handoff_paritylens_results_webview/README.md`.
- Full diff of `packages/extension/src/webview/resultsWebview.ts`,
  `packages/extension/src/webview/resultsWebview.test.ts`,
  `packages/extension/src/views/parityTreeDataProvider.ts`,
  `packages/extension/src/views/parityTreeDataProvider.test.ts` against
  `main`.
- `packages/extension/src/runHistory/runHistory.ts` (read-only, to verify
  the disclosed `RunSummary` scope-boundary claim).

## Verification performed (my own commands/results)

### 1. Fresh full verification

```
npm run verify
```
Result: **typecheck clean, lint clean.** Vitest: `28 passed | 2 skipped (30 files)`,
`477 passed | 27 skipped (504)`. This matches the implementation report's
claimed full-verification numbers exactly (477 passed / 27 skipped). The 27
skips are the documented SQL Server/PostgreSQL docker-integration tests
(no container running in this environment), unrelated to T-34.

### 2. `renderResultsHtml` purity and `enableScripts` guard

- Diffed the full function body against `main`
  (`git diff main...HEAD -- packages/extension/src/webview/resultsWebview.ts`).
  Confirmed:
  - Same exported signature: `export function renderResultsHtml(result: ComparisonResult): string`.
  - Only import addition is more type-only members (`ComparisonStatus`,
    `RowDifferenceCategory`, `Severity`) from `@paritylens/shared` — still
    `import type`, no runtime `vscode` import added.
  - No `Date.now()`, `Math.random()`, or any other non-determinism
    (`grep` for these found zero matches in the file).
  - No closures over external mutable state — `renderStyles()` returns a
    fixed string literal with no arguments; all other new helpers
    (`severityTagClass`, `statusTag`, `renderStatBand`, `renderRowDifferenceRow`)
    are pure functions of their arguments.
  - `showResultsWebview` (lines 689–707) is **byte-identical** to `main`'s
    version — diffed `git show main:...` against the current file region;
    `{ enableScripts: false }` is unchanged at the call site.
- Confirmed via `resultsWebview.test.ts`'s new purity test
  ("the same input rendered twice produces identical output") and arity
  test (`renderResultsHtml.length === 1`) — both pass under my own
  `npm run verify` run above, not just per the report's claim.

### 3. No JavaScript in the webview

- `grep -n "script\|onclick\|onchange\|javascript:"` over the file: zero
  matches for any `<script>` tag or inline event-handler attribute (the
  matches that did surface were all `color: var(--vscode-descriptionForeground)`
  false positives from grep's substring match on "script" inside
  "description", and doc-comment prose — no actual scripting construct).
- Tab switching is five hidden `<input type="radio" name="paritylens-tab">`
  elements plus `<label for="...">`, shown/hidden purely via
  `#tab-X:checked ~ .tab-panels .tab-panel--X { display: block; }` CSS
  sibling-combinator rules. Genuinely CSS-only.
- Row-level expand/collapse uses native `<details class="row-detail">`/
  `<summary>` — genuinely native-HTML, no JS.

### 4. Escaping coverage

Walked every new `${...}` interpolation in the diff
(`grep -n '\${' resultsWebview.ts`, then manually excluded pure CSS
`var(--vscode-...)` lines):
- `renderStatBand`: `result.summary.passed/warnings/failed`,
  `result.rowCounts.difference/source/target` — all wrapped in `escapeHtml`.
  These are numbers today (per `packages/shared/src/result.ts`:
  `ExecutionTiming`/`RowCounts` fields are typed `number`), so the escaping
  here is defense-in-depth rather than a live risk, but it's present and
  correct.
- `severityTagClass`/`statusTag` output: class name strings are drawn from
  a fixed `switch` over the `Severity`/`ComparisonStatus` enum values
  (not user data) — no escaping needed for the class name; the *label*
  text rendered alongside it is either a fixed string or, in the unhandled
  `default` case of `statusTag`, `escapeHtml(status)`. Confirmed present
  at the `default` branch.
- `renderRowDifferenceRow`: `categoryLabel` (`CATEGORY_LABELS[d.category] ?? d.category`,
  where the fallback is unescaped raw enum text) and `keyValuesLabel`
  (`d.keyValues.map(String).join(", ")`, values of `unknown` type) are both
  computed unescaped, but every render site wraps them in `escapeHtml`
  (`<td>${escapeHtml(categoryLabel)}</td>`, confirmed twice — once in the
  plain-row branch, once in the `<details>` branch). `d.message` similarly
  passes through `escapeHtml` at both render sites. The `data-category`
  attribute uses `escapeHtml(d.category)`.
- `renderQueryPreviewSection`: unchanged escaping/one-`<pre>`-per-query
  structure, confirmed still calls `escapeHtml(sql)` per query, only the
  wrapper markup (card + "Query N" header) changed.
- Meta line / header: `result.comparison`, `result.runId` — both
  `escapeHtml`-wrapped, matching pre-existing pattern.
- Existing XSS-probe test (`<script>alert(1)</script>` in comparison name)
  still present and passing.

No gap found: every `ComparisonResult`-derived string that could carry
data-dependent content is routed through the pre-existing `escapeHtml`
helper at the point of interpolation into the HTML string.

**One accuracy note on the brief's own header spec, not a security
finding:** the brief's Scope item 1 header description asks for a meta
line reading `Run <runId> · source→target · duration`. The implemented
meta line only renders `Run <runId>` and the duration
(`${execution.sourceDurationMs}ms source / ${execution.targetDurationMs}ms target`)
— it omits the `source object → target object` segment entirely (no
`·` separator or object names appear). This is a real, verifiable gap
against the brief's explicit header spec (confirmed by reading the
`header-row`/`meta-line` markup in the current file: it only contains
`Run ${...}` and the duration span, no second `meta-sep` or object-name
span). It was not disclosed in the implementation report's
Assumptions/Risks section. I judge this **Minor**: it does not affect
purity, security, or scope-file boundaries, and the object-name fields
were never listed as their own required Green-state evidence bullet
(only "new required markup ... absent" tests were required, and one
exists and passes for header/meta content in general) — but it is a
literal, uncalled-out deviation from Scope item 1's explicit line-item
spec and should be fixed or explicitly logged as a follow-up.

### 5. Sidebar native-only compliance

- `git diff main...HEAD -- parityTreeDataProvider.ts` shows exactly two
  additions: `this.iconPath = new vscode.ThemeIcon("file")` in
  `ParityComparisonTreeItem`, and `this.iconPath = new vscode.ThemeIcon("circle-outline")`
  in `ParityRecentRunTreeItem`. No `ThemeColor` argument is used anywhere
  in the diff (consistent with the disclosed neutral-icon decision — there
  is no outcome to color by). No custom HTML, no webview conversion, no
  new `description`/`contextValue` changes, `ParityTreeItem` (section
  headers) untouched — matches Scope item 2's explicit "do not
  over-engineer this node" instruction.
- `"file"` and `"circle-outline"` are both real, standard, long-standing
  built-in VS Code codicon ids (used extensively elsewhere in VS Code's own
  UI, e.g. `circle-outline` for neutral/unset states in the SCM view). No
  invalid id risk here since no `ThemeColor` id was introduced to spot-check.

### 6. File-ownership scope

```
git diff --stat main...HEAD
```
```
 IMPLEMENTATION-REPORT.md                           | 438 ++++++++---------
 .../src/views/parityTreeDataProvider.test.ts       |  33 +-
 .../extension/src/views/parityTreeDataProvider.ts  |  24 +
 .../extension/src/webview/resultsWebview.test.ts   |  81 ++-
 packages/extension/src/webview/resultsWebview.ts   | 547 ++++++++++++++++++---
 5 files changed, 833 insertions(+), 290 deletions(-)
```
Exactly the two owned source files, their two paired test files, and
`IMPLEMENTATION-REPORT.md`. Explicitly confirmed **zero diff** against
`main` for `packages/shared/src/result.ts`, `packages/extension/src/runHistory/`,
`packages/extension/src/connections/`, `packages/extension/src/statusbar/parityStatusBar.ts`,
and `packages/extension/src/activation/activate.ts` via
`git diff main...HEAD -- <those paths>` returning empty output. `git status --short`
on the branch is clean (no untracked/stray files).

### 7. `RunSummary` scope-boundary judgment

Read `packages/extension/src/runHistory/runHistory.ts` in full. Confirmed:
`export type RunSummary = Omit<RunRecord, "result">` — i.e. exactly
`{ id: string; name: string; timestamp: string }`, with a doc comment
explicitly justifying the omission of `result` (and therefore `status`) as
an intentional avoidance of reading/parsing every persisted run's full
body just to list names/timestamps.

Traced the only path `parityTreeDataProvider.ts` has to run data:
`ParityTreeDataProviderDeps.listRecentRuns: () => Promise<RunSummary[]>`,
consumed at `getRecentRunChildren` (`const runs = await this.deps.listRecentRuns()`)
— there is no other injected dependency that could supply a `status`/outcome
field. The only two ways to get an outcome-colored icon would be:
(a) widening `RunSummary` in `runHistory.ts` — explicitly a Prohibited
Changes file for this task, or (b) having the tree provider itself perform
additional I/O (e.g. call `loadRun` per item) to recover the full
`ComparisonResult` — which is filesystem I/O outside "`TreeItem`
presentation only — no data-fetching/dependency-shape changes beyond what
T-33 already established" (Files Owned). Both are genuinely out of this
task's ownership as declared by the brief itself.

**My independent judgment: stopping at a neutral icon was the correct
call**, not a shortcut the implementer could have avoided within this
task's actual file ownership. The brief's own Scope item 2 anticipated
exactly this outcome ("If it doesn't carry anything sufficient, that's a
scope boundary to flag and stop at, not silently work around") and the
implementer's report discloses it explicitly and specifically (not vaguely)
in both a code comment and the Assumptions/Risks section, with the two
rejected alternatives and why each is out of bounds. This is model
disclosed-scope-boundary behavior, not a defect.

**However**, the brief's own Green-state evidence list explicitly requires
"a `parityTreeDataProvider.test.ts` assertion that ... the run item's icon
color reflects at least two distinct outcomes" — and this requirement is
verifiably **not met**: the new tests only assert `instanceof ThemeIcon`,
with no color/outcome differentiation, because none exists to assert. I
treat this as a **disclosed, justified, but still real gap against a
brief-mandated Green-state requirement** — see Findings below for how I'm
classifying it.

### 8. Test quality

Read both new `describe` blocks in full (`resultsWebview.test.ts`'s
`"T-34 visual redesign"` and `"T-34: renderResultsHtml purity + enableScripts guard"`
blocks; `parityTreeDataProvider.test.ts`'s `"T-34 visual redesign: icons"`
block). All are genuine, specific assertions:
- Regex-anchored severity-tag-on-"Failure" check
  (`/class="[^"]*severity-tag[^"]*"[^>]*>Failure</`), not a bare substring
  check.
- Explicit negative assertions against banned raw Nocturne hex values
  (`#161826`, `#9184d9`) and against `<script>`/inline-handler patterns
  (`/\son\w+\s*=/i`).
- The `enableScripts` guard test inspects the actual 4th argument passed
  to a mocked `createWebviewPanel`, not just that the panel was created.
- The `ThemeIcon` tests use a real class-based `vi.mock("vscode", ...)`
  with `instanceof` checks rather than presence-of-a-string checks.

No vacuous "exists"/"is defined" placeholder assertions found.

## Findings

### Critical
NONE.

### Important
NONE. The `RunSummary`/outcome-color gap is a real requirement miss (see
below) but I am not blocking on it — see reasoning under Minor and the
Disposition section.

### Minor

| ID | Finding | Evidence | Resolution |
| --- | --- | --- | --- |
| T-34-01 | Brief's required Green-state evidence — "the run item's icon color reflects at least two distinct outcomes" — is not met. `ParityRecentRunTreeItem` uses a fixed, uncolored `ThemeIcon("circle-outline")` for every run regardless of outcome, because `RunSummary` (a file this task may not touch) carries no status field. | `packages/extension/src/views/parityTreeDataProvider.ts` diff; `RunSummary = Omit<RunRecord, "result">` in `runHistory.ts`; new tests only assert `instanceof ThemeIcon`, no color differentiation. | Accepted as a disclosed, correctly-justified scope boundary (see Handoff item 7 analysis above) rather than a defect to fix in this task. Route to a follow-up task authorized to additively extend `RunSummary` (e.g. an optional `status?: ComparisonStatus` field populated by `persistRun`, which already receives the full `ComparisonResult`) so `ParityRecentRunTreeItem` can then key an outcome-colored `ThemeColor` off it. Should be logged in `PROGRESS-LEDGER.md`'s open findings, routed to that future task, exactly as the implementer's own report recommends. |
| T-34-02 | Header meta line omits the `source object → target object` segment that Scope item 1's header spec explicitly calls for (`Run <runId> · source→target · duration`). Only `Run <runId>` and the duration are rendered; no second `·` separator or object-name span exists in the markup. Not disclosed in the Assumptions/Risks section of the implementation report. | `packages/extension/src/webview/resultsWebview.ts`, `renderResultsHtml`'s `meta-line` block (only one `<span>Run ...</span>` and one duration `<span>` present, no source/target object span). | Should be added in a small follow-up: `ComparisonResult` doesn't appear to carry a distinct "source object"/"target object" display string as a top-level field under this name (worth confirming what's actually available — e.g. derived from `queriesUsed`/definition metadata), so this may itself need a short scope note if the data isn't cleanly available; at minimum, log it as a known gap against the brief's literal header spec. Does not block approval — it's a cosmetic completeness gap, not a purity/security/scope violation. |

## Disposition of prior findings

No prior open findings from earlier review rounds were flagged as
in-scope for T-34 to resolve (T-34 is a new visual-only task, not a
remediation of a previously-flagged I-01/I-02-style finding). Nothing to
re-verify here.

## Summary of independent verification vs. report's claims

| Claim | Report's number | My independent number | Match? |
| --- | --- | --- | --- |
| Full verify test count | 477 passed, 27 skipped | 477 passed, 27 skipped | Yes |
| Full verify typecheck/lint | clean | clean | Yes |
| `showResultsWebview` `enableScripts: false` unchanged | claimed | confirmed byte-identical to `main` | Yes |
| Scope confined to 2 files + 2 test files + report | claimed | confirmed via `git diff --stat` and empty diffs on all prohibited paths | Yes |
| Escaping coverage complete | claimed | confirmed, walked every new interpolation | Yes |
| `RunSummary` has no status field | claimed | confirmed by reading `runHistory.ts` | Yes |
| Meta line includes source→target object info | implied by report's "Behavior delivered" prose ("a header with ... meta line") | **not actually present** in the rendered markup | **No — see T-34-02** |

## Final approval status

**APPROVED**

Reasoning: zero Critical or Important findings. The one brief-mandated
Green-state requirement that is not literally satisfied (run-item outcome
color, T-34-01) is a case where the brief itself pre-authorized exactly
this outcome ("that's a scope boundary to flag and stop at, not silently
work around") if the underlying data genuinely isn't available within this
task's file ownership — and my own independent trace of `runHistory.ts`
and `parityTreeDataProvider.ts`'s dependency injection confirms it
genuinely isn't. Treating a brief's own pre-authorized stopping point as a
blocking failure would contradict the brief's explicit instruction and
penalize correct behavior. The gap is disclosed prominently (code comment
+ Assumptions/Risks section) with a concrete, actionable follow-up path
(additive `RunSummary.status?` field), which is what "flag and stop"
disclosure is supposed to produce. T-34-02 (missing source→target segment)
is a genuine, undisclosed deviation from the brief's literal header spec,
but it is cosmetic, does not touch purity/security/scope, and does not
rise to a blocking Important-level finding.

Both Minor findings (T-34-01, T-34-02) should be logged in
`PROGRESS-LEDGER.md`'s open findings table with clear ownership for
follow-up, per this project's standard practice for disclosed/accepted
gaps.

No throwaway probe files were created during this review; `git status`
confirms no residue beyond this report.
