// T-38: pure, preview-only "dry run" of the SQL `runComparison` (planner.ts)
// would execute for a given `ParityDefinition` -- built to close the gap
// DESIGN-SPEC.md's "generated SQL is shown to the user for preview before
// execution" requirement identifies: today `paritylens.runComparison`
// executes real queries against real databases with no preview step.
//
// `planQueries` mirrors `runComparison`'s own query-building logic exactly
// -- same `checks.*.enabled` gating, same `resolveSideInput` calls, same
// builder functions (`buildProfileQueries`, `buildRowCountSql`,
// `buildFetchAllRowsSql`) -- so the preview this function returns can never
// drift from what a real run would actually execute. The two functions are
// intentionally *not* unified into one shared internal helper: `planner.ts`
// is prohibited scope for this task (its exported signature/control flow
// must stay completely untouched, per TASK-BRIEF.md's Prohibited changes),
// so this file re-walks the same steps `runComparison` takes, calling the
// exact same exported builder functions `runComparison` itself calls,
// rather than reimplementing any SQL-building logic of its own. This is the
// anti-drift guarantee: every string this function returns is the direct
// return value of one of those three shared builders (or, for
// `checks.rowLevel`, `buildFetchAllRowsSql` -- same as `runComparison`).
//
// Scope clarification carried over from TASK-BRIEF.md's Objective section:
// "zero execution" means zero `executeQuery` calls -- the actual comparison
// queries (row-count SQL, row-level fetch SQL, profile-metric SQL) are
// never run by this function. It does not mean zero connector contact:
// building an accurate profile-check query preview requires knowing each
// column's type, which requires a `getSchema()` call (schema introspection,
// not a data-fetching query) exactly the way `runComparison` itself already
// does before building profile queries (planner.ts's `runComparison`, the
// `if (schemaEnabled || profileEnabled)` block that calls
// `source.getSchema`/`target.getSchema`). `planQueries` calls `getSchema()`
// under the identical gating condition; it never calls `executeQuery()`
// anywhere, directly or transitively -- none of the three builder functions
// it calls (`buildProfileQueries`, `buildRowCountSql`, `buildFetchAllRowsSql`)
// issue a query themselves; they only return a SQL string.
//
// Ordering: schema/profile queries first, then row-count, then row-level --
// matching `runComparison`'s own `queriesUsed` accumulation order exactly
// (planner.ts pushes profile queries in the `if (schemaEnabled ||
// profileEnabled)` block, then row-count queries in the `if
// (rowCountEnabled)` block, then row-level queries in the `if
// (rowLevelEnabled)` block, in that source-order sequence).
//
// Judgment call, disclosed per TASK-BRIEF.md Scope item 1's last bullet:
// schema comparison itself (`compareSchemas`) issues no SQL of its own --
// confirmed by reading `runComparison`'s `queriesUsed` accumulation, which
// only ever receives pushes from the profile/row-count/row-level branches,
// never from the schema-only path. So when `checks.schema.enabled` is true
// but `checks.profile.enabled` is false, this function still resolves both
// sides and calls `getSchema` (needed only to mirror `runComparison`'s own
// control flow precisely and to surface a genuine connectivity/schema
// error the same way a real run would encounter one at that same point),
// but appends nothing to the returned query list for that check -- there is
// no "schema query" in the `queriesUsed` sense today, only profile queries
// exist in that category.
//
// Error propagation: like `runComparison`, this function does not wrap
// `getSchema`/`resolveSideInput` calls in a try/catch of its own -- a
// genuine error (e.g. `getSchema` rejecting because a table doesn't exist)
// is allowed to propagate to the caller. This mirrors `runComparison`'s own
// documented behavior for every check past the Layer-1 connectivity
// short-circuit (schema/profile/row-count/row-level errors are not
// downgraded to an empty result there either -- see planner.ts's own header
// comment and its `runComparison`/`rowCountEnabled` block comment). Since
// `planQueries` is a preview-only, no-side-effects function with no
// `ComparisonResult` to assemble and no Layer-1 connectivity-status
// contract of its own to uphold, propagating the error directly is the
// smallest-drift choice: the caller (`runComparisonCommand`, activate.ts)
// already has its own outer try/catch for exactly this kind of
// pre-execution failure.
//
// One deliberate exception to "propagate genuine errors directly," found
// while wiring this into `runComparisonCommand` and verifying against
// `activate.test.ts`'s pre-existing T-30 suite: a *connectivity* failure
// specifically (an unreachable real connector) must not throw out of this
// function, mirroring `runComparison`'s own Layer-1 `testConnection()`
// short-circuit (planner.ts step 2) -- a real connector's `getSchema` has
// no graceful-failure handling of its own the way `testConnection()` does,
// so calling it against an unreachable host would otherwise reject and
// propagate as a generic pre-execution error, permanently pre-empting
// `runComparison`'s own existing "failed"-status result for that same
// scenario (this was caught by a genuine regression in two pre-existing
// `activate.test.ts` T-30 tests during implementation, not simply reasoned
// out in advance). `planQueries` therefore runs the identical
// `testConnection()` gate `runComparison` runs first, and returns an empty
// query list (rather than throwing) when either side fails it -- see the
// gate itself, below, for the full reasoning.
import type { ColumnDefinition, DataPlatformConnector, QueryInput } from "@paritylens/shared";
import type { ParityDefinition } from "../definition/definition.js";
import { buildProfileQueries } from "../../comparison-core/profiling/profiling.js";
import { buildRowCountSql } from "../../comparison-core/volume/volume.js";
import { resolveSideInput, buildFetchAllRowsSql, type ConnectorRegistry } from "./planner.js";

