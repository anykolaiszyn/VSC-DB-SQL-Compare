# ParityLens — Review Report T-06

## Review independence

This review was performed by a separate Claude Code subagent instance,
distinct from the T-06 implementer. No implementation files, `TASK-BRIEF.md`,
or `IMPLEMENTATION-REPORT.md` were edited as part of this review. Only this
file (`REVIEW-REPORT.md`) was written. A throwaway probe test file
(`_probe.test.ts`) was created under `packages/engine/src/comparison-core/schema-diff/`
solely to independently exercise an edge case not covered by the
implementer's own test suite; it was run once and deleted before this report
was finalized — `git status` confirms no residue. All verification commands
below were re-run fresh in this review session, not copied from the
implementation report. (This file previously held the stale T-05 review
report; it has been fully replaced with the T-06 review below.)

## Review scope

- **Task objective:** Implement `compareSchemas(source, target, expectations?)`
  comparing two `ColumnDefinition[]` sets across column count, name, order,
  native type, normalized/canonical type, length, precision, scale, and
  nullability, producing severity-scored `SchemaDifference[]` findings per
  `Idea Prompt.md` section 2's worked example, and mandatorily resolve open
  finding M-07 from the T-05 review.
- **Files and interfaces reviewed:**
  - `packages/engine/src/comparison-core/schema-diff/schema-diff.ts`
  - `packages/engine/src/comparison-core/schema-diff/schema-diff.test.ts`
  - `packages/shared/src/result.ts` (`SchemaDifference` refinement, explicitly
    authorized by `TASK-BRIEF.md`)
  - `packages/shared/src/types.test.ts` (one literal touched — scope-checked)
  - `packages/engine/src/comparison-core/type-mapping/type-mapping.ts` (T-05,
    consumed as-is via `compareCanonicalTypes`, confirmed not modified)
  - `packages/engine/fixtures/sqlserver-customer.ts` (T-04, read as
    independent ground truth for acceptance criterion 1)
- **Evidence reviewed:** `git show --stat 67ea4f7`, `git show 67ea4f7 --
  packages/shared/src/result.ts`, `git show 67ea4f7 --
  packages/shared/src/types.test.ts`, `git diff main...67ea4f7 --stat`,
  `git log --oneline -5`, direct reading of all new/changed source and the
  `sqlserver-customer` fixture, an independent throwaway probe test, fresh
  `npx vitest run packages/engine`, fresh `npx vitest run packages/shared`,
  fresh `npm run verify`.

## Critical findings

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| NONE | | | |

## Important findings

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| NONE | | | |

## Minor findings

| ID | Finding | Evidence | Suggested resolution |
| --- | --- | --- | --- |
| NONE | | | |

## Verification performed

