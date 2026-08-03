// T-38: planQueries tests.
//
// Structure:
//   1. Red-state/core anti-drift proof: planQueries's output, compared
//      against runComparison's own queriesUsed for the exact same
//      definition/connectors, matches byte-for-byte (same strings, same
//      order) -- for at least two different check-enablement combinations,
//      per TASK-BRIEF.md's Handoff note item 1.
//   2. Zero-executeQuery proof: a spy-wrapped FixtureConnector confirms
//      executeQuery is never called during a planQueries run, while
//      getSchema is called (schema introspection is allowed).
//   3. Unresolved-connection proof: mirrors planner.ts's own
//      UnresolvedConnectionError contract.
import { describe, expect, it } from "vitest";
import { parseDefinition } from "../definition/definition.js";
import { FixtureConnector } from "../../connector-sdk/fixture/fixture-connector.js";
import { runComparison, UnresolvedConnectionError, type ConnectorRegistry } from "./planner.js";
import { planQueries } from "./planQueries.js";
import type { DataPlatformConnector, QueryInput, ExecutionOptions, RecordBatch, ColumnDefinition } from "@paritylens/shared";

const SCHEMA_ONLY_YAML = `
version: 1
name: customer-migration-parity
source:
  connection: legacy-sql-prod
  object: customer_source
target:
  connection: snowflake-analytics
  object: customer_target
keys:
  - CustomerID
checks:
  schema:
    enabled: true
`;

const PROFILE_YAML = `
version: 1
name: customer-migration-parity
source:
  connection: legacy-sql-prod
  object: customer_source
target:
  connection: snowflake-analytics
  object: customer_target
keys:
  - CustomerID
column_mapping:
  CustomerID: CUSTOMER_ID
  CustomerName: CUSTOMER_NAME
  CreatedDate: CREATED_AT
  IsActive: IS_ACTIVE
checks:
  schema:
    enabled: false
  profile:
    enabled: true
`;

const ALL_CHECKS_YAML = `
version: 1
name: customer-migration-parity
source:
  connection: legacy-sql-prod
  object: customer_source
target:
  connection: snowflake-analytics
  object: customer_target
keys:
  - CustomerID
column_mapping:
  CustomerID: CUSTOMER_ID
  CustomerName: CUSTOMER_NAME
  CreatedDate: CREATED_AT
  IsActive: IS_ACTIVE
checks:
  schema:
    enabled: true
  profile:
    enabled: true
  row_count:
    enabled: true
  row_level:
    enabled: true
`;

const UNREGISTERED_TARGET_YAML = `
version: 1
name: customer-migration-parity
source:
  connection: legacy-sql-prod
  object: customer_source
target:
  connection: does-not-exist
  object: customer_target
keys:
  - CustomerID
checks:
  schema:
    enabled: true
`;

/**
 * Normalizes a `TIMESTAMP '...'` literal's millisecond-precision value out
 * of a SQL string before comparison. `planQueries` and `runComparison` are
 * two genuinely separate calls (each pins its own `now = new Date()` once
 * per profiled column pair, per both functions' documented
 * TIMESTAMP-literal-stability rationale -- see planner.ts's `runProfileChecks`
 * comment and this file's `planQueries.ts` mirror of it) -- the *whole
 * point* of pinning `now` once per call is to keep a single run's own
 * source/target queries byte-identical to each other, not to make two
 * independent calls produce identical wall-clock literals. A test asserting
 * planQueries's output against runComparison's own queriesUsed for the
 * *same* definition must therefore normalize this one genuinely
 * time-dependent substring, or it would be asserting something neither
 * function actually promises (millisecond-identical timestamps across two
 * separate invocations) and would be flaky by construction. Every other
 * character of every query string is still compared exactly.
 */
