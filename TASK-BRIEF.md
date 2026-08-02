# ParityLens — Task Brief T-30

## Objective

Extend `paritylens.runComparison`'s connector registry resolution
(`packages/extension/src/activation/activate.ts`, T-22's
`buildFixtureRegistry`) so that when a `.paritylens` definition's
`source.connection`/`target.connection` name matches a saved
`ConnectionProfile` (T-29), the registry resolves to a real
`SqlServerConnector`/`PostgresConnector` instance instead of always
falling back to `FixtureConnector`. Fixture fallback remains for any
connection name that does not match a saved profile — this preserves
T-22's existing fixture-demo behavior unchanged when no profile is
configured, per `IMPLEMENTATION-PLAN.md`'s T-30 row.

## Scope

1. Add a function (in `activate.ts`, alongside `buildFixtureRegistry`) that
   builds a `ConnectorRegistry` by, for each of
   `definition.source.connection`/`definition.target.connection`:
   - Looking up a saved `ConnectionProfile` by name via
     `ConnectionProfileStore` (T-29,
     `packages/extension/src/connections/connectionProfileStore.ts`).
   - If found, reading the profile's password via `SecretStore` and calling
     `resolveConnector(profile, password)` (T-29,
     `packages/extension/src/connections/resolveConnector.ts`) to construct
     the real connector, registering it under the connection name.
   - If not found, falling back to the existing `FixtureConnector`
     construction exactly as `buildFixtureRegistry` does today (same
     `sqlserver-customer` fixture pair, same source/target side mapping).
2. Wire this new registry-building function into `runComparisonCommand`
   (or a thin wrapper around it) in place of the unconditional
   `buildFixtureRegistry` call. `runComparisonCommand` currently takes only
   `yamlText` and a `deps` object with UI callbacks — extend `deps` (or add
   a parameter) to carry the `ConnectionProfileStore` needed for lookup, so
   the function remains directly testable without `@vscode/test-electron`
   (same injected-dependency pattern already used throughout this file).
3. Update `FIXTURE_ONLY_NOTICE` (or its call site) so the user-facing
   message shown at the start of a run no longer unconditionally claims
   "this command runs comparisons against built-in fixture data only" —
   it should now be accurate for both the fixture-fallback and
   real-connection-profile cases. A conditional message (or two variants)
   is acceptable; do not simply delete the notice, since the fixture
   fallback path is still real and still worth disclosing when it's what
   actually happens for a given run.
4. Real connector construction failures (e.g. a bad host, connection
   refused) must not crash the command uncaught — they should surface via
   the Layer-1 connectivity-check failure path `runComparison`
   (`packages/engine/src/orchestration/planner/planner.ts`, already
   implemented, do not modify) already produces when a connector's
   `testConnection`/connect step fails, exactly as `DESIGN-SPEC.md`'s
   error/recovery table describes. Do not add a second, redundant
   try/catch around connector construction that swallows this into a
   generic error instead — let `runComparison`'s existing Layer-1 handling
   do its job; the existing outer `try/catch` in `runComparisonCommand`
   remains the only backstop for anything else.

## Dependencies

T-22 (COMPLETE, APPROVED — `runComparisonCommand`, `buildFixtureRegistry`,
the `ConnectorRegistry` type from `@paritylens/engine`). T-29 (COMPLETE,
APPROVED — `ConnectionProfile`, `ConnectionProfileStore`,
`resolveConnector`, all in `packages/extension/src/connections/`).

## Files owned

- `packages/extension/src/activation/activate.ts` (extends T-22's
  `buildFixtureRegistry`/`runComparisonCommand` — real-connector
  resolution only; the tree-view/`SecretStore`-construction/command-
  registration wiring for `paritylens.addConnection`/`editConnection`/
  `deleteConnection` from T-29 must remain untouched)
- `packages/extension/src/activation/activate.test.ts` (extend with new
  tests; do not delete or weaken existing T-22/T-29 test coverage)

## Interfaces consumed

- `ConnectionProfileStore` (`packages/extension/src/connections/connectionProfileStore.ts`)
  — `list()`/`get(name)`-style lookup by profile name. Read-only
  consumption, do not modify.
- `resolveConnector(profile, password)` (`packages/extension/src/connections/resolveConnector.ts`)
  — read-only consumption, do not modify.
- `SecretStore` (`packages/extension/src/secrets/secretStore.ts`) — `get`
  by key. Read-only consumption, do not modify.
- `ConnectorRegistry`, `runComparison`, `parseDefinition`,
  `FixtureConnector` (`@paritylens/engine`, via `packages/engine/src/index.ts`)
  — already exported, read-only consumption.

## Interfaces produced

- A real-connection-aware `ConnectorRegistry`-building function, used by
  `runComparisonCommand` in place of always calling `buildFixtureRegistry`.

## Prohibited changes

- Do not modify `packages/engine/**` (planner, connectors, or `index.ts`)
  — this task only changes how the extension *constructs* a
  `ConnectorRegistry`, not the engine's own connection/comparison logic.
- Do not modify `packages/extension/src/connections/**` (T-29's owned
  files) — read-only consumption only.
- Do not change the `paritylens.addConnection`/`editConnection`/
  `deleteConnection` command registrations or their handlers.
- Do not remove or weaken the fixture-fallback path — it must remain
  available, unchanged in behavior, for any connection name without a
  saved profile.

## Red-state evidence required

A test invoking `runComparisonCommand` (or its new registry-building
helper) with a definition naming a saved (mocked) SQL Server
`ConnectionProfile`, expecting a real `SqlServerConnector` to be
constructed for that connection name — fails today (always resolves to
`FixtureConnector` via `buildFixtureRegistry`, T-29's profiles are never
consulted).

## Green-state verification required

The test above passes. Additionally: a second test confirms an
unrecognized connection name (no matching saved profile) still falls back
to `FixtureConnector`, unchanged from T-22's existing behavior — assert
this against the *same* fixture-pair/side mapping T-22's existing tests
already expect, not a new one. A third test/assertion confirms a
connection failure against a real (mocked-failing) profile surfaces
through the normal Layer-1 `"failed"`-result path, not an uncaught
exception or a generic catch-all error message. `npm run verify` passes
in full.

## Handoff

Note to reviewer: please adversarially confirm (1) the fixture-fallback
path is genuinely byte-for-byte unchanged in behavior from T-22 (not just
"still present" but producing the identical fixture pair/side mapping for
an unmatched connection name), and (2) that a real-profile connection
failure flows through `runComparison`'s existing Layer-1 failure handling
rather than being caught and reshaped by a new, redundant try/catch in
`activate.ts`.
