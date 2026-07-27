// Fixture pair 1: "SQL Server-like" source vs "Snowflake-like" target,
// modeling the exact migration scenario in Idea Prompt.md section 2's
// worked example (SQL Server dbo.Customer -> Snowflake ANALYTICS.CUSTOMER).
//
// Deliberate mismatches (see IMPLEMENTATION-REPORT.md for the authoritative
// list consumed by T-06/T-14):
//
// 1. SCHEMA MISMATCH:
//    - Column `CreditLimit` is `MONEY` on the source but `CreditLimit` is
//      entirely ABSENT on the target (renamed/dropped) — a
//      missing-target-column case.
//    - Column `CreatedDate` (source, `DATETIME`) vs `CREATED_AT` (target,
//      `TIMESTAMP_NTZ`) — a compatible-but-different type-name mismatch
//      (mirrors the idea doc's own worked example row).
// 2. VOLUME MISMATCH: source has 6 rows, target has 7 rows (row-count
//    mismatch: CustomerID 4 missing from target, but CustomerID 5 is
//    duplicated in target, for a net +1).
// 3. ROW-LEVEL MISMATCH:
//    - CustomerID 4 exists in source but not target (missing-target row).
//    - CustomerID 2's CustomerName differs: source "Jane Roe" vs target
//      "Jane R. Doe" (differing-value row).
//    - CustomerID 5 is duplicated in target (appears twice, second copy has
//      IsActive flipped) — a duplicate-target row.

export interface FixtureTableDefinition {
  createTableSql: string;
  insertRowsSql: string[];
}

export const sqlServerCustomerSource: FixtureTableDefinition = {
  createTableSql: `
    CREATE TABLE customer_source (
      CustomerID INTEGER NOT NULL,
      CustomerName VARCHAR(100) NOT NULL,
      CreatedDate TIMESTAMP,
      IsActive BOOLEAN NOT NULL,
      CreditLimit DECIMAL(19,4)
    )
  `,
  insertRowsSql: [
    `INSERT INTO customer_source VALUES (1, 'John Smith', TIMESTAMP '2024-01-05 08:30:00', true, 5000.00)`,
    `INSERT INTO customer_source VALUES (2, 'Jane Roe', TIMESTAMP '2024-01-06 09:15:00', true, 12000.50)`,
    `INSERT INTO customer_source VALUES (3, 'Alan Turing', TIMESTAMP '2024-01-07 10:00:00', true, 7500.00)`,
    `INSERT INTO customer_source VALUES (4, 'Grace Hopper', TIMESTAMP '2024-01-08 11:45:00', true, 9000.00)`,
    `INSERT INTO customer_source VALUES (5, 'Ada Lovelace', TIMESTAMP '2024-01-09 13:00:00', true, 15000.00)`,
    `INSERT INTO customer_source VALUES (6, 'Margaret Hamilton', TIMESTAMP '2024-01-10 14:30:00', false, 3000.00)`,
  ],
};

// Target ("Snowflake-like"): column CREDIT_LIMIT is deliberately absent
// (schema mismatch); CREATED_AT stands in for TIMESTAMP_NTZ naming; row for
// CustomerID 4 is deliberately missing; CustomerID 2's name deliberately
// differs; CustomerID 5 is deliberately duplicated with a flipped
// IS_ACTIVE flag on the duplicate.
export const sqlServerCustomerTarget: FixtureTableDefinition = {
  createTableSql: `
    CREATE TABLE customer_target (
      CUSTOMER_ID INTEGER NOT NULL,
      CUSTOMER_NAME VARCHAR(255) NOT NULL,
      CREATED_AT TIMESTAMP,
      IS_ACTIVE BOOLEAN NOT NULL
    )
  `,
  insertRowsSql: [
    `INSERT INTO customer_target VALUES (1, 'John Smith', TIMESTAMP '2024-01-05 08:30:00', true)`,
    `INSERT INTO customer_target VALUES (2, 'Jane R. Doe', TIMESTAMP '2024-01-06 09:15:00', true)`,
    `INSERT INTO customer_target VALUES (3, 'Alan Turing', TIMESTAMP '2024-01-07 10:00:00', true)`,
    `INSERT INTO customer_target VALUES (5, 'Ada Lovelace', TIMESTAMP '2024-01-09 13:00:00', true)`,
    `INSERT INTO customer_target VALUES (5, 'Ada Lovelace', TIMESTAMP '2024-01-09 13:00:00', false)`,
    `INSERT INTO customer_target VALUES (6, 'Margaret Hamilton', TIMESTAMP '2024-01-10 14:30:00', false)`,
    `INSERT INTO customer_target VALUES (7, 'Katherine Johnson', TIMESTAMP '2024-01-11 15:00:00', true)`,
  ],
};
