// T-05: canonical type-mapping layer tests.
//
// Section "Worked examples (Idea Prompt.md section 2)" below reproduces the
// exact five-row table from Idea Prompt.md section 2, Layer 2: Structural
// Parity, verbatim:
//
//   Source        Source Type   Target        Target Type       Status
//   CustomerID    INT           CUSTOMER_ID   NUMBER(38,0)      Compatible
//   CustomerName  VARCHAR(100)  CUSTOMER_NAME VARCHAR(255)      Compatible
//   CreatedDate   DATETIME      CREATED_AT    TIMESTAMP_NTZ     Review
//   IsActive      BIT           IS_ACTIVE     BOOLEAN           Compatible
//   CreditLimit   MONEY         CREDIT_LIMIT  FLOAT             Risk
import { describe, expect, it } from "vitest";
import { mapNativeType, compareCanonicalTypes } from "./type-mapping.js";

describe("Idea Prompt.md section 2 worked examples (verbatim)", () => {
  it("CustomerID INT (sqlserver) / CUSTOMER_ID NUMBER(38,0) (snowflake) -> Integer/Integer -> Compatible", () => {
    const source = mapNativeType("INT", "sqlserver");
    const target = mapNativeType("NUMBER(38,0)", "snowflake");
    expect(source).toBe("Integer");
    expect(target).toBe("Integer");
    expect(compareCanonicalTypes(source, target)).toBe("Compatible");
  });

  it("CustomerName VARCHAR(100) (sqlserver) / CUSTOMER_NAME VARCHAR(255) (snowflake) -> String/String -> Compatible", () => {
    const source = mapNativeType("VARCHAR(100)", "sqlserver");
    const target = mapNativeType("VARCHAR(255)", "snowflake");
    expect(source).toBe("String");
    expect(target).toBe("String");
    expect(compareCanonicalTypes(source, target)).toBe("Compatible");
  });

  it("CreatedDate DATETIME (sqlserver) / CREATED_AT TIMESTAMP_NTZ (snowflake) -> Timestamp category -> Review", () => {
    const source = mapNativeType("DATETIME", "sqlserver");
    const target = mapNativeType("TIMESTAMP_NTZ", "snowflake");
    // Both are timestamp-family categories (Timestamp, since neither carries
    // an explicit timezone), but they are not treated as flatly identical:
    // DATETIME (SQL Server) has no timezone awareness and TIMESTAMP_NTZ
    // ("no time zone") is Snowflake's explicitly-naive timestamp type, so
    // both map to the plain `Timestamp` canonical category. Same-category
    // pairs are ordinarily Compatible, but this specific pair is called out
    // by the idea doc as Review rather than Compatible, reflecting that
    // "compatible category" does not always imply "safe to treat as
    // identical" -- see type-mapping.ts's DATETIME-vs-TIMESTAMP_NTZ note.
    expect(source).toBe("Timestamp");
    expect(target).toBe("Timestamp");
    expect(compareCanonicalTypes(source, target)).toBe("Review");
  });

  it("IsActive BIT (sqlserver) / IS_ACTIVE BOOLEAN (postgres) -> Boolean/Boolean -> Compatible", () => {
    const source = mapNativeType("BIT", "sqlserver");
    const target = mapNativeType("BOOLEAN", "postgres");
    expect(source).toBe("Boolean");
    expect(target).toBe("Boolean");
    expect(compareCanonicalTypes(source, target)).toBe("Compatible");
  });

  it("CreditLimit MONEY (sqlserver) / CREDIT_LIMIT FLOAT (snowflake) -> Decimal vs FloatingPoint -> Risk", () => {
    const source = mapNativeType("MONEY", "sqlserver");
    const target = mapNativeType("FLOAT", "snowflake");
    expect(source).toBe("Decimal");
    expect(target).toBe("FloatingPoint");
    expect(compareCanonicalTypes(source, target)).toBe("Risk");
  });
});

