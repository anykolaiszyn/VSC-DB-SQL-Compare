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
      source: { connection: "sqlserver-customer", object: "dbo.Customer" },
      target: { connection: "postgres-products", object: "public.customer" },
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

    expect(parsed.source).toEqual({ connection: "sqlserver-customer", object: "dbo.Customer", where: "region = 'US'" });
    expect(parsed.target).toEqual({ connection: "postgres-products", object: "public.customer" });
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
});
