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
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { parseDefinition } from "../definition/definition.js";
import type { ParitySide } from "../definition/definition.js";
import { FixtureConnector } from "../../connector-sdk/fixture/fixture-connector.js";
import {
  runComparison,
  resolveSideInput,
  buildFetchAllRowsSql,
  SqlFilePathEscapesBaseDirError,
  type ConnectorRegistry,
} from "./planner.js";

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

// T-28: unlike ROW_LEVEL_ONLY_YAML above (which declares an *identity*
// column_mapping for the key column, CustomerID: CustomerID -- never
// exercising the real-world scenario column_mapping exists for, and not
// even matching customer_target's actual CUSTOMER_ID column name), this
// fixture declares the key column's genuine, non-identity translation
// (CustomerID source -> CUSTOMER_ID target, sqlserver-customer.ts's real
// target column name), reproducing the live smoke-test bug report in
// TASK-BRIEF.md where every row-level finding's keyValues showed
// [undefined] instead of the real key value.
const ROW_LEVEL_KEY_MAPPING_YAML = `
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

  // T-16b: SQL preview panel. queriesUsed must be populated by runComparison
  // with the SQL strings actually issued during the run, sourced from the
  // same builder functions the execution code paths themselves call.
  describe("T-16b: queriesUsed", () => {
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
  CustomerID: CustomerID
  CustomerName: CustomerName
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

    it("produces a ComparisonResult with a populated queriesUsed when schema/profile/volume/row-level checks are enabled", async () => {
      const definition = parseDefinition(ALL_CHECKS_YAML);
      const result = await runComparison(definition, fixtureRegistry());

      expect(result.queriesUsed).toBeDefined();
      expect(result.queriesUsed?.length).toBeGreaterThan(0);
      // Volume (row-count) and row-level queries should both be present.
      expect(result.queriesUsed?.some((q) => q.includes("COUNT(*)"))).toBe(true);
      expect(result.queriesUsed?.some((q) => q.includes("SELECT *"))).toBe(true);
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

    // T-28: reproduces the live smoke-test bug -- a genuinely non-identity
    // column_mapping for the key column (CustomerID -> CUSTOMER_ID, the
    // real sqlserver-customer target column name) must still produce real
    // key values in rowDifferences[].keyValues, not [undefined], for
    // findings on both the source side (missing-from-target) and the
    // target side (matched-key-differing-values, duplicate-in-target).
    it("populates real keyValues (not undefined) when the key column has a genuinely different name on source vs target", async () => {
      const definition = parseDefinition(ROW_LEVEL_KEY_MAPPING_YAML);
      const result = await runComparison(definition, fixtureRegistry());

      expect(result.rowDifferences.length).toBeGreaterThan(0);

      // CustomerID 4: present in source, missing from target -- key value
      // resolved entirely from the source-side row, so this alone would
      // pass even with the bug. Included for completeness.
      const missingFromTarget = result.rowDifferences.find((d) => d.category === "missing-from-target");
      expect(missingFromTarget?.keyValues).toEqual([4]);

      // CustomerID 2: differing CustomerName, matched via the target-side
      // row's CUSTOMER_ID column -- this is the finding the bug corrupted
      // (target-side keyIndexes resolution via the unmapped source-side
      // name "CustomerID" against target columns, which only contains
      // "CUSTOMER_ID", returned -1, so keyValues was [undefined]).
      const differing = result.rowDifferences.find((d) => d.category === "matched-key-differing-values");
      expect(differing?.keyValues).toEqual([2]);

      // CustomerID 5: duplicated in target -- every duplicate-in-target
      // finding's keyValues is resolved from the target-side row via the
      // translated key column and must show the real value, not undefined.
      const duplicatesInTarget = result.rowDifferences.filter((d) => d.category === "duplicate-in-target");
      expect(duplicatesInTarget.length).toBeGreaterThan(0);
      for (const dup of duplicatesInTarget) {
        expect(dup.keyValues).toEqual([5]);
      }
    });
  });
});

// T-35a: ParitySide/planner support for query & sqlFile kinds.
describe("T-35a: resolveSideInput", () => {
  let tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs = [];
  });

  async function makeTempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "paritylens-t35a-"));
    tempDirs.push(dir);
    return dir;
  }

  it("resolves a table-kind side unchanged", async () => {
    const side: ParitySide = { kind: "table", connection: "c", object: "dbo.Customer" };
    const input = await resolveSideInput(side, process.cwd());
    expect(input).toEqual({ kind: "table", object: "dbo.Customer" });
  });

  it("resolves a query-kind side by passing sql through as-is", async () => {
    const side: ParitySide = { kind: "query", connection: "c", sql: "SELECT * FROM foo" };
    const input = await resolveSideInput(side, process.cwd());
    expect(input).toEqual({ kind: "query", sql: "SELECT * FROM foo" });
  });

  it("resolves a sqlFile-kind side by reading the file's contents and converting to kind: query", async () => {
    const baseDir = await makeTempDir();
    await mkdir(join(baseDir, "queries"), { recursive: true });
    const filePath = "queries/source.sql";
    await writeFile(join(baseDir, "queries", "source.sql"), "SELECT * FROM foo WHERE x > 1", "utf8");

    const side: ParitySide = { kind: "sqlFile", connection: "c", filePath };
    const input = await resolveSideInput(side, baseDir);
    expect(input).toEqual({ kind: "query", sql: "SELECT * FROM foo WHERE x > 1" });
  });

  it("rejects a sqlFile filePath that escapes baseDir via ../ traversal", async () => {
    const baseDir = await makeTempDir();
    const side: ParitySide = { kind: "sqlFile", connection: "c", filePath: "../outside.sql" };
    await expect(resolveSideInput(side, baseDir)).rejects.toThrow(SqlFilePathEscapesBaseDirError);
  });

  it("rejects a sqlFile filePath that is an absolute path outside baseDir", async () => {
    const baseDir = await makeTempDir();
    const outsideDir = await makeTempDir();
    const outsideAbsolutePath = join(outsideDir, "outside.sql");
    const side: ParitySide = { kind: "sqlFile", connection: "c", filePath: outsideAbsolutePath };
    await expect(resolveSideInput(side, baseDir)).rejects.toThrow(SqlFilePathEscapesBaseDirError);
  });

  it("rejects a sibling-directory-prefix bypass (baseDir 'foo' vs resolved 'foo-evil')", async () => {
    const baseDir = await makeTempDir();
    // baseDir is e.g. /tmp/paritylens-t35a-XXXX -- construct a sibling whose
    // name has baseDir's basename as a *prefix* (not a real subdirectory),
    // which a naive `resolvedTarget.startsWith(baseDir)` string check would
    // incorrectly treat as contained.
    const side: ParitySide = { kind: "sqlFile", connection: "c", filePath: `..${sep}${baseDir.split(sep).pop()}-evil${sep}x.sql` };
    await expect(resolveSideInput(side, baseDir)).rejects.toThrow(SqlFilePathEscapesBaseDirError);
  });
});

describe("T-35a: buildFetchAllRowsSql", () => {
  function fixtureConnector(): FixtureConnector {
    return new FixtureConnector("sqlserver-customer", "source");
  }

  it("is byte-for-byte unchanged for table-kind with no where", async () => {
    const connector = fixtureConnector();
    const side: ParitySide = { kind: "table", connection: "c", object: "customer_source" };
    const sql = await buildFetchAllRowsSql(connector, side);
    expect(sql).toBe(`SELECT * FROM ${connector.quoteIdentifier("customer_source")}`);
  });

  it("is byte-for-byte unchanged for table-kind with a where clause", async () => {
    const connector = fixtureConnector();
    const side: ParitySide = { kind: "table", connection: "c", object: "customer_source", where: "CustomerID > 1" };
    const sql = await buildFetchAllRowsSql(connector, side);
    expect(sql).toBe(`SELECT * FROM ${connector.quoteIdentifier("customer_source")} WHERE CustomerID > 1`);
  });

  it("subquery-wraps query-kind SQL", async () => {
    const connector = fixtureConnector();
    const side: ParitySide = { kind: "query", connection: "c", sql: "SELECT * FROM customer_source" };
    const sql = await buildFetchAllRowsSql(connector, side);
    expect(sql).toBe("SELECT * FROM (SELECT * FROM customer_source) AS row_level_subquery");
  });

  it("subquery-wraps sqlFile-kind SQL after reading the file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "paritylens-t35a-fars-"));
    try {
      await writeFile(join(dir, "q.sql"), "SELECT * FROM customer_source;", "utf8");
      const connector = fixtureConnector();
      const side: ParitySide = { kind: "sqlFile", connection: "c", filePath: "q.sql" };
      const sql = await buildFetchAllRowsSql(connector, side, dir);
      expect(sql).toBe("SELECT * FROM (SELECT * FROM customer_source) AS row_level_subquery");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("T-35a: runComparison end-to-end with query-kind and sqlFile-kind sides", () => {
  function fixtureRegistryForT35a(): ConnectorRegistry {
    const registry = new Map();
    registry.set("legacy-sql-prod", new FixtureConnector("sqlserver-customer", "source"));
    registry.set("snowflake-analytics", new FixtureConnector("sqlserver-customer", "target"));
    return registry;
  }

  it("runs schema + row-count checks end-to-end against a query-kind source and target", async () => {
    const yaml = `
