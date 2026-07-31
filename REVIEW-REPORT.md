# ParityLens — Review Report T-15

## Review independence statement

This review was performed by a fresh reviewer instance with no memory of
implementing T-15. All findings below come from reading the actual diff and
current source on `task/T-15-orchestration-phase2` (commit `724a514`, on top
of `main` at `65e3291`), re-running verification independently, and writing
and executing adversarial spy-connector tests that are **not** copies of the
implementer's own tests. `IMPLEMENTATION-REPORT.md`'s claims were treated as
assertions to verify, not evidence.

## Scope reviewed

- `packages/engine/src/orchestration/planner/planner.ts` (diff vs `main`)
- `packages/engine/src/orchestration/planner/planner.test.ts` (diff vs `main`)
- `IMPLEMENTATION-REPORT.md`
- `TASK-BRIEF.md` (sole authority for scope/interfaces)
- Supporting reads: `packages/engine/src/comparison-core/volume/volume.ts`
  (`evaluateTolerance`), `packages/engine/src/orchestration/definition/definition.ts`
  (`ParityChecks.rowCount.tolerance` shape), `packages/engine/fixtures/sqlserver-customer.ts`
  (fixture row-count facts), `packages/shared/src/connector.ts` /
  `packages/shared/src/types.ts` (`DataPlatformConnector`, `RecordBatch`,
  `ExecutionOptions`), `PROGRESS-LEDGER.md` (T-13-01/T-14-02 carried-forward
  findings).

## Findings

### Critical

NONE.

### Important

NONE.

### Minor

| ID | Description | Evidence | Resolution |
| --- | --- | --- | --- |
| T-15-01 | `IMPLEMENTATION-REPORT.md`'s "Patch or commit identity" section cites commit `70e1fa29045269b2539454201818d3bca70fdbad` as the T-15 commit. That hash does not exist anywhere in this repository (`git log --all --oneline \| grep 70e1fa` returns nothing) and is not even a valid SHA-1 length (41 hex characters instead of 40). The actual commit is `724a514211589b0d278394a434806df2bc7bbc54` ("T-15: wire volume and row-level checks into runComparison (Phase 2)"). | `git show --stat 724a514` confirms the real commit; `git log --all --oneline` confirms no `70e1fa2...` commit exists. | Cosmetic/report-accuracy only — does not affect code correctness, does not misstate a requirement, and does not match the pattern this project's history treats as serious (T-07's I-02: a paraphrase that silently dropped a real requirement). Track as a report-hygiene note; no code change required. Does not block approval. |

## Verification performed

### Fresh full verification (independent re-run)

```
npm run verify
```

Result: `tsc -b --force` clean, `eslint .` clean, `vitest run` →
**Test Files 17 passed (17)**, **Tests 350 passed (350)**, shell exit code
`0`. This matches `IMPLEMENTATION-REPORT.md`'s claimed 350/350 exactly — no
discrepancy.

### Scope check

```
git diff main..task/T-15-orchestration-phase2 --name-only
```
→ `IMPLEMENTATION-REPORT.md`, `packages/engine/src/orchestration/planner/planner.test.ts`,
`packages/engine/src/orchestration/planner/planner.ts`. Confirmed via a
second targeted diff that **zero** changes exist under
`comparison-core/volume/**`, `comparison-core/row-level/**`,
`comparison-core/mapping/**`, `comparison-core/normalization/**`,
`orchestration/definition/definition.ts`, `packages/shared/src/result.ts`,
or `packages/extension/**` — all in-bounds per the brief's Files
owned/Prohibited changes sections.

Read the full `planner.ts` diff line-by-line: T-09's Phase-1 code (steps
1-4 — connection resolution, Layer-1 connectivity short-circuit, schema
check, `runProfileChecks`) is untouched except for header-comment wording.
The only functional changes are: two new `if` blocks (steps 5/6) inserted
between the existing profile-check block and the final result assembly; the
`allFindings` array literal extended with `...aggregateDifferences,
...rowDifferences`; the returned object's `rowCounts`/`aggregateDifferences`/
`rowDifferences` fields switched from T-09's hardcoded empty literals to the
new local variables; two new private helpers (`fetchAllRows`,
`DEFAULT_ROW_LEVEL_MAX_ROWS`/`DEFAULT_ROW_LEVEL_TIMEOUT_MS` constants)
appended after the function. `summarizeFindings`/`deriveStatus` themselves
are byte-for-byte unchanged — Phase-2 findings flow through the same
severity-bucket logic Phase-1 findings already used, not a duplicate/parallel
computation.

