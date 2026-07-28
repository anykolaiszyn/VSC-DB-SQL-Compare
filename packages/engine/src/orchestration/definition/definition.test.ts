// T-08: Parity YAML definition schema and parser tests.
//
// Section "Idea Prompt.md section 7 worked example (verbatim)" reproduces
// the full YAML example from Idea Prompt.md section 7 exactly, and asserts
// the parsed ParityDefinition matches its structure field-by-field.
//
// Section "Credential rejection" reproduces the security requirement from
// DESIGN-SPEC.md's "Security, privacy, and safety" section: parity
// definition YAML files reference named connection profiles only, never
// inline secrets, enforced by the schema rejecting any credential-shaped
// field anywhere in the document.
import { describe, expect, it } from "vitest";
import { parseDefinition, InvalidDefinitionError } from "./definition.js";

describe("Idea Prompt.md section 7 worked example (verbatim)", () => {
  const worked = `
version: 1

name: customer-migration-parity

source:
  connection: legacy-sql
  object: dbo.Customer
  where: "ModifiedDate >= '2026-01-01'"

target:
  connection: analytics-snowflake
  object: CURATED.CUSTOMER
  where: "MODIFIED_DATE >= '2026-01-01'"

keys:
  - customer_id

column_mapping:
  customer_id: CUSTOMER_ID
  customer_name: CUSTOMER_NAME
  customer_status: STATUS
  modified_date: MODIFIED_TIMESTAMP

exclude_columns:
  - load_batch_id
  - ingestion_timestamp

rules:
  customer_name:
    trim: true
    case_sensitive: false

  modified_date:
    truncate_to: second
    timezone:
      source: America/New_York
      target: UTC

checks:
  schema:
    enabled: true

  row_count:
    enabled: true
    tolerance:
      percentage: 0.01

  profile:
    enabled: true
    top_values: 20

  row_level:
    enabled: true
    strategy: hash
    max_differences: 1000
`;

  it("parses every field of the worked example correctly", () => {
    const def = parseDefinition(worked);

    expect(def.version).toBe(1);
    expect(def.name).toBe("customer-migration-parity");

    expect(def.source).toEqual({
      connection: "legacy-sql",
      object: "dbo.Customer",
      where: "ModifiedDate >= '2026-01-01'",
    });
    expect(def.target).toEqual({
      connection: "analytics-snowflake",
      object: "CURATED.CUSTOMER",
      where: "MODIFIED_DATE >= '2026-01-01'",
    });

    expect(def.keys).toEqual(["customer_id"]);

    expect(def.columnMapping).toEqual([
      { source: "customer_id", target: "CUSTOMER_ID" },
      { source: "customer_name", target: "CUSTOMER_NAME" },
      { source: "customer_status", target: "STATUS" },
      { source: "modified_date", target: "MODIFIED_TIMESTAMP" },
    ]);

    expect(def.excludeColumns).toEqual(["load_batch_id", "ingestion_timestamp"]);

    expect(def.rules).toEqual({
      customer_name: {
        trim: true,
        caseSensitive: false,
      },
      modified_date: {
        truncateTo: "second",
        timezone: {
          source: "America/New_York",
          target: "UTC",
        },
      },
    });

    expect(def.checks).toEqual({
      schema: { enabled: true },
      rowCount: { enabled: true, tolerance: { percentage: 0.01 } },
      profile: { enabled: true, topValues: 20 },
      rowLevel: { enabled: true, strategy: "hash", maxDifferences: 1000 },
    });
  });
});

