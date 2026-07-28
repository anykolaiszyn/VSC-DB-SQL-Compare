# ParityLens — Implementation Report T-06

## Status and objective

- **Status:** COMPLETE
- **Objective:** Implement schema diff: compare two `ColumnDefinition[]` sets
  (source and target) across column count, name, order, native type,
  normalized/canonical type, length, precision, scale, and nullability, and
  produce severity-scored `SchemaDifference[]` findings, matching
  `Idea Prompt.md` section 2's worked example. This task's scope also
  mandatorily resolves open finding **M-07** from the T-05 review.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/engine/src/comparison-core/schema-diff/schema-diff.ts` | New. `compareSchemas(source, target, expectations?)` and `SchemaExpectations` type. | Produced interface owned by this task, per `TASK-BRIEF.md`. |
| `packages/engine/src/comparison-core/schema-diff/schema-diff.test.ts` | New. Focused Vitest suite. | Red-state and green-state test evidence for this task. |
| `packages/shared/src/result.ts` | Refined `SchemaDifference` from a thin `DifferenceItem` alias into a real shape (`columnName`, `kind: SchemaDifferenceKind`, `sourceType?`, `targetType?`, plus inherited `severity`/`message`). Added `SchemaDifferenceKind` export. | This task is the designated owner of refining `SchemaDifference` specifically (per `TASK-BRIEF.md`'s Consumed-interfaces row and Prohibited-changes section). `ProfileDifference`/`AggregateDifference`/`RowDifference` and `Severity` were left untouched. |
| `packages/shared/src/types.test.ts` | Updated one existing literal (`schemaDifferences: [{ severity, message }]` around line 218) to add `columnName`/`kind` fields, satisfying the refined `SchemaDifference` shape. | Direct, minimal, mechanical consequence of the shape refinement above — the literal no longer type-checked against the widened interface. No other line in this file was touched. |

## Behavior and interfaces

- **Behavior delivered:** `compareSchemas` compares two `ColumnDefinition[]`
  sets and returns a `SchemaDifference[]`, one finding per detected mismatch:
  - `missing-in-target` / `missing-in-source` for column presence, default
    `Failure` severity (per `Idea Prompt.md` section 12's
    `missing_target_column: fail` example), overridable via
    `expectations.missingTargetColumnSeverity` /
    `missingSourceColumnSeverity`.
  - `type-mismatch`, using T-05's `mapNativeType`/`compareCanonicalTypes`
    (native type itself is informational-only context on the finding, not a
    separate finding — native type names legitimately differ across
    platforms per the idea doc's own `INT`/`NUMBER(38,0)` example).
    Severity is derived from T-05's `TypeCompatibility`: `Compatible` → no
    finding, `Review` → `Warning`, `Risk` → `Failure`.
  - `length-mismatch` (default `Informational` if target length increased,
    `Failure` if decreased, matching the idea doc's
    `increased_string_length: info` / `decreased_string_length: fail`
    example; both overridable).
  - `precision-mismatch`, `scale-mismatch` (default `Warning`).
  - `nullability-mismatch` (default `Warning` for nullable→required, matching
    the idea doc's `nullable_to_required: warning` example; `Informational`
    for required→nullable; both overridable).
  - `order-mismatch` (default `Informational`), computed over the relative
    order of columns common to both sides only — a column missing on one
    side does not spuriously shift every later column's position into a
    false order-mismatch.
  - Two identical schemas (same columns, same order, same everything)
    produce zero findings.
- **Interfaces consumed:** `ColumnDefinition[]` (T-02, `packages/shared/src/types.ts`);
  `mapNativeType`/`compareCanonicalTypes`/`TypeCompatibility` (T-05,
  `packages/engine/src/comparison-core/type-mapping/type-mapping.ts`, consumed
  as-is, not modified); `FixtureConnector` + `sqlserver-customer` fixture
  (T-04) as test input only.
- **Interfaces produced:** `compareSchemas(source, target, expectations?): SchemaDifference[]`
  and `SchemaExpectations` (both in
  `packages/engine/src/comparison-core/schema-diff/schema-diff.ts`); refined
  `SchemaDifference` and new `SchemaDifferenceKind`
  (`packages/shared/src/result.ts`). Consumed by T-09 (orchestration
  planner) going forward.

## M-07 resolution

**Problem restated:** T-05's `compareCanonicalTypes` downgrades
same-category `Timestamp`/`Timestamp` (and `Time`/`Time`) pairs from
`Compatible` to `Review`, specifically to reproduce `Idea Prompt.md`'s
`DATETIME`/`TIMESTAMP_NTZ` worked-example row (`CreatedDate DATETIME` vs
`CREATED_AT TIMESTAMP_NTZ` → `Review`). That rule is correct for genuinely
different native types in the same category, but it also flags two
**identical** native types (e.g. `DATETIME2` on both sides) as `Review`,
which is a false positive: nothing differs, there is nothing to review.

**Resolution implemented (`compareType` in `schema-diff.ts`):**

```ts
function compareType(source, target) {
  if (source.nativeType === target.nativeType) {
    return undefined; // short-circuit: no finding at all
  }
  const compatibility = compareCanonicalTypes(source.canonicalType, target.canonicalType);
  if (compatibility === "Compatible") return undefined;
  // ...build a type-mismatch finding for Review/Risk
}
```

Before calling T-05's `compareCanonicalTypes` at all, `compareSchemas`
checks whether `source.nativeType` and `target.nativeType` are the exact
same string. If they are, the type check short-circuits straight to "no
finding" (equivalent to `Compatible`) and `compareCanonicalTypes` is never
invoked for that column. Only when the native type strings differ does
execution fall through to `mapNativeType`/`compareCanonicalTypes`'s
category-level classification — which is exactly the path the original
`DATETIME`/`TIMESTAMP_NTZ` example exercises, since those are two different
strings.

**Why this is the correct fix, not a workaround:** T-05's file
(`type-mapping.ts`) was explicitly out of scope for this task (Prohibited
changes: "Do not modify `packages/engine/src/comparison-core/type-mapping/**`").
Editing `compareCanonicalTypes` itself to stop downgrading same-category
Timestamp/Timestamp pairs would have silently broken the
`DATETIME`/`TIMESTAMP_NTZ` → `Review` example that same rule exists to
reproduce, since that pair is *also* same-category. The identical-native-
string short-circuit resolves the false positive at exactly the layer that
has the missing information T-05's primitive doesn't have (T-05 only sees
canonical categories, not the original native-type strings) — without
touching T-05's file and without weakening the case T-05's rule was
designed for.

**Tests proving this (`schema-diff.test.ts`, describe block "M-07
resolution: identical native type strings"):**

1. `DATETIME2`/`DATETIME2` (same string, both mapped to canonical
   `Timestamp`) → zero `type-mismatch` findings for that column. **Passing.**
2. `DATETIME`/`TIMESTAMP_NTZ` (different strings, both mapped to canonical
   `Timestamp`) → one `type-mismatch` finding, severity `Warning` (T-05's
   `Review` → this task's `Warning` mapping). **Passing** — confirms the
   short-circuit did not delete T-05's original documented behavior.

## Refined `SchemaDifference` shape

```ts
export type SchemaDifferenceKind =
  | "missing-in-target"
  | "missing-in-source"
  | "type-mismatch"
  | "length-mismatch"
  | "precision-mismatch"
  | "scale-mismatch"
  | "nullability-mismatch"
  | "order-mismatch";

export interface SchemaDifference extends DifferenceItem {
  columnName: string;
  kind: SchemaDifferenceKind;
  sourceType?: string;
  targetType?: string;
}
```

`severity: Severity` and `message: string` are inherited unchanged from
`DifferenceItem` (the `Severity` union itself was not touched, per the
brief). `sourceType`/`targetType` are optional because a
`missing-in-target`/`missing-in-source` finding only has a native type on
the side where the column actually exists. `ProfileDifference`,
`AggregateDifference`, and `RowDifference` remain untouched aliases of
`DifferenceItem`, left for T-07/T-13/T-14 to refine.

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline (pre-change) | `npm run verify` | Exit 0. 4 test files, 229/229 tests passed. | Captured in this session's transcript before any change. |
| Red state | `npx vitest run packages/engine` | 1 failed suite: `schema-diff.test.ts` — `Error: Failed to load url ./schema-diff.js ... Does the file exist?` 218 tests passed across the other 3 suites; 0 tests collected from the failing suite. | Captured in this session's transcript, before `schema-diff.ts` was created. |
| Focused green state (engine) | `npx vitest run packages/engine` | Exit 0. 4 test files passed, 229/229 tests passed (69 + 109 + 11 new + 40). | This session's transcript. |
| Focused green state (shared) | `npx vitest run packages/shared` | Exit 0. 1 test file passed, 11/11 tests passed (no regression from the `SchemaDifference` refinement, after updating the one affected literal in `types.test.ts`). | This session's transcript. |
| Full verification | `npm run verify` | Exit 0 (independently re-confirmed via a redirected run plus `echo $?`). `tsc -b --force` clean, `eslint .` clean (0 errors, after removing one transient unused-import lint error introduced mid-implementation), `vitest run`: 5 test files passed, **240/240 tests passed** (229 pre-existing + 11 new schema-diff tests). No regressions. | This session's transcript. |

Acceptance-criterion-1 proof specifically: `compareSchemas` run against the
actual `sqlserver-customer` fixture pair's schemas (fetched live via
`FixtureConnector.getSchema` against the seeded DuckDB tables, not
hand-built) asserts a `missing-in-target` finding for column `CreditLimit`
with `severity === "Failure"`. This test is in the "acceptance criterion 1"
describe block and passed in both the focused and full verification runs.

## Assumptions and risks

- **Assumptions:**
  - Column matching between source and target is by exact, case-sensitive
    name equality (`ColumnDefinition.name`). This task does not implement
    column mapping/suggestion (that is T-12's scope) — a source column
    named differently from its target counterpart (e.g. `CustomerID` vs
    `CUSTOMER_ID`) is reported as `missing-in-target` **and**
    `missing-in-source` rather than being matched as a renamed column. This
    matches the current interface contract (`compareSchemas` takes no
    mapping argument) and is documented here as an explicit limitation for
    T-09/T-12 to be aware of when wiring column mapping in front of this
    function later.
  - `SchemaExpectations` (the `expectations?` parameter's type) did not
    already exist anywhere in the codebase; it is newly defined in
    `schema-diff.ts` as this task's own file, per the produced-interface
    signature in `TASK-BRIEF.md`. Its field names/shape are this task's own
    design choice, informed by `Idea Prompt.md` section 12's example
    (`missing_target_column`, `increased_string_length`,
    `decreased_string_length`, `nullable_to_required`) but not dictated by
    any prior task.
  - Native type itself is treated as informational context carried on other
    findings (`sourceType`/`targetType` fields), not a standalone
    "native-type-mismatch" finding kind — per the brief's phrasing ("native
    type (informational)"), since native type names legitimately differ
    across platforms without being a problem (e.g. `INT` vs
    `NUMBER(38,0)`).
- **Risks or limitations:**
  - Order comparison is computed over the relative order of columns common
    to both sides (ignoring columns missing on either side), which avoids
    spurious cascading order-mismatches after a single dropped/added column,
    but has not been validated against every possible reordering pattern —
    only the single-swap case is covered by a test.
  - `SchemaExpectations` currently supports only the specific overrides this
    task's tests exercise (missing-column, length, order, nullability
    direction). Precision/scale severity overrides were not added because
    neither `DESIGN-SPEC.md` nor `Idea Prompt.md` section 12's example names
    a specific override key for them; T-09 or a later task can extend
    `SchemaExpectations` if a concrete need arises.
- **Blockers:** None.

## Patch or commit identity

- **Branch:** `task/T-06-schema-diff`, created from `main` (HEAD at task
  start: commit `429b251`, "T-05: add implementation report"). `main` was
  confirmed clean at task start except for the expected
  `PROGRESS-LEDGER.md`/`TASK-BRIEF.md` orchestrator-state modifications,
  which were left untouched throughout this task.
- **Commit:** Recorded in this branch's git log alongside this report; see
  `git log task/T-06-schema-diff` for the exact hash at handoff time.

## Recommended next step

Independent review by a separate Claude Code subagent instance, distinct
from this implementer, per `TASK-BRIEF.md`'s Handoff section. The reviewer
must:

1. Verify against `DESIGN-SPEC.md` acceptance criterion 1 using the actual
   T-04 `sqlserver-customer` fixture mismatch (not a hand-built substitute),
   confirming the dropped `CreditLimit` column produces a `Failure`-severity
   finding.
2. **Specifically confirm M-07 is genuinely resolved**: identical native
   types (e.g. `DATETIME2`/`DATETIME2`) no longer produce a spurious
   `Review`/`Warning` finding, **and** the original `DATETIME`/`TIMESTAMP_NTZ`
   `Review` example from T-05 still produces a `Warning`-severity finding
   (i.e. the fix did not just delete T-05's documented behavior wholesale).
3. Confirm no unauthorized files were touched (`ProfileDifference`,
   `AggregateDifference`, `RowDifference`, `Severity`,
   `packages/engine/src/comparison-core/type-mapping/**`,
   `packages/engine/src/connector-sdk/**` should all be unchanged from
   `main`).
4. Re-run `npm run verify` independently and confirm exit 0 with the
   reported test count.

No self-approval has been performed; this report requires the independent
reviewer's `REVIEW-REPORT.md` before this task can be considered approved.
