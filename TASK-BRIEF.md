# ParityLens — Task Brief T-28

## Objective

Found during the prompt-07 Release step 5 live smoke test's third pass
(2026-08-02), after T-27's fix confirmed the extension is genuinely
functional end-to-end: the owner ran a real comparison against a
`.paritylens` definition using `keys: [CustomerID]` and a `column_mapping`
translating `CustomerID` (source) → `CUSTOMER_ID` (target) — i.e. the key
column has a genuinely different name on each side, the exact scenario
`column_mapping` exists to handle. Every row-level finding's `Key Values`
column showed `undefined` instead of the actual key value.

**Root cause, confirmed by direct inspection of
`packages/engine/src/comparison-core/row-level/row-level.ts`:**
`compareRows` (line ~144-145) calls `indexByKey` for both the source and
target row sets, passing the *same* `keys` array (source-side naming,
e.g. `["CustomerID"]`) to both calls:

```typescript
const sourceIndex = indexByKey(resolveRows(sourceRows), sourceColumns, keys);
const targetIndex = indexByKey(resolveRows(targetRows), targetColumns, keys);
```

`indexByKey` (line ~188) looks up each key name directly in the row set's
own `columns` array via `columns.indexOf(keyName)`, with no
`column_mapping` translation applied:

```typescript
function indexByKey(rows: unknown[][], columns: string[], keys: string[]): Map<string, IndexedRow[]> {
  const keyIndexes = keys.map((keyName) => columns.indexOf(keyName));
  ...
  const keyValues = keyIndexes.map((columnIndex) => (columnIndex >= 0 ? row[columnIndex] : undefined));
```

When `indexByKey` runs against `targetColumns` (which contains
`CUSTOMER_ID`, not `CustomerID`), `columns.indexOf("CustomerID")` returns
`-1`, so every target-side `keyValues` entry becomes `[undefined]`.
Row *matching* itself still worked correctly in this smoke-test run
(the classification — missing-from-target, duplicate-in-target — was
accurate), because matching happens via the JSON-stringified key text as
a Map key, and `compareMatchedRow` (for actually-matched rows) applies
`columnMapping` correctly elsewhere in the same file — **this bug is
narrowly confined to `indexByKey`'s own key-value lookup, not the whole
row-level comparison pipeline.** But every row-level finding's displayed
`Key Values` field is wrong (`[undefined]` instead of the real key) for
any row on the side where the key column's name differs from the
`keys` array's declared name.