describe("credential rejection (DESIGN-SPEC.md security model)", () => {
  const minimalValid = `
version: 1
name: minimal
source:
  connection: src-conn
  object: a.b
target:
  connection: tgt-conn
  object: c.d
keys:
  - id
`;

  it("parses a minimal valid definition without throwing", () => {
    expect(() => parseDefinition(minimalValid)).not.toThrow();
  });

  it("throws InvalidDefinitionError on a top-level password field", () => {
    const yaml = `${minimalValid}\npassword: SuperSecret123\n`;
    expect(() => parseDefinition(yaml)).toThrow(InvalidDefinitionError);
  });

  it("throws InvalidDefinitionError on a password field nested under source", () => {
    const yaml = `
version: 1
name: minimal
source:
  connection: src-conn
  object: a.b
  password: SuperSecret123
target:
  connection: tgt-conn
  object: c.d
keys:
  - id
`;
    expect(() => parseDefinition(yaml)).toThrow(InvalidDefinitionError);
  });

  it("throws InvalidDefinitionError on a password field nested under target", () => {
    const yaml = `
version: 1
name: minimal
source:
  connection: src-conn
  object: a.b
target:
  connection: tgt-conn
  object: c.d
  password: SuperSecret123
keys:
  - id
`;
    expect(() => parseDefinition(yaml)).toThrow(InvalidDefinitionError);
  });

  it("throws InvalidDefinitionError when a connection field is an object instead of a name reference", () => {
    const yaml = `
version: 1
name: minimal
source:
  connection:
    host: db.internal
    user: admin
  object: a.b
target:
  connection: tgt-conn
  object: c.d
keys:
  - id
`;
    expect(() => parseDefinition(yaml)).toThrow(InvalidDefinitionError);
  });

  it.each(["secret", "token", "api_key", "apiKey", "API_KEY", "client_secret", "private_key", "connection_string"])(
    "throws InvalidDefinitionError on a %s field anywhere in the document",
    (fieldName) => {
      const yaml = `${minimalValid}\n${fieldName}: some-value\n`;
      expect(() => parseDefinition(yaml)).toThrow(InvalidDefinitionError);
    }
  );

  // T-08a (R-01 hardening): these five field names were demonstrated by the
  // T-08 independent review to bypass the T-08 blocklist. TASK-BRIEF.md
  // T-08a requires each to throw, reproducing the reviewer's exact
  // adversarial cases, using the same case-insensitive/separator-insensitive
  // exact-field-name matching mechanism as the existing tests above.
  it.each(["auth", "pass", "db_pass", "key", "passphrase"])(
    "throws InvalidDefinitionError on a %s field anywhere in the document (T-08a)",
    (fieldName) => {
      const yaml = `${minimalValid}\n${fieldName}: some-value\n`;
      expect(() => parseDefinition(yaml)).toThrow(InvalidDefinitionError);
    }
  );

  it("throws InvalidDefinitionError on a credential field deeply nested under an unrelated key", () => {
    const yaml = `
version: 1
name: minimal
source:
  connection: src-conn
  object: a.b
target:
  connection: tgt-conn
  object: c.d
keys:
  - id
checks:
  schema:
    enabled: true
    nested:
      deeper:
        token: abc123
`;
    expect(() => parseDefinition(yaml)).toThrow(InvalidDefinitionError);
  });

  it("does not throw for field names that merely contain a credential-like substring but are not credential fields", () => {
    // "password_reset_enabled" and "tokenizer_version" are not in the
    // rejected set (exact-name match, not substring match), so this
    // ensures the check is not overly broad.
    const yaml = `${minimalValid}\ntokenizer_version: 3\n`;
    expect(() => parseDefinition(yaml)).not.toThrow();
  });
});

