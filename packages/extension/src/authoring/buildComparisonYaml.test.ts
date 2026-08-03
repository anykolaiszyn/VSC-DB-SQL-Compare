import { describe, expect, it } from "vitest";
import { parseDefinition } from "@paritylens/engine";
import { buildComparisonYaml, type NewComparisonAnswers } from "./buildComparisonYaml";

const baseAnswers: NewComparisonAnswers = {
  comparisonName: "Customer Parity",
  sourceConnection: "sqlserver-customer",
  sourceObject: "dbo.Customer",
  targetConnection: "postgres-products",
  targetObject: "public.customer",
  keys: ["customer_id"]
};

describe("buildComparisonYaml", () => {
  it("produces a minimal YAML document that round-trips through parseDefinition with the exact fields provided", () => {
    const yamlText = buildComparisonYaml(baseAnswers);
    const parsed = parseDefinition(yamlText);

    expect(parsed).toEqual({
      version: 1,
      name: "Customer Parity",
      source: { kind: "table", connection: "sqlserver-customer", object: "dbo.Customer" },
      target: { kind: "table", connection: "postgres-products", object: "public.customer" },
      keys: ["customer_id"],
      columnMapping: [],
      excludeColumns: [],
      rules: {},
      checks: {}
    });
  });

  it("includes optional where clauses per side when provided, omits them when not", () => {
    const yamlText = buildComparisonYaml({
      ...baseAnswers,
      sourceWhere: "region = 'US'",
      // targetWhere intentionally omitted
    });
    const parsed = parseDefinition(yamlText);

    expect(parsed.source).toEqual({
      kind: "table",
      connection: "sqlserver-customer",
      object: "dbo.Customer",
      where: "region = 'US'"
    });
    expect(parsed.target).toEqual({ kind: "table", connection: "postgres-products", object: "public.customer" });
    expect(parsed.target).not.toHaveProperty("where");
  });

  it("supports a composite key (multiple key columns)", () => {
    const yamlText = buildComparisonYaml({ ...baseAnswers, keys: ["customer_id", "region"] });
    const parsed = parseDefinition(yamlText);
    expect(parsed.keys).toEqual(["customer_id", "region"]);
  });

  it("safely quotes user input containing YAML-significant characters (colons, quotes, hashes)", () => {
    const yamlText = buildComparisonYaml({
      ...baseAnswers,
      comparisonName: 'Weird: "name" # with stuff',
      sourceWhere: "status = 'active' # trailing comment-looking text"
    });
    const parsed = parseDefinition(yamlText);
    expect(parsed.name).toBe('Weird: "name" # with stuff');
    // Type-narrow on `kind` rather than casting -- `where` only exists on
    // the `table`-kind variant of the `ParitySide` discriminated union
    // (T-35a); this proves TypeScript can verify the narrowing correctly.
    if (parsed.source.kind !== "table") {
      throw new Error("expected source to parse as kind: table");
    }
    expect(parsed.source.where).toBe("status = 'active' # trailing comment-looking text");
  });

  it("never emits a connection field as anything other than a bare string, even for credential-shaped free-typed input", () => {
    const yamlText = buildComparisonYaml({
      ...baseAnswers,
      sourceConnection: "password: hunter2"
    });
    const parsed = parseDefinition(yamlText);
    expect(typeof parsed.source.connection).toBe("string");
    expect(parsed.source.connection).toBe("password: hunter2");
  });

  // --- T-35b: query/sqlFile kinds -----------------------------------------

  it("emits a query-kind source side that round-trips through parseDefinition", () => {
    const yamlText = buildComparisonYaml({
      ...baseAnswers,
      source: { kind: "query", sql: "SELECT * FROM dbo.Customer WHERE region = 'US'" }
    });
    const parsed = parseDefinition(yamlText);
    expect(parsed.source).toEqual({
      kind: "query",
      connection: "sqlserver-customer",
      sql: "SELECT * FROM dbo.Customer WHERE region = 'US'"
    });
    expect(parsed.source).not.toHaveProperty("object");
    expect(parsed.source).not.toHaveProperty("where");
  });

  it("emits a sqlFile-kind target side that round-trips through parseDefinition", () => {
    const yamlText = buildComparisonYaml({
      ...baseAnswers,
      target: { kind: "sqlFile", filePath: "queries/target-customer.sql" }
    });
    const parsed = parseDefinition(yamlText);
    expect(parsed.target).toEqual({
      kind: "sqlFile",
      connection: "postgres-products",
      filePath: "queries/target-customer.sql"
    });
    expect(parsed.target).not.toHaveProperty("object");
  });

  it("supports a mixed source-is-table/target-is-query comparison", () => {
    const yamlText = buildComparisonYaml({
      ...baseAnswers,
      source: { kind: "table", object: "dbo.Customer" },
      target: { kind: "query", sql: "SELECT * FROM public.customer" }
    });
    const parsed = parseDefinition(yamlText);
    expect(parsed.source).toEqual({ kind: "table", connection: "sqlserver-customer", object: "dbo.Customer" });
    expect(parsed.target).toEqual({
      kind: "query",
      connection: "postgres-products",
      sql: "SELECT * FROM public.customer"
    });
  });

  // --- T-35b: column_mapping -----------------------------------------------

  it("omits column_mapping entirely when absent (relies on parseDefinition's default)", () => {
    const yamlText = buildComparisonYaml(baseAnswers);
    expect(yamlText).not.toContain("column_mapping");
    const parsed = parseDefinition(yamlText);
    expect(parsed.columnMapping).toEqual([]);
  });

  it("omits column_mapping entirely when an empty array is provided", () => {
    const yamlText = buildComparisonYaml({ ...baseAnswers, columnMapping: [] });
    expect(yamlText).not.toContain("column_mapping");
  });

  it("round-trips a plain source/target column mapping entry", () => {
    const yamlText = buildComparisonYaml({
      ...baseAnswers,
      columnMapping: [{ source: "customer_id", target: "CUSTOMER_ID" }]
    });
    const parsed = parseDefinition(yamlText);
    expect(parsed.columnMapping).toEqual([{ source: "customer_id", target: "CUSTOMER_ID" }]);
  });

  it("round-trips a derived name/target column mapping entry without expressions", () => {
    const yamlText = buildComparisonYaml({
      ...baseAnswers,
      columnMapping: [{ name: "full_name", target: "FULL_NAME" }]
    });
    const parsed = parseDefinition(yamlText);
    expect(parsed.columnMapping).toEqual([{ name: "full_name", target: "FULL_NAME" }]);
  });

  it("round-trips a derived name/target column mapping entry with source and target expressions", () => {
    const yamlText = buildComparisonYaml({
      ...baseAnswers,
      columnMapping: [
        {
          name: "full_name",
          target: "FULL_NAME",
          sourceExpression: "first_name || ' ' || last_name",
          targetExpression: "UPPER(FULL_NAME)"
        }
      ]
    });
    const parsed = parseDefinition(yamlText);
    expect(parsed.columnMapping).toEqual([
      {
        name: "full_name",
        target: "FULL_NAME",
        sourceExpression: "first_name || ' ' || last_name",
        targetExpression: "UPPER(FULL_NAME)"
      }
    ]);
  });

  it("round-trips multiple mixed column mapping entries in order", () => {
    const yamlText = buildComparisonYaml({
      ...baseAnswers,
      columnMapping: [
        { source: "customer_id", target: "CUSTOMER_ID" },
        { name: "full_name", target: "FULL_NAME", sourceExpression: "first_name || last_name" }
      ]
    });
    const parsed = parseDefinition(yamlText);
    expect(parsed.columnMapping).toEqual([
      { source: "customer_id", target: "CUSTOMER_ID" },
      { name: "full_name", target: "FULL_NAME", sourceExpression: "first_name || last_name" }
    ]);
  });

  // --- T-35b: adversarial escaping for new fields ---------------------------
  // Mirrors T-32's original 11-case YAML-injection probe, applied to the new
  // sql/filePath/column_mapping fields per TASK-BRIEF.md Scope item 4.

  it("safely quotes a sql value containing YAML-significant characters and a credential-shaped-looking substring", () => {
    const yamlText = buildComparisonYaml({
      ...baseAnswers,
      source: {
        kind: "query",
        sql: "SELECT * FROM t WHERE note = 'password: hunter2' -- : # {flow: map}\nAND x = 1"
      }
    });
    const parsed = parseDefinition(yamlText);
    expect(parsed.source).toEqual({
      kind: "query",
      connection: "sqlserver-customer",
      sql: "SELECT * FROM t WHERE note = 'password: hunter2' -- : # {flow: map}\nAND x = 1"
    });
  });

  it("safely quotes a filePath value containing YAML anchors/aliases and quote-escape-and-reopen attempts", () => {
    const yamlText = buildComparisonYaml({
      ...baseAnswers,
      target: {
        kind: "sqlFile",
        filePath: 'queries/&anchor "quoted" *alias: [flow, seq] #comment.sql'
      }
    });
    const parsed = parseDefinition(yamlText);
    expect(parsed.target).toEqual({
      kind: "sqlFile",
      connection: "postgres-products",
      filePath: 'queries/&anchor "quoted" *alias: [flow, seq] #comment.sql'
    });
  });

  it("safely quotes column_mapping entry fields containing YAML-significant characters and credential-shaped-looking strings", () => {
    const yamlText = buildComparisonYaml({
      ...baseAnswers,
      columnMapping: [
        {
          name: 'weird "name" # with: colons',
          target: "TARGET_COL",
          sourceExpression: "password: hunter2\nsecret: true",
          targetExpression: '*alias &anchor {password: "hunter2"}'
        }
      ]
    });
    const parsed = parseDefinition(yamlText);
    expect(parsed.columnMapping).toEqual([
      {
        name: 'weird "name" # with: colons',
        target: "TARGET_COL",
        sourceExpression: "password: hunter2\nsecret: true",
        targetExpression: '*alias &anchor {password: "hunter2"}'
      }
    ]);
  });
});
