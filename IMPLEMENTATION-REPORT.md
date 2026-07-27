# ParityLens — Implementation Report T-05

## Status and objective

- **Status:** COMPLETE
- **Objective:** Implement the canonical type-mapping layer — map native
  database types (from the T-04 fixture connector's `ColumnDefinition.nativeType`
  values and declared real-platform type catalogs) into the canonical
  `CanonicalTypeCategory` enum (T-02), plus a `Compatible`/`Review`/`Risk`
  pairwise classification, per `Idea Prompt.md` section 2's worked example.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/engine/src/comparison-core/type-mapping/type-mapping.ts` | New | Implements `mapNativeType(nativeType, platform)` and `compareCanonicalTypes(source, target)`, the two interfaces T-05's task brief requires |
| `packages/engine/src/comparison-core/type-mapping/type-mapping.test.ts` | New | 69 focused Vitest tests: the 5 `Idea Prompt.md` worked examples verbatim, native types observed in/implied by the T-04 fixtures across all three platforms, an Unknown-fallback contract check, and additional compatibility-matrix cases |

No other files were modified. `packages/shared/**` and
`packages/engine/src/connector-sdk/**` were read-only inputs, never edited.

## Behavior and interfaces

- **Behavior delivered:**
  - `mapNativeType(nativeType: string, platform: SqlDialect): CanonicalTypeCategory`
    parses a native type string and returns exactly one of the 15 canonical
    categories from `packages/shared/src/types.ts`. It never throws — any
    unrecognized type string returns `"Unknown"` (documented fallback
    contract, exercised by dedicated tests).
  - `compareCanonicalTypes(source: CanonicalTypeCategory, target: CanonicalTypeCategory): 'Compatible' | 'Review' | 'Risk'`
    classifies a pair of canonical categories.
- **Interfaces consumed:** `CanonicalTypeCategory` and `ColumnDefinition`
  from `@paritylens/shared` (read-only); `SqlDialect` from
  `packages/engine/src/connector-sdk/safety/statement-safety.ts` (read-only,
  reused as the `platform` parameter type rather than inventing a
  parallel type). Fixture files
  (`packages/engine/fixtures/sqlserver-customer.ts`,
  `snowflake-orders.ts`, `postgres-products.ts`) were read to derive
  realistic native-type test cases; not modified.
- **Interfaces produced:** `mapNativeType`, `compareCanonicalTypes`, and the
  `TypeCompatibility` type alias, all exported from
  `packages/engine/src/comparison-core/type-mapping/type-mapping.ts`, for
  T-06 (schema diff) and T-07 (profiling) to consume.

## mapNativeType classification logic

Recognizes, per platform-agnostic pattern matching on the uppercased native
type string (platform parameter reserved for future disambiguation; every
currently-recognized type name means the same canonical thing on every MVP
platform):

- **Integer:** `TINYINT/SMALLINT/INT/INTEGER/BIGINT/...`, plus Snowflake
  `NUMBER(p,s)` with `s` absent or `0`.
