// T-09: orchestration run planner tests.
//
// Structure:
//   1. Red-state / acceptance-criterion-1 proof: runComparison against a
//      ParityDefinition parsed from YAML referencing the T-04
//      sqlserver-customer fixture pair (source and target resolved via a
//      ConnectorRegistry populated with FixtureConnector instances), with
//      checks.schema.enabled: true, asserting the resulting
//      ComparisonResult.schemaDifferences contains the known
//      dropped-CreditLimit-column finding (same fact T-06 already proved,
//      now proven end-to-end through the full pipeline).
//   2. Profile-check proof: checks.profile.enabled: true produces populated
//      profileDifferences.
//   3. Connectivity-failure proof: an unregistered connection name in the
//      registry short-circuits the run to a failed-status result without
//      attempting schema/profile checks.
//   4. T-15 Phase 2 proof: checks.row_count.enabled routes to T-13's
//      compareVolume and populates rowCounts/aggregateDifferences from real
//      results; checks.row_level.enabled routes to T-14's compareRows (after
//      fetching full row data via executeQuery) and populates
//      rowDifferences; disabling either check leaves its corresponding
//      field(s) at the Phase-1 empty/default value -- no silent execution.
import { describe, expect, it } from "vitest";
import { parseDefinition } from "../definition/definition.js";
import { FixtureConnector } from "../../connector-sdk/fixture/fixture-connector.js";
import { runComparison, type ConnectorRegistry } from "./planner.js";

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

const ROW_COUNT_ONLY_YAML = `
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
    enabled: false
  row_count:
    enabled: true
  row_level:
    enabled: false
`;

const ROW_LEVEL_ONLY_YAML = `
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
  CustomerID: CustomerID
  CustomerName: CustomerName
checks:
  schema:
    enabled: false
  row_count:
    enabled: false
  row_level:
    enabled: true
`;

const BOTH_DISABLED_YAML = `
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
    enabled: false
  row_count:
    enabled: false
  row_level:
    enabled: false
`;

function fixtureRegistry(): ConnectorRegistry {
  const registry = new Map();
  registry.set("legacy-sql-prod", new FixtureConnector("sqlserver-customer", "source"));
  registry.set("snowflake-analytics", new FixtureConnector("sqlserver-customer", "target"));
  return registry;
}

describe("runComparison", () => {
  describe("acceptance criterion 1: sqlserver-customer fixture end-to-end", () => {
    it("produces a Failure-severity schemaDifferences finding for the dropped CreditLimit column", async () => {
      const definition = parseDefinition(SCHEMA_ONLY_YAML);
      const result = await runComparison(definition, fixtureRegistry());

      const creditLimitFinding = result.schemaDifferences.find(
        (f) => f.columnName === "CreditLimit" && f.kind === "missing-in-target"
      );
      expect(creditLimitFinding).toBeDefined();
      expect(creditLimitFinding?.severity).toBe("Failure");
      expect(result.comparison).toBe("customer-migration-parity");
      expect(result.status).not.toBe("error");
    });
  });

  describe("profile checks", () => {
    it("populates profileDifferences when checks.profile.enabled is true", async () => {
      const definition = parseDefinition(PROFILE_YAML);
      const result = await runComparison(definition, fixtureRegistry());

      expect(result.profileDifferences.length).toBeGreaterThan(0);
      // Schema check was disabled, so no schema findings should appear.
      expect(result.schemaDifferences).toEqual([]);
    });
  });

  describe("connectivity failure short-circuit", () => {
    it("returns a failed-status result and does not attempt schema/profile checks for an unregistered connection", async () => {
      const definition = parseDefinition(UNREGISTERED_TARGET_YAML);
      const registry: ConnectorRegistry = new Map();
      registry.set("legacy-sql-prod", new FixtureConnector("sqlserver-customer", "source"));
      // Deliberately do not register "does-not-exist".

      const result = await runComparison(definition, registry);

      expect(result.status).toBe("failed");
      expect(result.schemaDifferences).toEqual([]);
      expect(result.profileDifferences).toEqual([]);
    });
  });

  describe("Phase 2: row-count checks", () => {
    it("populates rowCounts and aggregateDifferences from compareVolume when checks.row_count.enabled is true", async () => {
      const definition = parseDefinition(ROW_COUNT_ONLY_YAML);
      const result = await runComparison(definition, fixtureRegistry());

      // sqlserver-customer fixture: 6 source rows, 7 target rows (see
      // packages/engine/fixtures/sqlserver-customer.ts).
      expect(result.rowCounts).toEqual({ source: 6, target: 7, difference: 1 });
      expect(result.aggregateDifferences).toHaveLength(1);
      expect(result.aggregateDifferences[0]?.sourceCount).toBe(6);
      expect(result.aggregateDifferences[0]?.targetCount).toBe(7);
      // Row-level check was disabled -- no rowDifferences should appear.
      expect(result.rowDifferences).toEqual([]);
    });

    it("leaves rowCounts/aggregateDifferences at Phase-1 defaults when checks.row_count.enabled is false (no silent execution)", async () => {
      const definition = parseDefinition(BOTH_DISABLED_YAML);
      const result = await runComparison(definition, fixtureRegistry());

      expect(result.rowCounts).toEqual({ source: 0, target: 0, difference: 0 });
      expect(result.aggregateDifferences).toEqual([]);
    });
  });

  describe("Phase 2: row-level checks", () => {
    it("populates rowDifferences from compareRows when checks.row_level.enabled is true", async () => {
      const definition = parseDefinition(ROW_LEVEL_ONLY_YAML);
      const result = await runComparison(definition, fixtureRegistry());

      expect(result.rowDifferences.length).toBeGreaterThan(0);
      // CustomerID 4 is present in source but missing from target -- known
      // fixture fact from sqlserver-customer.ts's header comment.
      const missingFromTarget = result.rowDifferences.find(
        (d) => d.category === "missing-from-target"
      );
      expect(missingFromTarget).toBeDefined();
      // Row-count check was disabled -- rowCounts/aggregateDifferences stay
      // at their Phase-1 defaults.
      expect(result.rowCounts).toEqual({ source: 0, target: 0, difference: 0 });
      expect(result.aggregateDifferences).toEqual([]);
    });

    it("leaves rowDifferences at the Phase-1 empty default when checks.row_level.enabled is false (no silent execution)", async () => {
      const definition = parseDefinition(BOTH_DISABLED_YAML);
      const result = await runComparison(definition, fixtureRegistry());

      expect(result.rowDifferences).toEqual([]);
    });
  });
});
