# ParityLens — Review Report T-22

## Review independence statement

This review was performed by a separate reviewer agent instance from the
implementer that produced commit `8129fca` on branch
`task/T-22-engine-export-and-run-command` (based on `main` at `dab5db7`).
No claim in `IMPLEMENTATION-REPORT.md` was trusted at face value: every
factual claim (changed-file list, test counts, the "byte-for-byte
unchanged assertions" claim on `activate.test.ts`, the disclosure claims
about `showInformationMessage`/error handling) was independently
re-derived from the actual diff, the actual source, and a fresh `npm run
verify` run. A fresh set of adversarial probes was written from scratch
(not reusing the implementer's `runComparisonCommand.test.ts` fixtures or
wording) and executed directly against the exported `runComparisonCommand`
function. The probe file was deleted after use; `git status --porcelain`
confirmed zero residue beyond this report before finishing.

## Scope reviewed

- `TASK-BRIEF.md` (task authority, read in full)
- `IMPLEMENTATION-REPORT.md` (claims, read in full, treated as assertions to verify)
- `packages/engine/src/index.ts` (full diff read)
- `packages/engine/src/index.test.ts` (new file, read in full)
- `packages/extension/src/activation/activate.ts` (full diff read)
- `packages/extension/src/activation/activate.test.ts` (full diff read)
- `packages/extension/src/activation/runComparisonCommand.test.ts` (new file, read in full)
- `packages/extension/package.json` (full diff read)
- `packages/engine/src/orchestration/definition/definition.ts` (read relevant sections — `InvalidDefinitionError`, credential blocklist)
- `packages/engine/src/orchestration/planner/planner.ts` (read `UnresolvedConnectionError` definition and trigger condition)
- `packages/extension/src/webview/resultsWebview.ts` (read `showResultsWebview`'s exported signature to confirm wiring matches)
- `git diff main task/T-22-engine-export-and-run-command` (full diff and `--stat`)
- `PROGRESS-LEDGER.md` (current phase, T-22 row, open findings table)

## Findings

### Critical

NONE.

### Important

NONE.

### Minor

| ID | Description | Evidence | Suggested resolution |
| --- | --- | --- | --- |
| T-22-01 | `UnresolvedConnectionError` can never actually be thrown by this command's own registry construction. `buildFixtureRegistry(sourceConnectionName, targetConnectionName)` unconditionally registers a `FixtureConnector` under *whatever* connection-name strings the parsed definition contains (`activate.ts`, `buildFixtureRegistry`), so `runComparison`'s internal registry lookup (`planner.ts`, `UnresolvedConnectionError` thrown only when `connectors.get(name)` misses) can never miss for this specific caller. The brief's reviewer note asks to construct "a YAML definition referencing an unregistered connection name" and confirm it surfaces cleanly — that literal scenario is unreachable through this command as designed; the implementer's own 4th test (`runComparisonCommand.test.ts`, "surfaces UnresolvedConnectionError-shaped failures") and my own probe 5 below actually exercise the generic catch-all path via an unknown fixture *table*, not an unresolved *connection name*. The generic `catch` block still handles the (unreachable) case defensively, so this is not a functional gap — just a design property worth naming plainly, since the report and the brief both talk about testing "an unregistered connection name" as if it were a live code path here. | `packages/extension/src/activation/activate.ts` `buildFixtureRegistry` (registers both parsed names unconditionally); `packages/engine/src/orchestration/planner/planner.ts` `UnresolvedConnectionError` (thrown only on registry miss); confirmed via my own independent probe (see Verification §2, probe 5) that an arbitrary/unregistered-sounding connection name still resolves and produces a successful result with `showErrorMessage` never called | Non-blocking. Correct the report/brief-adjacent framing (in a future revision or the ledger note) to say the reachable error path is "any error `runComparison` throws" (e.g. unknown fixture table), not literally "an unresolved connection name" — or, if a genuinely unresolvable-connection scenario is wanted for test coverage, have `buildFixtureRegistry` only register a fixed, smaller set of known names so a definition using an unexpected third name would miss. Not required for approval since the catch-all error handling is still correct and complete. |

## Verification performed

### 1. Fresh `npm run verify`

Ran independently on the task branch (`task/T-22-engine-export-and-run-command`, already checked out, working tree clean before and after):

```
$ npm run verify
> tsc -b --force        (exit 0, no errors)
> eslint .               (exit 0, no errors)
> vitest run
 Test Files  22 passed | 2 skipped (24)
      Tests  404 passed | 27 skipped (431)
```

Matches the report's claimed **404 passed / 27 skipped (22 test files
passed / 2 skipped), exit 0** exactly. Skip count (27) is the pre-existing
SQL Server (13) / PostgreSQL (14) live-container integration suites,
untouched by this task.