/** Thrown only when a named connection cannot be resolved through the
 * supplied `ConnectorRegistry` -- mirrors `planner.ts`'s own
 * `UnresolvedConnectionError`, reused directly (not reimplemented) so a
 * caller catching one error type catches both `planQueries` and
 * `runComparison`'s equivalent failure. Re-exported here is unnecessary --
 * `UnresolvedConnectionError` is already exported from `planner.ts` and
 * `@paritylens/engine`'s index; this file imports and throws the same
 * class. */
import { UnresolvedConnectionError } from "./planner.js";

/**
 * Builds the exact list of SQL strings `runComparison(definition,
 * connectors, baseDir)` would issue via `executeQuery` for the same
 * arguments, without ever calling `executeQuery` itself. See this file's
 * header comment for the full anti-drift contract and error-propagation
 * rationale.
 *
 * `baseDir` defaults are intentionally omitted here (required parameter,
 * not optional with a `process.cwd()` fallback like `runComparison`'s own
 * `baseDir`) -- TASK-BRIEF.md's signature is `planQueries(definition,
 * connectors, baseDir?)`, so `baseDir` stays optional at the call boundary,
 * but internally this function passes it straight through to
 * `resolveSideInput`/`buildFetchAllRowsSql`, both of which already default
 * to `process.cwd()` when `baseDir` is `undefined` -- reusing their own
 * existing default rather than duplicating it here keeps this function's
 * behavior byte-for-byte aligned with `runComparison`'s for every
 * `baseDir`-omitted call site.
 */
export async function planQueries(
  definition: ParityDefinition,
  connectors: ConnectorRegistry,
  baseDir?: string
): Promise<string[]> {
  const source = connectors.get(definition.source.connection);
  const target = connectors.get(definition.target.connection);

  if (!source) {
    throw new UnresolvedConnectionError(definition.source.connection, "source");
  }
  if (!target) {
    throw new UnresolvedConnectionError(definition.target.connection, "target");
  }

  // Layer 1 connectivity check, mirroring runComparison's own step 2
  // (planner.ts) exactly -- a real connector's getSchema call below has no
  // graceful-failure handling of its own (unlike testConnection(), which
  // every connector implements to return a ConnectionTestResult rather
  // than reject); calling getSchema against an unreachable host would
  // otherwise reject and propagate out of this function as a generic
  // error. runComparison shields against this identical scenario by
  // checking testConnection() first and short-circuiting to a
  // "failed"-status ComparisonResult before any schema/profile work runs.
  // planQueries has no ComparisonResult to build, so it short-circuits to
  // an empty query list instead -- the confirmation panel then shows "no
  // queries" for a connection that can't be reached, and if the user still
  // clicks Run, runComparison's own identical Layer-1 check performs the
  // real, authoritative connectivity determination and produces the
  // correct "failed"-status result exactly as it did before this task
  // existed. This is the one respect in which planQueries's checks.*
  // control flow is a superset of runComparison's own -- required per this
  // file's header comment ("must not throw for a connectivity failure the
  // way runComparison doesn't either") and disclosed here rather than left
  // as an unstated behavioral gap.
  const [sourceConnectResult, targetConnectResult] = await Promise.all([source.testConnection(), target.testConnection()]);
  if (!sourceConnectResult.success || !targetConnectResult.success) {
    return [];
  }

  const queriesUsed: string[] = [];

  const schemaEnabled = definition.checks.schema?.enabled === true;
  const profileEnabled = definition.checks.profile?.enabled === true;

  if (schemaEnabled || profileEnabled) {
    const sourceInput = await resolveSideInput(definition.source, baseDir ?? defaultBaseDir());
    const targetInput = await resolveSideInput(definition.target, baseDir ?? defaultBaseDir());
    const sourceColumns = await source.getSchema(sourceInput);
    const targetColumns = await target.getSchema(targetInput);

    // Schema comparison itself issues no SQL -- see this file's header
    // comment's judgment-call note. Only when profiling is enabled do we
    // collect query strings, mirroring runComparison's runProfileChecks
    // exactly (same column-pairing logic: definition.columnMapping lookup
    // falling back to identical-name match, same skip of unmapped source
    // columns).
    if (profileEnabled) {
      queriesUsed.push(...buildProfileQueryStrings(source, target, sourceColumns, targetColumns, definition, sourceInput, targetInput));
    }
  }

  const rowCountEnabled = definition.checks.rowCount?.enabled === true;
  const rowLevelEnabled = definition.checks.rowLevel?.enabled === true;

  if (rowCountEnabled) {
    const rowCountSourceInput = await resolveSideInput(definition.source, baseDir ?? defaultBaseDir());
    const rowCountTargetInput = await resolveSideInput(definition.target, baseDir ?? defaultBaseDir());
    queriesUsed.push(buildRowCountSql(source, rowCountSourceInput), buildRowCountSql(target, rowCountTargetInput));
  }

  if (rowLevelEnabled) {
    queriesUsed.push(
      await buildFetchAllRowsSql(source, definition.source, baseDir ?? defaultBaseDir()),
      await buildFetchAllRowsSql(target, definition.target, baseDir ?? defaultBaseDir())
    );
  }

  return queriesUsed;
}