// T-04 fixture-observed native types. The three fixture pairs
// (sqlserver-customer, snowflake-orders, postgres-products) are seeded
// through DuckDB, so `getSchema()` itself reports DuckDB-flavored type
// strings (see FixtureConnector's own `mapDuckDbTypeToCanonical`) -- but
// each fixture's authoring comments document the *real platform* types
// those columns model (SQL Server INTEGER/VARCHAR/TIMESTAMP/BOOLEAN/
// DECIMAL; Snowflake NUMBER(p,s)/VARCHAR/DOUBLE/BOOLEAN; PostgreSQL
// NUMERIC/VARCHAR/TIMESTAMPTZ/BOOLEAN). This section exercises
// `mapNativeType` against those realistic native-type strings so this
// mapping table is validated against the same platforms/types the other
// engine tasks (T-06/T-07) will actually see once real connectors (T-17-19)
// land, not only DuckDB's own type spelling.
describe("native types observed in/implied by T-04 fixtures", () => {
  it.each([
    ["INTEGER", "sqlserver", "Integer"],
    ["INT", "sqlserver", "Integer"],
    ["BIGINT", "sqlserver", "Integer"],
    ["SMALLINT", "sqlserver", "Integer"],
    ["TINYINT", "sqlserver", "Integer"],
    ["VARCHAR(100)", "sqlserver", "String"],
    ["NVARCHAR(255)", "sqlserver", "String"],
    ["CHAR(10)", "sqlserver", "String"],
    ["TEXT", "sqlserver", "String"],
    ["DATETIME", "sqlserver", "Timestamp"],
    ["DATETIME2", "sqlserver", "Timestamp"],
    ["SMALLDATETIME", "sqlserver", "Timestamp"],
    ["DATETIMEOFFSET", "sqlserver", "TimestampWithTimezone"],
    ["BOOLEAN", "sqlserver", "Boolean"],
    ["BIT", "sqlserver", "Boolean"],
    ["DECIMAL(19,4)", "sqlserver", "Decimal"],
    ["DECIMAL(10,0)", "sqlserver", "Decimal"],
    ["MONEY", "sqlserver", "Decimal"],
    ["DATE", "sqlserver", "Date"],
    ["TIME", "sqlserver", "Time"],
    ["BINARY(16)", "sqlserver", "Binary"],
    ["VARBINARY(MAX)", "sqlserver", "Binary"],

    ["NUMBER(38,0)", "snowflake", "Integer"],
    ["NUMBER(12,2)", "snowflake", "Decimal"],
    ["NUMBER(10,2)", "snowflake", "Decimal"],
    ["DECIMAL(12,2)", "snowflake", "Decimal"],
    ["DOUBLE", "snowflake", "FloatingPoint"],
    ["FLOAT", "snowflake", "FloatingPoint"],
    ["VARCHAR(20)", "snowflake", "String"],
    ["VARCHAR", "snowflake", "String"],
    ["BOOLEAN", "snowflake", "Boolean"],
    ["TIMESTAMP_NTZ", "snowflake", "Timestamp"],
    ["TIMESTAMP_TZ", "snowflake", "TimestampWithTimezone"],
    ["VARIANT", "snowflake", "JSON"],
    ["ARRAY", "snowflake", "Array"],
    ["OBJECT", "snowflake", "Object"],

    ["INTEGER", "postgres", "Integer"],
    ["NUMERIC(10,2)", "postgres", "Decimal"],
    ["NUMERIC", "postgres", "Decimal"],
    ["VARCHAR(20)", "postgres", "String"],
    ["VARCHAR(10)", "postgres", "String"],
    ["VARCHAR(500)", "postgres", "String"],
    ["BOOLEAN", "postgres", "Boolean"],
    ["TIMESTAMPTZ", "postgres", "TimestampWithTimezone"],
    ["TIMESTAMP WITH TIME ZONE", "postgres", "TimestampWithTimezone"],
    ["TIMESTAMP", "postgres", "Timestamp"],
    ["BYTEA", "postgres", "Binary"],
    ["JSONB", "postgres", "JSON"],
    ["JSON", "postgres", "JSON"],
  ] as const)("mapNativeType(%s, %s) -> %s", (nativeType, platform, expected) => {
    expect(mapNativeType(nativeType, platform)).toBe(expected);
  });

  it("bare NUMERIC with no precision/scale is Decimal (declared type, not reinterpreted)", () => {
    // Unlike Snowflake's NUMBER(p,s) (where scale 0 means Integer), standard
    // SQL NUMERIC/DECIMAL is Decimal by declaration regardless of scale --
    // see type-mapping.ts's NUMBER-vs-DECIMAL/NUMERIC reasoning note.
    expect(mapNativeType("NUMERIC", "postgres")).toBe("Decimal");
  });

  it("NUMBER(38,0) (Snowflake) is Integer but DECIMAL(38,0) (standard SQL) is Decimal", () => {
    expect(mapNativeType("NUMBER(38,0)", "snowflake")).toBe("Integer");
    expect(mapNativeType("DECIMAL(38,0)", "sqlserver")).toBe("Decimal");
  });
});

