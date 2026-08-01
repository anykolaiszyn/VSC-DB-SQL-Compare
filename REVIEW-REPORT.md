# ParityLens — Review Report T-16

## Review independence statement

This review was performed by a separate agent instance from whoever
implemented T-16, with no memory of writing this code. All findings below
are based on direct inspection of the actual diff/source at commit
`f087404` on branch `task/T-16-diff-viewer-export`, my own fresh test runs,
and my own independently constructed adversarial path-traversal tests and
hand-built `ComparisonResult` fixture — none of which reuse the
implementer's fixture or test file. `IMPLEMENTATION-REPORT.md`'s claims
were treated as things to verify, not trust.

## Scope reviewed

- `TASK-BRIEF.md` (full text) and cross-referenced `DESIGN-SPEC.md`'s
  "Write safety" principle it cites.
- Full diff `main..task/T-16-diff-viewer-export` (8 files changed, per
  `git diff main task/T-16-diff-viewer-export --stat`).
- Actual current source of all changed files:
  `packages/extension/src/webview/resultsWebview.ts`,
  `packages/extension/src/webview/resultsWebview.test.ts`,
  `packages/extension/src/export/exporters.ts`,
  `packages/extension/src/export/exporters.test.ts`,
  `packages/extension/src/export/writeExport.ts`,
  `packages/extension/package.json`, `package-lock.json`.
- `PROGRESS-LEDGER.md`'s T-16 row and decision-log entries for the
  SQL-preview deferral and task activation.
- `packages/shared/src/result.ts` (to verify `AggregateDifference`/
  `RowDifference`/`RowColumnDifference` field names actually match what the
  webview/export code renders).

## Findings

**NONE at Critical or Important severity. NONE at Minor severity.**

| ID | Severity | Location | Description | Resolution |
| --- | --- | --- | --- | --- |
| — | — | — | No findings | — |

## Verification performed

### 1. Fresh full-suite verification (not trusting reported numbers)

```
npx vitest run packages/extension
  → 6 files, 24 tests passed (matches IMPLEMENTATION-REPORT.md's claim exactly)

npm run verify
  → typecheck clean, lint clean, vitest run: 18 test files, 359 tests passed, exit 0
  → matches IMPLEMENTATION-REPORT.md's claimed 359 (350 baseline + 9 new) exactly
```

Both my own runs match the implementer's reported numbers exactly. No
discrepancy.

### 2. My own adversarial path-traversal probes against `writeExport`

I wrote an independent test file (`packages/extension/src/__reviewer_probe__/reviewer-probe.test.ts`,
deleted after use — confirmed via `git status --short` showing a clean
tree with no residue) containing five path-traversal/containment probes
distinct from the implementer's three `writeExport` tests:

1. A deep relative traversal (`subdir/../../../etc-passwd-equivalent.txt`)
   climbing out past the root via multiple `..` segments — **rejected**
   (threw), and confirmed nothing was written at the computed
   escape-target path as a side effect.
2. An absolute path pointing into a sibling temp directory outside the
   root — **rejected** (threw), confirmed no file appeared at the
   sibling path.
3. Writing to the root directory itself (`"."`, no filename) — **rejected**
   (threw), consistent with the implementer's documented judgment call
   that a root is not "under" itself.
4. An absolute path constructed by resolving one level above the OS temp
   directory (clearly outside any plausible safe root) — **rejected**
   (threw), confirmed no file was created.
5. Control case: a legitimately nested subdirectory path
   (`exports/2026/results.csv`) inside the root — **succeeded**, file
   confirmed present at the expected nested location (proves the
   validation isn't simply rejecting everything).

All 8 tests in this probe file (5 traversal probes + 3 content-sampling
tests below) passed on the first run against the actual `writeExport`
implementation. `writeExport`'s containment logic (`path.relative(root,
target)` checked for `""`, `".."`, `"..' + sep`-prefix, or
`isAbsolute(rel)`) correctly rejects every traversal shape I constructed,
including one the implementer's own three tests didn't cover (multi-level
`../../../` climb, and the bare-root-as-target case combined with a
control "must still work" case in the same run to rule out a
reject-everything false-positive).

### 3. `renderResultsHtml` purity / no new `vscode` import

```
git diff main task/T-16-diff-viewer-export | grep -n 'from "vscode"'
  → one match: `import type * as vscode from "vscode";` (line 874 of the
    diff, inside resultsWebview.ts) — this is the pre-existing T-11
    type-only import (verified: the diff shows it as unchanged context,
    not an added `+` line), not a new runtime import.
```

