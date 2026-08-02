import { describe, expect, it } from "vitest";
import { SqlServerConnector, PostgresConnector } from "@paritylens/engine";
import { resolveConnector } from "./resolveConnector";
import type { ConnectionProfile } from "./connectionProfile";

const SQLSERVER_PROFILE: ConnectionProfile = {
  id: "profile-sqlserver",
  name: "legacy-sql-prod",
  platform: "sqlserver",
  host: "db.example.internal",
  port: 1433,
  database: "CustomerDb",
  user: "parity_reader",
  trustServerCertificate: true,
  connectTimeoutMs: 20000
};

const POSTGRES_PROFILE: ConnectionProfile = {
  id: "profile-postgres",
  name: "analytics-postgres",
  platform: "postgres",
  host: "pg.example.internal",
  port: 5432,
  database: "AnalyticsDb",
  user: "parity_reader",
  ssl: true
};

describe("resolveConnector", () => {
  it("constructs a SqlServerConnector for a sqlserver-platform profile, carrying over its non-secret fields plus the given password", () => {
    const connector = resolveConnector(SQLSERVER_PROFILE, "s3cr3t-password");

    expect(connector).toBeInstanceOf(SqlServerConnector);
  });

  it("constructs a PostgresConnector for a postgres-platform profile, carrying over its non-secret fields plus the given password", () => {
    const connector = resolveConnector(POSTGRES_PROFILE, "s3cr3t-password");

    expect(connector).toBeInstanceOf(PostgresConnector);
  });

  it("omits optional fields not present on the profile rather than passing them as undefined", () => {
    const minimalProfile: ConnectionProfile = {
      id: "profile-minimal",
      name: "minimal-postgres",
      platform: "postgres",
      host: "pg.example.internal",
      port: 5432,
      database: "AnalyticsDb",
      user: "parity_reader"
    };

    // Constructing must not throw even though ssl/connectTimeoutMs are absent.
    expect(() => resolveConnector(minimalProfile, "s3cr3t-password")).not.toThrow();
  });
});
