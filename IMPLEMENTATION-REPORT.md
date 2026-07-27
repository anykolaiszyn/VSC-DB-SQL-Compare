# ParityLens — Implementation Report T-02

## Status and objective

- **Status:** COMPLETE (implementation and evidence for this task's scope only; not independently reviewed; not self-approved)
- **Objective:** Define the canonical shared TypeScript types in
  `packages/shared`: the `DataPlatformConnector` interface,
  `ConnectorCapabilities`, `ColumnDefinition`, `QueryInput`,
  `ExecutionOptions`, `RecordBatch`, the canonical type-category enum
  (Integer, Decimal, FloatingPoint, Boolean, String, Binary, Date, Time,
  Timestamp, TimestampWithTimezone, JSON, Array, Object, Geospatial,
  Unknown), and the `ComparisonResult` shape (and its sub-shapes:
  schema/profile/aggregate/row differences, execution timing, and summary
  counts). No runtime logic — types and interfaces only.

## Module structure chosen

All files live under `packages/shared/src/` (the only path this task owns):

- `types.ts` — `CanonicalTypeCategory` (15-value union), `ColumnDefinition`,
  `QueryInput`, `ExecutionOptions`, `RecordBatch`.
- `connector.ts` — `DataPlatformConnector`, `ConnectorCapabilities`, and the
  connector-facing supporting types the interface's method signatures
  require: `ConnectionTestResult`, `CatalogInfo`, `SchemaInfo`,
  `ObjectScope`, `DataObjectKind`, `DataObjectInfo`, `ProfileOptions`,
  `GeneratedQuery`.
- `result.ts` — `ComparisonResult` and its sub-shapes: `Severity`,
  `DifferenceItem` (shared placeholder shape for the four difference
  arrays), `SchemaDifference`/`ProfileDifference`/`AggregateDifference`/
  `RowDifference` (all currently aliases of `DifferenceItem`),
  `ComparisonStatus`, `ComparisonSummary`, `RowCounts`, `ExecutionTiming`.
- `index.ts` — re-exports the public surface only (`export * from` each of
  the three modules above); no logic, matching the T-01 placeholder's role
  as the package entry point.
- `types.test.ts` — the focused Vitest shape/type-check test required by
  the task brief; imports every type above and constructs minimal
  conforming object literals, including a full structural implementation
  of `DataPlatformConnector`.

This mirrors the submodule split suggested in the task brief
(`connector.ts`, `types.ts`, `result.ts`, `index.ts`).

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/shared/src/types.ts` | New | Canonical type enum + `ColumnDefinition`/`QueryInput`/`ExecutionOptions`/`RecordBatch` |
| `packages/shared/src/connector.ts` | New | `DataPlatformConnector` + `ConnectorCapabilities` + supporting connector types |
| `packages/shared/src/result.ts` | New | `ComparisonResult` + sub-shapes |
| `packages/shared/src/index.ts` | Modified | Replaced T-01 placeholder export with `export * from` re-exports of the three new modules |
| `packages/shared/src/types.test.ts` | New | Focused Vitest shape/type-check test covering every deliverable interface |

No files outside `packages/shared/src/**` were touched. `packages/engine/**`,
`packages/extension/**`, and all T-01-owned root config files
(`package.json`, `tsconfig*.json`, `eslint.config.mjs`, `vitest.config.ts`,
`.gitignore`) are unmodified — verified before starting that
`packages/shared` was already a wired workspace member (it was, from T-01),
so no re-scaffolding was needed.

## Behavior and interfaces

- **Behavior delivered:** `@paritylens/shared` now exports the full set of
  types/interfaces named in the task brief. No runtime logic exists in the
  package; the only executable code is the test file's minimal object
  literals used purely to exercise the shapes under `tsc` and Vitest.
- **Interfaces consumed:** `npm run verify` contract from T-01 (unmodified
  in meaning; still runs `tsc -b --force`, `eslint .`, `vitest run` across
  all three workspaces).
- **Interfaces produced:**
  - `DataPlatformConnector` — matches Idea Prompt.md section 9 method-for-method: `testConnection()`, `getCatalogs()`, `getSchemas(catalog?)`, `getObjects(scope)`, `getSchema(input)`, `executeQuery(input, options): AsyncIterable<RecordBatch>`, `getCapabilities()`, `quoteIdentifier(identifier)`, `buildProfileQuery(input, columns, profileOptions)`.
  - `ConnectorCapabilities` — matches Idea Prompt.md section 9 field-for-field, including optional `maximumParameters`.
  - `CanonicalTypeCategory` — exactly the 15 values from Idea Prompt.md section 2, in the order listed there.
  - `ColumnDefinition` — `name`, `ordinalPosition`, `nativeType`, `canonicalType`, `nullable`, `isPrimaryKeyCandidate`, plus optional `length`/`precision`/`scale`.
  - `QueryInput`, `ExecutionOptions`, `RecordBatch` — see judgment calls below.
  - `ComparisonResult` — matches the Idea Prompt.md section 11 JSON example field-for-field (`comparison`, `runId`, `status`, `summary{passed,warnings,failed}`, `rowCounts{source,target,difference}`, `schemaDifferences`, `profileDifferences`, `aggregateDifferences`, `rowDifferences`, `execution{sourceDurationMs,targetDurationMs,comparisonDurationMs}`).

## Judgment calls on unspecified shapes

- **`QueryInput`:** Modeled as a discriminated union on a `kind` field —
  `{ kind: "table"; object: string }`, `{ kind: "query"; sql: string }`, or
  `{ kind: "sqlFile"; filePath: string }` — directly mirroring the three
  MVP input types from Idea Prompt.md section 14 ("Table versus table",
  "Query versus query", "SQL file versus SQL file"). A discriminated union
  lets downstream consumers (T-03's statement-safety parser, T-04/T-17-19
  connectors) exhaustively switch on `kind` with type narrowing instead of
  guessing which optional fields are populated.
- **`ExecutionOptions`:** Kept to `maxRows`, `timeoutMs`, and an optional
  `signal?: AbortSignal`, directly reflecting the two safety limits
  DESIGN-SPEC.md calls out by name ("a configurable maximum row cap...and
  query timeout") plus a cancellation hook consistent with
  `ConnectorCapabilities.supportsQueryCancellation`. Did not add
  fetch-size/isolation-level/etc. since no consumer in this plan currently
  needs them.
- **`RecordBatch`:** Modeled as row-oriented columnar data — a shared
  `columns: string[]` name list plus `rows: unknown[][]` and a `rowCount`
  — rather than a true Apache Arrow `RecordBatch`. Idea Prompt.md section 8
  recommends Arrow as "the preferred internal transfer format where drivers
  support it," but that's a connector-level optimization a connector can
  opt into and advertise via `ConnectorCapabilities.supportsArrowResults`;
  pulling an `apache-arrow` dependency into `packages/shared` for a
  types-only package felt like the wrong layer for that decision. This
  keeps `packages/shared` dependency-free. Documented the tradeoff inline
  in `types.ts`.
- **`ColumnDefinition`:** Used the exact minimum field set named in the
  task brief (native type, canonical type, length, precision, scale,
  nullability, name, ordinal position, primary-key-candidate flag).
  Idea Prompt.md section 2's structural-parity list also mentions partition
  columns, default values, and collation/case-sensitivity behavior; those
  were deliberately left out since T-06 (schema diff) is scoped to add
  fields it actually needs rather than this task guessing at a schema-diff
  shape it doesn't consume.
- **Difference-array item shapes (`SchemaDifference`, `ProfileDifference`,
  `AggregateDifference`, `RowDifference`):** All four are currently type
  aliases of one shared `DifferenceItem = { severity: Severity; message:
  string }` shape. `Severity` uses the exact six values from
  DESIGN-SPEC.md's severity model (Pass / Informational / Warning /
  Failure / Error / Skipped). This is intentionally minimal per the task
  brief's explicit instruction not to over-design these — their full shape
  is refined by T-06, T-07, T-13, and T-14 respectively. Because each is a
  separate named type alias (not all four collapsed into one type), a later
  task can widen its specific alias (e.g. `SchemaDifference extends
  DifferenceItem { columnName: string; ... }`) without touching the other
  three or breaking `ComparisonResult`'s field types.
- **`ComparisonStatus`:** Idea Prompt.md's example uses the literal string
  `"failed"`. Modeled as a union (`"passed" | "warning" | "failed" |
  "error"`) covering the plausible top-level run outcomes implied by the
  summary/severity model, rather than an unconstrained `string`, so
  consumers get type safety on the status field.

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline (pre-change) | `npm run verify` | Exit 0 — typecheck/lint/test all pass; test step reports "No test files found, exiting with code 0" (confirms T-01's green baseline before any T-02 change) | Captured in this session's transcript |
| Red state | `npm run verify` | Exit 2 at the `typecheck` step (`tsc -b --force`) — 8 `TS2305` errors ("Module './index.js' has no exported member '...'") for every type named in the new test file, plus 4 `TS7006` implicit-any errors on then-untyped test params. Lint/test steps did not run. | Captured in this session's transcript, reproduced below |
| Focused green state | `npx vitest run packages/shared` | Exit 0 — `types.test.ts`: 11 tests, 11 passed | Captured in this session's transcript |
| Full verification | `npm run verify` | Exit 0 — `tsc -b --force` clean, `eslint .` clean, `vitest run`: 1 test file, 11 tests, all passed | Captured in this session's transcript, reproduced below |

Note on the red-state command: `npx vitest run packages/shared` alone did
**not** fail before implementation (Vitest's esbuild transpile-only
pipeline does not type-check `.ts` imports, so a missing named export is
not caught at that layer). The true red state — and the one the task brief
explicitly allows ("or a more focused `npx vitest run packages/shared` if
the implementer wants a narrower focused command before the full one —
record whichever is used") — was captured via `npm run verify`, whose
`typecheck` step (`tsc -b --force`) is what actually fails on missing
exports. This is recorded above as the red-state command actually used.

### Full verify — red-state raw output

```
> paritylens@0.0.1 verify
> npm run typecheck && npm run lint && npm run test

> paritylens@0.0.1 typecheck
> tsc -b --force

packages/shared/src/types.test.ts(10,3): error TS2305: Module '"./index.js"' has no exported member 'CanonicalTypeCategory'.
packages/shared/src/types.test.ts(11,3): error TS2305: Module '"./index.js"' has no exported member 'ColumnDefinition'.
packages/shared/src/types.test.ts(12,3): error TS2305: Module '"./index.js"' has no exported member 'ComparisonResult'.
packages/shared/src/types.test.ts(13,3): error TS2305: Module '"./index.js"' has no exported member 'ConnectorCapabilities'.
packages/shared/src/types.test.ts(14,3): error TS2305: Module '"./index.js"' has no exported member 'DataPlatformConnector'.
packages/shared/src/types.test.ts(15,3): error TS2305: Module '"./index.js"' has no exported member 'ExecutionOptions'.
packages/shared/src/types.test.ts(16,3): error TS2305: Module '"./index.js"' has no exported member 'QueryInput'.
packages/shared/src/types.test.ts(17,3): error TS2305: Module '"./index.js"' has no exported member 'RecordBatch'.
packages/shared/src/types.test.ts(139,24): error TS7006: Parameter '_scope' implicitly has an 'any' type.
packages/shared/src/types.test.ts(167,25): error TS7006: Parameter '_input' implicitly has an 'any' type.
packages/shared/src/types.test.ts(167,33): error TS7006: Parameter '_columns' implicitly has an 'any' type.
packages/shared/src/types.test.ts(167,43): error TS7006: Parameter '_profileOptions' implicitly has an 'any' type.
EXIT_CODE=2
```

### Full verify — final green-state raw output

```
> paritylens@0.0.1 verify
> npm run typecheck && npm run lint && npm run test

> paritylens@0.0.1 typecheck
> tsc -b --force

> paritylens@0.0.1 lint
> eslint .

> paritylens@0.0.1 test
> vitest run

 RUN  v2.1.9 V:/Secret Projects/VSC-DB-SQL-Compare

 ✓ packages/shared/src/types.test.ts (11 tests) 4ms

 Test Files  1 passed (1)
      Tests  11 passed (11)
EXIT_CODE=0
```

An intermediate full-verify run also caught a lint-only failure (8
`@typescript-eslint/no-unused-vars` errors on intentionally-unused
interface-implementation parameters in `types.test.ts`, since this repo's
`eslint.config.mjs` — a T-01-owned file this task must not modify — has no
`argsIgnorePattern` for a `_`-prefix convention). Fixed by referencing each
parameter with a no-op `void param;` statement inside the function body
instead of relying on an underscore-prefix naming convention, avoiding any
change to root ESLint configuration.

## Assumptions and risks

- **Assumptions:**
  - `packages/shared` was already a correctly wired npm workspace member
    from T-01 (confirmed: root `package.json` lists `"packages/*"` as a
    workspace, `packages/shared/package.json`/`tsconfig.json` already
    existed and needed no changes).
  - The four difference-array item shapes are intentionally deferred to
    their owning tasks (T-06, T-07, T-13, T-14) per the task brief's
    explicit instruction; this task does not attempt to anticipate their
    final field sets beyond the shared `severity`/`message` placeholder.
  - `RecordBatch`'s row-oriented (non-Arrow) representation is a reasonable
    interim shape; if a later task determines Arrow's actual
    `RecordBatch`/`Table` types are needed at the shared-types layer, that
    would be a scoped interface-change task per `IMPLEMENTATION-PLAN.md`'s
    "Interface change control" section, not a silent extension.
- **Risks or limitations:**
  - Because the four difference-array types are currently identical
    aliases of `DifferenceItem`, nothing today prevents assigning a
    `RowDifference` value into `schemaDifferences` at the type level (they
    are structurally the same type). This is an accepted, documented
    tradeoff for this task's scope (deliberately not over-designed) — T-06/
    T-07/T-13/T-14 introducing distinct discriminated fields will close this
    gap naturally as they extend each alias.
  - `ComparisonStatus` and `DataObjectKind` are judgment-call unions not
    given verbatim in the idea doc; a later task may need to widen them
    (e.g. add a `"skipped"` status) — that would be a normal, backward-
    compatible union extension, not a breaking change to already-consumed
    fields.
- **Blockers:** None.

## Patch or commit identity

- **Patch or commit:** `ffa6accfb64821132200a65b3e1f6449b392b444`
- **Branch or workspace:** `task/T-02-shared-types`
- **Commit message:** "T-02: define canonical shared types in packages/shared"
- **Files committed:** `packages/shared/src/connector.ts`,
  `packages/shared/src/index.ts` (modified), `packages/shared/src/result.ts`,
  `packages/shared/src/types.test.ts`, `packages/shared/src/types.ts` — all
  within this task's owned path (`packages/shared/src/**`) only.
- **Note:** `PROGRESS-LEDGER.md` and `TASK-BRIEF.md` had pre-existing
  working-tree modifications (made by the Lead Orchestrator to activate
  T-02) present before this task started; per this task's ownership scope
  and the rule against touching `PROGRESS-LEDGER.md`, those files were left
  unstaged/uncommitted by this task and are the Lead Orchestrator's to
  commit.

## Recommended next step

Independent review required. A separate Claude Code subagent instance,
distinct from this implementer, should review this change against
`DESIGN-SPEC.md`'s Architecture and component contracts section and
`Idea Prompt.md` sections 2/9/11, confirming every interface named there
exists with matching field-level contracts, before T-03/T-04 (which depend
on T-02's interfaces) or any merge to `main` proceeds. This implementer
does not have authority to approve or mark this task complete/reviewed.
