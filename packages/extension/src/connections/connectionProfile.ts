/**
 * Non-secret connection profile metadata (T-29).
 *
 * Deliberately mirrors the non-secret fields of `SqlServerConnectionOptions`
 * / `PostgresConnectionOptions`
 * (`packages/engine/src/connector-sdk/sqlserver/sqlServerConnector.ts`,
 * `packages/engine/src/connector-sdk/postgres/postgresConnector.ts`) minus
 * `password` -- per TASK-BRIEF.md Scope item 1. `trustServerCertificate`
 * (SQL Server-only) and `ssl` (PostgreSQL-only) are both included as
 * optional fields on the single shared type rather than split into two
 * platform-specific types, matching the exact shape TASK-BRIEF.md specifies
 * verbatim; `resolveConnector` (see `resolveConnector.ts`) is what narrows
 * per-platform and only reads the field relevant to the resolved connector.
 *
 * CRITICAL: this type must never gain a `password`/credential-shaped field.
 * The credential is stored only via `SecretStore`
 * (`packages/extension/src/secrets/secretStore.ts`), keyed by this
 * profile's `id` (see `connectionProfileStore.ts`'s `secretKeyFor`). Nothing
 * in this module -- or anything holding a `ConnectionProfile` value -- may
 * write a credential to `vscode.Memento` (`globalState`/`workspaceState`).
 * This is the same rule T-10's own review gate enforced for `SecretStore`
 * (see `secretStore.test.ts`'s "never writes a credential-shaped value to
 * globalState or workspaceState" test) and must hold identically here.
 */
export interface ConnectionProfile {
  id: string;
  name: string;
  platform: "sqlserver" | "postgres";
  host: string;
  port: number;
  database: string;
  user: string;
  trustServerCertificate?: boolean;
  ssl?: boolean;
  connectTimeoutMs?: number;
}
