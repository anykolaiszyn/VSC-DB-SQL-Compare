// Fixture registry: maps a fixture-set identifier + side ("source"/"target")
// to the DuckDB table definition FixtureConnector should seed and query
// against. Three named pairs, one per Idea Prompt.md section 14's MVP
// platform shapes (SQL Server, Snowflake, PostgreSQL) — see each fixture
// file's header comment for the deliberate schema/volume/row-level
// mismatches encoded in that pair.
import type { FixtureTableDefinition } from "./sqlserver-customer.js";
import { sqlServerCustomerSource, sqlServerCustomerTarget } from "./sqlserver-customer.js";
import { snowflakeOrdersSource, snowflakeOrdersTarget } from "./snowflake-orders.js";
import { postgresProductsSource, postgresProductsTarget } from "./postgres-products.js";

export type { FixtureTableDefinition } from "./sqlserver-customer.js";

/** Which side of a fixture pair to seed/query: source or target dataset. */
export type FixtureSide = "source" | "target";

/** Named fixture-set identifiers, one per MVP platform shape. */
export type FixtureSetId = "sqlserver-customer" | "snowflake-orders" | "postgres-products";

/** A fixture set: a named pair of source/target table definitions plus the
 * table name each side is seeded into, and the object name callers pass to
 * `getSchema`/`executeQuery` via `QueryInput`. */
export interface FixtureSetDefinition {
  id: FixtureSetId;
  source: { tableName: string; definition: FixtureTableDefinition };
  target: { tableName: string; definition: FixtureTableDefinition };
}

const FIXTURE_SETS: Record<FixtureSetId, FixtureSetDefinition> = {
  "sqlserver-customer": {
    id: "sqlserver-customer",
    source: { tableName: "customer_source", definition: sqlServerCustomerSource },
    target: { tableName: "customer_target", definition: sqlServerCustomerTarget },
  },
  "snowflake-orders": {
    id: "snowflake-orders",
    source: { tableName: "orders_source", definition: snowflakeOrdersSource },
    target: { tableName: "orders_target", definition: snowflakeOrdersTarget },
  },
  "postgres-products": {
    id: "postgres-products",
    source: { tableName: "products_source", definition: postgresProductsSource },
    target: { tableName: "products_target", definition: postgresProductsTarget },
  },
};

export const FIXTURE_SET_IDS: FixtureSetId[] = [
  "sqlserver-customer",
  "snowflake-orders",
  "postgres-products",
];

export function getFixtureSet(id: FixtureSetId): FixtureSetDefinition {
  const set = FIXTURE_SETS[id];
  if (!set) {
    throw new Error(`Unknown fixture set: ${id}`);
  }
  return set;
}

/** Resolves the table name a given fixture set + side should be seeded into
 * and queried as. */
export function fixtureTableName(id: FixtureSetId, side: FixtureSide): string {
  const set = getFixtureSet(id);
  return side === "source" ? set.source.tableName : set.target.tableName;
}