### Adversarial probe 1 — no silent execution (independently constructed, not reusing implementer's tests)

Built a spy `DataPlatformConnector` implementation recording every
`executeQuery` call (input + options), registered via a fresh
`ConnectorRegistry`, and ran `runComparison` against three definitions:

- Both `row_count.enabled: false` and `row_level.enabled: false`: **zero**
  `executeQuery` calls on either connector. `rowCounts` = `{source:0,
  target:0, difference:0}`, `aggregateDifferences` = `[]`, `rowDifferences`
  = `[]` — exact Phase-1 defaults, confirmed.
- Only `row_count.enabled: true`: exactly **one** `executeQuery` call per
  side, SQL contains `COUNT` and does **not** match `/SELECT\s+\*/` —
  confirms no row-fetch query fires when row-level is disabled.
- Only `row_level.enabled: true`: exactly **one** `executeQuery` call per
  side, SQL matches `/SELECT\s+\*/` and does **not** contain `COUNT` —
  confirms no count query fires when row-count is disabled; `rowCounts`/
  `aggregateDifferences` stayed at Phase-1 defaults as expected.

All 3 assertions passed on first correct run (an initial run had a bug in my
own test's mock — an empty row-batch array caused `compareVolume`'s
"returned no rows" guard to legitimately throw; fixed by yielding a count
row, which is a defect in my probe, not the implementation).

### Adversarial probe 2 — error propagation

Constructed a spy connector whose `executeQuery` throws before yielding any
batch, for both the row-count path and the row-level path independently.
Confirmed via `await expect(runComparison(...)).rejects.toThrow(...)` that:

- A throw inside `compareVolume`'s underlying query (row-count enabled)
  propagates as a rejected `runComparison` promise — not swallowed, not
  converted to a `"failed"`-status result.
- A throw inside `fetchAllRows`'s underlying query (row-level enabled)
  propagates identically.

This matches what the code actually does: `await compareVolume(...)` and
`await Promise.all([fetchAllRows(...), fetchAllRows(...)])` are both called
with no surrounding `try/catch` in `planner.ts`, so a rejection unwinds
`runComparison`'s returned promise directly, exactly as
`IMPLEMENTATION-REPORT.md` describes and exactly as the in-line comment at
the `compareVolume` call site (lines ~183-197 of `planner.ts`) documents.

**Judgment on reasonableness:** this is a deliberate, documented asymmetry
versus the Layer-1 connectivity short-circuit (which *does* catch a
connectivity failure and converts it to a `"failed"`-status result). The
brief explicitly left this unspecified and asked the reviewer to judge it,
not prescribe a particular answer. The chosen behavior is internally
consistent with T-09's own pre-existing precedent — the schema/profile
checks above steps 5/6 in the same function already have zero try/catch
around their `getSchema`/`profileColumn` calls, so a schema-check query
failure already propagates as an uncaught rejection today. Extending that
same "let it throw" behavior to volume/row-level, while reserving the
catch-and-report pattern specifically for the Layer-1 "can we even connect"
question (which Idea Prompt.md's own design language frames as "a basic
execution status" fact rather than an error), is a reasonable and
internally consistent choice, not an inconsistency. It is documented both
in the code comment and in the report's Assumptions/Risks section, satisfying
the brief's "not unspecified-and-silent" bar. Noting for awareness (not a
finding): any future task wiring `runComparison` into a UI-facing async
context (T-16, the webview) will need its own try/catch around the
`runComparison` call to convert a Phase-2 query failure into a user-visible
error state, since `runComparison` itself will reject rather than resolve
with a `"failed"` result in that case. This is not T-15's problem to solve
and is not required scope here — flagging only as consumer guidance.

### Adversarial probe 3 — T-13-01 resolution verification

Read `volume.ts`'s `evaluateTolerance` directly (lines 148-157):

```ts
function evaluateTolerance(difference, differenceRate, tolerance) {
  if (tolerance?.percentage !== undefined) {
    return Math.abs(differenceRate) > tolerance.percentage;
  }
  if (tolerance?.absolute !== undefined) {
    return Math.abs(difference) > tolerance.absolute;
  }
  return difference !== 0;
}
```

Confirmed independently: `percentage` is checked first and, if defined,
short-circuits the function — `absolute` is only ever consulted when
`percentage` is `undefined`. This matches the report's claim exactly
("percentage takes precedence whenever both are configured") — no
discrepancy found on re-derivation.

