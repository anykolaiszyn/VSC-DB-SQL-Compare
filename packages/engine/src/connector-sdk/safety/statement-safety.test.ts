import { describe, expect, it } from "vitest";
import {
  assertReadOnlyStatement,
  MutatingStatementError,
  type SqlDialect,
} from "./statement-safety.js";

const DIALECTS: SqlDialect[] = ["sqlserver", "snowflake", "postgres", "duckdb"];

// Representative matrix of mutating statements every dialect must reject.
const MUTATING_STATEMENTS: Array<{ label: string; sql: string }> = [
  { label: "DROP TABLE", sql: "DROP TABLE x" },
  { label: "DELETE FROM", sql: "DELETE FROM x" },
  { label: "UPDATE ... SET", sql: "UPDATE x SET y = 1" },
  { label: "INSERT INTO", sql: "INSERT INTO x VALUES (1)" },
  { label: "TRUNCATE TABLE", sql: "TRUNCATE TABLE x" },
  { label: "ALTER TABLE", sql: "ALTER TABLE x ADD y INT" },
  { label: "MERGE INTO", sql: "MERGE INTO x USING y ON x.id = y.id WHEN MATCHED THEN UPDATE SET x.y = y.y" },
];

// Representative safe statements every dialect must allow.
const SAFE_STATEMENTS: Array<{ label: string; sql: string }> = [
  { label: "plain SELECT", sql: "SELECT * FROM x" },
  {
    label: "CTE-wrapped SELECT",
    sql: "WITH cte AS (SELECT id, name FROM x) SELECT * FROM cte WHERE id > 1",
  },
  { label: "SHOW statement", sql: "SHOW TABLES" },
  { label: "DESCRIBE statement", sql: "DESCRIBE x" },
];

describe("assertReadOnlyStatement", () => {
  for (const dialect of DIALECTS) {
    describe(`dialect: ${dialect}`, () => {
      for (const { label, sql } of MUTATING_STATEMENTS) {
        it(`throws MutatingStatementError for ${label}`, () => {
          expect(() => assertReadOnlyStatement(sql, dialect)).toThrow(MutatingStatementError);
        });
      }

      for (const { label, sql } of SAFE_STATEMENTS) {
        it(`does not throw for ${label}`, () => {
          expect(() => assertReadOnlyStatement(sql, dialect)).not.toThrow();
        });
      }

      it("throws for a mutating statement hidden after a line comment", () => {
        const sql = "-- this looks safe\nDROP TABLE x";
        expect(() => assertReadOnlyStatement(sql, dialect)).toThrow(MutatingStatementError);
      });

      it("throws for a mutating statement hidden after a block comment", () => {
        const sql = "/* harmless comment\nspanning lines */ DELETE FROM x";
        expect(() => assertReadOnlyStatement(sql, dialect)).toThrow(MutatingStatementError);
      });

      it("throws for a multi-statement batch where the mutating statement is not first", () => {
        const sql = "SELECT 1; DROP TABLE x;";
        expect(() => assertReadOnlyStatement(sql, dialect)).toThrow(MutatingStatementError);
      });

      it("throws for a multi-statement batch hidden behind a comment on the first statement", () => {
        const sql = "SELECT 1; -- looks fine\nUPDATE x SET y = 1;";
        expect(() => assertReadOnlyStatement(sql, dialect)).toThrow(MutatingStatementError);
      });

      it("does not throw for a comment that merely mentions a mutating keyword in text", () => {
        const sql = "-- note: do not DROP TABLE in prod\nSELECT * FROM x";
        expect(() => assertReadOnlyStatement(sql, dialect)).not.toThrow();
      });

      it("does not throw for a multi-statement batch of only safe SELECTs", () => {
        const sql = "SELECT 1; SELECT 2; SELECT * FROM x;";
        expect(() => assertReadOnlyStatement(sql, dialect)).not.toThrow();
      });
    });
  }

  it("is case-insensitive when detecting mutating keywords", () => {
    expect(() => assertReadOnlyStatement("drop table x", "postgres")).toThrow(
      MutatingStatementError
    );
    expect(() => assertReadOnlyStatement("Delete From x", "sqlserver")).toThrow(
      MutatingStatementError
    );
  });
});