function normalizeTimestamps(queries: string[]): string[] {
  return queries.map((q) => q.replace(/TIMESTAMP '[^']*'/g, "TIMESTAMP '<now>'"));
}

function buildRegistry(): ConnectorRegistry {
  const registry: ConnectorRegistry = new Map();
  registry.set("legacy-sql-prod", new FixtureConnector("sqlserver-customer", "source"));
  registry.set("snowflake-analytics", new FixtureConnector("sqlserver-customer", "target"));
  return registry;
}

/** Wraps a real connector, recording every executeQuery/getSchema call so
 * tests can assert on call counts without guessing at FixtureConnector's
 * own internals. Delegates every other `DataPlatformConnector` method
 * straight through to `inner` unchanged. */
class SpyConnector implements DataPlatformConnector {
  executeQueryCalls = 0;
  getSchemaCalls = 0;

  constructor(private readonly inner: DataPlatformConnector) {}

  testConnection() {
    return this.inner.testConnection();
  }

  getCatalogs() {
    return this.inner.getCatalogs();
  }

  getSchemas(catalog?: string) {
    return this.inner.getSchemas(catalog);
  }

  getObjects(scope: Parameters<DataPlatformConnector["getObjects"]>[0]) {
    return this.inner.getObjects(scope);
  }

  getSchema(input: QueryInput): Promise<ColumnDefinition[]> {
    this.getSchemaCalls += 1;
    return this.inner.getSchema(input);
  }

  executeQuery(input: QueryInput, options: ExecutionOptions): AsyncIterable<RecordBatch> {
    this.executeQueryCalls += 1;
    return this.inner.executeQuery(input, options);
  }

  getCapabilities() {
    return this.inner.getCapabilities();
  }

  quoteIdentifier(identifier: string): string {
    return this.inner.quoteIdentifier(identifier);
  }

  buildProfileQuery(
    input: QueryInput,
    columns: ColumnDefinition[],
    profileOptions: Parameters<DataPlatformConnector["buildProfileQuery"]>[2]
  ) {
    return this.inner.buildProfileQuery(input, columns, profileOptions);
  }
}

describe("planQueries", () => {
  it("matches runComparison's own queriesUsed exactly (byte-for-byte, same order) for a profile-enabled definition", async () => {
    const definition = parseDefinition(PROFILE_YAML);

    const planned = await planQueries(definition, buildRegistry());
    const result = await runComparison(definition, buildRegistry());

    expect(result.queriesUsed).toBeDefined();
    expect(normalizeTimestamps(planned.queries)).toEqual(normalizeTimestamps(result.queriesUsed!));
    expect(planned.queries.length).toBeGreaterThan(0);
    expect(planned.connectionUnreachable).toBe(false);
  });

  it("matches runComparison's own queriesUsed exactly for a definition with schema+profile+rowCount+rowLevel all enabled", async () => {
    const definition = parseDefinition(ALL_CHECKS_YAML);

    const planned = await planQueries(definition, buildRegistry());
    const result = await runComparison(definition, buildRegistry());

    expect(result.queriesUsed).toBeDefined();
    expect(normalizeTimestamps(planned.queries)).toEqual(normalizeTimestamps(result.queriesUsed!));
    // Sanity: row-count (2) + row-level (2) + at least one profiled column
    // pair's queries should all be present.
    expect(planned.queries.length).toBeGreaterThanOrEqual(4);
    expect(planned.connectionUnreachable).toBe(false);
  });

  it("returns an empty list for a schema-only definition, matching runComparison's queriesUsed being absent (schema comparison issues no SQL) -- and connectionUnreachable is false, since both connections are reachable and the definition legitimately produces zero queries", async () => {
    const definition = parseDefinition(SCHEMA_ONLY_YAML);

    const planned = await planQueries(definition, buildRegistry());
    const result = await runComparison(definition, buildRegistry());

    expect(planned.queries).toEqual([]);
    expect(planned.connectionUnreachable).toBe(false);
    expect(result.queriesUsed).toBeUndefined();
  });

  it("never calls executeQuery on either connector, but does call getSchema when schema/profile checks are enabled", async () => {
    const definition = parseDefinition(ALL_CHECKS_YAML);
    const sourceSpy = new SpyConnector(new FixtureConnector("sqlserver-customer", "source"));
    const targetSpy = new SpyConnector(new FixtureConnector("sqlserver-customer", "target"));
    const registry: ConnectorRegistry = new Map([
      ["legacy-sql-prod", sourceSpy],
      ["snowflake-analytics", targetSpy]
    ]);

    const planned = await planQueries(definition, registry);

    expect(sourceSpy.executeQueryCalls).toBe(0);
    expect(targetSpy.executeQueryCalls).toBe(0);
    expect(sourceSpy.getSchemaCalls).toBeGreaterThan(0);
    expect(targetSpy.getSchemaCalls).toBeGreaterThan(0);
    expect(planned.queries.length).toBeGreaterThan(0);
    expect(planned.connectionUnreachable).toBe(false);
  });

  it("never calls executeQuery for a rowCount+rowLevel-only definition (no schema/profile) either", async () => {
    const definition = parseDefinition(`
version: 1
name: customer-migration-parity
source:
  connection: legacy-sql-prod
  object: customer_source
target:
  connection: snowflake-analytics
  object: customer_target
keys:
  - CustomerID
checks:
  row_count:
    enabled: true
  row_level:
    enabled: true
`);
    const sourceSpy = new SpyConnector(new FixtureConnector("sqlserver-customer", "source"));
    const targetSpy = new SpyConnector(new FixtureConnector("sqlserver-customer", "target"));
    const registry: ConnectorRegistry = new Map([
      ["legacy-sql-prod", sourceSpy],
      ["snowflake-analytics", targetSpy]
    ]);

    const planned = await planQueries(definition, registry);

    expect(sourceSpy.executeQueryCalls).toBe(0);
    expect(targetSpy.executeQueryCalls).toBe(0);
    expect(sourceSpy.getSchemaCalls).toBe(0);
    expect(targetSpy.getSchemaCalls).toBe(0);
    expect(planned.queries).toHaveLength(4);
    expect(planned.connectionUnreachable).toBe(false);
  });

  it("throws UnresolvedConnectionError for an unregistered target connection, mirroring runComparison's own error contract for genuine wiring errors", async () => {
    const definition = parseDefinition(UNREGISTERED_TARGET_YAML);
    const registry: ConnectorRegistry = new Map();
    registry.set("legacy-sql-prod", new FixtureConnector("sqlserver-customer", "source"));
    // "does-not-exist" intentionally left unregistered.

    await expect(planQueries(definition, registry)).rejects.toThrow(UnresolvedConnectionError);
  });

  // T-49: resolves finding T-38-01 -- planQueries's Layer-1 testConnection()
  // gate must distinguish "connection unreachable" from "definition
  // legitimately produces zero queries" so the confirmation panel can show
  // a distinguishing message instead of an ambiguous empty-queries state.
  it("returns connectionUnreachable: true and an empty queries list when the source connector's testConnection() fails (T-38-01)", async () => {
    const definition = parseDefinition(SCHEMA_ONLY_YAML);
    const unreachableSource = new UnreachableConnector(new FixtureConnector("sqlserver-customer", "source"));
    const registry: ConnectorRegistry = new Map<string, DataPlatformConnector>([
      ["legacy-sql-prod", unreachableSource],
      ["snowflake-analytics", new FixtureConnector("sqlserver-customer", "target")]
    ]);

    const planned = await planQueries(definition, registry);

    expect(planned.connectionUnreachable).toBe(true);
    expect(planned.queries).toEqual([]);
  });

  it("returns connectionUnreachable: true when the target connector's testConnection() fails (T-38-01)", async () => {
    const definition = parseDefinition(SCHEMA_ONLY_YAML);
    const unreachableTarget = new UnreachableConnector(new FixtureConnector("sqlserver-customer", "target"));
    const registry: ConnectorRegistry = new Map<string, DataPlatformConnector>([
      ["legacy-sql-prod", new FixtureConnector("sqlserver-customer", "source")],
      ["snowflake-analytics", unreachableTarget]
    ]);

    const planned = await planQueries(definition, registry);

    expect(planned.connectionUnreachable).toBe(true);
    expect(planned.queries).toEqual([]);
  });
});

/** Wraps a real connector, overriding `testConnection()` to always report
 * failure -- used to distinguish the T-38-01 "connection unreachable" case
 * from the "definition legitimately produces zero queries" case, which the
 * unmodified `SCHEMA_ONLY_YAML` fixture registry already covers above.
 * Delegates every other `DataPlatformConnector` method straight through to
 * `inner` unchanged, matching `SpyConnector`'s own delegation pattern. */
class UnreachableConnector implements DataPlatformConnector {
  constructor(private readonly inner: DataPlatformConnector) {}

  testConnection() {
    return Promise.resolve({ success: false, message: "simulated unreachable connection" });
  }

  getCatalogs() {
    return this.inner.getCatalogs();
  }

  getSchemas(catalog?: string) {
    return this.inner.getSchemas(catalog);
  }

  getObjects(scope: Parameters<DataPlatformConnector["getObjects"]>[0]) {
    return this.inner.getObjects(scope);
  }

  getSchema(input: QueryInput): Promise<ColumnDefinition[]> {
    return this.inner.getSchema(input);
  }

  executeQuery(input: QueryInput, options: ExecutionOptions): AsyncIterable<RecordBatch> {
    return this.inner.executeQuery(input, options);
  }

  getCapabilities() {
    return this.inner.getCapabilities();
  }

  quoteIdentifier(identifier: string): string {
    return this.inner.quoteIdentifier(identifier);
  }

  buildProfileQuery(
    input: QueryInput,
    columns: ColumnDefinition[],
    profileOptions: Parameters<DataPlatformConnector["buildProfileQuery"]>[2]
  ) {
    return this.inner.buildProfileQuery(input, columns, profileOptions);
  }
}