**Why this was never caught before:** confirmed by reading every existing
test — `packages/engine/src/comparison-core/row-level/row-level.test.ts`
has no test scenario where the key column's name genuinely differs
between source and target rows (composite-key and other tests all use
identical column names on both row sets). `planner.test.ts`'s
`ROW_LEVEL_ONLY_YAML` fixture (the closest existing coverage) declares
`column_mapping: { CustomerID: CustomerID }` — an *identity* mapping,
same name both sides — not the doc's own real-world scenario
(`CustomerID` → `CUSTOMER_ID`, matching `sqlserver-customer`'s actual
fixture column names and `Idea Prompt.md`'s own worked example). The
existing planner test also only asserts a `missing-from-target` finding
*exists*, never inspects its `keyValues` field, so this bug would pass
silently there too.

## Scope

Fix `indexByKey`'s key-name resolution to correctly translate the key
column name for whichever side (source or target) it's indexing, using
the same `column_mapping` translation `compareMatchedRow` already applies
elsewhere in this file — investigate the exact translation direction and
helper function already in use (read the rest of `row-level.ts` first;
do not invent a second, parallel mapping mechanism) and reuse it rather
than writing new translation logic. The fix should be narrowly targeted
at `indexByKey`'s `keyIndexes` computation — do not restructure
`compareRows`'s broader flow, matching algorithm, or classification logic
beyond what's strictly necessary to correctly resolve each side's actual
key column index.

Add test coverage for the specific gap: a row-level comparison test where
the key column has a genuinely different name on source vs. target
(e.g. `CustomerID`/`CUSTOMER_ID`, matching the real-world scenario that
surfaced this), asserting the resulting `keyValues` field contains the
actual key value (not `undefined`) for findings on both the source and
target side. Also add or extend a `planner.test.ts` case using a
non-identity `column_mapping` for the key column specifically (not just
matching column names, unlike the existing `ROW_LEVEL_ONLY_YAML` fixture)
and assert on the resulting `rowDifferences[].keyValues` field directly,
not just that a finding of the right category exists.

## Dependencies

- **Required completed tasks:** NONE beyond what's already merged — this
  is a bug fix in existing, already-approved T-14 code (`row-level.ts`),
  found live via T-27's now-functional extension.
- **Required decisions or approvals:** NONE — straightforward bug fix
  with clear, already-diagnosed root cause.
- **Environment:** No WSL/Docker containers needed. Fixture-only.

## Files owned

- `packages/engine/src/comparison-core/row-level/row-level.ts`
  (T-14's owned file — this task extends it with a bounded, targeted fix)
- `packages/engine/src/comparison-core/row-level/row-level.test.ts`
- `packages/engine/src/orchestration/planner/planner.test.ts` (test-only
  addition/extension for the non-identity-key-mapping scenario — do not
  touch `planner.ts` itself unless the investigation reveals the bug
  actually needs a fix at that layer too; if so, stop and report rather
  than silently expanding scope)

Do not touch any other file. Do not modify
`packages/engine/src/comparison-core/mapping/**` or
`packages/engine/src/comparison-core/normalization/**` (T-12's owned
files) — reuse their exported functions if `row-level.ts` already imports
from them, do not reimplement anything from those modules.

## Interfaces

None new — `RowDifference.keyValues`'s existing shape/contract is
unchanged; this task fixes what value populates it, not its type.

## Prohibited changes

- Do not touch any file outside the three declared owned paths.
- Do not change `RowDifference`'s shape or any other exported interface.
- Do not "fix" this by changing `compareRows`'s call sites (e.g. in
  `planner.ts`) to pass already-translated column names — the correct
  fix is inside `indexByKey`'s own resolution logic, using the
  `column_mapping` data it's already given (or should be given) access
  to, matching how `compareMatchedRow` already handles this correctly
  elsewhere in the same file.
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Test to add:** a `row-level.test.ts` case using two `RecordBatch`es
  (or the bare-array form, whichever the file's existing tests prefer)
  where the key column is named differently on each side (mirroring
  `sqlserver-customer`'s real `CustomerID`/`CUSTOMER_ID` naming), with a
  `column_mapping` correctly declaring the key's translation. Assert the
  resulting findings' `keyValues` contain the real key value, not
  `undefined`. This test must fail against the current code before the
  fix (reproduce the exact live bug).
- **Command:** `npx vitest run packages/engine/src/comparison-core/row-level`
- **Expected failure reason:** `keyValues` currently resolves to
  `[undefined]` for the side whose column name differs from the `keys`
  array's declared name.

## Green-state and full verification

- **Focused command:** `npx vitest run packages/engine/src/comparison-core/row-level`
- **Full command:** `npm run verify`
- **Expected evidence:** the new test passes; all previously passing
  tests (404 as of T-27) still pass with no regression. `npm run verify`
  exits 0. Additionally, manually re-verify against the exact scenario
  that surfaced this live: rebuild the `.vsix`, install into a fresh
  sandbox, run `paritylens.runComparison` against a `.paritylens`
  definition using `CustomerID`→`CUSTOMER_ID` key mapping (the same
  `sqlserver-customer` fixture, `keys: [CustomerID]`,
  `column_mapping: {CustomerID: CUSTOMER_ID, ...}`), and confirm the
  results webview shows real key values (e.g. `1`, `2`, `3`) instead of
  `undefined`.

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md`
- **Independent reviewer:** `reviewer` subagent (separate instance from
  whichever `implementer` subagent does this task)
- **Review report location:** `REVIEW-REPORT.md`
- **Commit or patch checkpoint:** Branch `task/T-28-row-level-key-mapping`

**Note to reviewer:** independently construct your own adversarial case
distinct from the implementer's own test — e.g. a composite key where
only one of two key columns has a differing name, or a
`column_mapping` that maps the key column to a name that doesn't exist
in the target's actual columns at all (confirm this produces a sensible
error/finding rather than a different silent-`undefined` variant).
Confirm `compareMatchedRow`'s existing, already-correct column-mapping
usage elsewhere in the file was genuinely reused, not duplicated with
slightly different logic. Re-run the live extension-host verification
yourself if you have the same sandbox/CLI access prior tasks used,
rather than trusting the implementer's manual re-check alone.
