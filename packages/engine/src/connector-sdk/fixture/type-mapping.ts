// Best-effort mapping from DuckDB's reported logical type strings (as
// returned by `DESCRIBE`/`information_schema.columns` and by
// `DuckDBType.toString()` from @duckdb/node-api) to the canonical type
// category enum from @paritylens/shared (Idea Prompt.md section 2). This is
// intentionally narrow — a full native-type catalog per real platform is
// T-05's concern — but FixtureConnector must still populate
// `ColumnDefinition.canonicalType` with *something* sensible so its shape
// satisfies the `DataPlatformConnector` contract on its own, independent of
// T-05 landing.
import type { CanonicalTypeCategory } from "@paritylens/shared";

export function mapDuckDbTypeToCanonical(duckDbType: string): CanonicalTypeCategory {
  const normalized = duckDbType.toUpperCase();

  if (/^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|INT\d*|UTINYINT|USMALLINT|UINTEGER|UBIGINT)$/.test(normalized)) {
    return "Integer";
  }
  if (/^(DECIMAL|NUMERIC)(\(.*\))?$/.test(normalized)) {
    return "Decimal";
  }
  if (/^(FLOAT|DOUBLE|REAL)$/.test(normalized)) {
    return "FloatingPoint";
  }
  if (normalized === "BOOLEAN") {
    return "Boolean";
  }
  if (/^(VARCHAR|CHAR|TEXT|STRING|BPCHAR)(\(.*\))?$/.test(normalized)) {
    return "String";
  }
  if (/^(BLOB|BYTEA|VARBINARY)$/.test(normalized)) {
    return "Binary";
  }
  if (normalized === "DATE") {
    return "Date";
  }
  if (/^TIME/.test(normalized)) {
    return "Time";
  }
  if (normalized === "TIMESTAMP" || normalized === "DATETIME") {
    return "Timestamp";
  }
  if (/^TIMESTAMP.*(TZ|WITH TIME ZONE)/.test(normalized)) {
    return "TimestampWithTimezone";
  }
  if (normalized === "JSON") {
    return "JSON";
  }
  if (/\[\]$/.test(normalized) || normalized.startsWith("LIST") || normalized.startsWith("ARRAY")) {
    return "Array";
  }
  if (normalized.startsWith("STRUCT") || normalized.startsWith("MAP")) {
    return "Object";
  }

  return "Unknown";
}