- **Decimal:** `DECIMAL/NUMERIC` (bare or with any precision/scale,
  including scale 0 — standard SQL DECIMAL/NUMERIC is decimal-family *by
  declaration*, unlike Snowflake's generic `NUMBER`), `MONEY/SMALLMONEY`,
  and Snowflake `NUMBER(p,s)` with `s > 0`.
- **FloatingPoint:** `FLOAT/REAL/DOUBLE/DOUBLE PRECISION` variants.
- **Boolean:** `BIT/BOOLEAN/BOOL`.
- **String:** `VARCHAR/NVARCHAR/CHAR/NCHAR/TEXT/STRING/CLOB/BPCHAR`, with or
  without a length modifier.
- **Binary:** `BINARY/VARBINARY/BYTEA/BLOB/IMAGE/RAW`, including SQL
  Server's `VARBINARY(MAX)`.
- **JSON:** `JSON/JSONB/VARIANT`.
- **Array:** `ARRAY`, or any type ending in `[]`.
- **Object:** `OBJECT/STRUCT/RECORD`.
- **Geospatial:** `GEOGRAPHY/GEOMETRY/POINT/POLYGON/LINESTRING/...`.
- **TimestampWithTimezone:** `TIMESTAMPTZ/TIMESTAMP_TZ/TIMESTAMP WITH TIME ZONE/DATETIMEOFFSET`
  (checked before the plain-timestamp patterns since they share the
  `TIMESTAMP` prefix).
- **Date:** `DATE`.
- **Time:** `TIME`, with optional precision.
- **Timestamp:** `TIMESTAMP/TIMESTAMP_NTZ/TIMESTAMP WITHOUT TIME ZONE/DATETIME/DATETIME2/SMALLDATETIME`.
- **Unknown:** anything else (documented fallback, never throws).

## compareCanonicalTypes compatibility matrix

| Pair | Result | Reasoning |
| --- | --- | --- |
| Same category (general case) | Compatible | Same kind of value; length/precision-level severity is T-06's concern, not this pairwise primitive's |
| Timestamp / Timestamp (identical) | **Review** (not Compatible) | Reproduces the idea doc's own worked example verbatim: SQL Server `DATETIME` and Snowflake `TIMESTAMP_NTZ` both canonicalize to `Timestamp`, yet the doc classifies that exact pair as Review. Naive/timezone-less timestamp types carry an implicit timezone assumption from their source system that is not guaranteed to match across platforms — see idea doc section 17 ("DATETIME2 and TIMESTAMP_NTZ **may** be compatible") and section 4's explicit timezone-normalization rules |
| Time / Time (identical) | **Review** | Same implicit-timezone ambiguity as Timestamp/Timestamp; downgraded for consistency |
| Decimal / FloatingPoint | Risk | Reproduces `MONEY`/`FLOAT` → Risk. Decimal/Money is exact fixed-point; Float/Double is inexact binary. Converting between them can silently change the value |
| Integer / FloatingPoint | Risk | Same underlying risk as Decimal/FloatingPoint: integers beyond 2^53 are not exactly representable as IEEE-754 doubles |
| String / Binary | Risk | Different byte representation/encoding; direct comparison is essentially never correct without an explicit conversion rule — closer to "wrong to compare" than "understand a tradeoff", so Risk rather than Review |
| Integer / Decimal | Review | Direction-dependent: int→decimal is exact, decimal→int truncates. Category pair alone doesn't reveal direction, so flagged for a human |
| Date / Timestamp, Date / TimestampWithTimezone, Time / Timestamp, Time / TimestampWithTimezone | Review | Structurally related (Date is a Timestamp with the time component dropped) but needs confirmation of intended normalization — matches idea doc section 4's explicit "ignore time component" / "treat midnight timestamps as dates" rules, which exist precisely because this pairing needs configuration |
| Timestamp / TimestampWithTimezone | Review | Reproduces idea doc section 17's framing exactly; adding/dropping timezone awareness needs a documented timezone assumption (section 4's `timezone: source/target` rule), not a silent pass |
| JSON / String, JSON / Array, JSON / Object, Array / String, Array / Object, Object / String | Review | Semi-structured data is frequently represented as JSON-encoded text on one platform and a native semi-structured type on another (e.g. SQL Server `NVARCHAR` holding JSON vs Snowflake `VARIANT`) — a common, often-intentional migration pattern, so flagged for confirmation rather than treated as automatic Risk |
| Geospatial paired with anything | Review | Geospatial encoding compatibility (WKT/WKB/native) cannot be determined from the canonical category alone |
| Unknown paired with anything (including Unknown/Unknown) | Review | This primitive cannot make an informed judgment about an unrecognized type; silently passing would hide a real gap, silently failing would false-alarm on types that may be fine — Review correctly routes to a human |
| Every other cross-category pair (e.g. String/Integer, Boolean/Integer, Date/Boolean) | Risk | No meaningful value-space overlap; almost certainly a mapping error or genuine incompatibility, so the stricter default is safer |

Full reasoning for every rule above is also documented inline as a doc
comment directly above `compareCanonicalTypes` in `type-mapping.ts`.

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Red state | `npx vitest run packages/engine` | 1 test file failed to load (`Failed to load url ./type-mapping.js ... Does the file exist?`); 149 pre-existing tests still passed, 0 new tests ran | Captured in this session's transcript before implementation; reproduced by deleting `type-mapping.ts` |
| Focused green state | `npx vitest run packages/engine` | **3 test files passed, 218 tests passed** (149 pre-existing + 69 new), 0 failed | Session transcript; also re-confirmed as part of `npm run verify` below |
| Full verification | `npm run verify` | **Exit code 0.** `tsc -b --force` clean, `eslint .` clean, `vitest run`: **4 test files passed, 229 tests passed** (160 pre-existing baseline + 69 new), 0 failed | Session transcript |

Exact focused-green output:

```text
✓ packages/engine/src/comparison-core/type-mapping/type-mapping.test.ts (69 tests)
✓ packages/engine/src/connector-sdk/safety/statement-safety.test.ts (109 tests)
✓ packages/engine/src/connector-sdk/fixture/fixture-connector.test.ts (40 tests)

 Test Files  3 passed (3)
      Tests  218 passed (218)
```

Exact full-verification output (test portion):

```text
✓ packages/shared/src/types.test.ts (11 tests)
✓ packages/engine/src/comparison-core/type-mapping/type-mapping.test.ts (69 tests)
✓ packages/engine/src/connector-sdk/safety/statement-safety.test.ts (109 tests)
✓ packages/engine/src/connector-sdk/fixture/fixture-connector.test.ts (40 tests)

 Test Files  4 passed (4)
      Tests  229 passed (229)
```

