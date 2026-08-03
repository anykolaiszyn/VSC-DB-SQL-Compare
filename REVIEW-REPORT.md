# REVIEW-REPORT.md — T-35a: `ParitySide`/planner support for query & sqlFile kinds

## Review independence statement

This review was performed by a separate reviewer agent instance from
whoever implemented T-35a, with no memory of writing the implementation.
All findings below come from independently reading the actual diff and
source on `task/T-35a-parityside-query-kinds`, independently re-running
verification commands, and independently constructing adversarial test
probes — not from trusting `IMPLEMENTATION-REPORT.md`'s claims at face
value. Every claim in the report that could be checked was re-derived or
reproduced directly.

## Scope reviewed

- `packages/engine/src/orchestration/definition/definition.ts` (+ `.test.ts`)
- `packages/engine/src/orchestration/planner/planner.ts` (+ `.test.ts`)
- `git diff --stat main..task/T-35a-parityside-query-kinds` (full diff, all files)
- Fresh `npm run verify`, isolated `npx vitest run packages/engine`
- Independent backward-compatibility diff script (main's `parseSide` vs
  branch's `parseSide` against real fixture-shaped YAML)
- Independent adversarial containment probes against `resolveSideInput`
  (7 cases, run as a throwaway vitest file, deleted after use)

## Findings

### Critical

NONE.

### Important

NONE.

### Minor

| ID | Finding | Evidence | Suggested resolution |
| --- | --- | --- | --- |
| T-35a-01 | `resolveSideInput` is called twice for the same `ParitySide` within a single `runComparison` run when both `rowCount` and (`schema` or `profile`) checks are enabled (once at planner.ts:245-246 for schema/profile, again at planner.ts:297-298 for row-count). For a `sqlFile`-kind side this means the file is read from disk twice per run instead of once. Not a correctness bug (the second read produces the same content, barring a concurrent external edit to the file mid-run, which is an inherent TOCTOU characteristic of reading any file twice, not something this task introduces) and not a security issue since the containment check is enforced identically both times. It is a minor and disclosed-adjacent inefficiency — the implementation report's Judgment call 2 explicitly reasons about avoiding a *double read within `runProfileChecks`* but does not mention the separate row-count resolution also duplicating the schema/profile resolution above it. | `planner.ts` lines 245-246 vs 297-298; confirmed by reading, not merely inferred | Non-blocking. A future task (row-count/row-level consolidation, or T-35b if convenient) could hoist a single `resolveSideInput` call per side to the top of `runComparison` and thread it to all four check families. Low priority since no current caller uses `sqlFile`-kind input in production. |

## Verification performed

### Fresh full verification (`npm run verify`)

Reproduced independently, exact output:

- `npm run typecheck` → **exit 1**, exactly one error:
  `packages/extension/src/authoring/buildComparisonYaml.test.ts(59,26): error TS2339: Property 'where' does not exist on type 'ParitySide'.` — matches the report's disclosure precisely (same file, same line, same error).
- `npm run lint` → exit 0, no output.
- `npx vitest run` (all workspaces) → **2 files failed / 26 passed / 2 skipped** (30 total); **3 tests failed / 496 passed / 27 skipped** (526 total). All 3 failures confirmed to be in `packages/extension`:
  - `buildComparisonYaml.test.ts` — 2 failures, both `toEqual` deep-equality mismatches caused solely by the new `kind: "table"` field appearing in the parsed `ParitySide` (diff output shows `+ "kind": "table",` as the only delta in each case).
  - `newComparisonWizard.test.ts` — 1 failure, same root cause (`+ kind: 'table'` in the diff).
  - No failures anywhere in `packages/engine`.

This matches the implementation report's Full verification row exactly (same counts, same files, same root cause).

### `packages/engine` in isolation

`npx vitest run packages/engine` → **14 files passed, 2 skipped (integration, no test containers); 389 tests passed, 27 skipped**. Matches the report's claimed 389/389 exactly. Confirms `packages/engine` itself is fully green and the extension break is genuinely isolated to `packages/extension`.

### Independent backward-compatibility check (Handoff item 1)

Not satisfied with the report's description alone. Extracted `definition.ts` at `main` and at the task branch into standalone bundles (via `esbuild`, `yaml` dependency vendored locally) and parsed two real fixture-shaped YAML documents with each:

1. The Idea Prompt.md section 7 worked example verbatim (as reproduced in `definition.test.ts`'s own "worked example" describe block) — has a `where` clause on both sides, no `kind` field.
2. A minimal source/target pair with no `where` clause, no `kind` field (matching the shape used throughout the pre-existing `buildComparisonYaml`/`newComparisonWizard` extension tests).

Result for both samples: `branch.source` and `branch.target` are **byte-for-byte equal to `main.source`/`main.target` plus exactly one added field, `kind: "table"`** — no other field changed, none dropped, no reordering-sensitive issue (deep-equal, not string-equal, was used, so key order is irrelevant). This is a real, reproduced diff, not a restatement of the report's claim. Confirms the single most important regression guard in this task holds against genuine fixture-shaped input, not just the implementer's own new test cases.

### Independent adversarial `baseDir` containment probes (Handoff item 2)

`planner.test.ts` already covers: `../` traversal, an absolute path outside `baseDir`, and a sibling-directory-prefix bypass (`baseDir` vs `baseDir-evil`) — matching the brief's "at minimum" list.

Beyond those, constructed and ran 7 additional adversarial probes as a throwaway test file (`packages/engine/src/orchestration/planner/__adversarial-review-probe.test.ts`, deleted after the run; `git status` confirms clean working tree with no residue):

1. Backslash-traversal (`..\outside.sql`) — **rejected** (`SqlFilePathEscapesBaseDirError`).
2. Mixed-slash traversal (`sub/../../outside.sql`) — **rejected**.
3. `filePath: "."` (baseDir itself, a directory not a file) — **rejected** (throws; does not silently "succeed" against a directory read).
4. Sibling-prefix bypass constructed with backslash separators (`..\<baseDirName>-evil\x.sql`) — **rejected**.
5. Windows drive-absolute escape (`C:\Windows\win.ini`) — **rejected**.
6. Negative control: legitimate nested subdirectory access (`a/b/q.sql` under `baseDir`) — **succeeds**, returns the file's contents as expected (confirms the check isn't overly strict/broken).
7. Sibling-prefix bypass with no separator between the base name and the suffix (`../<baseDirName>Evil/x.sql`) — **rejected**.

All 7 passed as expected (6 correctly rejected, 1 correctly allowed). `resolveSideInput`'s `path.relative`-based containment check (`rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)`, computed after `path.resolve`, which normalizes both `/` and `\` on Windows and collapses `..` segments) holds against every adversarial variant constructed independently of the implementer's own test suite, including the Windows-specific backslash and drive-absolute cases the brief's Handoff note specifically asked for.

### No `sqlFile`-kind reaches a connector directly (Handoff item 3)

Grepped `planner.ts` for every `.getSchema(`/`.executeQuery(` call site:

- `planner.ts:247-248` — `source.getSchema(sourceInput)` / `target.getSchema(targetInput)`, where `sourceInput`/`targetInput` are assigned at lines 245-246 exclusively via `await resolveSideInput(definition.source/target, baseDir)`.
- `planner.ts:453` — `connector.executeQuery({ kind: "query", sql }, executionOptions)`, where `sql` is `await buildFetchAllRowsSql(connector, side, baseDir)` (line 443), and `buildFetchAllRowsSql` itself routes `query`/`sqlFile`-kind sides through `resolveSideInput` (line 407) before ever touching a connector.

Also confirmed `profiling.ts`'s `profileColumn`/`buildProfileQueries` and `volume.ts`'s `compareVolume`/`buildRowCountSql` all take `QueryInput` (never `ParitySide`) as their parameter type, and every call site in `planner.ts` passes only the already-resolved `sourceInput`/`targetInput`/`rowCountSourceInput`/`rowCountTargetInput` (all products of `resolveSideInput`) into them — never a raw `ParitySide`. No code path exists where a `sqlFile`-kind `ParitySide` or a `{kind:"sqlFile"}` `QueryInput` could reach a connector method without first passing through `resolveSideInput`'s read-and-convert step.

### `buildFetchAllRowsSql`/`fetchAllRows` invariant (Handoff item 4)

Confirmed structurally, not just via the implementer's own test assertions: `fetchAllRows` (planner.ts:438-461) computes `const sql = await buildFetchAllRowsSql(connector, side, baseDir);` and then uses that exact same `sql` variable, unmodified, as the value passed to `connector.executeQuery({ kind: "query", sql }, ...)`. Since it is the literal same value (not reconstructed from `side` a second time), the previewed SQL (`buildFetchAllRowsSql`'s return value, which is what `queriesUsed` collects at lines 331-333) and the executed SQL are provably identical by construction, for all 3 kinds — the invariant does not depend on the two code paths happening to agree, there is only one code path. `planner.test.ts`'s three `T-35a: buildFetchAllRowsSql` tests independently confirm the string output is correct for each kind (byte-for-byte unchanged for `table`, correctly subquery-wrapped for `query`/`sqlFile`).