| Check | Exact command or inspection | Result |
| --- | --- | --- |
| Scope — commit file list | `git show --stat 67ea4f7` | Exactly 5 files changed: `IMPLEMENTATION-REPORT.md`, `packages/engine/src/comparison-core/schema-diff/schema-diff.ts` (new), `packages/engine/src/comparison-core/schema-diff/schema-diff.test.ts` (new), `packages/shared/src/result.ts`, `packages/shared/src/types.test.ts`. No files under `packages/engine/src/connector-sdk/**` or `packages/engine/src/comparison-core/type-mapping/**` touched. |
| Scope — full-branch diff vs `main` | `git diff main...67ea4f7 --stat` | Same 5 files, confirming no additional changes elsewhere on the branch. |
| Scope — `result.ts` diff content | `git show 67ea4f7 -- packages/shared/src/result.ts` | Only the `SchemaDifference` placeholder alias was replaced with a real interface (`columnName`, `kind: SchemaDifferenceKind`, `sourceType?`, `targetType?`, inherited `severity`/`message`), plus the new `SchemaDifferenceKind` export. `ProfileDifference`, `AggregateDifference`, `RowDifference` (still `DifferenceItem` aliases) and the `Severity` union are byte-for-byte unchanged — confirmed by direct diff inspection, not just report claims. |
| Scope — `types.test.ts` diff content and assessment | `git show 67ea4f7 -- packages/shared/src/types.test.ts` | Single 4-line change: one existing `schemaDifferences` literal (around line 218) gains `columnName: "CustomerID"` and `kind: "order-mismatch"` fields. No other line in the file touched; no assertion logic, describe/it structure, or test intent changed — the test still verifies the same `ComparisonResult` shape end-to-end, just with a literal that now satisfies the widened `SchemaDifference` interface. This is judged a trivial, mechanically-forced consequence of the authorized `result.ts` change (the literal would fail `tsc` otherwise), directly analogous to the T-04 precedent (reviewer-approved minimal `tsconfig.json`/`package.json` edits required by that task's own authorized change). Not out-of-bounds; does not warrant a revised brief. |
| Acceptance criterion 1 — fixture ground truth | Direct read of `packages/engine/fixtures/sqlserver-customer.ts` | `customer_target`'s `CREATE TABLE` (lines 56-63) has no `CreditLimit`/`CREDIT_LIMIT` column; `customer_source`'s (lines 31-39) has `CreditLimit DECIMAL(19,4)`. Independently confirms the documented drop, not just trusted from comments. |
| Acceptance criterion 1 — test correctness | Direct read of `schema-diff.test.ts` lines 34-50 | Fetches both schemas live via `FixtureConnector.getSchema` (not hand-built), calls `compareSchemas`, asserts a `missing-in-target` finding for `columnName === "CreditLimit"` with `severity === "Failure"`. Traced against `compareSchemas`'s logic (lines 92-104 of `schema-diff.ts`): `CreditLimit` exists in `source`, `targetByName.get("CreditLimit")` is `undefined` (confirmed by the fixture), so the `missing-in-target` branch fires with `expectations?.missingTargetColumnSeverity ?? DEFAULT_MISSING_SEVERITY` where `DEFAULT_MISSING_SEVERITY = "Failure"` and no `expectations` argument is passed in this test — correctly resolves to `Failure`. |
| M-07 — identical native-type short-circuit | Direct read of `compareType` (`schema-diff.ts` lines 171-196) | `if (source.nativeType === target.nativeType) return undefined;` executes before `compareCanonicalTypes` is called at all — confirmed by reading the function body, not inferred from the test name. `compareCanonicalTypes` is genuinely unreachable for identical native-type strings. |
| M-07 — original DATETIME/TIMESTAMP_NTZ behavior preserved | Direct read of `schema-diff.test.ts` lines 63-72, traced against `compareType`/`compareCanonicalTypes` | `DATETIME` ≠ `TIMESTAMP_NTZ` as strings, so execution falls through to `compareCanonicalTypes("Timestamp", "Timestamp")`, which (per `type-mapping.ts` lines 267-274, unmodified) returns `"Review"` because `source === target === "Timestamp"` hits the documented same-category-downgrade branch. `TYPE_COMPATIBILITY_SEVERITY["Review"] = "Warning"` — matches the test's expectation and confirms T-05's original documented behavior was not broken. |
| M-07 — same-category, different-string, non-Timestamp/Time edge case (not in implementer's suite) | Independent throwaway probe: `compareSchemas([{name:"ID",nativeType:"INT",canonicalType:"Integer"}], [{name:"ID",nativeType:"INTEGER",canonicalType:"Integer"}])` | Native strings differ (`"INT"` ≠ `"INTEGER"`), so the short-circuit does *not* fire and execution correctly falls through to `compareCanonicalTypes("Integer","Integer")`, which returns `"Compatible"` (same category, not Timestamp/Time) per `type-mapping.ts`'s logic — `compareType` returns `undefined`. Probe run via `npx vitest run` confirmed `typeFindings` has length 0, matching the traced expectation. Probe file deleted immediately after use; `git status` confirms no residue. This closes the specific gap the task brief asked the reviewer to probe: the identical-string short-circuit is an *additional* fast path for the Timestamp/Time-only false positive, not a replacement for or interference with `compareCanonicalTypes`'s pre-existing correct same-category handling for every other type family. M-07's fix is complete, not just a fix for the literal test case. |
| Severity default — missing-target-column | Direct read of `schema-diff.ts` lines 59, 96-104 and `schema-diff.test.ts`'s acceptance-criterion-1 test | `DEFAULT_MISSING_SEVERITY: Severity = "Failure"` is applied whenever no `expectations.missingTargetColumnSeverity` override is supplied, matching `Idea Prompt.md` section 12's `missing_target_column: fail` example. A second test (lines 148-154) confirms the override path works (`Warning` when explicitly configured), proving the default is a real default, not a hardcoded value. |
| Fresh focused test run (engine) | `npx vitest run packages/engine` (re-run by this reviewer) | Exit 0. 4 test files, **229/229 tests** passed (69 type-mapping + 109 statement-safety + 11 new schema-diff + 40 fixture-connector). Matches the implementation report's claim exactly. |
| Fresh focused test run (shared) | `npx vitest run packages/shared` (re-run by this reviewer) | Exit 0. 1 test file, **11/11 tests** passed — no regression from the `SchemaDifference` refinement. |
| Fresh full verification | `npm run verify` (re-run by this reviewer) | Exit 0. `tsc -b --force`: no errors. `eslint .`: no errors. `vitest run`: 5 test files, **240/240 tests** passed (11 shared + 69 type-mapping + 109 statement-safety + 11 schema-diff + 40 fixture-connector). Matches the implementation report's claim exactly, no regressions. |

## Prior-finding disposition

| Finding ID | Disposition | Evidence of resolution |
| --- | --- | --- |
| M-01 (T-01, transitive devDependency audit warnings) | NOT APPLICABLE | T-06 added no dependencies; unrelated to schema-diff scope. |
| M-04 (T-02, thin `DifferenceItem` alias shared across Schema/Profile/Aggregate/Row differences, tracked for T-06 to refine the schema-diff shape specifically) | RESOLVED (for `SchemaDifference` only) | `packages/shared/src/result.ts`'s `SchemaDifference` is now a real interface (`columnName`, `kind: SchemaDifferenceKind`, `sourceType?`, `targetType?`) extending `DifferenceItem`, confirmed by direct diff read. `ProfileDifference`/`AggregateDifference`/`RowDifference` remain thin aliases, correctly left open and tracked for T-07/T-13/T-14 per the brief's explicit scope boundary — this is the expected partial resolution, not a gap. |
| M-05 (T-03, SQL Server `GO` batch separator not recognized) | NOT APPLICABLE | Tracked for T-17; unrelated to schema-diff. |
| M-06 (T-03, PostgreSQL dollar-quoting scanner desync) | NOT APPLICABLE | Tracked for T-19; unrelated to schema-diff. |
| M-07 (T-05, `compareCanonicalTypes` downgrades identical Timestamp/Timestamp and Time/Time native-type pairs to `Review` instead of `Compatible`, explicitly assigned to T-06 to resolve) | RESOLVED | `compareType`'s identical-native-type-string short-circuit (`schema-diff.ts` lines 171-179) bypasses `compareCanonicalTypes` entirely for identical native strings, confirmed by direct code trace (not just the passing test). Original `DATETIME`/`TIMESTAMP_NTZ` → `Warning` behavior confirmed preserved by trace and fresh test run. Independent probe of the same-category/different-string/non-Timestamp edge case (`INT` vs `INTEGER`) confirms `compareCanonicalTypes`'s pre-existing same-category-is-Compatible logic is untouched and still reachable — the fix is additive and complete, not a narrow patch for the literal test case. `type-mapping.ts` itself confirmed unmodified (`git show --stat 67ea4f7` and full-branch diff both show 0 changes to that file). |
| M-08 (T-05, collation-suffixed native type strings like `VARCHAR(255) COLLATE ...` fall to `Unknown`) | NOT APPLICABLE | Tracked for T-17 (real SQL Server connector); `nativeType` as consumed by `compareType`/`mapNativeType` is unrelated to schema-diff's own logic — T-06 does not alter `mapNativeType`'s parsing. |

## Approval status

- **Status:** APPROVED
- **Reviewer:** Claude Code Independent Reviewer subagent
- **Date:** 2026-07-27
- **Release or dependency impact:** T-06 delivers `compareSchemas` and the
  refined `SchemaDifference` shape (`columnName`, `kind`, `sourceType?`,
  `targetType?`) that T-09 (orchestration planner) is expected to consume.
  `DESIGN-SPEC.md` acceptance criterion 1 is independently verified against
  the actual `sqlserver-customer` fixture (not a hand-built substitute). M-07
  is genuinely resolved with no discovered gap. No Critical or Important
  findings block downstream work. `ProfileDifference`, `AggregateDifference`,
  `RowDifference`, and `Severity` remain untouched and available for
  T-07/T-13/T-14 as designed. No other pending findings block progression.