`EXIT_CODE=0` confirmed by capturing `$?` immediately after the `npm run verify` invocation.

All five `Idea Prompt.md` section 2 worked examples pass exactly as given:

- `mapNativeType("INT","sqlserver")` → `Integer`, `mapNativeType("NUMBER(38,0)","snowflake")` → `Integer`, `compareCanonicalTypes("Integer","Integer")` → `Compatible`
- `mapNativeType("VARCHAR(100)","sqlserver")` → `String`, `mapNativeType("VARCHAR(255)","snowflake")` → `String`, → `Compatible`
- `mapNativeType("DATETIME","sqlserver")` → `Timestamp`, `mapNativeType("TIMESTAMP_NTZ","snowflake")` → `Timestamp`, → `Review`
- `mapNativeType("BIT","sqlserver")` → `Boolean`, `mapNativeType("BOOLEAN","postgres")` → `Boolean`, → `Compatible`
- `mapNativeType("MONEY","sqlserver")` → `Decimal`, `mapNativeType("FLOAT","snowflake")` → `FloatingPoint`, → `Risk`

## Assumptions and risks

- **Assumptions:**
  - The `platform: SqlDialect` parameter is accepted per the interface
    contract but does not currently branch any classification decision,
    because every native type name recognized by this mapping table means
    the same canonical thing on every MVP platform (`sqlserver`,
    `snowflake`, `postgres`, `duckdb`). It is kept as a required parameter
    (not dropped) so a future platform-specific exception can be added
    without an interface-breaking change.
  - `NUMBER(p,s)` with `s` absent or `0` is treated as Integer (Snowflake
    convention), while `DECIMAL(p,0)`/`NUMERIC(p,0)` (standard SQL,
    SQL Server/PostgreSQL) is treated as Decimal by declaration, not
    reinterpreted as Integer even at scale 0. This distinction was
    discovered via a genuine test failure during implementation (an
    earlier version of the regex applied the Snowflake scale-0-means-integer
    rule to DECIMAL/NUMERIC generally, which is wrong for standard SQL) and
    is now covered by a dedicated regression test
    (`NUMBER(38,0)` (Snowflake) is Integer but `DECIMAL(38,0)` (standard SQL) is Decimal).
  - Timestamp/Timestamp and Time/Time same-category pairs are deliberately
    downgraded from the general "same category = Compatible" rule to
    Review, to reproduce the idea doc's own DATETIME/TIMESTAMP_NTZ worked
    example exactly. This is a judgment call beyond the five given
    examples, documented inline in `compareCanonicalTypes`'s doc comment.
- **Risks or limitations:**
  - The compatibility matrix built here goes beyond the five worked
    examples with reasoned judgment calls (see table above); an independent
    reviewer should specifically scrutinize the non-obvious classifications
    (Integer/Decimal → Review, JSON-family cross-pairs → Review,
    Unknown-paired-with-anything → Review) since `Idea Prompt.md` does not
    give worked examples for these.
  - `mapNativeType` does not currently use the `platform` argument to
    disambiguate any type name. If a future real-platform type catalog
    (T-17/T-18/T-19) surfaces a genuinely platform-ambiguous native type
    name (same spelling, different canonical meaning on two platforms),
    this function will need a platform-specific branch added — no such
    case was found in the T-04 fixtures or the idea doc's worked examples,
    so none was speculatively added.
  - Length/precision/scale-aware severity (e.g. "target VARCHAR is shorter
    than source → truncation risk") is explicitly out of scope for this
    pairwise category-only primitive; per the task brief, that is T-06
    schema diff's responsibility, which will consume `ColumnDefinition`'s
    `length`/`precision`/`scale` fields directly alongside this module's
    category comparison.
- **Blockers:** None.

## Patch or commit identity

- **Patch or commit:** `c1ba63bce4665b03aaa6fb20b681790b59ab53dc`
- **Branch or workspace:** `task/T-05-type-mapping` (branched from `main`
  at the T-01–T-04-merged, 160/160-green baseline)

## Recommended next step

Independent review by a separate Claude Code subagent instance, distinct
from this implementer, per `TASK-BRIEF.md`'s handoff contract. The reviewer
must **independently re-derive** at least the five `Idea Prompt.md` section
2 worked examples (not just trust this report's claim that they pass) by
running `npx vitest run packages/engine/src/comparison-core/type-mapping`
and/or calling `mapNativeType`/`compareCanonicalTypes` directly, and should
specifically scrutinize the non-obvious compatibility-matrix judgment calls
listed above (Integer/Decimal, Timestamp/Timestamp downgrade,
JSON-family pairs, Unknown handling) since those go beyond what
`Idea Prompt.md` explicitly specifies. Required owner: independent reviewer
subagent dispatched by the Lead Orchestrator; findings recorded in
`REVIEW-REPORT.md`. This task must not be marked complete/approved by the
implementer.
