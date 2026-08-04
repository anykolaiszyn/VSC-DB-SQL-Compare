# TASK-BRIEF.md — T-51: batch A (trivial doc/comment/test-rigor fixes)

## Objective

Resolve four independent, low-risk, non-functional findings from
`PROGRESS-LEDGER.md`'s Open findings table in a single batched cycle, per
the backlog-cleanup sweep's confirmed batching approach (trivial
doc/comment/test-clarity items batched together rather than each getting
its own full task-loop cycle). None of the four changes any runtime
behavior — each is a comment correction or a test-clarity fix confirming
existing behavior is already correct.

## Scope — four independent findings, each touching a disjoint file

### 1. T-26-03 — `icon.svg` header comment says the wrong technique

**File:** `packages/extension/media/icon.svg`

Line 4's header comment currently reads (verbatim):

> Monochrome, `fill="currentColor"` so VS Code applies its own
> theme-appropriate icon color.

But all three shapes actually use `stroke="currentColor"` with
`fill="none"` (lines 5-7) — the comment describes a technique the file
doesn't use. Fix: correct the comment text to say
`stroke="currentColor"`/`fill="none"`, not `fill="currentColor"`. This is
an SVG XML comment — never parsed/rendered — so this is a pure text
correction with zero effect on rendering or theme-color inheritance.

### 2. T-12-01 — conditional assertions in `mapping.test.ts` should be unconditional

**File:** `packages/engine/src/comparison-core/mapping/mapping.test.ts`

Three tests (currently at approximately lines 57-70, 72-80, 82-90 — verify
exact line numbers before editing, since T-51's other changes don't touch
this file but line numbers can drift from unrelated history) each contain
an `if (match) { ... }` guard around their assertions:

```ts
const match = suggestions.find((s) => s.source === "cust_nm");
// Ordinal fallback would still pair cust_nm (position 2) with
// CUSTOMER_NAME (position 2) -- but per the brief, only the four
// named strategies are in scope, and ordinal is explicitly a
// "last-resort fallback", not a confident match. Assert directly
// that no exact/case-insensitive/snake-camel strategy fired.
if (match) {
  expect(match.strategy).not.toBe("exact");
  expect(match.strategy).not.toBe("case-insensitive");
  expect(match.strategy).not.toBe("snake-camel");
}
```

The reviewer's original adversarial probe (a mismatched-ordinal case)
already confirmed `suggestMappings` always produces a `match` for these
three fixture pairs (ordinal fallback fires), so the guard never actually
skips the assertions in practice — but the conditional form means a
future regression that caused `match` to become `undefined` would make
these tests silently pass instead of failing loudly. Fix: remove the
`if (match) { ... }` wrapper in all three tests, promote the three
`expect` calls to run unconditionally, and add one unconditional
`expect(match).toBeDefined();` immediately before them (mirroring the
existing pattern already used in the first test in this same file, e.g.
`expect(match).toBeDefined();` before `expect(match?.target)...` around
line 52). Keep each test's existing inline comment explaining the ordinal-
fallback reasoning — only remove the conditional wrapper, don't rewrite
the explanation.

### 3. T-36-01 — misleadingly-titled test in `comparisonEditorProvider.test.ts`

**File:** `packages/extension/src/authoring/comparisonEditorProvider.test.ts`

The test at approximately line 313 is titled:

> "NEVER calls applyEdit when the Apply message would fail the
> provider-side round-trip guard -- document stays untouched"

But its body (lines 313-334) sends `{ ...VALID_APPLY_MESSAGE.draft, keys: [] }`
— an empty `keys` array. Per the test's own inline comment (lines 321-323),
this is caught by `handleApplyMessage`'s own required-field precheck
(rejecting empty key columns) *before* the message ever reaches
`buildComparisonYaml`/`parseDefinition` — i.e., it never actually
exercises the "round-trip guard" (the `parseDefinition` re-validation
step) the title claims. The actual round-trip guard is separately and
correctly exercised by the adjacent test at line 215- (the "internal
validation bypass" test using a structurally-invalid object name that
*does* pass the required-field precheck).

Fix: rename this one test's title to accurately describe what it tests —
the required-field precheck, not the round-trip guard. Suggested title:
`"NEVER calls applyEdit when the Apply message fails the required-field precheck (empty key columns) -- document stays untouched"`.
Do not change the test's body/assertions/behavior — this is a title-only
fix. Optionally tighten the existing inline comment (lines 321-323) if its
wording no longer fits the corrected title, but keep its substance (it
already correctly explains what's being tested).

### 4. T-39-01 — `provideCodeLenses` doesn't catch `listRecentRuns` rejection

**File:** `packages/extension/src/codelens/comparisonCodeLensProvider.ts`

`provideCodeLenses` (lines 156-177) wraps only the `parseDefinition` call
(lines 166-171) in try/catch; the subsequent `await this.deps.listRecentRuns()`
call (line 173) is unguarded. Per the file's own doc comment (lines
142-155), this method's contract is "never throws" (VS Code calls it on
every keystroke-adjacent document change), so an unhandled rejection from
`listRecentRuns` (e.g. a corrupted extension-storage state) would violate
that contract for an otherwise-valid document.

