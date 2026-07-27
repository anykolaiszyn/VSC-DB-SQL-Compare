// Fixture pair 3: "PostgreSQL-like" source vs "PostgreSQL-like" target,
// modeling a PRODUCTS catalog reconciliation between two Postgres-shaped
// schemas (e.g. a replication or ETL/ELT regression scenario per Idea
// Prompt.md section 1), using Postgres-flavored native types (NUMERIC,
// VARCHAR with differing lengths, TIMESTAMPTZ, BOOLEAN).
//
// Deliberate mismatches (see IMPLEMENTATION-REPORT.md for the authoritative
// list consumed by T-06/T-14):
//
// 1. SCHEMA MISMATCH: column `sku` is `VARCHAR(20)` on source but
//    `VARCHAR(10)` on target (declared-length mismatch — compatible but
//    truncation-risk). Also `description` (source, `VARCHAR(500)`) is
//    entirely absent from target (dropped-in-target column).
// 2. VOLUME MISMATCH: source has 5 rows, target has 6 rows (target has an
//    extra row not present in source, in addition to the duplicate below).
// 3. ROW-LEVEL MISMATCH:
//    - product_id 3 exists in source but not target (missing-target row).
//    - product_id 6 exists in target but not source (missing-source row).
//    - product_id 2 is duplicated in target (appears twice, second copy has
//      a differing `price`) — a duplicate-target row.

import type { FixtureTableDefinition } from "./sqlserver-customer.js";

export const postgresProductsSource: FixtureTableDefinition = {
  createTableSql: `
    CREATE TABLE products_source (
      product_id INTEGER NOT NULL,
      sku VARCHAR(20) NOT NULL,
      description VARCHAR(500),
      price DECIMAL(10,2) NOT NULL,
      in_stock BOOLEAN NOT NULL
    )
  `,
  insertRowsSql: [
    `INSERT INTO products_source VALUES (1, 'SKU-0001-A', 'Widget, standard', 9.99, true)`,
    `INSERT INTO products_source VALUES (2, 'SKU-0002-B', 'Widget, deluxe', 19.99, true)`,
    `INSERT INTO products_source VALUES (3, 'SKU-0003-C', 'Widget, industrial', 49.99, false)`,
    `INSERT INTO products_source VALUES (4, 'SKU-0004-D', 'Gadget, compact', 14.50, true)`,
    `INSERT INTO products_source VALUES (5, 'SKU-0005-E', 'Gadget, premium', 89.00, true)`,
  ],
};

// Target: sku length narrowed to VARCHAR(10) (declared-length mismatch);
// description column dropped entirely; product_id 3 deliberately missing;
// product_id 6 deliberately added (not present in source); product_id 2
// deliberately duplicated with a differing price on the duplicate.
export const postgresProductsTarget: FixtureTableDefinition = {
  createTableSql: `
    CREATE TABLE products_target (
      product_id INTEGER NOT NULL,
      sku VARCHAR(10) NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      in_stock BOOLEAN NOT NULL
    )
  `,
  insertRowsSql: [
    `INSERT INTO products_target VALUES (1, 'SKU-0001A', 9.99, true)`,
    `INSERT INTO products_target VALUES (2, 'SKU-0002B', 19.99, true)`,
    `INSERT INTO products_target VALUES (2, 'SKU-0002B', 24.99, true)`,
    `INSERT INTO products_target VALUES (4, 'SKU-0004D', 14.50, true)`,
    `INSERT INTO products_target VALUES (5, 'SKU-0005E', 89.00, true)`,
    `INSERT INTO products_target VALUES (6, 'SKU-0006F', 5.25, true)`,
  ],
};