Direct read of `packages/extension/src/webview/resultsWebview.ts`
confirms: the only `vscode` reference in the whole file is line 1's
`import type * as vscode from "vscode"`, used solely for type annotations
in `showResultsWebview`'s parameters. `renderResultsHtml` itself (lines
178–205) has no `vscode` reference anywhere in its body — it only calls
the four internal render-table helpers and returns a template string.
Confirmed pure: no I/O, no `vscode.*` API call, deterministic output from
its single `ComparisonResult` argument.

### 4. SQL-preview deferral — zero SQL-generation code check

```
git diff main task/T-16-diff-viewer-export | grep -inE "SELECT |buildQuery|generateSql|buildSql"
```

The only hits are inside the diff hunk for `IMPLEMENTATION-REPORT.md`
(pre-existing T-15 report text being replaced, describing T-15's
`fetchAllRows`/`compareVolume` work — not new code introduced by this
task). Re-ran the same grep restricted to `packages/` paths only and got
zero hits. Confirmed by direct read of `exporters.ts` and `writeExport.ts`
(the two new files): neither contains any SQL string construction,
`buildXQuery`-style function, or reference to a query-generation concept —
both only consume `ComparisonResult`'s already-computed data. No
`packages/engine/**` files appear in `git diff main
task/T-16-diff-viewer-export --name-only`. The deferral recorded in
`PROGRESS-LEDGER.md`'s decision log (2026-07-31 entry: "Descoped T-16's
'SQL preview panel' requirement... deferred to a future follow-up task")
was honored as a full removal, not a partial/reinterpreted implementation.

### 5. Independent output sampling against my own hand-built fixture

I constructed `REVIEWER_FIXTURE`, a `ComparisonResult` independent of
`exporters.test.ts`'s `SAMPLE_RESULT` — different comparison name
(`"reviewer-check"`), different run ID, different column names
(`CustomerId`/`Region`/`Status`), a `type-mismatch` schema finding (a kind
the implementer's fixture didn't exercise — theirs used
`missing-in-target`), a `distinctCount` profile metric (theirs used
`nullPercentage`), and two row differences including one
`missing-from-target` case with no `columnDifferences` (theirs only had
one `matched-key-differing-values` row). Assertions and results:

- `exportToCsv(REVIEWER_FIXTURE)` — contained `"CustomerId"`,
  `"type-mismatch"`, `"INT"`, `"BIGINT"`, `"ZZ-999"`, `"YY-001"`,
  `"missing-from-target"`, and the semicolon-joined column-diff format
  `"Status: Open -> Closed"`. All passed — confirms actual field values
  land in the correct CSV columns, not just non-empty output.
- `exportToJson(REVIEWER_FIXTURE)` — parsed back with `JSON.parse` and
  checked `runId === "run-REV-01"`,
  `rowDifferences[1].keyValues` deep-equal `["YY-001"]`, and
  `aggregateDifferences[0].differenceRate === -1`. All passed — confirms
  a genuine round-trip, not string-containment alone.
- `exportToMarkdown(REVIEWER_FIXTURE)` — contained `"reviewer-check"`,
  `"ZZ-999"`, `"Status: Open -> Closed"`, and the exact expected Markdown
  table row `"| Warning | CustomerId | type-mismatch | INT | BIGINT |"`,
  confirming column ordering and value placement inside the rendered
  table, not merely presence of the substrings anywhere in the document.

All 3 sampling tests plus all 5 traversal probes passed (8/8) on first
run.

### 6. `@types/node` devDependency judgment

Confirmed via `git diff` on `packages/extension/package.json`: the
addition is exactly one line under `"devDependencies"` —
`"@types/node": "^22.20.1"` — not under `"dependencies"`. No runtime
`node:fs`/`node:path`/`node:os` import appears anywhere outside
`packages/extension/src/export/writeExport.ts` (the legitimate file-I/O
module) and `packages/extension/src/export/exporters.test.ts` (test-only,
for building/cleaning up temp directories). Verified this with a targeted
search across the diff: the only `node:` import sites are those two
files. `package-lock.json`'s 21-line diff is the expected lockfile
fallout of a single new devDependency install (adds `@types/node` and its
`undici-types` transitive dependency).

