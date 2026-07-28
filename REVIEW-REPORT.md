# ParityLens — Review Report T-05

## Review independence

This review was performed by a Claude Code Independent Reviewer subagent
distinct from the T-05 implementer subagent. No implementation file
(`packages/engine/src/comparison-core/type-mapping/type-mapping.ts` or
`type-mapping.test.ts`), `TASK-BRIEF.md`, or `IMPLEMENTATION-REPORT.md` was
edited during this review. A temporary reviewer-authored test file
(`__reviewer_scratch.test.ts`) was created solely to independently re-derive
the worked examples, run, and then deleted before this report was written;
`git status` confirms it left no residue (only pre-existing, unrelated
working-tree changes to `PROGRESS-LEDGER.md`/`TASK-BRIEF.md` remain, present
before this review began).

## Review scope

- **Task objective:** Implement the canonical type-mapping layer —
  `mapNativeType(nativeType, platform): CanonicalTypeCategory` and
  `compareCanonicalTypes(source, target): 'Compatible' | 'Review' | 'Risk'`,
  satisfying `Idea Prompt.md` section 2's worked example and the T-04 fixture
  native types.
- **Files and interfaces reviewed:**
  `packages/engine/src/comparison-core/type-mapping/type-mapping.ts` (317
  lines), `type-mapping.test.ts` (209 lines, 69 tests);
  `packages/shared/src/types.ts` (`CanonicalTypeCategory`, `ColumnDefinition`);
  `packages/engine/fixtures/sqlserver-customer.ts`,
  `snowflake-orders.ts`, `postgres-products.ts`; commits `c1ba63b` and
  `429b251` on `task/T-05-type-mapping`.
- **Evidence reviewed:** `TASK-BRIEF.md`, `IMPLEMENTATION-REPORT.md`,
  `Idea Prompt.md` section 2 and section 17, `AGENTS.md`, `PROGRESS-LEDGER.md`
  (prior findings section), fresh command output from this review's own
  execution (see below).

## Critical findings

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| NONE | — | — | — |

## Important findings

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| NONE | — | — | — |

## Minor findings

| ID | Finding | Evidence | Suggested resolution |
| --- | --- | --- | --- |
| M-07 | The Timestamp/Timestamp (and Time/Time) same-category special-case downgrade to `Review` is necessary to reproduce the idea doc's DATETIME/TIMESTAMP_NTZ example, but it is a blunt instrument: it also flags two **genuinely identical** timestamp types (e.g. `DATETIME2` vs `DATETIME2` on both sides of a real SQL Server-to-SQL Server or same-platform comparison) as Review, not Compatible, even though no timezone ambiguity exists in that case. Confirmed by reviewer's own probe: `compareCanonicalTypes(mapNativeType("DATETIME2","sqlserver"), mapNativeType("DATETIME2","sqlserver"))` → `"Review"`. | `type-mapping.ts` lines 267–274; reviewer's independent test run (see Verification below), test named "regression probe: identical DATETIME2/DATETIME2 on both sides" | Non-blocking for T-05, since `Idea Prompt.md` gives no worked example that requires distinguishing "same exact native type" from "same canonical category, different native spelling" at this pairwise-category-only layer, and the task brief explicitly scopes finer-grained severity to T-06. Recommend T-06 (schema diff) either (a) special-case same-native-type pairs as Compatible before falling back to `compareCanonicalTypes`, or (b) revisit whether `CanonicalTypeCategory` should split `Timestamp` into a naive/local variant and a distinct "explicitly timezone-agnostic" variant so the category system itself carries the distinction this special case currently papers over. Track as a follow-up decision for the T-06 implementer/reviewer, not a T-05 blocker. |
| M-08 | `VARCHAR(255) COLLATE SQL_Latin1_General_CP1_CI_AS` (a real, common SQL Server column-definition suffix) falls through to `Unknown` rather than `String`, because the string-variant regex is anchored (`^...(\(\d+\))?$`) and does not tolerate a trailing collation clause. This is consistent with the documented "never throw, fall back to Unknown" contract (so it is not a correctness bug), but it means a realistic SQL Server type string that includes collation metadata will silently route to Unknown → Review at the compatibility layer rather than being correctly recognized as String. | Reviewer's independent test: `mapNativeType("VARCHAR(255) COLLATE SQL_Latin1_General_CP1_CI_AS", "sqlserver")` → `"Unknown"` (confirmed passing, i.e., matches the fallback contract, but flagged as a coverage gap) | Non-blocking: `nativeType` as consumed here is expected to be the connector-reported bare type string (per `ColumnDefinition.nativeType`'s doc comment and its usage in `mapNativeType`'s own examples, e.g. `"NUMBER(38,0)"`, `"VARCHAR(255)"`), not a full column DDL fragment with collation. No evidence any T-04 fixture or real-platform connector (T-17) actually reports collation-suffixed strings through `nativeType`. Worth a one-line doc-comment note or a future test once T-17 (SQL Server connector) is implemented and its actual `nativeType` reporting format is known. |

