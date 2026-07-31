# ParityLens — Review Report T-12

## Review independence statement

This review was performed by a separate agent instance from the implementer who
authored commits `7c04db7` and `37c4cd2` on `task/T-12-mapping-normalization`.
No implementer session memory or context was carried over; all findings below
are derived from reading `TASK-BRIEF.md`, `Idea Prompt.md` sections 3 and 4,
the actual diff/source, and fresh command execution performed independently in
this review session.

## Scope reviewed

- `packages/engine/src/comparison-core/mapping/mapping.ts` (new)
- `packages/engine/src/comparison-core/mapping/mapping.test.ts` (new)
- `packages/engine/src/comparison-core/normalization/normalization.ts` (new)
- `packages/engine/src/comparison-core/normalization/normalization.test.ts` (new)
- `IMPLEMENTATION-REPORT.md` (claims cross-checked, not treated as evidence)
- Commits: `7c04db7` (implementation), `37c4cd2` (report commit-hash fixup)
- Diff vs `main`: `git diff main..task/T-12-mapping-normalization --stat` confirms
  exactly the four source/test files above plus `IMPLEMENTATION-REPORT.md`
  changed (850 insertions, 119 deletions, all attributable to the report
  rewrite + new files). No other file touched.

## Scope and ownership check

- `packages/engine/src/orchestration/definition/definition.ts` (T-08's owned
  file): `git diff main..task/T-12-mapping-normalization -- <that path>`
  returns empty — confirmed untouched. `NormalizationRule` is imported
  read-only via `import type`.
- `packages/extension/**`: no changes in the diff.
- Sibling `comparison-core/*` directories (`type-mapping/`, `schema-diff/`,
  `profiling/`): no changes in the diff.
- All changed files fall within the brief's declared ownership
  (`packages/engine/src/comparison-core/mapping/**` and
  `.../normalization/**`). No scope expansion found.

## Findings

### Critical

NONE.

### Important

NONE.

### Minor

| ID | Finding | Evidence | Suggested resolution |
| --- | --- | --- | --- |
| T-12-01 | The abbreviation-scope-boundary tests in `mapping.test.ts` (lines 57–90) use a conditional assertion (`if (match) { expect(match.strategy).not.toBe(...) }`) rather than asserting the suggestion's exact strategy unconditionally. This is weaker than it needs to be, though not incorrect — it does not create a false pass, since the brief's own worked example puts `cust_nm`/`created_dt`/`active_ind` at ordinal positions matching their true targets, so `match` is always defined in this fixture and the ordinal fallback legitimately fires. My independent adversarial probe (constructing the same names at *mismatched* ordinal positions) confirmed no suggestion at all is produced in that case, and confirmed the strategy is `"ordinal"` (never exact/case-insensitive/snake-camel) in the matching-ordinal case — so the implementation is correct; only the test's own assertion strength is a minor readability/rigor gap. | `mapping.test.ts:65-69`; independent probe output: `abbreviation suggestions (mismatched ordinals): []`, `abbreviation suggestion with matching ordinal position: [{"strategy":"ordinal"}]` | Optional follow-up: tighten the existing tests to assert `match?.strategy === "ordinal"` unconditionally (since ordinal position happens to coincide in this fixture) instead of the current negative-only assertion, for clearer documentation of expected behavior. Does not block approval. |

## Verification performed

### Fresh `npm run verify`

