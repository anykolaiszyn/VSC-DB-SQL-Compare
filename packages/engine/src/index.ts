// Public entry point for @paritylens/engine.
//
// T-22: this file gives @paritylens/engine's package entry point real
// content for the first time -- through T-21, every engine-layer test
// imported from deep relative paths inside packages/engine/src/..., and no
// task ever re-exported the package's public surface through this file
// (it held only T-01's `PLACEHOLDER = true` placeholder). Following
// packages/shared/src/index.ts's own precedent exactly: a re-export-only
// file, no logic.
//
// Re-exports the public surface of the three modules a consumer outside
// packages/engine actually needs:
// - orchestration/definition/definition.ts -- `parseDefinition` plus the
//   `ParityDefinition` shape and `InvalidDefinitionError` it can throw.
// - orchestration/planner/planner.ts -- `runComparison`, the injectable
//   `ConnectorRegistry` type callers populate, `UnresolvedConnectionError`,
//   and the `buildFetchAllRowsSql` query-preview builder already exported
//   alongside them.
// - connector-sdk/fixture/fixture-connector.ts -- `FixtureConnector`, the
//   only connector implementation that exists yet (real SQL Server/
//   Snowflake/PostgreSQL connectors are T-17/T-18/T-19, still unscheduled).
//
// T-29 (amendment): adds two more re-exports, following the exact same
// precedent this file already set for T-22's three entries above -- no
// file in this monorepo deep-imports across the @paritylens/engine package
// boundary, so widening this file is the established way to expose newly
// needed public surface:
// - connector-sdk/sqlserver/sqlServerConnector.ts -- `SqlServerConnector`
//   and `SqlServerConnectionOptions`, needed by T-29's `resolveConnector`
//   (packages/extension/src/connections/resolveConnector.ts) to construct a
//   real SQL Server connector from a stored connection profile.
// - connector-sdk/postgres/postgresConnector.ts -- `PostgresConnector` and
//   `PostgresConnectionOptions`, needed by the same `resolveConnector` for
//   the PostgreSQL case.
//
// T-38 (amendment): adds one more re-export, following this file's own
// established precedent (T-29's amendment note above) -- no file in this
// monorepo deep-imports across the @paritylens/engine package boundary, so
// widening this file is the established way to expose newly needed public
// surface:
// - orchestration/planner/planQueries.ts -- `planQueries`, the new
//   pure, preview-only "dry run" query-builder `runComparisonCommand`
//   (packages/extension/src/activation/activate.ts) calls before showing
//   the pre-execution SQL preview + confirmation panel.
export * from "./orchestration/definition/definition.js";
export * from "./orchestration/planner/planner.js";
export * from "./orchestration/planner/planQueries.js";
export * from "./connector-sdk/fixture/fixture-connector.js";
export * from "./connector-sdk/sqlserver/sqlServerConnector.js";
export * from "./connector-sdk/postgres/postgresConnector.js";