version: 1
name: customer-migration-parity
source:
  connection: legacy-sql-prod
  kind: query
  sql: "SELECT * FROM customer_source"
target:
  connection: snowflake-analytics
  kind: query
  sql: "SELECT * FROM customer_target"
keys:
  - CustomerID
checks:
  schema:
    enabled: true
  row_count:
    enabled: true
`;
    const definition = parseDefinition(yaml);
    const result = await runComparison(definition, fixtureRegistryForT35a());

    // Same known fixture facts as the acceptance-criterion-1 / row-count
    // tests above, now reached via query-kind input instead of table-kind.
    const creditLimitFinding = result.schemaDifferences.find(
      (f) => f.columnName === "CreditLimit" && f.kind === "missing-in-target"
    );
    expect(creditLimitFinding).toBeDefined();
    expect(result.rowCounts).toEqual({ source: 6, target: 7, difference: 1 });
  });

  it("runs schema checks end-to-end against a sqlFile-kind source and target", async () => {
    const dir = await mkdtemp(join(tmpdir(), "paritylens-t35a-e2e-"));
    try {
      await writeFile(join(dir, "source.sql"), "SELECT * FROM customer_source", "utf8");
      await writeFile(join(dir, "target.sql"), "SELECT * FROM customer_target", "utf8");

      const yaml = `