describe("malformed YAML and missing required fields", () => {
  it("throws InvalidDefinitionError on malformed YAML", () => {
    const yaml = `
version: 1
name: broken
  source: [unbalanced
`;
    expect(() => parseDefinition(yaml)).toThrow(InvalidDefinitionError);
  });

  it("throws InvalidDefinitionError when version is missing", () => {
    const yaml = `
name: minimal
source:
  connection: src-conn
  object: a.b
target:
  connection: tgt-conn
  object: c.d
keys:
  - id
`;
    expect(() => parseDefinition(yaml)).toThrow(InvalidDefinitionError);
  });

  it("throws InvalidDefinitionError when name is missing", () => {
    const yaml = `
version: 1
source:
  connection: src-conn
  object: a.b
target:
  connection: tgt-conn
  object: c.d
keys:
  - id
`;
    expect(() => parseDefinition(yaml)).toThrow(InvalidDefinitionError);
  });

  it("throws InvalidDefinitionError when source is missing", () => {
    const yaml = `
version: 1
name: minimal
target:
  connection: tgt-conn
  object: c.d
keys:
  - id
`;
    expect(() => parseDefinition(yaml)).toThrow(InvalidDefinitionError);
  });

  it("throws InvalidDefinitionError when target is missing", () => {
    const yaml = `
version: 1
name: minimal
source:
  connection: src-conn
  object: a.b
keys:
  - id
`;
    expect(() => parseDefinition(yaml)).toThrow(InvalidDefinitionError);
  });

  it("throws InvalidDefinitionError when keys is missing", () => {
    const yaml = `
version: 1
name: minimal
source:
  connection: src-conn
  object: a.b
target:
  connection: tgt-conn
  object: c.d
`;
    expect(() => parseDefinition(yaml)).toThrow(InvalidDefinitionError);
  });

  it("throws InvalidDefinitionError when keys is an empty array", () => {
    const yaml = `
version: 1
name: minimal
source:
  connection: src-conn
  object: a.b
target:
  connection: tgt-conn
  object: c.d
keys: []
`;
    expect(() => parseDefinition(yaml)).toThrow(InvalidDefinitionError);
  });
});

describe("composite keys", () => {
  it("parses a multi-entry keys array (composite key)", () => {
    const yaml = `
version: 1
name: composite-key-example
source:
  connection: src-conn
  object: a.b
target:
  connection: tgt-conn
  object: c.d
keys:
  - order_id
  - line_number
`;
    const def = parseDefinition(yaml);
    expect(def.keys).toEqual(["order_id", "line_number"]);
  });
});

describe("derived column mappings and normalization rules (Idea Prompt.md sections 3 and 4)", () => {
  it("parses derived mappings (source_expression/target_expression) and normalization rules", () => {
    const yaml = `
version: 1
name: derived-mapping-example
source:
  connection: src-conn
  object: a.b
target:
  connection: tgt-conn
  object: c.d
keys:
  - id
column_mapping:
  - source: first_name
    target: first_name
  - source: last_name
    target: last_name
  - name: full_name
    source_expression: "concat(first_name, ' ', last_name)"
    target: customer_full_name
  - name: normalized_phone
    source_expression: >
      REPLACE(REPLACE(REPLACE(phone, '-', ''), '(', ''), ')', '')
    target_expression: >
      REGEXP_REPLACE(PHONE_NUMBER, '[^0-9]', '')
    target: normalized_phone
rules:
  order_amount:
    numeric_tolerance:
      absolute: 0.01
  cancellation_date:
    null_equivalents:
      - "1900-01-01"
      - "9999-12-31"
`;
    const def = parseDefinition(yaml);

    expect(def.columnMapping).toEqual([
      { source: "first_name", target: "first_name" },
      { source: "last_name", target: "last_name" },
      {
        name: "full_name",
        target: "customer_full_name",
        sourceExpression: "concat(first_name, ' ', last_name)",
      },
      {
        name: "normalized_phone",
        target: "normalized_phone",
        sourceExpression: "REPLACE(REPLACE(REPLACE(phone, '-', ''), '(', ''), ')', '')\n",
        targetExpression: "REGEXP_REPLACE(PHONE_NUMBER, '[^0-9]', '')\n",
      },
    ]);

    expect(def.rules["order_amount"]).toEqual({
      numericTolerance: { absolute: 0.01 },
    });
    expect(def.rules["cancellation_date"]).toEqual({
      nullEquivalents: ["1900-01-01", "9999-12-31"],
    });
  });
});