**Arithmetic re-derivation:** brief's own baseline is 396 passed (as of
T-16b/T-21). New tests added by this branch: `packages/engine/src/index.test.ts`
has 4 `it(...)` blocks (confirmed by reading the file);
`packages/extension/src/activation/runComparisonCommand.test.ts` has 4
`it(...)` blocks (confirmed by reading the file). 396 + 4 + 4 = 404,
matching the observed total exactly. `activate.test.ts` still has exactly
3 tests (unchanged count, only its mock factory was extended) — confirmed
by reading the file and by the vitest output line
`activate.test.ts (3 tests)`.

### 2. Adversarial probing — independent probe file, not reusing the implementer's tests

Wrote a fresh throwaway test file
(`packages/extension/src/activation/reviewer-probe.test.ts`, deleted after
use) importing the real exported `runComparisonCommand` function directly,
using YAML payloads and assertions distinct from
`runComparisonCommand.test.ts`. All 5 probes passed:

1. **Totally garbage non-YAML text** (`"\t: : :\nnot: [valid\n  - - -"`) →
   no throw escaped `runComparisonCommand` (caught in my own test's
   `try`/`catch`, `threw` stayed `false`); `result` was `undefined`;
   `showErrorMessage` called exactly once. Confirms the malformed-YAML
   case works for YAML syntactically broken in a different way than the
   implementer's own `MALFORMED_YAML` fixture (implementer used an
   unclosed `[`; I used stray colons/dashes).
2. **Empty `{}` document** (missing every required field, not just
   syntactically odd) → same clean result: no throw, `showErrorMessage`
   called once, `result` undefined.
3. **Credential-shaped field injection** (`password: hunter2` nested under
   `source`) — probing `definition.ts`'s existing credential blocklist
   through this specific command path, a case neither the implementer's
   report nor its tests mention → correctly rejected as an
   `InvalidDefinitionError`, surfaced cleanly via `showErrorMessage`, no
   throw escaped, no silent bypass.