Fix: wrap the `listRecentRuns` call (and the two lines that consume its
result — `findMostRecentRunForComparison` and `buildLensesForValidDocument`)
in its own try/catch, alongside the existing `parseDefinition` one. On a
`listRecentRuns` rejection, fall back to `buildLensesForValidDocument(document.uri, undefined)`
— i.e., render the four lenses as if no prior run exists (matching the
"Open Last Result" lens's own pre-existing "no runs yet" fallback
behavior for the normal case), rather than returning `[]` (which would
suppress even "Run Profile"/"Run Schema Check"/"Run Full Comparison" for
a perfectly valid, parseable document just because run-history lookup
failed — a worse outcome than the gap this fix closes). Do not let this
new catch silently swallow the error with no trace — a `console.error`
(or equivalent, matching whatever error-visibility convention this
codebase already uses elsewhere in `comparisonCodeLensProvider.ts` or
its siblings; if none exists in this file, a bare `console.error(err)` is
sufficient, no new logging infrastructure) is acceptable and sufficient;
no user-facing notification is required (this method has no UI surface
of its own to notify through).

## Files owned

- `packages/extension/media/icon.svg`
- `packages/engine/src/comparison-core/mapping/mapping.test.ts`
- `packages/extension/src/authoring/comparisonEditorProvider.test.ts`
- `packages/extension/src/codelens/comparisonCodeLensProvider.ts`
- `packages/extension/src/codelens/comparisonCodeLensProvider.test.ts` (new test only, item 4)

## Interfaces consumed

None new. No signature of any exported function/type changes in any of
the four items.

## Prohibited changes

- Do not touch `mapping.ts` itself (item 2 is test-only — `suggestMappings`'s
  actual behavior is already correct per the reviewer's original probe;
  this is a test-rigor fix, not a bug fix).
- Do not touch `comparisonEditorProvider.ts` itself (item 3 is test-title-only
  — `handleApplyMessage`'s actual behavior is already correct).
- Do not add column-name-mapping, retry logic, or any new dependency to
  `comparisonCodeLensProvider.ts` beyond the try/catch itself (item 4) —
  scope is strictly "don't let a `listRecentRuns` rejection escape
  uncaught," not a redesign of the lens-building flow.
- Do not touch any other comparison-authoring or codelens file beyond
  the five listed above.
- Do not touch `PROGRESS-LEDGER.md` (the orchestrator updates it during
  reconciliation, not the implementer).

## Red-state evidence required

- Item 2: run `mapping.test.ts` unmodified first if there's any doubt the
  three `match` values are always defined — but per the finding's own
  text this was already reviewer-confirmed, so red-state evidence here
  can be the *before* state of the conditional assertions themselves
  (i.e., show the file before editing) rather than a failing test, since
  there is no behavior change to prove red/green on. Do include the new
  unconditional test run passing green as the primary evidence.
- Item 4: write the new test first (a `listRecentRuns` mock that rejects,
  called against a valid `.paritylens` document) and confirm it fails
  against today's unmodified `comparisonCodeLensProvider.ts` (an unhandled
  rejection propagating out of `provideCodeLenses`, or Vitest reporting an
  unhandled rejection/thrown error) before implementing the fix.

## Green-state evidence required

1. The scoped diff across the five owned files.
2. Item 2: all three previously-conditional tests now assert
   unconditionally and pass.
3. Item 4: the new rejection-handling test passes — `provideCodeLenses`
   resolves (does not throw/reject) and returns the four lenses with
   "Open Last Result" in its no-prior-run form when `listRecentRuns`
   rejects.
4. Every pre-existing test across all four touched test files still
   passes unchanged.
5. A full fresh `npm run verify` passing with no regression versus the
   current baseline.

## Handoff

- Write `IMPLEMENTATION-REPORT.md` using
  `multi-agent-idea-to-app/templates/IMPLEMENTATION-REPORT.md`, with one
  clearly separated subsection per item (1-4) so the reviewer can verify
  each independently.
- Commit on branch `task/T-51-batch-a-trivial-fixes`.
- Recommend independent review as the next step.
- Reviewer should specifically re-verify, per item: (1) the `icon.svg`
  comment now accurately describes the actual `stroke`/`fill` technique
  used, and no rendering-relevant attribute was touched; (2) the three
  `mapping.test.ts` assertions are now genuinely unconditional (not just
  reformatted) and would fail if `suggestMappings` stopped producing a
  match for one of the three fixture pairs; (3) the renamed test title in
  `comparisonEditorProvider.test.ts` accurately describes what the test's
  body actually exercises, and the adjacent round-trip-guard test (~line
  215) is untouched and still distinct; (4) independently construct a
  `listRecentRuns`-rejection scenario against the fixed
  `comparisonCodeLensProvider.ts` and confirm `provideCodeLenses` never
  throws/rejects and still returns all four lenses; (5) a fresh full
  `npm run verify` is green.
