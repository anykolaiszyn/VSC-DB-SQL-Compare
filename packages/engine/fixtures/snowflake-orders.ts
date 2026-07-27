// Fixture pair 2: "Snowflake-like" source vs "Snowflake-like" target,
// modeling a same-platform dev-vs-prod ORDERS table reconciliation (Idea
// Prompt.md section 1's "Development versus production comparisons" use
// case), using Snowflake-flavored native types (NUMBER(p,s), VARCHAR,
// FLOAT, BOOLEAN).
//
// Deliberate mismatches (see IMPLEMENTATION-REPORT.md for the authoritative
// list consumed by T-06/T-14):
//
// 1. SCHEMA MISMATCH: column `DISCOUNT_PCT` (source, `FLOAT`) is present in
//    source but absent from target entirely (dropped-in-target column).
//    Also `ORDER_TOTAL` is `NUMBER(12,2)` on source vs `NUMBER(10,2)` on
//    target (precision mismatch — compatible-but-different).
// 2. VOLUME MISMATCH: source has 5 rows, target has 4 rows.
// 3. ROW-LEVEL MISMATCH:
//    - OrderID 103 exists in source but not target (missing-target row).
//    - OrderID 101's ORDER_TOTAL differs: source 250.00 vs target 199.99
//      (differing-value row).

import type { FixtureTableDefinition } from "./sqlserver-customer.js";

export const snowflakeOrdersSource: FixtureTableDefinition = {
  createTableSql: `
    CREATE TABLE orders_source (
      ORDER_ID INTEGER NOT NULL,
      CUSTOMER_ID INTEGER NOT NULL,
      ORDER_TOTAL DECIMAL(12,2) NOT NULL,
      DISCOUNT_PCT DOUBLE,
      ORDER_STATUS VARCHAR(20) NOT NULL
    )
  `,
  insertRowsSql: [
    `INSERT INTO orders_source VALUES (101, 1, 250.00, 0.10, 'SHIPPED')`,
    `INSERT INTO orders_source VALUES (102, 2, 89.50, 0.00, 'SHIPPED')`,
    `INSERT INTO orders_source VALUES (103, 3, 430.25, 0.05, 'PENDING')`,
    `INSERT INTO orders_source VALUES (104, 5, 15.75, NULL, 'CANCELLED')`,
    `INSERT INTO orders_source VALUES (105, 6, 999.99, 0.15, 'SHIPPED')`,
  ],
};

// Target: DISCOUNT_PCT column dropped entirely; ORDER_TOTAL precision
// narrowed to (10,2); OrderID 103 (PENDING, source-only) deliberately
// missing; OrderID 101's total deliberately differs from source.
export const snowflakeOrdersTarget: FixtureTableDefinition = {
  createTableSql: `
    CREATE TABLE orders_target (
      ORDER_ID INTEGER NOT NULL,
      CUSTOMER_ID INTEGER NOT NULL,
      ORDER_TOTAL DECIMAL(10,2) NOT NULL,
      ORDER_STATUS VARCHAR(20) NOT NULL
    )
  `,
  insertRowsSql: [
    `INSERT INTO orders_target VALUES (101, 1, 199.99, 'SHIPPED')`,
    `INSERT INTO orders_target VALUES (102, 2, 89.50, 'SHIPPED')`,
    `INSERT INTO orders_target VALUES (104, 5, 15.75, 'CANCELLED')`,
    `INSERT INTO orders_target VALUES (105, 6, 999.99, 'SHIPPED')`,
  ],
};
