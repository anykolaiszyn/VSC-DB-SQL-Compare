# ParityLens — Implementation Report T-28

## Status and objective

- **Status:** COMPLETE (implementation and evidence only — not reviewed or approved)
- **Objective:** Fix `compareRows`' `indexByKey` helper
  (`packages/engine/src/comparison-core/row-level/row-level.ts`), which
  looked up the key column's index via `columns.indexOf(keyName)` using the
  *source-side* key name (from `keys`) against **both** the source and
  target column lists, with no `column_mapping` translation applied to the
  key lookup itself. When the key column is named differently on source vs.
  target (e.g. `CustomerID` source / `CUSTOMER_ID` target — the real-world
  scenario `column_mapping` exists to handle, and the exact live smoke-test
  failure this task was opened from), the target-side lookup silently
  failed (`columns.indexOf` returns `-1`), producing `keyValues: [undefined]`
  for every target-side finding.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/engine/src/comparison-core/row-level/row-level.ts` | Added `resolveTargetKeyName(keyName, mapping)`, which resolves a `keys`-declared (source-side) key column name to its target-side name via the same `mapping.find(... mappingSourceColumnName(entry) === keyName)` lookup pattern `compareMatchedRow` already uses for every other mapped column. `compareRows` now computes `targetKeys = keys.map((k) => resolveTargetKeyName(k, mapping))` and passes `targetKeys` (not the raw `keys`) to the target-side `indexByKey` call. `indexByKey` itself, `compareRows`'s broader flow, matching algorithm, and classification logic are all unchanged — the fix is confined to which key-name array is passed into the target-side `indexByKey` call. | Root cause fix per TASK-BRIEF.md's Scope: "narrowly targeted at `indexByKey`'s `keyIndexes` computation ... using the `column_mapping` data it's already given ... matching how `compareMatchedRow` already handles this correctly elsewhere in the same file." |
| `packages/engine/src/comparison-core/row-level/row-level.test.ts` | Added a new `describe("T-28: key column named differently on source vs target", ...)` block with 3 cases (`sourceColumns = ["CustomerID", "Name"]`, `targetColumns = ["CUSTOMER_ID", "NAME"]`, non-identity `mapping`), asserting `keyValues` for a `missing-from-target` finding (source-side key resolution — was already correct, included for completeness), a `missing-from-source` finding (target-side key resolution — the actual bug), and a `matching` finding (both sides resolved and joined correctly). | Red-state evidence + regression coverage, per TASK-BRIEF.md's Red-state evidence section. |
| `packages/engine/src/orchestration/planner/planner.test.ts` | Added `ROW_LEVEL_KEY_MAPPING_YAML` (a new definition-YAML fixture using the genuine, non-identity `CustomerID: CUSTOMER_ID` mapping — the real `sqlserver-customer` target column name, unlike the existing `ROW_LEVEL_ONLY_YAML` fixture's identity `CustomerID: CustomerID`, which does not even match the real fixture's target column name) and one new test asserting `rowDifferences[].keyValues` directly for `missing-from-target` (`[4]`), `matched-key-differing-values` (`[2]`), and every `duplicate-in-target` finding (`[5]`) — the fixture's three documented row-level mismatch facts (`packages/engine/fixtures/sqlserver-customer.ts`'s header comment). | End-to-end (planner-level, not just unit-level) coverage of the exact bug scenario, per TASK-BRIEF.md: "add or extend a `planner.test.ts` case using a non-identity `column_mapping` for the key column specifically ... and assert on the resulting `rowDifferences[].keyValues` field directly." |

No other files were touched. `packages/engine/src/orchestration/planner/planner.ts` was **not** modified — the bug is fully confined to `row-level.ts`'s own `indexByKey`/`compareRows`, and does not require any change at the planner call-site (planner.ts already passes `definition.keys` and `definition.columnMapping` through unchanged, which is exactly what the fixed `compareRows` needs).

## Behavior and interfaces

- **Behavior delivered:** `compareRows` now correctly translates each
  `keys`-declared key column name to its target-side name (via `mapping`)
  before indexing target-side rows, so every row-level finding's
  `keyValues` field contains the real key value on both sides, regardless
  of whether the key column is named identically or differently between
  source and target.
- **Interfaces consumed:** `ColumnMappingEntry` (read-only, from
  `orchestration/definition/definition.ts`) — no changes to its shape.
  `mappingSourceColumnName` (this file's own existing private helper,
  reused rather than duplicated) is now also called from
  `resolveTargetKeyName`.
- **Interfaces produced:** None new. `RowDifference.keyValues`'s existing
  shape/contract is unchanged, per TASK-BRIEF.md's Interfaces section —
  this task fixes what value populates it, not its type.

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline (pre-change) | `npm run verify` | Exit 0 after removing a stray untracked `packages/extension/dist-bundle/` directory left over from a prior task's packaging run (see Assumptions below); 404 passed, 27 skipped, 431 total | Command output captured directly in this session |
| Red state — focused unit test | `npx vitest run packages/engine/src/comparison-core/row-level` | 2 of 11 tests failed before the fix: `expected [ undefined ] to deeply equal [ 2 ]` (missing-from-source case) and a length mismatch on the matched-pair case (target-side key resolved to a *different* key text than source, so the pair was misclassified as split missing-from-target/missing-from-source instead of matching) — reproduces the exact reported bug | Command output captured directly in this session |
| Red state — planner-level test | `npx vitest run packages/engine/src/orchestration/planner -t "genuinely different name"` (run against `row-level.ts` stashed back to its pre-fix state) | Failed: `expected [ 1 ] to deeply equal [ 4 ]` for the `missing-from-target` assertion — confirms the planner-level test is genuine, discriminating coverage, not accidentally passing | Command output captured directly in this session |
| Focused green state | `npx vitest run packages/engine/src/comparison-core/row-level` | 11/11 passed | Command output captured directly in this session |
| Focused green state (planner) | `npx vitest run packages/engine/src/orchestration/planner` | 9/9 passed | Command output captured directly in this session |
| Full verification | `npm run verify` | Exit 0. `408 passed`, `27 skipped` (`435` total) — 4 more passing tests than the 404-test baseline (3 new in `row-level.test.ts`, 1 new in `planner.test.ts`), no regressions | Command output captured directly in this session |
| End-to-end: packaged `.vsix` rebuild | `npm run package` (inside `packages/extension`) | Succeeded: `Packaged: .../paritylens-0.0.1.vsix (19 files, 13.02 MB)` | Command output captured directly in this session |
| End-to-end: Node harness against the packaged bundle (post-fix) | Custom Node harness (see below) requiring `packages/extension/dist-bundle/extension.js` with a mocked `vscode` module, calling `activate()`, invoking the registered `paritylens.runComparison` command against a real `.paritylens` file with `column_mapping: {CustomerID: CUSTOMER_ID, CustomerName: CUSTOMER_NAME}` | `Occurrences of the literal text 'undefined' in rendered HTML: 0`; real key values `2` and `4` present in the rendered results-webview HTML; harness printed `PASS` | Command output captured directly in this session |
| End-to-end: Node harness against the pre-fix bundle (discriminating-red proof) | Same harness, run against a bundle rebuilt with `row-level.ts` `git stash`ed back to its pre-fix state | `Occurrences of the literal text 'undefined' in rendered HTML: 7` — harness printed `FAIL`, with visible `<td>undefined</td>` rows in the captured HTML context | Command output captured directly in this session |
| Sandbox install | `code --user-data-dir <fresh tmp dir> --extensions-dir <fresh tmp dir> --install-extension paritylens-0.0.1.vsix` | `Extension 'paritylens-0.0.1.vsix' was successfully installed.` | Command output captured directly in this session |

## Assumptions and risks

- **Assumption (judgment call):** `keys` is documented (this file's own
  header comment, T-14's original design) as being in *source-side*
  naming, matching the YAML `keys:` example and `planner.ts`'s
  `definition.keys` pass-through. This fix assumes that documented
  convention is correct and translates from source-side `keys` to
  target-side names via `mapping`, never the reverse — consistent with
  `compareMatchedRow`'s existing direction (`mappingSourceColumnName(entry)`
  for the source side, `entry.target` for the target side).
- **Judgment call — key column not present in `mapping`:** if a key
  column's name is never listed in `column_mapping` at all (the common
  case where the key column happens to be named identically on both
  sides, so no mapping entry is needed), `resolveTargetKeyName` falls back
  to returning the source-side name unchanged. This preserves every
  existing test's and caller's behavior (all of which omit the key column
  from `mapping` and rely on identical naming) and does not change
  behavior for any row-level scenario that isn't the specific bug this
  task fixes.
- **Pre-existing, unrelated build/lint hazard encountered (not caused by
  this task):** at session start, an untracked
  `packages/extension/dist-bundle/` directory (left over from a prior
  packaging run) was already present in the working tree. This is
  `T-27-01` (`PROGRESS-LEDGER.md`, already recorded as an OPEN,
  accepted-non-blocking Important finding from T-27's review): the
  generated bundle isn't in `eslint.config.mjs`'s `ignores` list, so `npm
  run verify` false-fails on 221 lint errors against the *minified build
  output*, not source. `eslint.config.mjs` is outside this task's file
  ownership (only `row-level.ts`, `row-level.test.ts`, `planner.test.ts`
  are owned), so it was not edited. I deleted the stray `dist-bundle/`
  directory to get a clean baseline read, ran `npm run verify` cleanly
  throughout implementation, and deleted the newly-rebuilt `dist-bundle/`
  and `.vsix` again at the end so the final `npm run verify` (reported
  above, exit 0) reflects the same clean state. Both `dist-bundle/` and
  `*.vsix` are already `.gitignore`'d and were never staged.
- **End-to-end verification method, disclosed plainly:** no GUI automation
  tool is available in this environment to click through a real
  interactive VS Code window (same limitation T-26/T-27 disclosed). I
  built a from-scratch Node harness (no reusable harness existed —
  T-27's was deleted per that task's own cleanup instruction) that mocks
  the `vscode` module, `require()`s the actual packaged
  `dist-bundle/extension.js`, calls the real exported `activate()`,
  captures the real `vscode.commands.registerCommand("paritylens.runComparison", ...)`
  callback, and invokes it against a real `.paritylens` file on disk
  (mocking only `showOpenDialog` to point at that file — every other step,
  including `readFile`, `parseDefinition`, `runComparison`, and
  `showResultsWebview`'s HTML generation, runs for real). I additionally
  proved this harness is genuinely discriminating (not merely passing by
  construction) by rebuilding the bundle from a `git stash`-reverted,
  pre-fix `row-level.ts` and confirming the same harness fails red (7
  occurrences of literal `"undefined"` in the rendered HTML) before
  restoring the fix and rebuilding. I also confirmed the real `code` CLI
  is available in this environment and used it to install the freshly
  built `.vsix` into a brand-new sandbox user-data/extensions directory,
  which succeeded — but I did not (and could not, absent a GUI automation
  tool) visually confirm the results webview inside an actual running VS
  Code window with my own eyes. The Node-harness evidence is strong (it
  exercises the identical compiled bundle that ships in the `.vsix`,
  through the real command-registration and rendering path, not a proxy),
  but it is not the same as human visual confirmation — consistent with
  the gap T-26/T-27 already disclosed and that `PROGRESS-LEDGER.md` notes
  remains open pending the owner's own look.
- **Risks or limitations:** None known beyond the disclosed verification-method
  gap above. The fix is narrowly scoped (one new private helper, one
  changed line at the `indexByKey` call site) and does not alter
  `indexByKey`'s own signature, `compareMatchedRow`, or any exported
  interface.
- **Blockers:** None.

## Patch or commit identity

- **Branch:** `task/T-28-row-level-key-mapping`
- **Commit:** see the commit immediately following this report's addition
  to the branch (this report is committed together with the code and test
  changes it describes, in the same commit, per this project's established
  pattern for prior single-session task reports).

## Recommended next step

Independent review by a separate `reviewer` subagent instance, per
TASK-BRIEF.md's Handoff section — including the reviewer's own
adversarial test case(s) (e.g. a composite key with only one differing
key-column name, or a `column_mapping` that maps the key column to a
target name that doesn't exist in the target's actual columns at all) and
the reviewer's own from-scratch re-verification of the packaged `.vsix`,
rather than trusting this report's manual re-check alone. This task does
not self-approve and is not itself a release-readiness or human-approval
event.
