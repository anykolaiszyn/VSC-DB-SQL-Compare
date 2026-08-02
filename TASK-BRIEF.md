# ParityLens — Task Brief T-29

## Objective

Implement connection profile management: the first piece of Phase 4's
self-service UI gap (`IMPLEMENTATION-PLAN.md`'s Phase 4 section,
`PROGRESS-LEDGER.md`'s decision log 2026-08-02). Today, `runComparisonCommand`
(T-22) can only ever resolve a `.paritylens` definition's connection names
against hardcoded `FixtureConnector` instances — there is no way for a user
to register a real SQL Server or PostgreSQL connection. This task adds a
`ConnectionProfile` type, CRUD commands, and a profile-to-connector resolver.
It does **not** wire these profiles into `runComparisonCommand` itself — that
real-connector resolution is T-30, which depends on this task's output.

## Scope

1. Define a `ConnectionProfile` type: `{ id: string; name: string; platform:
   "sqlserver" | "postgres"; host: string; port: number; database: string;
   user: string; trustServerCertificate?: boolean; ssl?: boolean;
   connectTimeoutMs?: number }` — deliberately mirrors the non-secret fields
   of `SqlServerConnectionOptions`/`PostgresConnectionOptions`
   (`packages/engine/src/connector-sdk/sqlserver/sqlServerConnector.ts`,
   `packages/engine/src/connector-sdk/postgres/postgresConnector.ts`) minus
   `password`. **Never include a `password`/credential field on this type** —
   the credential is stored only via `SecretStore`, keyed by the profile's
   `id`.
2. A `ConnectionProfileStore` class wrapping `context.globalState` for the
   non-secret fields above (array of profiles, get/list/add/update/delete),
   and the existing `SecretStore` (`packages/extension/src/secrets/secretStore.ts`,
   already built by T-10 — do not modify it) for the profile's password,
   using a stable per-profile secret key (e.g. `paritylens.connection.<id>.password`).
   Deleting a profile must delete its `SecretStore` entry too — no orphaned
   credential left behind.
3. Register three commands: `paritylens.addConnection`,
   `paritylens.editConnection`, `paritylens.deleteConnection`, following the
   same extraction pattern `runComparisonCommand`
   (`packages/extension/src/activation/activate.ts`) already uses — a plain,
   directly testable function taking injected VS Code UI dependencies
   (`showInputBox`/`showQuickPick`/`showInformationMessage`/`showErrorMessage`
   etc.), wired to a real `vscode.commands.registerCommand` callback
   separately. Prompt for: name, platform (quick-pick sqlserver/postgres),
   host, port, database, user, password (using `password: true` on the
   input box so it isn't shown in plaintext on screen — mirrors how a real
   VS Code extension collects a secret interactively).
4. A profile-to-connector resolver function,
   `resolveConnector(profile: ConnectionProfile, password: string):
   SqlServerConnector | PostgresConnector`, switching on `profile.platform`
   and constructing the matching real connector from T-17/T-19 with the
   profile's non-secret fields plus the resolved password. This function is
   the interface T-30 will consume; it does not need to be wired into
   `runComparisonCommand` in this task.
5. Register the three new commands in `package.json`'s
   `contributes.commands` array (same array T-22 already added
   `paritylens.runComparison` to) and call the registration functions from
   `activate()` in `activate.ts`, following T-22's exact precedent (each
   registered disposable pushed to `context.subscriptions`).

## Dependencies

T-10 (extension scaffold: `SecretStore`, `activate()` shape — complete,
`APPROVED`). T-17/T-19 (`SqlServerConnector`/`PostgresConnector` and their
`*ConnectionOptions` types — complete, `APPROVED`, read-only consumption
only, do not modify either connector file).

## Files owned

- `packages/extension/src/connections/**` (new directory — the
  `ConnectionProfile` type, `ConnectionProfileStore`, `resolveConnector`,
  the three command handler functions, and their tests)
- `packages/extension/src/activation/activate.ts` (extends T-10/T-22;
  **only** permitted edit is registering the three new commands the same
  way `registerRunComparisonCommand`/T-22 already registers
  `paritylens.runComparison` — do not restructure existing tree-view/
  SecretStore/runComparison wiring)
