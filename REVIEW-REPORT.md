# ParityLens — Independent Review Report T-47

## Review independence statement

This review was performed by a separate agent instance from whoever
implemented T-47. No claim in `IMPLEMENTATION-REPORT.md` was taken at
face value — every factual claim (diff scope, test coverage, codicon/
theme-color id validity, and the `npm run verify` counts) was
independently re-derived from the actual source, the actual diff, and
live external documentation, not from the report's narrative.

## Scope reviewed

- `TASK-BRIEF.md` (T-47: run-history status-colored icons, resolving
  finding T-34-01)
- `IMPLEMENTATION-REPORT.md` (implementer's claims)
- `packages/extension/src/runHistory/runHistory.ts` (full file, read)
- `packages/extension/src/runHistory/runHistory.test.ts` (new T-47 test
  block, read)
- `packages/extension/src/views/parityTreeDataProvider.ts` (full file,
  read)
- `packages/extension/src/views/parityTreeDataProvider.test.ts` (new
  T-47 test block, read)
- `git diff --stat main..task/T-47-run-history-status-icons`
- `git log --oneline main..task/T-47-run-history-status-icons`
- `packages/shared/src/result.ts` (to confirm `ComparisonStatus`'s
  literal union independently of the brief's own citation)
- Fresh `npm run verify` run on branch
  `task/T-47-run-history-status-icons`
- Live VS Code documentation/source (Theme Color reference, codicon
  reference, `vscode-codicons` mapping.json, `vscode` testing theme
  source) to adversarially verify all codicon/`ThemeColor` ids used

## Findings

### Critical

NONE.

### Important

NONE.

### Minor

| ID | Finding | Evidence | Resolution |
| --- | --- | --- | --- |
| T-47-01 | `iconForRunStatus`'s `switch` is not written as an exhaustive discriminated-union switch (no `never`-check in the `default` branch). If a fifth `ComparisonStatus` value is ever added, it would silently fall through to the neutral `circle-outline` fallback rather than failing to compile or being visibly flagged. | `packages/extension/src/views/parityTreeDataProvider.ts:110-122`. Self-disclosed by the implementer in IMPLEMENTATION-REPORT.md's "Assumptions and risks" section — verified as accurate and non-fabricated: the `switch` genuinely has no `never`/exhaustiveness assertion. | Accepted as documented residual risk, consistent with the brief's minimal-edit mandate and the project's stated pattern of flagging future-task risk rather than over-building. Not blocking. Whichever future task extends `ComparisonStatus` (owned by `packages/shared/**`, out of T-47's ownership) should add an exhaustiveness check at that time. |

No other issues found. Both Minor-candidate areas probed adversarially
(codicon/theme-color id validity, and the `circle-outline` fallback
icon inherited from T-33/T-34) turned out to check out as genuine,
correctly-chosen ids — see Verification below.

## Disposition of prior findings

T-34-01 (OPEN, non-blocking, per `PROGRESS-LEDGER.md`) is the finding
this task exists to close. Re-verified directly, not from the
implementer's say-so:

- **Original gap:** `ParityRecentRunTreeItem` always constructed
  `ThemeIcon("circle-outline")` with no status-based color, because
  `RunSummary` carried no status field.
- **Confirmed fixed:** `RunRecord.status?: ComparisonStatus` now exists
  (`runHistory.ts:29`), `persistRun` populates it from
  `result.status` (`runHistory.ts:134`), `listRecentRuns` surfaces it
  additively via a conditional spread required by
  `exactOptionalPropertyTypes: true` (`runHistory.ts:199-204`), and
  `iconForRunStatus` (`parityTreeDataProvider.ts:110-122`) now keys the
  icon/color off `run.status` for all four `ComparisonStatus` values,
  falling back to the original neutral `circle-outline` only when
  `status === undefined`.
- I did not simply trust the report's description of this fix — I read
  the actual diff and traced the data flow from `ComparisonResult.status`
  through `persistRun` → on-disk JSON → `listRecentRuns` → `RunSummary`
  → `ParityRecentRunTreeItem` → `iconForRunStatus` myself, and separately
  read the backward-compatibility test scenario's logic against the
  actual `listRecentRuns` implementation (see Verification below).

T-34-01 is genuinely resolved by this change.

## Verification performed

### 1. Fresh full `npm run verify`

Ran independently on `task/T-47-run-history-status-icons` (not copied
from the report):

```
npm run verify
  typecheck: clean (tsc -b --force, no errors)
  lint: clean (eslint ., no errors)
  test: Test Files  34 passed | 2 skipped (36)
        Tests       606 passed | 27 skipped (633)
```

This **exactly matches** the report's claimed 606 passed / 27 skipped
(633 total), up from the 598/27/625 baseline (+8 new tests: 3 in
`runHistory.test.ts`, 5 in `parityTreeDataProvider.test.ts`, matching
the report's file-by-file breakdown). No discrepancy between my
independent run and the claimed numbers.

### 2. Scope / diff-containment check

```
git diff --stat main..task/T-47-run-history-status-icons
```

Changed files: `IMPLEMENTATION-REPORT.md`, `TASK-BRIEF.md`,
`packages/extension/src/runHistory/runHistory.test.ts`,
`packages/extension/src/runHistory/runHistory.ts`,
`packages/extension/src/views/parityTreeDataProvider.test.ts`,
`packages/extension/src/views/parityTreeDataProvider.ts`.

This is exactly the brief's declared 4 owned source/test files plus the
two expected task-evidence documents created as part of this task's own
process (not scope drift). Explicitly confirmed via targeted diffs that
`packages/shared/**` and `packages/extension/src/activation/activate.ts`
— both named in the brief's "Prohibited changes" — have **zero** changes
(`git diff --stat ... -- packages/shared` and `... -- activate.ts` both
returned empty). `git status --short` at review time is clean (no
untracked residue).

`RunRecord`/`RunSummary` were widened by exactly the one field the brief
authorized (`status?: ComparisonStatus`) — read the full diff of
`runHistory.ts`, confirmed no other field was added.

### 3. Backward-compatibility (pre-existing on-disk record with no `status` key)

Read `runHistory.test.ts`'s `"listRecentRuns backward-compat..."` test
(lines 123-141): it writes a legacy `RunRecord`-shaped JSON object with
no `status` key at all (not `status: undefined`) directly to disk via
`writeFileSync`, matching what an actual pre-T-47 `JSON.stringify`d
record would have looked like, then calls the real `listRecentRuns` and
asserts the run still lists (`toHaveLength(1)`) with
`runs[0].status` `toBeUndefined()`. I traced this against the actual
`listRecentRuns` implementation (`runHistory.ts:169-214`): the parse
guard only checks `id`/`name`/`timestamp` are strings — `status` is
never part of the malformed-record rejection condition — so a legacy
record is not silently skipped. This is a genuine, correctly-targeted
proof, not a superficial test. Also separately confirmed the
`parityTreeDataProvider.test.ts` "undefined status" case
(lines 315-322) exercises the tree-item rendering side of the same
scenario and asserts `icon.id === "circle-outline"` and
`icon.color === undefined`.

### 4. Adversarial verification of codicon / `ThemeColor` ids (the report's self-flagged highest-risk item)

The implementer's report explicitly disclosed that the 4 codicon ids
and 3 `ThemeColor` ids were "recalled from training knowledge," not
locally type-checkable (no `@types/vscode` is installed in this repo —
confirmed true), and flagged this as the one thing most worth
independently cross-checking against live documentation. I did so
against authoritative sources, not just documentation summaries (which
proved unreliable in one case — see below):

- **`pass`** — confirmed present in VS Code's published codicon
  reference (`https://microsoft.github.io/vscode-codicons/dist/codicon.html`).
- **`warning`** — confirmed present, same source.
- **`error`** — confirmed present, same source.
- **`circle-outline`** — an initial pass against the rendered codicon
  reference page did **not** surface this id in a "circle"-filtered
  listing, which would have been an Important finding (a nonexistent
  codicon id silently rendering no icon). Before flagging it, I went to
  the authoritative source directly: `vscode-codicons`'s own
  `src/template/mapping.json` on GitHub, which is the literal id→
  codepoint registry the font is built from. It confirms
  `"circle-outline"` **is a real, valid id** — an alias mapped to
  codepoint `60092` alongside `circle` and
  `debug-breakpoint-unverified`. The documentation-page summarization
  simply omitted it from an incomplete listing; the raw mapping file is
  authoritative and overrides that omission. **No finding** — the id is
  genuine. (Note: `circle-outline` is pre-existing code from T-33/T-10,
  not introduced by T-47, but the brief's Handoff section asks the
  reviewer to re-verify it as part of this task's fallback behavior, so
  it was checked to the same standard as the three new ids.)
- **`testing.iconPassed`**, **`testing.iconFailed`**,
  **`testing.iconQueued`** — confirmed present in VS Code's published
  Theme Color reference under the Testing color family. Went one level
  deeper than the brief required: fetched VS Code's own
  `theme.ts`/registration source
  (`src/vs/workbench/contrib/testing/browser/theme.ts`) to check the
  *actual default color* behind each id, not just that the id string
  exists. Confirmed `testing.iconPassed` defaults to a green hex
  (`#73c991`), `testing.iconFailed` derives from `listErrorForeground`
  (red-family), and — most relevant to the implementer's judgment call
  — `testing.iconQueued` derives from `listWarningForeground`, i.e. it
  is genuinely a warning/yellow-orange-toned color under the hood, not
  merely "closest available id in the same family" as the report
  characterized it. This makes the `"warning"` → `testing.iconQueued`
  mapping a stronger choice than even the implementer's own reasoning
  claimed — no `testing.iconWarning` id exists in the published
  reference, confirmed independently, so there was no better-fitting
  alternative being passed over.
- Confirmed by reading the actual test file
  (`parityTreeDataProvider.test.ts:256-323`) that all 4 status values
  plus the `undefined` fallback assert the *exact* codicon id and
  `ThemeColor` id via the local `vscode` mock, not just "an icon was
  set" — so a future accidental id change would fail these tests.

Net result: **all 4 codicon ids and 3 `ThemeColor` ids used are real,
currently-published, correctly-chosen identifiers.** No invented or
misspelled id was found, despite one initially appearing questionable
before deeper verification against the authoritative source.

### 5. Data-flow / type-safety read of `exactOptionalPropertyTypes` handling

Independently confirmed (not just trusted the report's explanation) that
`tsconfig.base.json`'s `exactOptionalPropertyTypes: true` does require
the conditional-spread pattern used in `listRecentRuns`
(`runHistory.ts:199-204`) rather than `status: record.status` directly —
`npm run verify`'s typecheck step passed cleanly, which is consistent
with (though not sole proof of) this being handled correctly; the
pattern itself is a standard, correct way to satisfy that compiler
option while keeping the key genuinely absent rather than
present-with-`undefined`.

## Overall assessment

The implementation is a minimal, precisely-scoped, well-tested fix that
does exactly what the brief and the recorded T-34-01 resolution path
call for — no more, no less. The one self-disclosed risk (non-exhaustive
switch) is honestly reported and correctly classified as a Minor,
non-blocking, future-task concern, not something hidden or
mischaracterized. The one claim most likely to be wrong on inspection
(codicon/theme-color id accuracy, given no local type definitions to
check against) was independently and adversarially verified against
authoritative upstream sources and found to be entirely correct —
including one id that initially looked questionable on a first pass and
required going to the raw source-of-truth mapping file to confirm.

## Final disposition

**APPROVED**

0 Critical, 0 Important, 1 Minor (non-blocking, tracked for the future
task that eventually extends `ComparisonStatus`). Fresh `npm run verify`
independently reproduced at 606 passed / 27 skipped (633 total),
matching the implementer's claim exactly. Diff scope confirmed exactly
contained to the 4 declared owned files plus expected task-evidence
docs. Backward compatibility for pre-existing status-less on-disk
records independently traced and confirmed correct. All codicon and
`ThemeColor` ids independently verified against live/authoritative VS
Code sources as real and well-chosen. Finding T-34-01 is confirmed
genuinely resolved.