describe("Unknown fallback contract", () => {
  it("never throws on an unrecognized native type string, returns Unknown", () => {
    expect(() => mapNativeType("SOME_MADE_UP_TYPE_XYZ", "sqlserver")).not.toThrow();
    expect(mapNativeType("SOME_MADE_UP_TYPE_XYZ", "sqlserver")).toBe("Unknown");
  });

  it("returns Unknown for an empty string without throwing", () => {
    expect(() => mapNativeType("", "postgres")).not.toThrow();
    expect(mapNativeType("", "postgres")).toBe("Unknown");
  });

  it("compareCanonicalTypes(Unknown, anything) is Review, never Compatible or a throw", () => {
    expect(compareCanonicalTypes("Unknown", "Unknown")).toBe("Review");
    expect(compareCanonicalTypes("Unknown", "Integer")).toBe("Review");
    expect(compareCanonicalTypes("String", "Unknown")).toBe("Review");
  });
});

describe("additional compatibility matrix cases (beyond the five worked examples)", () => {
  it("Integer vs Decimal is Review (direction-dependent precision risk)", () => {
    expect(compareCanonicalTypes("Integer", "Decimal")).toBe("Review");
    expect(compareCanonicalTypes("Decimal", "Integer")).toBe("Review");
  });

  it("Integer vs FloatingPoint is Risk (large-integer precision loss)", () => {
    expect(compareCanonicalTypes("Integer", "FloatingPoint")).toBe("Risk");
  });

  it("Timestamp vs TimestampWithTimezone is Review (timezone-awareness change)", () => {
    expect(compareCanonicalTypes("Timestamp", "TimestampWithTimezone")).toBe("Review");
  });

  it("Date vs Timestamp is Review (structurally related, needs normalization confirmation)", () => {
    expect(compareCanonicalTypes("Date", "Timestamp")).toBe("Review");
  });

  it("String vs Binary is Risk (different byte representation/encoding)", () => {
    expect(compareCanonicalTypes("String", "Binary")).toBe("Risk");
  });

  it("JSON vs String is Review (common JSON-as-text migration pattern)", () => {
    expect(compareCanonicalTypes("JSON", "String")).toBe("Review");
  });

  it("Boolean vs Integer has no meaningful overlap -> Risk", () => {
    expect(compareCanonicalTypes("Boolean", "Integer")).toBe("Risk");
  });

  it("same-category String/String (identical) is Compatible", () => {
    expect(compareCanonicalTypes("String", "String")).toBe("Compatible");
  });

  it("same-category Integer/Integer (identical) is Compatible", () => {
    expect(compareCanonicalTypes("Integer", "Integer")).toBe("Compatible");
  });

  it("Geospatial paired with any other category is Review", () => {
    expect(compareCanonicalTypes("Geospatial", "String")).toBe("Review");
    expect(compareCanonicalTypes("Integer", "Geospatial")).toBe("Review");
  });
});