## Verification performed

| Check | Exact command or inspection | Result |
| --- | --- | --- |
| Independent re-derivation of the 5 worked examples | Reviewer wrote a fresh, throwaway Vitest file (`__reviewer_scratch.test.ts`, not copied from the implementer's test file) importing `mapNativeType`/`compareCanonicalTypes` directly and asserting each of the 5 `Idea Prompt.md` section 2 rows independently; ran `npx vitest run packages/engine/src/comparison-core/type-mapping/__reviewer_scratch.test.ts --reporter=verbose`; deleted the file afterward | All 5 pass exactly: INT/NUMBER(38,0)→Integer/Integer→Compatible; VARCHAR(100)/VARCHAR(255)→String/String→Compatible; DATETIME/TIMESTAMP_NTZ→Timestamp/Timestamp→Review; BIT/BOOLEAN→Boolean/Boolean→Compatible; MONEY/FLOAT→Decimal/FloatingPoint→Risk. 14/14 reviewer tests passed (5 worked examples + 9 edge-case probes) |
| Focused engine test suite (fresh run) | `npx vitest run packages/engine` | 3 test files passed, **218 tests passed**, matches `IMPLEMENTATION-REPORT.md`'s claim exactly |
| Full verification (fresh run) | `npm run verify` | `tsc -b --force` clean, `eslint .` clean, `vitest run`: 4 test files passed, **229 tests passed**, `EXIT_CODE=0` — matches claim exactly |
| Isolated typecheck | `npx tsc -b --force` | Clean, exit 0 |
| Scope check | `git show --stat c1ba63b` and `git show --stat 429b251` | `c1ba63b` touches only `type-mapping.ts` (new, 316 lines) and `type-mapping.test.ts` (new, 209 lines) under the owned `packages/engine/src/comparison-core/type-mapping/**` path; `429b251` touches only `IMPLEMENTATION-REPORT.md`. No files outside T-05's declared ownership were touched; `packages/shared/**` and `packages/engine/src/connector-sdk/**` untouched |
| Snowflake NUMBER(p,0) vs standard DECIMAL(p,0)/NUMERIC(p,0) distinction | Read `type-mapping.ts` lines 49–80 directly; reviewer probe `mapNativeType("NUMBER(38,0)","snowflake")` → `Integer`, `mapNativeType("DECIMAL(38,0)","sqlserver")` → `Decimal`, `mapNativeType("NUMERIC(38,0)","sqlserver")` → `Decimal` | Implemented exactly as the report claims. This is a defensible real-world judgment call: Snowflake's `NUMBER` is genuinely its single generic numeric type (integer-by-convention at scale 0), while SQL Server/PostgreSQL's `DECIMAL`/`NUMERIC` are decimal-family types by declaration regardless of scale — the two platforms' type systems are not symmetric, so this asymmetric handling is correct rather than inconsistent |
| Unknown fallback / never-throws contract | Reviewer probes: empty string, whitespace-only string, lowercase `int`, mixed-case `VarChar(50)`, `VARCHAR(255) COLLATE ...`, bare `NUMBER`, bare `DECIMAL`, unrecognized `FROBNICATE_TYPE` | Never throws in any case (all wrapped in `expect(() => ...).not.toThrow()` where tested). Empty/whitespace-only and unrecognized strings correctly fall back to `Unknown`. Case-insensitivity works correctly (`.toUpperCase()` normalization). Collation-suffixed VARCHAR falls to `Unknown` rather than `String` — flagged as M-08 above, non-blocking |
| T-04 fixture native-type cross-check | Read `packages/engine/fixtures/sqlserver-customer.ts`, `snowflake-orders.ts`, `postgres-products.ts` directly | Fixtures are seeded through DuckDB (per T-04's design), so their actual DDL uses DuckDB-compatible type spellings (`TIMESTAMP`, `BOOLEAN`, `DECIMAL(19,4)`, `VARCHAR(n)`) even where the fixture's authoring comments describe the "real platform" type being modeled (SQL Server `MONEY`, `DATETIME`; Snowflake `NUMBER(p,s)`). This is a T-04 characteristic (DuckDB is the actual storage/schema-report engine), not a T-05 defect — `type-mapping.test.ts`'s "native types observed in/implied by T-04 fixtures" section correctly tests against the *real-platform* type strings the fixtures document in comments (e.g. `MONEY`, `DATETIMEOFFSET`, `TIMESTAMP_NTZ`, `NUMBER(38,0)`), which is the right target since T-17/T-18/T-19's real connectors (not yet built) are what will actually report these native strings. All such types map sensibly, none fall through to Unknown unexpectedly |

## Prior-finding disposition

| Finding ID | Disposition | Evidence of resolution |
| --- | --- | --- |
| M-01 (T-01, transitive devDependency audit warnings) | NOT APPLICABLE | T-05 added no dependencies; `package.json` files for `packages/engine` unchanged aside from source files under review |
| M-02 (T-01, `tsc -b --force` usage) | NOT APPLICABLE | Same verification convention reused consistently in T-05's evidence; already resolved at T-01 |
| M-03 (T-02, citation correction) | NOT APPLICABLE | Documentation-only finding on T-02's report; not touched by T-05 |
| M-04 (T-02, thin `DifferenceItem` shape shared across Schema/Profile/Aggregate/Row differences) | NOT APPLICABLE | T-05 does not touch `packages/shared/**` or produce any `DifferenceItem`; remains tracked for T-06/T-07/T-13/T-14 |
| I-01 (T-03, paren-wrapped CTE mutation bypass) | NOT APPLICABLE | Resolved at T-03; T-05 does not touch the statement-safety parser (only imports its `SqlDialect` type, read-only) |
| M-05 (T-03, SQL Server `GO` batch separator not recognized) | NOT APPLICABLE | Tracked for T-17; unrelated to type mapping |
| M-06 (T-03, PostgreSQL dollar-quoting scanner desync) | NOT APPLICABLE | Tracked for T-19; unrelated to type mapping |
| (T-04 review) | NOT APPLICABLE | T-04 review returned 0 findings; T-05 consumed T-04's fixtures read-only, no regression found |

## Approval status

- **Status:** APPROVED
- **Reviewer:** Claude Code Independent Reviewer subagent
- **Date:** 2026-07-27
- **Release or dependency impact:** T-05 is complete and unblocks T-06
  (schema diff) and T-07 (profiling), both of which consume `mapNativeType`
  and `compareCanonicalTypes`. Two Minor findings are recorded, neither
  blocking: M-07 (Timestamp/Timestamp same-category downgrade to Review is a
  sound, conservative-by-design interpretation of the idea doc's own worked
  example, but it will also flag genuinely identical timestamp types as
  Review when both sides of a real comparison use the exact same native
  type — the T-06 implementer/reviewer should decide whether to special-case
  identical-native-type pairs at the schema-diff layer, or revisit the
  canonical category split, rather than silently inheriting this over-flagging
  behavior) and M-08 (collation-suffixed native type strings fall to Unknown
  rather than String — track for T-17 once real SQL Server `nativeType`
  reporting format is known). Neither finding requires code changes before
  merge; both are forward-looking notes for downstream tasks.