Ran independently on `task/T-12-mapping-normalization` (Node v24.9.0, npm
11.6.0, matching `CLAUDE.md`'s documented versions):

```
npm run verify
> tsc -b --force        (clean)
> eslint .               (clean)
> vitest run
 Test Files  15 passed (15)
      Tests  334 passed (334)
```

Exit code 0. Matches the report's claimed `334 passed (334)`, 15 test files,
exit 0 exactly — no discrepancy. New test files present in output:
`comparison-core/normalization/normalization.test.ts (24 tests)`,
`comparison-core/mapping/mapping.test.ts (12 tests)` — matches report's
12+24=36 new tests over a 298 baseline.

### Adversarial mutation-purity probe (independent, not reusing implementer's tests)

Built `packages/engine` via `npm run typecheck` (produces `dist/`), then ran a
standalone script directly against the compiled `applyNormalization` and
`suggestMappings`, constructing cases not present in the implementer's own
test file:

- Passed a nested object (`{name, tags: [...], nested: {x}}`) through
  `applyNormalization` with `trim`/`caseSensitive`/`collapseWhitespace`/
  `truncateTo` all set simultaneously — confirmed by reference equality and
  `JSON.stringify` snapshot that the object, its nested object, and its array
  property were byte-for-byte unchanged, and that the returned value is the
  *same* object reference (no copy-then-mutate).
- Passed an array of nested mutable objects (`[{v: "  X  "}, {v: "  Y  "}]`)
  through `applyNormalization` — confirmed unchanged via JSON snapshot.
- Passed a `rule` object containing nested `nullEquivalents` array and
  `timezone` object through `applyNormalization` — confirmed both nested
  references and the full rule's JSON representation were unchanged after the
  call (this specifically covers the "mutates the `rule` object... or any
  nested object/array within them" case the dispatch prompt called out, which
  the implementer's own test only partially covers via a top-level snapshot).
- Passed a plain number array (`[1,2,3]`) through `applyNormalization` and
  confirmed the returned value is the identical reference.
- All probes passed: **8/8 mutation-purity checks green**, 0 failures.

Result: the non-mutation guarantee is real and holds under adversarial
construction, not just the implementer's own test cases. Confirmed no
connector, record, or persisted-structure write-back exists anywhere in
`normalization.ts` — the file contains no I/O, no imports beyond the
type-only `NormalizationRule` import, and every function documented in the
Behavior section returns a new value or the original primitive/reference
untouched.

### DST/timezone arithmetic re-derivation (independent, not trusting the report's claimed math)

Confirmed no bare `Date.parse`/`new Date(string)` call remains on the
offset-less parsing path: `parseAsUtcWallClock` (normalization.ts:155-186)
only falls back to `Date.parse` when (a) the regex doesn't match the plain
`YYYY-MM-DD[THH:mm:ss[.sss]]` shape at all, or (b) the matched string
already carries an explicit `Z`/offset suffix — both cases are host-timezone-
independent by construction (case (b) delegates to a JS engine's built-in
explicit-offset parsing, which does not consult host TZ). The offset-less
wall-clock path uses `Date.UTC` exclusively.

Independently re-ran the January vs. July `America/New_York` conversion
(not copy-pasted from the report — computed via a from-scratch script calling
the compiled function and independently cross-checking the offset via
`Date.parse` arithmetic against a naive-UTC parse of the same wall-clock
string):

```
jan result: 2026-01-20T17:00:00.000Z   (12:00 local -> 17:00 UTC, offset -5h = EST)
jul result: 2026-07-20T16:00:00.000Z   (12:00 local -> 16:00 UTC, offset -4h = EDT)
Jan offset hours from naive UTC: 5   Jul offset hours: 4
DST difference between Jan and Jul is exactly 1 hour: true
```

This matches the report's claim (EST is UTC-5, EDT is UTC-4, difference of
exactly one hour) via independent re-derivation, not by trusting the report's
arithmetic or its test file. The fix is real and correct.

### Idea Prompt.md section 3/4 text verification

Read `Idea Prompt.md` lines 240–330 directly. Confirmed:
- Section 3's worked example (`customer_id → CUSTOMER_ID`,
  `cust_nm → CUSTOMER_NAME`, `created_dt → CREATED_TIMESTAMP`,
  `active_ind → IS_ACTIVE`) matches the brief's citation verbatim.
- Section 3 lists "Prefix or suffix removal," "Common abbreviations,"
  "Data-type compatibility," "Profile similarity," "Value overlap," and
  "Optional AI-assisted semantic matching" as candidate strategies — none of
  these are implemented in `mapping.ts`; only exact/case-insensitive/
  snake-camel/ordinal are present, matching the brief's explicit scope
  boundary.
- Section 4's exact quote — "These transformations should apply only in the
  comparison engine. They should never alter the underlying data." — appears
  verbatim at line 330, matching the brief's citation and
  `normalization.ts`'s header comment.