### File-ownership diff (Handoff item 5)

```
git diff --stat main..task/T-35a-parityside-query-kinds
 IMPLEMENTATION-REPORT.md                                              | 253 ++++-----------------
 packages/engine/src/orchestration/definition/definition.test.ts       | 167 ++++++++++++++
 packages/engine/src/orchestration/definition/definition.ts            | 121 +++++++++-
 packages/engine/src/orchestration/planner/planner.test.ts             | 221 +++++++++++++++++-
 packages/engine/src/orchestration/planner/planner.ts                  | 188 ++++++++++++---
 5 files changed, 696 insertions(+), 254 deletions(-)
```

Confirmed via a second, exclusion-based diff (`git diff --stat ... -- . ':!IMPLEMENTATION-REPORT.md' ':!definition.ts' ':!definition.test.ts' ':!planner.ts' ':!planner.test.ts'`) that returned **zero output** — i.e., no file outside the five declared files changed at all. Specifically confirmed nothing under `packages/extension/**`, `packages/shared/**`, `comparison-core/profiling/**` (or any other `comparison-core/**` path), or `connector-sdk/**` changed. No new module file was added (matches the report's "no new module was added" note; brief permitted but did not require one).

### `packages/extension` disclosure accuracy (Handoff item 6)

Reproduced independently (see Full verification above): `packages/extension` genuinely fails to typecheck (1 error, `buildComparisonYaml.test.ts:59`, `.where` access on the narrowed union) and genuinely fails 3 tests (2 in `buildComparisonYaml.test.ts`, 1 in `newComparisonWizard.test.ts`), all caused by the new required `kind` field appearing in strict `toEqual` assertions written before this task. Confirmed `activate.ts`'s sole `runComparison` call site (`packages/extension/src/activation/activate.ts:307`) passes exactly 2 arguments (`definition, registry`), which remains valid against the new 3rd-optional-parameter signature — so the report's claim that `activate.ts` itself needs no follow-up edit (only the two test files do, for an unrelated reason: the `kind` field, not the signature change) is accurate. The typecheck/test break is real, correctly isolated to `packages/extension`, and correctly attributed to `kind` being new on `ParitySide` rather than to any signature-compatibility problem. This is not a T-35a defect — the brief explicitly prohibits touching `packages/extension/**`, and the break is a mechanically forced, disclosed, and previously-anticipated consequence of widening a type this task was specifically scoped to widen.

## Disposition of prior findings this task was meant to resolve

None — T-35a is a new task (no `T-35a-*` findings existed prior to this review), and no `PROGRESS-LEDGER.md` finding was cited as required to close in `TASK-BRIEF.md`'s scope for this task.

## Overall assessment

- Backward compatibility: verified independently against real fixture-shaped YAML — exact match (branch = main + `kind: "table"`, nothing else).
- Security-relevant containment logic (`resolveSideInput`'s `baseDir` check): held against 7 independently constructed adversarial probes beyond the implementer's own 3, including the specific Windows backslash-traversal case the brief's Handoff note called out by name, plus a drive-absolute escape and multiple sibling-prefix bypass variants.
- No path exists where `sqlFile`-kind input reaches a connector without first being converted to `query`-kind by `resolveSideInput`.
- The `buildFetchAllRowsSql`/`fetchAllRows` preview-vs-executed invariant (T-16b's original stated property) is preserved by construction for all 3 kinds, not just `table`.
- File-ownership scope is exactly as declared — zero unauthorized file changes.
- The disclosed `packages/extension` typecheck/test break is real, correctly isolated, correctly attributed, and correctly left unfixed per the brief's explicit prohibition.
- One Minor finding (T-35a-01, a redundant double-resolution/double-file-read across check families within one run) — non-blocking, does not affect correctness or security, flagged for optional future cleanup.

## Approval status

**APPROVED**

0 Critical, 0 Important, 1 Minor (non-blocking, tracked as T-35a-01 for optional future follow-up). T-35b may proceed.