4. **Fixture-only disclosure fires even on a failing run** — confirmed
   `showInformationMessage` is called before `parseDefinition` even runs
   (it's the first statement inside the `try` block in `activate.ts`), so
   the notice is genuinely unconditional, not gated on a successful parse
   or a successful comparison. This directly answers reviewer-note item
   (4): the disclosure is real, user-visible, on every invocation
   including failing ones — not just a code comment.
5. **Unregistered-sounding connection names** (`totally-made-up-name-xyz`
   / `another-made-up-name-abc`) → produced a **successful** result
   (`result` defined, `showErrorMessage` never called), confirming finding
   T-22-01 above: `UnresolvedConnectionError` is structurally unreachable
   through this command's own registry-building logic, since
   `buildFixtureRegistry` always registers whatever names are present.

```
$ npx vitest run packages/extension/src/activation/reviewer-probe.test.ts
 ✓ packages/extension/src/activation/reviewer-probe.test.ts (5 tests)
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

Probe file deleted immediately after this run; confirmed via
`git status --porcelain` (empty output) that no residue remained.

### 3. Scope discipline check

```
$ git diff main task/T-22-engine-export-and-run-command --stat
IMPLEMENTATION-REPORT.md                            | 321 ++++++++-----------
packages/engine/src/index.test.ts                   |  41 +++
packages/engine/src/index.ts                        |  27 +-
packages/extension/package.json                     |   8 +-
packages/extension/src/activation/activate.test.ts  |  14 +-
packages/extension/src/activation/activate.ts       | 166 ++++++++++-
.../src/activation/runComparisonCommand.test.ts     | 171 +++++++++++
```

- `packages/engine/src/index.ts`: confirmed the entire diff is `export *
  from "./orchestration/definition/definition.js"` /
  `"./orchestration/planner/planner.js"` /
  `"./connector-sdk/fixture/fixture-connector.js"` plus header-comment
  prose. No new logic, no re-implementation, no wrapper functions — a
  genuine re-export-only file, matching `packages/shared/src/index.ts`'s
  precedent as required. All four hard-required symbols
  (`parseDefinition`, `runComparison`, `ConnectorRegistry`,
  `FixtureConnector`) plus `InvalidDefinitionError`/
  `UnresolvedConnectionError` are exported via the wildcard re-exports —
  confirmed directly importable via `packages/engine/src/index.test.ts`,
  which I re-ran independently (passes).
- `packages/extension/package.json`: diff is confined to inserting one
  object into the `contributes.commands` array; `activationEvents`,
  `contributes.views`, and every other field are untouched (confirmed by
  reading the full diff, not just the stat).
- `packages/extension/src/activation/activate.ts`: extends T-10's
  ownership as authorized. Confirmed the pre-existing `treeDataProvider`/
  `treeView`/`secretStore` construction lines inside `activate()` are
  byte-for-byte unchanged (grepped the diff for those identifiers — only
  comment-prose lines around them changed); the only body change is two
  added lines (`registerRunComparisonCommand()` call and
  `context.subscriptions.push(...)`) plus new top-level functions
  (`buildFixtureRegistry`, `runComparisonCommand`,
  `registerRunComparisonCommand`) and two new exported constants. No
  restructuring of the tree-view/SecretStore wiring occurred.
- `packages/extension/src/activation/activate.test.ts`: **not** in the
  brief's declared "Files owned" list, but the implementer disclosed this
  as a forced minimal edit. I read the full diff directly rather than
  trusting the disclosure: the only change is two new keys added to the
  `vi.mock("vscode", ...)` factory's returned object
  (`commands: { registerCommand }`, `workspace: { workspaceFolders:
  undefined }`) plus a new comment explaining why. All three pre-existing
  `it(...)` test bodies and their assertions are textually identical to
  `main` — confirmed by diff inspection, not by trusting the report's
  "byte-for-byte unchanged" claim. This is a minimal, mechanically-forced
  consequence of `activate()` now calling `vscode.commands.registerCommand`
  at module-body-execution time (the mock previously had no `commands`
  key, so any test importing `activate.ts` would fail with `No "commands"
  export is defined on the "vscode" mock` even before assertions run) —
  judged an acceptable, correctly-disclosed minimal edit, not a scope
  violation.
- No file inside `packages/engine/src/comparison-core/**`,
  `packages/engine/src/connector-sdk/**` (beyond the authorized read-only
  import), `packages/engine/src/orchestration/**` (beyond the authorized
  read-only import), `packages/extension/src/webview/**`,
  `packages/extension/src/export/**`, or `packages/extension/src/views/**`
  was touched — confirmed by the `--stat` output above; none of those
  paths appear.
- `IMPLEMENTATION-REPORT.md` is the only file touched outside the three
  owned paths besides the disclosed `activate.test.ts` mock edit, which is
  explicitly permitted.

### 4. Wiring correctness — `showResultsWebview` signature match

Read `packages/extension/src/webview/resultsWebview.ts`'s exported
`showResultsWebview(createWebviewPanel, viewColumn, result)` signature
directly and compared it against `runComparisonCommand`'s call site in
`activate.ts` (`showResultsWebview(deps.createWebviewPanel, deps.viewColumn,
result)`) — parameter order and types match exactly. No shape mismatch,
consistent with the brief's own pre-confirmed integration probe.

### 5. Fixture-only disclosure — code-comment vs. runtime-visible check

Confirmed `FIXTURE_ONLY_NOTICE` is a real runtime string shown via
`deps.showInformationMessage(FIXTURE_ONLY_NOTICE)` as the **first**
statement inside `runComparisonCommand`'s `try` block (before
`parseDefinition` is even called) — not merely a header comment. Verified
independently via probe 4 above that this fires even when the subsequent
parse fails. This satisfies reviewer-note item (4).

## Disposition of prior findings

None apply to T-22 — `PROGRESS-LEDGER.md`'s Open Findings table (as of the
`dab5db7` baseline this branch is built on) contains no finding routed to
T-22; this is the task's first review round and it is a bounded
integration-remediation task, not a fix for a previously flagged defect.

## Adversarial probe residue check

```
$ git status --porcelain
```

returned no output (clean) after deleting the throwaway probe file
(`packages/extension/src/activation/reviewer-probe.test.ts`) created and
used during this review — confirmed no residue beyond this report. (Note:
an unrelated stray untracked file with the same name, left over from a
different prior session/attempt and containing unrelated content, was
found and removed before writing my own probe — confirmed via `git status`
that it was untracked and not part of the T-22 branch; this is disclosed
for transparency, not because it reflects on the implementer's work.)

## Final disposition

**APPROVED.**

Rationale: this is a low-risk, purely additive wiring task, and every one
of the brief's own four reviewer-note risk items was independently
confirmed rather than trusted:

1. **Scope discipline** — confirmed via direct diff inspection: only the
   three declared owned paths were touched with logic changes, plus the
   correctly-disclosed and independently-verified minimal
   `activate.test.ts` mock-only edit (assertions unchanged).
2. **`packages/engine/src/index.ts` is genuinely re-export-only** —
   confirmed by reading the full diff; three `export * from` statements
   and a header comment, no new logic.
3. **Error handling** — confirmed via 5 independent adversarial probes
   (garbage YAML, empty object, credential-injection attempt, and two more
   beyond what the implementer tested) that every failure path produces a
   clean `showErrorMessage` call, never an unhandled rejection or crash.
   One Minor finding (T-22-01) notes that the specific "unregistered
   connection name" scenario the brief's reviewer note describes is
   structurally unreachable through this command's own registry
   construction — not a defect, since the generic catch-all still handles
   it correctly, but a framing correction worth tracking.
4. **Fixture-only disclosure** — confirmed genuinely user-visible at
   runtime via `showInformationMessage`, fired unconditionally
   (independently verified to fire even on a failing run), not just a code
   comment.

`npm run verify` independently reproduces 404 passed / 27 skipped / exit 0
exactly as claimed, with test-count arithmetic re-derived and matching.
The one Minor finding (T-22-01) is non-blocking, does not weaken any
safety property, and does not violate the brief.