- `packages/extension/package.json` (`contributes.commands` array only —
  append three entries, do not touch any other field)
- `packages/engine/src/index.ts` (Amendment, see below — narrowly widen
  re-exports only)

## Amendment (added after round-1 correctly stopped at a scope boundary)

Round 1 correctly identified that `SqlServerConnector`/`PostgresConnector`
and their `*ConnectionOptions` types are not reachable from
`packages/extension` — `packages/engine/src/index.ts` (the package's sole
public entry point) re-exports only `orchestration/definition/definition.ts`,
`orchestration/planner/planner.ts`, and `connector-sdk/fixture/fixture-connector.ts`
(added by T-22). No file in this monorepo deep-imports across the
`@paritylens/engine` package boundary; widening this file's re-exports is
the established, single existing precedent for this exact situation (T-22
did the same thing for `parseDefinition`/`runComparison`/`FixtureConnector`).

**Resolution (orchestrator decision, not escalated — mechanical,
additive-only change):** add `packages/engine/src/index.ts` to this task's
Files owned, scoped narrowly to one additional re-export line:

```ts
export * from "./connector-sdk/sqlserver/sqlServerConnector.js";
export * from "./connector-sdk/postgres/postgresConnector.js";
```

placed alongside the three existing re-exports, following the file's
existing header-comment convention (extend the comment to document why
these two lines were added, same style as the existing three). No other
edit to this file is permitted — do not remove, reorder, or alter the
three existing re-export lines or their documentation beyond appending the
new entries.

## Interfaces consumed

- `SecretStore` (`packages/extension/src/secrets/secretStore.ts`) — `get`/
  `set`/`delete` by string key. Read-only consumption, do not modify.
- `SqlServerConnectionOptions`, `SqlServerConnector`
  (`packages/engine/src/connector-sdk/sqlserver/sqlServerConnector.ts`) —
  read-only consumption.
- `PostgresConnectionOptions`, `PostgresConnector`
  (`packages/engine/src/connector-sdk/postgres/postgresConnector.ts`) —
  read-only consumption.
- `vscode.ExtensionContext.globalState` (Memento API: `get`/`update`).

## Interfaces produced

- `ConnectionProfile` type (exported from `packages/extension/src/connections/`).
- `ConnectionProfileStore` (add/update/delete/list/get profile metadata via
  `globalState`; delete also clears the matching `SecretStore` entry).
- `resolveConnector(profile, password): SqlServerConnector | PostgresConnector`.
- `paritylens.addConnection` / `paritylens.editConnection` /
  `paritylens.deleteConnection` commands.

## Prohibited changes

- Do not modify `SecretStore`, `SqlServerConnector`, `PostgresConnector`, or
  either connector's `*ConnectionOptions` type.
- Do not touch `runComparisonCommand` or `buildFixtureRegistry` in
  `activate.ts` — wiring real connectors into the run command is T-30's
  scope, not this task's.
- Do not add a `password`/credential-shaped field anywhere on
  `ConnectionProfile` itself or anywhere it could be written to
  `globalState`/`workspaceState`. This is the same rule T-10's own review
  gate enforced and must hold here identically.

## Red-state evidence required

A test adding a connection profile (mocked `globalState`/`SecretStorage`)
and reading it back, expecting the non-secret fields to be present in the
returned profile object and the password readable only via a separate
`SecretStore.get` call — fails today because `ConnectionProfileStore`
doesn't exist.

A second red-state test: after deleting a profile, confirm its `SecretStore`
entry was also deleted — fails today (nothing to delete yet).

## Green-state verification required

Both tests above pass. Additionally: a test directly inspecting the raw
value(s) written to the mocked `globalState` for an added profile, confirming
no property on the stored object is named or shaped like a
password/credential (same class of assertion T-10's own test suite already
uses for its `SecretStore` review gate — mirror that pattern, don't invent
a new one). `npm run verify` passes in full.

## Handoff

Note to reviewer: the two review-gate items that matter most here are (1)
no credential ever reaches `globalState`/`workspaceState` under any field
name, mirroring T-10's original gate, and (2) deleting a profile leaves no
orphaned `SecretStore` entry. Please adversarially check both directly
against the diff, not just by re-running the given tests.