- Section 4's four worked-example rule shapes (`customer_name`,
  `order_amount`, `created_timestamp`, `cancellation_date`) match the brief's
  Interfaces table and are each exercised literally in
  `normalization.test.ts` with the exact field names/values from the idea
  doc (`trim`/`case_sensitive`/`collapse_whitespace`,
  `numeric_tolerance.absolute: 0.01`,
  `timezone: {America/New_York, UTC}`/`truncate_to: second`,
  `null_equivalents: ["1900-01-01", "9999-12-31"]`).

### `suggestMappings` abbreviation false-positive probe (independent)

Beyond re-running the implementer's own tests, constructed two additional
cases not in `mapping.test.ts`:

1. `cust_nm`/`created_dt`/`active_ind` at ordinal positions that do **not**
   coincide with their target's ordinal position (99/98/97 vs. 1/2/3) —
   result: `suggestMappings` returns **zero** suggestions for all three,
   confirming no exact/case-insensitive/snake-camel/ordinal strategy
   fires when ordinal also doesn't align. No false positive.
2. `cust_nm` at the same ordinal position as `CUSTOMER_NAME` (mirroring the
   idea doc's literal worked example, where the columns are adjacent) —
   result: exactly one suggestion, `strategy: "ordinal"` — never `exact`,
   `case-insensitive`, or `snake-camel`. This is the last-resort fallback
   working as designed, not abbreviation matching; `MappingSuggestion`
   reports which strategy fired so any future consuming UI (T-16) can
   distinguish a confident match from an ordinal guess.

`toComparableForm` (mapping.ts:49-51) only strips `_`/`-` and lowercases —
verified by reading the code that it performs no substring/edit-distance/
abbreviation-expansion logic of any kind. `cust_nm` normalizes to `custnm`,
which does not equal `customername` (from `CUSTOMER_NAME`), so no
false-positive snake-camel match is structurally possible for this pair.

### Type/lint check

`tsc -b --force` and `eslint .` both completed cleanly as part of
`npm run verify` above — no new type or lint errors introduced by the new
files.

## Disposition of prior findings

No prior open findings were scoped to T-12 in `PROGRESS-LEDGER.md`. This is a
new task with no predecessor findings to re-verify.

## Cleanup

A standalone probe script was created at
`packages/engine/dist/src/comparison-core/__adversarial_probe.mjs` (compiled
output directory, not source-controlled) to run the adversarial checks above
against the built module. It has been deleted. `git status` after cleanup
shows only pre-existing, unrelated working-tree modifications
(`PROGRESS-LEDGER.md`, `TASK-BRIEF.md`, `package-lock.json` — orchestrator
working-tree state predating this review, not part of the T-12 diff under
review) — no residue from this review's probing.

## Final disposition

**APPROVED**

All claims in `IMPLEMENTATION-REPORT.md` were independently verified and
found accurate: fresh `npm run verify` reproduced exit 0 with 334/334 tests
(15 test files) exactly as claimed. The brief's primary scrutiny target —
whether `applyNormalization` mutates its inputs or writes back anywhere —
was adversarially probed with constructed cases beyond the implementer's own
tests (nested objects, nested arrays, rule objects with nested
array/object fields) and found to hold in every case. The self-disclosed
`Date.parse`/host-timezone bug fix was independently confirmed both by
code inspection (no remaining bare offset-less `Date.parse`/`new Date(string)`
call on the timezone-conversion path) and by independently re-deriving the
DST arithmetic from scratch (EST UTC-5 vs. EDT UTC-4, exactly one hour
apart). `suggestMappings` was confirmed to produce no false-positive
confident (exact/case-insensitive/snake-camel) match for any of the three
abbreviation-based idea-doc examples, including in a constructed case the
implementer's own test suite did not cover (mismatched ordinal positions).
No edits landed in `definition.ts`, `packages/extension/**`, or sibling
`comparison-core/*` directories. One Minor finding (T-12-01, a test
assertion-strength nit that does not indicate any implementation defect)
is recorded for optional future follow-up and does not block approval.