Confirmed the planner does **not** reimplement this logic: `planner.ts`
passes `definition.checks.rowCount?.tolerance` straight through as
`compareVolume`'s 5th positional argument, unmodified, with a comment at the
call site explaining the precedence rule for documentation purposes only —
no planner-side branching on `percentage`/`absolute` exists. Cross-checked
`definition.ts` lines 419-429: `ParityChecks.rowCount.tolerance` is parsed
as `{percentage?: number; absolute?: number}`, structurally identical to
`VolumeTolerance`, so the "passed straight through" claim holds — no
reshaping needed or performed.

### Adversarial probe 4 — status/summary folding for Phase-2-only findings

Constructed a definition with `schema.enabled: false`, `profile` absent
(defaults disabled), and only `row_count.enabled: true`, using a spy
connector forcing source count 10 / target count 20 (no tolerance
configured → any nonzero difference fails per `evaluateTolerance`'s
`difference !== 0` fallback). Result: `rowCounts` =
`{source:10,target:20,difference:10}`, **`status` = `"failed"`**,
**`summary.failed` >= 1**, `schemaDifferences` = `[]`, `profileDifferences`
= `[]`. This proves the new `aggregateDifferences`/`rowDifferences` spreads
into `allFindings` (planner.ts lines 244-249) are genuinely consumed by the
unmodified `summarizeFindings`/`deriveStatus` functions, not computed or
ignored separately.

### Fixture-fact cross-check

Verified `packages/engine/fixtures/sqlserver-customer.ts`'s header comment
independently states "source has 6 rows, target has 7 rows" and "CustomerID
4 exists in source but not target" — matching both the implementer's test
assertions (`{source:6,target:7,difference:1}`,
`category: "missing-from-target"`) and the fresh `npm run verify` pass.

## Disposition of prior/carried-forward findings

- **T-13-01** (Minor, "undocumented precedence when `tolerance` supplies
  both `percentage` and `absolute`"): **RESOLVED.** Verified against
  `volume.ts`'s actual `evaluateTolerance` source (not the report's
  characterization) that percentage wins when both are set, and confirmed
  the planner documents this at the call site without reimplementing or
  overriding it. `PROGRESS-LEDGER.md`'s T-13-01 row explicitly deferred
  this documentation step to T-15; that instruction is satisfied.
- **T-14-02** (Minor, already resolved inside `compareRows` per
  `PROGRESS-LEDGER.md`, "no action needed here beyond passing `rules`
  through"): confirmed `planner.ts`'s `compareRows` call passes
  `definition.rules` as the 5th argument, so the fallback
  (`options.numericTolerance?.[col] ?? rules[col]?.numericTolerance`)
  inside `row-level.ts` is reachable end-to-end. No `RowCompareOptions`
  object with a distinct `numericTolerance` map is constructed by the
  planner, which is correct — inventing one would have been unauthorized
  scope expansion per the brief's own "Do not implement a distinct
  informational-only row-count tolerance mode" caution applied by analogy.

## Scope and ownership check

All changed files fall within `packages/engine/src/orchestration/planner/**`
(this task's declared ownership) plus `IMPLEMENTATION-REPORT.md` (required
handoff artifact). No file under any prohibited path was touched. No
`AggregateDifference`/`RowDifference`/`SchemaDifference`/`ProfileDifference`
shape was modified in `packages/shared/src/result.ts` — confirmed via `git
diff` producing no output against that path. `packages/extension/**` is
untouched — confirmed. This task is genuinely integration-only, as required.

## Final approval status

**APPROVED**

Zero Critical or Important findings. One Minor finding (T-15-01, a
fabricated/incorrect commit hash in the report's metadata section) does not
block approval — it has no bearing on code correctness, test evidence, or
requirement fidelity, and is unlike the T-07 I-02 pattern this project
treats as serious (a paraphrase that silently drops a real requirement).
Fresh `npm run verify` independently reproduced the claimed 350/350 tests
passing with exit code 0. All five of the brief's "scrutinize hardest"
items were independently probed with reviewer-authored tests (not reused
from the implementer) and confirmed to behave exactly as claimed: no silent
execution for disabled checks, correct and reasonable (documented) error
propagation, an accurately verified T-13-01 resolution, correct
status/summary folding for Phase-2-only failures, and a clean scope
boundary with T-09's Phase-1 behavior functionally untouched.

No throwaway test files remain in the working tree — the reviewer's
adversarial probe file
(`packages/engine/src/orchestration/planner/__t15-review-probe.test.ts`)
was deleted after use; `git status` confirms a clean tree aside from this
report.