Judgment: reasonable, not a red flag. `writeExport`'s path-traversal
validation is exactly the kind of security-relevant logic the project's
own `AGENTS.md`/`DESIGN-SPEC.md` treats with elevated rigor; using
Node's standard `path.resolve`/`path.relative` under proper ambient types
is safer than the counterfactual (hand-rolled path parsing without type
checking, or `@ts-expect-error`-suppressed calls). The brief's own
Prohibited-changes clause restricts "runtime dependency" additions
(templating/charting libraries), and `@types/node` ships no runtime code
and is not bundled into the extension's runtime output. The implementer
also disclosed this proactively and explicitly rather than burying it,
consistent with the project's stated expectations for flagged deviations.

## Scope and ownership check

`git diff main task/T-16-diff-viewer-export --name-only` shows exactly:
`IMPLEMENTATION-REPORT.md`, `package-lock.json`,
`packages/extension/package.json`,
`packages/extension/src/export/exporters.test.ts`,
`packages/extension/src/export/exporters.ts`,
`packages/extension/src/export/writeExport.ts`,
`packages/extension/src/webview/resultsWebview.test.ts`,
`packages/extension/src/webview/resultsWebview.ts`.

- `packages/extension/src/webview/**` and `packages/extension/src/export/**`
  — both explicitly owned by this brief.
- `packages/extension/package.json` / `package-lock.json` — minimal,
  mechanically-forced consequence of the disclosed and justified
  `@types/node` devDependency addition (see above). Acceptable, noted.
- `IMPLEMENTATION-REPORT.md` — the brief's own designated report location.
- Zero files under `packages/engine/**`, `packages/extension/src/activation/**`,
  `.../views/**`, `.../secrets/**`, `.../statusbar/**` — all correctly
  untouched, matching the brief's Prohibited-changes and Files-owned
  sections. `schemaDifferences`/`profileDifferences` rendering functions
  in `resultsWebview.ts` are byte-for-byte unchanged (confirmed by direct
  read: `renderSchemaDifferencesTable`/`renderProfileDifferencesTable`
  match T-11's original structure and are called identically from
  `renderResultsHtml`).

No unauthorized scope expansion found.

## Disposition of prior findings this task was meant to resolve

None. T-16's brief does not carry forward any specific open finding from
`PROGRESS-LEDGER.md` to resolve (X-01 is tracked against "T-16 or the
first packaging task" as a non-blocking, accepted-open item about
extension-host smoke testing, not something this task's brief requires it
to close, and this task did not touch activation/command wiring at all,
so X-01 remains correctly untouched and still open).

## Additional observations (non-blocking)

- The implementer's own disclosed residual gap — `writeExport`'s
  containment check does not follow symlinks — is real (Node's
  `path.resolve` normalizes `.`/`..` but does not resolve symlinks on
  disk) but is a reasonable, honestly-scoped residual risk consistent with
  this project's existing "defense in depth" pattern
  (`assertReadOnlyStatement`'s documented residual gaps per `CLAUDE.md`).
  The safe output root is application-configured, not attacker-supplied,
  which further limits the practical exploitability of this gap. Not a
  blocking finding.
- No command/UI wiring was added to invoke export from the command
  palette. The brief treats this as optional ("if strictly necessary")
  and the implementer's reasoning for omitting it (no red-state test
  requires it, Interfaces table only requires the functions to exist and
  be testable) is a correct reading of the brief text. Left as an
  implementer/orchestrator judgment call for a future task, not a defect
  in this one.

## Final approval status: APPROVED

Zero Critical, Important, or Minor findings. Fresh verification matches
the implementer's reported numbers exactly (24/24 focused, 359/359 full,
`npm run verify` exit 0). My own independently constructed
path-traversal probes (5 cases, none reused from the implementer's tests)
all confirm rejection of escaping writes and confirm a legitimate nested
write still succeeds. My own independently hand-built `ComparisonResult`
fixture (distinct column names, difference kinds, and metrics from the
implementer's fixture) confirms CSV/JSON/Markdown exports contain correct
row/column values in the correct structural positions, not merely
non-empty output. `renderResultsHtml` remains provably pure with no new
`vscode` import. Zero SQL-generation code exists anywhere in the diff,
confirming the SQL-preview deferral was honored as a full removal rather
than a partial reinterpretation. The `@types/node` devDependency addition
is judged reasonable: devDependencies-only, types-only, disclosed
proactively, and directly necessary for the brief's own required
`writeExport` interface. Scope is fully contained within the brief's file
ownership.
