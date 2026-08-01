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
export * from "./orchestration/definition/definition.js";
export * from "./orchestration/planner/planner.js";
export * from "./connector-sdk/fixture/fixture-connector.js";
