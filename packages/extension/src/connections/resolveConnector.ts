import {
  SqlServerConnector,
  type SqlServerConnectionOptions,
  PostgresConnector,
  type PostgresConnectionOptions
} from "@paritylens/engine";
import type { ConnectionProfile } from "./connectionProfile";

/**
 * Constructs the real connector matching a stored `ConnectionProfile`'s
 * `platform`, per TASK-BRIEF.md Scope item 4. This is the interface T-30
 * will consume to wire real connectors into `runComparisonCommand`; it is
 * intentionally not called anywhere in this task (T-29's Scope explicitly
 * excludes wiring it into `runComparisonCommand` -- that's T-30's own
 * declared scope).
 *
 * `password` is taken as a separate parameter rather than read from
 * `ConnectionProfile` itself, because `ConnectionProfile` deliberately never
 * holds a credential -- the caller (T-30's future command/resolution code)
 * is expected to have already read it via `SecretStore.get(secretKeyFor(profile.id))`
 * (`connectionProfileStore.ts`).
 */
export function resolveConnector(profile: ConnectionProfile, password: string): SqlServerConnector | PostgresConnector {
  switch (profile.platform) {
    case "sqlserver": {
      const options: SqlServerConnectionOptions = {
        host: profile.host,
        port: profile.port,
        user: profile.user,
        password,
        database: profile.database,
        ...(profile.trustServerCertificate !== undefined
          ? { trustServerCertificate: profile.trustServerCertificate }
          : {}),
        ...(profile.connectTimeoutMs !== undefined ? { connectTimeoutMs: profile.connectTimeoutMs } : {})
      };
      return new SqlServerConnector(options);
    }
    case "postgres": {
      const options: PostgresConnectionOptions = {
        host: profile.host,
        port: profile.port,
        user: profile.user,
        password,
        database: profile.database,
        ...(profile.ssl !== undefined ? { ssl: profile.ssl } : {}),
        ...(profile.connectTimeoutMs !== undefined ? { connectTimeoutMs: profile.connectTimeoutMs } : {})
      };
      return new PostgresConnector(options);
    }
  }
}
