// Public entry point for @paritylens/shared.
//
// Module structure (T-02):
// - types.ts      — canonical type-category enum, ColumnDefinition, and the
//                    connector-agnostic query/execution/result-batch shapes
//                    (QueryInput, ExecutionOptions, RecordBatch).
// - connector.ts   — DataPlatformConnector and its supporting types
//                     (ConnectorCapabilities, catalog/schema/object info,
//                     profile-query generation), per Idea Prompt.md
//                     section 9.
// - result.ts      — ComparisonResult and its sub-shapes, per Idea
//                     Prompt.md section 11.
// - index.ts (this file) — re-exports the public surface only; no logic.
export * from "./types.js";
export * from "./connector.js";
export * from "./result.js";