/** Same default as `planner.ts`'s own private `defaultBaseDir` (not
 * imported -- that function is private to `planner.ts` and not part of its
 * exported surface) -- the process's current working directory, used only
 * when the caller omits `baseDir` entirely, matching
 * `resolveSideInput`/`buildFetchAllRowsSql`'s own identical default so this
 * function's behavior stays aligned with theirs for every omitted-`baseDir`
 * call. */
function defaultBaseDir(): string {
  return process.cwd();
}

/**
 * Collects every profile-query SQL string `runComparison`'s private
 * `runProfileChecks` (planner.ts) would collect for the same
 * source/target column pairing, without ever calling `profileColumn`
 * (which executes the query) -- only `buildProfileQueries` (the pure
 * builder `profileColumn` itself sources its SQL from) is called.
 * Reimplements `runProfileChecks`'s column-pairing/`now`-pinning logic
 * exactly (same `definition.columnMapping` lookup, same identical-name
 * fallback, same skip of source columns with no target-side counterpart)
 * since that pairing logic itself is private to `planner.ts` and out of
 * scope to import or modify -- but never diverges from it, since both
 * walk `sourceColumns` in the same order under the same mapping rules.
 */
function buildProfileQueryStrings(
  source: DataPlatformConnector,
  target: DataPlatformConnector,
  sourceColumns: ColumnDefinition[],
  targetColumns: ColumnDefinition[],
  definition: ParityDefinition,
  sourceInput: QueryInput,
  targetInput: QueryInput
): string[] {
  const targetByName = new Map(targetColumns.map((c) => [c.name, c]));
  const mappedTargetName = new Map<string, string>();
  for (const entry of definition.columnMapping) {
    if ("source" in entry) {
      mappedTargetName.set(entry.source, entry.target);
    }
  }

  const queriesUsed: string[] = [];

  for (const sourceColumn of sourceColumns) {
    const targetName = mappedTargetName.get(sourceColumn.name) ?? sourceColumn.name;
    const targetColumn = targetByName.get(targetName);
    if (!targetColumn) {
      continue;
    }

    // Single `now` per column pair, matching runProfileChecks's own
    // TIMESTAMP-literal-stability rationale (planner.ts's header comment
    // on this exact line) -- irrelevant here since this function never
    // calls profileColumn (which is the other consumer that would
    // otherwise independently default `now`), but kept for symmetry with
    // buildProfileQueries's ProfileOptions shape.
    const now = new Date();
    queriesUsed.push(
      ...buildProfileQueries(source, sourceColumn, { input: sourceInput, now }),
      ...buildProfileQueries(target, targetColumn, { input: targetInput, now })
    );
  }

  return queriesUsed;
}
