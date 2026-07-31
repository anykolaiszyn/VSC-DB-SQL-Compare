# ParityLens — Implementation Report T-12

## Status and objective

- **Status:** COMPLETE (implementation and evidence only — not reviewed or approved; see Recommended next step)
- **Objective:** Implement column mapping (automatic suggestion by exact/case-insensitive/snake-camel/ordinal matching, per `Idea Prompt.md` section 3) and normalization rules (trim, case, whitespace collapse, numeric tolerance, date truncation/timezone, null equivalents, per `Idea Prompt.md` section 4), per `TASK-BRIEF.md` T-12.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/engine/src/comparison-core/mapping/mapping.ts` | New | `suggestMappings(source, target): MappingSuggestion[]` — the brief's Interfaces-table Produced entry |
| `packages/engine/src/comparison-core/mapping/mapping.test.ts` | New | Red/green evidence + worked-example proof for `suggestMappings` |
| `packages/engine/src/comparison-core/normalization/normalization.ts` | New | `applyNormalization(value, rule): unknown` and `valuesEqualWithinTolerance(a, b, tolerance): boolean` — the brief's Interfaces-table Produced entry |
| `packages/engine/src/comparison-core/normalization/normalization.test.ts` | New | Red/green evidence + worked-example proof for `applyNormalization`/`valuesEqualWithinTolerance`, plus a dedicated non-mutation ("purity") test group |

No file outside `packages/engine/src/comparison-core/mapping/**` and `packages/engine/src/comparison-core/normalization/**` was touched. `packages/engine/src/orchestration/definition/definition.ts` (T-08's file, defining `NormalizationRule`/`ColumnMappingEntry`) was read only, never edited.

## Behavior and interfaces

- **Behavior delivered:**
  - `suggestMappings(source: ColumnDefinition[], target: ColumnDefinition[]): MappingSuggestion[]` proposes, for each source column, zero or one best-candidate target column using exactly four strategies in preference order — exact name, case-insensitive name, snake_case↔camelCase equivalence, ordinal position (last-resort fallback). Each `MappingSuggestion` reports `{source, target, strategy}` so a caller can show why a mapping was suggested. A target column already claimed by a higher-preference suggestion for another source column is not reused, so no target is suggested twice. Pure function — never mutates `source`/`target`, never touches a `ParityDefinition`/`ColumnMappingEntry`.
  - `applyNormalization(value: unknown, rule: NormalizationRule): unknown` applies whichever of `trim`, `caseSensitive: false`, `collapseWhitespace`, `truncateTo`, `timezone`, `nullEquivalents` are present on `rule`, in that fixed order (null-equivalents check first — short-circuits to `null` — then string shaping, then date truncation/timezone). `numericTolerance` is deliberately **not** applied here (see judgment call below); it leaves numeric values unchanged and is evaluated separately via `valuesEqualWithinTolerance(a, b, tolerance)`.
  - Non-string/non-listed-sentinel values (numbers, booleans, objects, arrays) pass through **unchanged, by reference**, never mutated — this is the brief's primary reviewer scrutiny target, and is proven by a dedicated "purity / non-mutation" test group asserting object/array/rule-argument identity and content are unchanged after a call.
- **Interfaces consumed:**
  - `ColumnDefinition[]` (`packages/shared/src/types.ts`, T-02) — read-only, full shape used (`name`, `ordinalPosition` for the ordinal fallback).
  - `NormalizationRule` (`packages/engine/src/orchestration/definition/definition.ts`, T-08) — read-only import, every field consumed as documented in the brief.
- **Interfaces produced:**
  - `suggestMappings(source: ColumnDefinition[], target: ColumnDefinition[]): MappingSuggestion[]` and the `MappingSuggestion`/`MappingStrategy` types, from `packages/engine/src/comparison-core/mapping/mapping.ts`.
  - `applyNormalization(value: unknown, rule: NormalizationRule): unknown` and `valuesEqualWithinTolerance(a: unknown, b: unknown, tolerance: {absolute?: number; percentage?: number} | undefined): boolean`, from `packages/engine/src/comparison-core/normalization/normalization.ts`.

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Red state | `npx vitest run packages/engine/src/comparison-core/mapping packages/engine/src/comparison-core/normalization` | Exit 1. `Error: Failed to load url ./mapping.js ... Does the file exist?` and the same for `./normalization.js` — module resolution failure, exactly as the brief predicted ("neither directory exists yet"). `Test Files 2 failed (2)`, `Tests no tests`. | Captured transcript below |
| Focused green state | `npx vitest run packages/engine/src/comparison-core/mapping packages/engine/src/comparison-core/normalization` | Exit 0. `Test Files 2 passed (2)`, `Tests 36 passed (36)` (12 mapping + 24 normalization) | Captured transcript below |
| Full verification | `npm run verify` | Exit 0. `tsc -b --force` clean, `eslint .` clean, `vitest run`: `Test Files 15 passed (15)`, `Tests 334 passed (334)` | Captured transcript below |

### Red-state transcript (abridged, real output)

```
$ npx vitest run packages/engine/src/comparison-core/mapping packages/engine/src/comparison-core/normalization
...
 ❯ packages/engine/src/comparison-core/normalization/normalization.test.ts (0 test)
 ❯ packages/engine/src/comparison-core/mapping/mapping.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  packages/engine/src/comparison-core/mapping/mapping.test.ts [ packages/engine/src/comparison-core/mapping/mapping.test.ts ]
Error: Failed to load url ./mapping.js (resolved id: ./mapping.js) in V:/Secret Projects/VSC-DB-SQL-Compare/packages/engine/src/comparison-core/mapping/mapping.test.ts. Does the file exist?

 FAIL  packages/engine/src/comparison-core/normalization/normalization.test.ts [ packages/engine/src/comparison-core/normalization/normalization.test.ts ]
Error: Failed to load url ./normalization.js (resolved id: ./normalization.js) in V:/Secret Projects/VSC-DB-SQL-Compare/packages/engine/src/comparison-core/normalization/normalization.test.ts. Does the file exist?

 Test Files  2 failed (2)
      Tests  no tests
```
Exit code: `1` (confirmed via `echo EXIT:$?` immediately after the command).

### Focused green-state transcript (real output)

```
$ npx vitest run packages/engine/src/comparison-core/mapping packages/engine/src/comparison-core/normalization
 ✓ packages/engine/src/comparison-core/mapping/mapping.test.ts (12 tests) 6ms
 ✓ packages/engine/src/comparison-core/normalization/normalization.test.ts (24 tests) 27ms

 Test Files  2 passed (2)
      Tests  36 passed (36)
```

### Full verification transcript (real output, tail)

```
$ npm run verify
> tsc -b --force
> eslint .
> vitest run
 ✓ packages/engine/src/comparison-core/type-mapping/type-mapping.test.ts (69 tests) 16ms
 ✓ packages/engine/src/connector-sdk/safety/statement-safety.test.ts (109 tests) 28ms
 ✓ packages/engine/src/comparison-core/normalization/normalization.test.ts (24 tests) 38ms
 ✓ packages/shared/src/types.test.ts (11 tests) 7ms
 ✓ packages/engine/src/comparison-core/mapping/mapping.test.ts (12 tests) 10ms
 ✓ packages/extension/src/webview/resultsWebview.test.ts (2 tests) 4ms
 ✓ packages/extension/src/statusbar/parityStatusBar.test.ts (2 tests) 4ms
 ✓ packages/extension/src/secrets/secretStore.test.ts (3 tests) 9ms
 ✓ packages/extension/src/views/parityTreeDataProvider.test.ts (5 tests) 8ms
 ✓ packages/extension/src/activation/activate.test.ts (3 tests) 9ms
 ✓ packages/engine/src/orchestration/definition/definition.test.ts (30 tests) 56ms
 ✓ packages/engine/src/comparison-core/schema-diff/schema-diff.test.ts (11 tests) 66ms
 ✓ packages/engine/src/comparison-core/profiling/profiling.test.ts (9 tests) 159ms
 ✓ packages/engine/src/orchestration/planner/planner.test.ts (4 tests) 181ms
 ✓ packages/engine/src/connector-sdk/fixture/fixture-connector.test.ts (40 tests) 871ms

 Test Files  15 passed (15)
      Tests  334 passed (334)
```
Exit code: `0` (confirmed via `echo EXIT:$?` immediately after the command). 334 = 298 baseline (per `PROGRESS-LEDGER.md`'s T-11 entry) + 36 new (12 mapping + 24 normalization). No regression in any previously-passing test.

Idea-doc worked examples exercised literally and passing:
- Section 3: `customer_id → CUSTOMER_ID` via case-insensitive strategy; `cust_nm`, `created_dt`, `active_ind` each proven to NOT produce an exact/case-insensitive/snake-camel match (abbreviation matching correctly out of scope).
- Section 4: `customer_name` (`trim` + `case_sensitive: false` + `collapse_whitespace: true` combined) → `"acme inc."`; `order_amount` (`numeric_tolerance.absolute: 0.01`) via `valuesEqualWithinTolerance`; `created_timestamp` (`timezone: {America/New_York → UTC}` + `truncate_to: second`); `cancellation_date` (`null_equivalents: ["1900-01-01", "9999-12-31"]`).

## Assumptions and risks

- **Assumptions (judgment calls):**
  1. **`applyNormalization` naming and tolerance split** — implemented exactly as the brief names it, with `numericTolerance` exposed as a separate `valuesEqualWithinTolerance(a, b, tolerance)` helper rather than folded into `applyNormalization`, per the brief's own explicit guidance ("document how your implementation exposes this, e.g. a separate `valuesEqualWithinTolerance` helper, since tolerance is inherently a two-value comparison, not a single-value transform"). Not treated as an open judgment call since the brief names this exact pattern.
  2. **`applyNormalization`'s field-application order** is not specified by the brief beyond the section-4 worked examples (which only combine fields that don't interact). I chose: null-equivalents check first (short-circuits everything else), then trim → case-fold → collapse-whitespace (matching the order fields are listed in `NormalizationRule` and in the customer_name worked example), then date truncation/timezone last (only applies to string values, independent of the string-shaping fields — a value is never simultaneously a "string to trim" and a "date to truncate" in the worked examples, so order between the two groups doesn't affect any given rule's real-world use, but trim/case/whitespace running first means a date-shaped value with incidental leading/trailing whitespace would still parse correctly).
  3. **`timezone` without `truncateTo`** — the brief's Interfaces table requires `timezone` conversion and separately requires `truncateTo`; I implemented them as independently applicable (either can appear alone), converting to UTC ISO-8601 as the normalized output format in both cases, since the brief doesn't specify a different output representation and UTC ISO-8601 is unambiguous and directly comparable regardless of the record's original timezone.
  4. **Host-timezone independence (a correctness fix I caught myself during implementation, not a request from the brief):** my first draft used `Date.parse`/`new Date(string)` on timestamp strings with no explicit UTC/offset marker. This is a real bug class — ECMA-262 leaves that parse behavior host-local-timezone-dependent, and my first version's `created_timestamp` test only passed by coincidence because this development machine's local zone (`America/New_York`, confirmed via `Intl.DateTimeFormat().resolvedOptions().timeZone`) happened to equal the test's configured `timezone.source`. I rewrote date parsing (`parseAsUtcWallClock` in `normalization.ts`) to explicitly parse wall-clock components via regex and `Date.UTC`, making the parse step itself host-timezone-independent; only the explicit `rule.timezone` field now introduces any timezone semantics. I added a second worked-example test (`created_timestamp: DST-boundary sanity check`) asserting a January (EST, UTC-5) conversion differs by exactly one hour from the July (EDT, UTC-4) case, proving the fix resolves actual IANA DST rules via `Intl.DateTimeFormat` rather than a fixed offset or the host's own zone.
- **Risks or limitations:**
  - `parseAsUtcWallClock`'s regex targets the plain `YYYY-MM-DD[THH:mm:ss[.sss]]` shape used throughout `Idea Prompt.md` section 4's examples and this task's tests. A value already carrying an explicit `Z`/offset suffix, or a genuinely different date format, falls back to `Date.parse` (host-local for the no-offset case, which cannot occur for a matched-with-offset string, so this fallback path is host-independent in practice). Values that don't match either shape return the original value unchanged (not a date, `truncateTo`/`timezone` don't apply) — this is intentional per the brief ("non-date-shaped strings pass through unaffected"), not a gap.
  - `suggestMappings`'s snake-camel strategy normalizes by stripping `_`/`-` and lowercasing; it does not disambiguate cases where this normalization causes two structurally different names to collide (e.g. two source columns both normalizing to the same form would compete for the same target, and the first-processed source column wins under the "claimed targets" rule). Not exercised by a dedicated test since no such case appears in the brief's worked examples; flagging as a known untested edge case rather than omitting mention of it.
  - `applyNormalization`'s `caseSensitive` field only case-folds strings (`toLowerCase()`); it does not perform full Unicode normalization (NFC/NFD) — `Idea Prompt.md` section 4 lists "Unicode normalization" and "remove punctuation"/"normalize line endings" as candidate string-normalization rules, but `NormalizationRule` (T-08's already-approved shape, consumed read-only) has no field for them, so they are out of scope for this task by construction, not an oversight.
- **Blockers:** None.

## Patch or commit identity

- **Commit:** `7c04db7` ("T-12: implement column mapping suggestion and normalization rules")
- **Branch:** `task/T-12-mapping-normalization`

## Recommended next step

Independent review by the `reviewer` subagent (a separate instance from this implementer), per `TASK-BRIEF.md`'s Handoff section, focused especially on:
1. The non-mutation ("purity") guarantee on `applyNormalization` — the brief's stated primary scrutiny target.
2. Confirming `suggestMappings` genuinely produces no confident match for `cust_nm`, `created_dt`, `active_ind` against their idea-doc abbreviation-based targets.
3. Independently checking the timezone/DST arithmetic in `normalization.ts` (`parseAsUtcWallClock` / `getUtcOffsetMs`) rather than trusting this report's worked-through math alone.

This report reflects implementation-and-evidence completion only. It is not a claim of review, approval, or release readiness — those require the independent reviewer and, ultimately, human release approval per `AGENTS.md`.