version: 1
name: customer-migration-parity
source:
  connection: legacy-sql-prod
  kind: sqlFile
  filePath: source.sql
target:
  connection: snowflake-analytics
  kind: sqlFile
  filePath: target.sql
keys:
  - CustomerID
checks:
  schema:
    enabled: true
`;
      const definition = parseDefinition(yaml);
      const result = await runComparison(definition, fixtureRegistryForT35a(), dir);

      const creditLimitFinding = result.schemaDifferences.find(
        (f) => f.columnName === "CreditLimit" && f.kind === "missing-in-target"
      );
      expect(creditLimitFinding).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a sqlFile-kind source whose filePath escapes the supplied baseDir, before any connector call", async () => {
    const dir = await mkdtemp(join(tmpdir(), "paritylens-t35a-escape-"));
    try {
      const yaml = `
version: 1
name: customer-migration-parity
source:
  connection: legacy-sql-prod
  kind: sqlFile
  filePath: "../../etc/passwd"
target:
  connection: snowflake-analytics
  object: customer_target
keys:
  - CustomerID
checks:
  schema:
    enabled: true
`;
      const definition = parseDefinition(yaml);
      await expect(runComparison(definition, fixtureRegistryForT35a(), dir)).rejects.toThrow(
        SqlFilePathEscapesBaseDirError
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// T-48 (finding T-34-02): ComparisonResult.sourceLabel/.targetLabel
// derivation, for the results webview header's source→target segment. Red
// state: before this task, ComparisonResult had no sourceLabel/targetLabel
// fields at all, so these assertions could not even compile/pass against
// the pre-T-48 shape.
describe("T-48: sourceLabel/targetLabel derivation", () => {
  it("derives table-kind labels from the object reference itself", async () => {
    const definition = parseDefinition(SCHEMA_ONLY_YAML);
    const result = await runComparison(definition, fixtureRegistry());

    expect(result.sourceLabel).toBe("customer_source");
    expect(result.targetLabel).toBe("customer_target");
  });

  it("derives query-kind labels as the fixed '(custom query)' placeholder", async () => {
    const yaml = `
version: 1
name: customer-migration-parity
source:
  connection: legacy-sql-prod
  kind: query
  sql: "SELECT * FROM customer_source"
target:
  connection: snowflake-analytics
  kind: query
  sql: "SELECT * FROM customer_target"
keys:
  - CustomerID
checks:
  schema:
    enabled: true
`;
    const definition = parseDefinition(yaml);
    const registry: ConnectorRegistry = new Map();
    registry.set("legacy-sql-prod", new FixtureConnector("sqlserver-customer", "source"));
    registry.set("snowflake-analytics", new FixtureConnector("sqlserver-customer", "target"));
    const result = await runComparison(definition, registry);

    expect(result.sourceLabel).toBe("(custom query)");
    expect(result.targetLabel).toBe("(custom query)");
  });

  it("derives sqlFile-kind labels as the file's base name only, not the full path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "paritylens-t48-sqlfile-"));
    try {
      await writeFile(join(dir, "source.sql"), "SELECT * FROM customer_source", "utf8");
      await writeFile(join(dir, "target.sql"), "SELECT * FROM customer_target", "utf8");

      const yaml = `
version: 1
name: customer-migration-parity
source:
  connection: legacy-sql-prod
  kind: sqlFile
  filePath: source.sql
target:
  connection: snowflake-analytics
  kind: sqlFile
  filePath: target.sql
keys:
  - CustomerID
checks:
  schema:
    enabled: true
`;
      const definition = parseDefinition(yaml);
      const registry: ConnectorRegistry = new Map();
      registry.set("legacy-sql-prod", new FixtureConnector("sqlserver-customer", "source"));
      registry.set("snowflake-analytics", new FixtureConnector("sqlserver-customer", "target"));
      const result = await runComparison(definition, registry, dir);

      expect(result.sourceLabel).toBe("source.sql");
      expect(result.targetLabel).toBe("target.sql");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("populates sourceLabel/targetLabel on the Layer-1 connectivity-failure short-circuit path when definition.source/.target are available", async () => {
    const definition = parseDefinition(UNREGISTERED_TARGET_YAML);
    const registry: ConnectorRegistry = new Map();
    registry.set("legacy-sql-prod", new FixtureConnector("sqlserver-customer", "source"));
    // "does-not-exist" intentionally left unregistered.

    const result = await runComparison(definition, registry);

    expect(result.status).toBe("failed");
    expect(result.sourceLabel).toBe("customer_source");
    expect(result.targetLabel).toBe("customer_target");
  });
});
