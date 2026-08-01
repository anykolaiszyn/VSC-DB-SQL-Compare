# ParityLens — Implementation Report T-16

## Status and objective

- **Status:** COMPLETE (implementation and evidence only — not reviewed or approved)
- **Objective:** "Extend the results webview to render the two Phase-2
  difference arrays (`aggregateDifferences`, `rowDifferences`) that T-15
  now populates, and add a new export module that writes a
  `ComparisonResult` to CSV, JSON, and Markdown files under the configured
  safe output root." SQL preview is explicitly out of scope per the
  brief's Objective section (deferred to a future task by owner decision)
  and was not implemented — no SQL-generation code was written and
  `packages/engine/**` was not touched.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/extension/src/webview/resultsWebview.ts` | Extended `renderResultsHtml` with `renderAggregateDifferencesTable` ("Volume Parity" section: severity/sourceCount/targetCount/difference/differenceRate/message) and `renderRowDifferencesTable` ("Row-Level Differences" section: severity/category/keyValues (comma-joined)/message, with a nested `renderColumnDifferencesSubTable` only rendered for `columnDifferences` when present). `schemaDifferences`/`profileDifferences` rendering functions unchanged. No new `vscode` import — the pre-existing `import type * as vscode` is the only reference and remains type-only. | Brief's "Extended" interface row for `renderResultsHtml`. |
| `packages/extension/src/webview/resultsWebview.test.ts` | Added 4 new tests: aggregateDifferences table-row assertion, rowDifferences + columnDifferences assertion, and an empty-state assertion for both new sections ("No volume differences." / "No row-level differences."). Existing 2 tests unmodified. | Brief's Red-state evidence section, cases 1 and 2, plus the Green-state section's empty-state requirement. |
| `packages/extension/src/export/exporters.ts` (new) | Pure string-returning `exportToCsv`, `exportToJson`, `exportToMarkdown`. No file I/O. | Brief's "Produced (new)" interface row. |
| `packages/extension/src/export/writeExport.ts` (new) | `writeExport(targetPath, content, safeOutputRoot)`: resolves `targetPath` against `safeOutputRoot`, validates containment via `path.relative`, throws (rejects) if the resolved path escapes the root or equals the root itself, otherwise creates parent directories and writes the file. | Brief's "Produced (new)" interface row: path-traversal-safe write function. |
| `packages/extension/src/export/exporters.test.ts` (new) | Hand-built `ComparisonResult` fixture (independent of `resultsWebview.test.ts`'s fixture) exercising all four difference arrays; tests for each export function's content and three `writeExport` tests (successful contained write, relative-traversal rejection, absolute-outside-root rejection). | Brief's Red-state evidence section, cases 3 and 4. |
| `packages/extension/package.json` | Added `@types/node` (`^22.20.1`) to `devDependencies`. | See "Flagged deviation" below — same package (`packages/extension`) already under this task's ownership, but strictly necessary to satisfy the brief's own required `writeExport` interface; flagged explicitly rather than assumed in-scope. |
| `package-lock.json` | Lockfile update from the `@types/node` install (transitively adds `undici-types`). | Mechanical consequence of the above `npm install`. |

## Behavior and interfaces

- **Behavior delivered:** The results webview now renders "Volume Parity"
  and "Row-Level Differences" sections alongside the existing "Schema
  Differences"/"Profile Differences" sections, with the same table
  pattern and an empty-state message when an array is empty. A new
  `packages/extension/src/export/` module provides three pure
  string-returning export functions (CSV, JSON, Markdown) and a
  `writeExport` function that performs the actual write only after
  confirming the resolved path stays under a caller-supplied safe output
  root, throwing otherwise.
- **Interfaces consumed:** `ComparisonResult` and its sub-shapes
  (`AggregateDifference`, `RowDifference`, `RowColumnDifference`,
  `RowDifferenceCategory`) from `packages/shared/src/result.ts`, via
  `import type` only, read-only, exactly as the brief's Interfaces table
  specifies.
- **Interfaces produced:**
  - `renderResultsHtml(result: ComparisonResult): string` (extended, same
    signature as T-11).
  - `exportToCsv(result: ComparisonResult): string`
  - `exportToJson(result: ComparisonResult): string`
  - `exportToMarkdown(result: ComparisonResult): string`
  - `writeExport(targetPath: string, content: string, safeOutputRoot: string): Promise<void>`

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline (pre-change) | `npm run verify` | Exit 0, 17 test files, 350 tests passed | Run before any edits, confirmed clean before starting |
| Red state | `npx vitest run packages/extension` | Exit 1. 2 test files failed: `resultsWebview.test.ts` (3 of 5 tests failed — aggregateDifferences table-row assertion, rowDifferences/columnDifferences assertion, and empty-state assertion all failed with `expected '<!DOCTYPE html>...' to contain '1000'` / `'matched-key-differing-values'` / `'No volume differences.'` respectively — the two pre-existing T-11 tests still passed); `exporters.test.ts` failed to load entirely (`Error: Failed to load url ./exporters ... Does the file exist?`) because the export module did not exist yet. | `packages/extension/src/webview/resultsWebview.test.ts`, `packages/extension/src/export/exporters.test.ts` |
| Focused green state | `npx vitest run packages/extension` | Exit 0. 6 test files, 24 tests passed (5 webview + 6 export + 13 pre-existing extension tests from activation/secrets/statusbar/views). | Ran after implementation |
| Full verification | `npm run verify` | Exit 0. `tsc -b --force` clean, `eslint .` clean, `vitest run`: 18 test files, **359 tests passed** (350 baseline + 9 new: 3 new webview tests + 6 new export tests). No regressions — all previously-passing tests still pass unmodified. | Ran after implementation, immediately before commit |

## Assumptions and risks

- **Assumptions:**
  - `exportToJson` serializes the full `ComparisonResult` object via
    `JSON.stringify(result, null, 2)` rather than a hand-picked subset —
    documented in-line in `exporters.ts` as a judgment call per the
    brief's "(or a documented equivalent subset — document the choice)"
    allowance. Reasoning: no information loss, no risk of a subset
    silently dropping a field a consumer needs, and `ComparisonResult`
    contains no credentials per this project's no-inline-credentials
    rule, so full serialization carries no sensitivity concern.
  - `exportToCsv` emits one CSV "section" per difference category
    (Schema / Profile / Volume / Row-Level), each with its own header row
    and separated by a blank line, rather than one single flat table —
    documented in-line as a judgment call. Reasoning: the four difference
    shapes have materially different fields; a single shared header would
    force mostly-empty columns on every row. The brief's only hard
    requirement — "CSV must include row-difference rows with at least
    severity/category/keyValues/message columns" — is satisfied by the
    Row-Level Differences section, verified directly by test.
  - `writeExport`'s containment check treats a resolved path equal to
    `safeOutputRoot` itself (i.e., writing to the root directory, not a
    file inside it) as an escape and rejects it — not explicitly stated
    in the brief, but a reasonable reading of "contained under" (a root
    is not "under" itself). Documented in-line in `writeExport.ts`.
  - `columnDifferences` in CSV/Markdown export is rendered as a single
    semicolon-joined field (`ColumnName: source -> target; ...`) rather
    than exploded into separate rows, to keep row alignment with the
    rest of the row-differences table/section. Not explicitly specified
    by the brief; documented in-line as a judgment call.

- **Risks or limitations:**
  - **Flagged deviation — `@types/node` devDependency added.**
    `writeExport.ts`'s and `exporters.test.ts`'s use of Node's `fs`/`path`
    built-ins (`node:fs/promises`, `node:path`, `node:fs`, `node:os`)
    requires ambient/declared Node types to typecheck under this
    project's strict `tsconfig.base.json`. I confirmed via `find`/`grep`
    that `@types/node` was not installed anywhere in this monorepo before
    this task (no other package touches Node's `fs`/`path`/`os` modules),
    and `npm run typecheck` failed with `TS2307: Cannot find module
    'node:fs'` etc. until I added `@types/node@^22.20.1` as a
    `devDependency` of `packages/extension` (a types-only major matching
    this repo's Node 24 runtime per `CLAUDE.md`; `@types/node@22` was
    chosen because it is the latest LTS-aligned major with published
    types at install time). This is a types-only package that ships no
    runtime code and is not a "runtime dependency" in the sense the
    brief's Prohibited-changes section restricts ("Do not add a
    general-purpose templating engine, charting library, or other new
    runtime dependency"), but it is still a new devDependency, and
    AGENTS.md's default posture is "do not install dependencies...
    request a revised brief instead." I judged this a genuine blocker
    under the brief's own explicit carve-out ("unless a genuine blocker
    requires otherwise (flag and justify explicitly if so)") because the
    brief's own Interfaces table requires exactly this `writeExport`
    function to exist and perform real file I/O with path validation —
    not achievable without either Node ambient types or hand-rolled
    path-manipulation logic reimplementing `path.resolve`/`path.relative`
    (which would be worse: more security-relevant surface, less
    scrutinized, for exactly the kind of path-safety logic this project's
    own `AGENTS.md` calls out as needing rigor). **Flagging this
    explicitly and separately per my own operating instructions — a
    reviewer should independently judge whether this dependency addition
    was warranted or should instead trigger a revised brief.**
  - `writeExport`'s containment check does not resolve symlinks
    (`path.resolve` normalizes `.`/`..` segments but does not follow
    symlinks on disk, matching Node's own `path.resolve` semantics). A
    safe-output-root directory containing a symlink that points outside
    itself could theoretically still allow an escape at the filesystem
    level even though the resolved *path string* is contained. This
    mirrors a known-accepted-gap pattern already established elsewhere in
    this codebase (e.g. `assertReadOnlyStatement`'s documented residual
    gaps) rather than a new class of issue, but is worth a reviewer's
    explicit judgment since this is a security-relevant path-safety
    function.
  - No new command/UI wiring was added under `activation/**` to actually
    invoke export from a user-facing command — the brief's Files-owned
    section allows this only "if strictly necessary" and treats it as
    optional/flaggable. I judged it was not strictly necessary: the
    brief's Interfaces table only requires the export functions
    themselves to exist and be independently testable, and no red-state
    test in the brief's Red-state evidence section calls for a command
    registration. Not implemented; flagging so a reviewer/orchestrator
    can decide if a follow-up task should own that wiring.

- **Blockers:** None remaining — the `@types/node` blocker above was
  resolved by adding the devDependency rather than left open, but is
  flagged for reviewer judgment as noted.

## Patch or commit identity

- **Patch or commit:** Committed on the branch below immediately after
  this report (implementation and report land in the same commit, per
  this task's Files-owned scope covering the report location).
- **Branch or workspace:** `task/T-16-diff-viewer-export`

## Recommended next step

Recommend independent review by the `reviewer` subagent (a separate
instance from this implementation), per the brief's Handoff section and
its detailed "Note to reviewer" section, which specifically asks the
reviewer to: construct their own adversarial path-traversal case (not
just trust the tests added here) against `writeExport`; grep the diff for
`from "vscode"` outside type-only imports in the webview file; confirm
zero SQL-generation code exists in this diff; and independently sample
CSV/JSON/Markdown output against a hand-built fixture the reviewer
constructs themselves, not the one reused from `exporters.test.ts` here.
The reviewer should also explicitly judge the `@types/node`
devDependency addition flagged above. This report does not claim review
or approval status — only implementation-and-evidence completeness.
