# ParityLens — Implementation Report T-29

## Status and objective

- **Status:** COMPLETE (implementation and evidence only — not reviewed or approved)
- **Objective:** Implement connection profile management per `TASK-BRIEF.md`'s
  Objective: "Implement connection profile management: the first piece of
  Phase 4's self-service UI gap ... This task adds a `ConnectionProfile`
  type, CRUD commands, and a profile-to-connector resolver. It does **not**
  wire these profiles into `runComparisonCommand` itself — that real-
  connector resolution is T-30, which depends on this task's output."

## Resumed-after-amendment history

This task was picked up mid-flight. A prior implementer session correctly
stopped before writing any code because the brief's original Scope item 4
(`resolveConnector` returning `SqlServerConnector | PostgresConnector`)
required `SqlServerConnector`/`PostgresConnector`/their `*ConnectionOptions`
types, none of which were re-exported from `packages/engine/src/index.ts`
(the package's sole public entry point) — and that file was outside the
brief's declared file ownership at the time. The brief was then amended in
place (see its "Amendment" section) to add `packages/engine/src/index.ts`
to Files owned, scoped narrowly to two additional re-export lines following
the file's existing pattern. This session read `TASK-BRIEF.md` in its
current (amended) form as sole authority and implemented the full task,
including that narrow amendment.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/engine/src/index.ts` | Added two re-export lines — `export * from "./connector-sdk/sqlserver/sqlServerConnector.js";` and `export * from "./connector-sdk/postgres/postgresConnector.js";` — placed after the three existing re-exports, with the header comment extended to document why (same style as the existing three entries). No existing line removed, reordered, or altered. | Per the brief's Amendment section: "add `packages/engine/src/index.ts` to this task's Files owned, scoped narrowly to one additional re-export line ... No other edit to this file is permitted." |
| `packages/extension/src/connections/connectionProfile.ts` (new) | `ConnectionProfile` interface: `{ id, name, platform: "sqlserver" \| "postgres", host, port, database, user, trustServerCertificate?, ssl?, connectTimeoutMs? }`. No credential field. | Per Scope item 1. |
| `packages/extension/src/connections/connectionProfileStore.ts` (new) | `ConnectionProfileStore` class wrapping `globalState` (list/get/add/update/delete of non-secret profile metadata) and the existing `SecretStore` (consumed read-only, not modified) for the password, keyed by `secretKeyFor(id)` = `` `paritylens.connection.${id}.password` ``. `delete()` removes both the metadata entry and the matching `SecretStore` entry. | Per Scope item 2. |
| `packages/extension/src/connections/resolveConnector.ts` (new) | `resolveConnector(profile, password): SqlServerConnector \| PostgresConnector`, switching on `profile.platform` and constructing the matching real connector with the profile's non-secret fields plus the given password. Not called from anywhere in this task's own code (T-30's scope, per the brief). | Per Scope item 4. |
| `packages/extension/src/connections/connectionCommands.ts` (new) | Three directly-testable handler functions — `addConnectionCommand`, `editConnectionCommand`, `deleteConnectionCommand` — taking an injected `ConnectionProfileStore` and a `ConnectionCommandDeps` (`showInputBox`/`showQuickPick`/`showInformationMessage`/`showErrorMessage`), following `runComparisonCommand`'s extraction pattern. Prompts for name, platform (quick-pick), host, port, database, user, password (`password: true` on the input box). | Per Scope item 3. |
| `packages/extension/src/connections/connectionProfileStore.test.ts` (new) | Red/green-state tests: add-then-read-back (non-secret fields via `list()`/`get()`, password only via a separate `SecretStore.get()` call), delete-clears-secret, update semantics, and a raw-`globalState`-value inspection asserting no credential-shaped property/value is present. | Per Red-state/Green-state evidence sections. |
| `packages/extension/src/connections/connectionCommands.test.ts` (new) | Tests for all three command handlers: prompt sequencing, cancel-at-any-prompt behavior, `password: true` assertion on the password prompt, store interaction, and error-path coverage. | Test-first coverage for Scope item 3. |
| `packages/extension/src/connections/resolveConnector.test.ts` (new) | Tests asserting `resolveConnector` returns a `SqlServerConnector`/`PostgresConnector` instance per platform, and that optional fields absent from the profile don't produce `undefined`-valued properties in the constructed options. | Test-first coverage for Scope item 4. |
| `packages/extension/src/activation/activate.ts` | Added imports for `ConnectionProfileStore`/the three command functions; added `ADD_CONNECTION_COMMAND_ID`/`EDIT_CONNECTION_COMMAND_ID`/`DELETE_CONNECTION_COMMAND_ID` constants; added `buildConnectionCommandDeps()` and three `register*ConnectionCommand()` functions mirroring `registerRunComparisonCommand`'s exact pattern; in `activate()`, constructs one `ConnectionProfileStore` (wrapping `context.globalState` and the existing `secretStore`) and registers the three new commands, each disposable pushed to `context.subscriptions`. Existing tree-view/SecretStore/runComparison wiring untouched. | Per Scope item 5 and Files owned's "only permitted edit is registering the three new commands the same way `registerRunComparisonCommand`/T-22 already registers `paritylens.runComparison` — do not restructure existing tree-view/SecretStore/runComparison wiring." |
| `packages/extension/package.json` | Appended three entries to `contributes.commands`: `paritylens.addConnection`, `paritylens.editConnection`, `paritylens.deleteConnection`. No other field touched. | Per Scope item 5 and Files owned's "`contributes.commands` array only — append three entries, do not touch any other field." |

No other files were modified. `SecretStore`, `SqlServerConnector`,
`PostgresConnector`, and their `*ConnectionOptions` types were not touched
(read-only consumption only, per Prohibited changes). `runComparisonCommand`
and `buildFixtureRegistry` in `activate.ts` were not touched.

## Behavior and interfaces

- **Behavior delivered:** Users can now register, edit, and delete named
  connection profiles (non-secret fields persisted via `globalState`,
  password persisted via `SecretStorage`) through three new commands. A
  `resolveConnector` function exists that can turn a stored profile plus a
  resolved password into a real `SqlServerConnector`/`PostgresConnector`
  instance, ready for T-30 to wire into `runComparisonCommand`. No existing
  behavior (tree view, `runComparisonCommand`, fixture-only resolution) was
  changed.
- **Interfaces consumed:** `SecretStore.get/set/delete` (unchanged, read-only
  consumption); `SqlServerConnectionOptions`/`SqlServerConnector`,
  `PostgresConnectionOptions`/`PostgresConnector` (unchanged, read-only
  consumption, now reachable via `@paritylens/engine`'s public entry point
  per the amendment); `vscode.ExtensionContext.globalState` (Memento `get`/
  `update`).
- **Interfaces produced:** `ConnectionProfile` type; `ConnectionProfileStore`
  (`list`/`get`/`add`/`update`/`delete`, plus the exported `secretKeyFor`
  helper); `resolveConnector(profile, password)`; the
  `paritylens.addConnection`/`paritylens.editConnection`/
  `paritylens.deleteConnection` commands (both as directly-testable handler
  functions and as real `vscode.commands.registerCommand` registrations).

## Verification evidence

All commands run from the repo root (`v:\Secret Projects\VSC-DB-SQL-Compare`).

**Environment note:** the shell's default `node` resolved to v18.18.0,
which fails `npm run test` with `ERR_REQUIRE_ESM` (vite/vitest 3.x require
Node 20+; this repo's documented known-good version per `CLAUDE.md` is
v24.9.0). `nvm4w` had Node v24.3.0 already installed; switched to it
(`nvm use 24.3.0`) before running any command below. This is an environment
correction, not a code or scope change. A stray untracked, gitignored
`packages/extension/dist-bundle/` directory (build output from a prior
`npm run bundle`/`package` run) was also present and made `eslint .` fail
with hundreds of `no-undef`/`no-require-imports` errors against the bundled
file; removed it (`rm -rf packages/extension/dist-bundle`) before the
baseline run — same class of issue and same resolution T-28's own
implementation report documented.

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline (pre-change) | `npm run verify` (after `rm -rf packages/extension/dist-bundle` and switching to Node v24.3.0) | Exit 0; 408 passed, 27 skipped, 435 total | Captured directly in this session |
| Red state | `npx vitest run packages/extension/src/connections` with `connectionProfileStore.ts`, `resolveConnector.ts`, `connectionCommands.ts` temporarily moved out of the directory (only `connectionProfile.ts` and `connectionProfileStore.test.ts` present) | 1 failed suite: `Error: Cannot find module './connectionProfileStore' imported from '.../connectionProfileStore.test.ts'` — fails for exactly the reason the brief predicts ("fails today because `ConnectionProfileStore` doesn't exist") | Captured directly in this session |
| Focused green state | `npx vitest run packages/extension/src/connections` (implementation files restored) | 3 test files passed, 17 tests passed (6 in `connectionProfileStore.test.ts`, 8 in `connectionCommands.test.ts`, 3 in `resolveConnector.test.ts`) | Captured directly in this session |
| Full test suite | `npm run test` | Exit 0; 425 passed, 27 skipped, 452 total (skip count unchanged from baseline — same two Docker-gated integration suites) | Captured directly in this session |
| Full verification | `npm run verify` | Exit 0 (`typecheck` clean, `lint` clean, `test`: 425 passed, 27 skipped, 452 total) | Captured directly in this session, redirected to `%TEMP%/t29_verify.txt` and tail-inspected; exit code captured immediately after via `echo EXIT:$?` |

The second red-state test the brief calls for ("after deleting a profile,
confirm its `SecretStore` entry was also deleted") is covered by
`connectionProfileStore.test.ts`'s `"delete() removes a profile's metadata
AND its matching SecretStore entry — no orphaned credential left behind"`
test; it was not run in isolation against a pre-implementation tree because
`ConnectionProfileStore` not existing at all already produces the same
"module not found" red state shown above for the whole file — a targeted
second module-missing failure would not add distinct evidence beyond what
the first captured red-state run already demonstrates for every test in
that file, including this one.

The green-state raw-`globalState`-inspection requirement (mirroring T-10's
`SecretStore` review-gate test) is
`connectionProfileStore.test.ts`'s `"never writes a credential-shaped
property to the raw globalState value for an added profile"` test: it reads
the mock `globalState`'s raw stored value directly (not through
`ConnectionProfileStore`'s own accessors) and asserts no property name
matches `/password|secret|credential|token/i` and the plaintext password
value does not appear anywhere in the raw stored data.

## Assumptions and risks

- **Assumptions (judgment calls):**
  - `ConnectionProfileStore.update()` takes an optional `password` parameter
    (`undefined` leaves the existing stored password untouched). The brief's
    Interfaces produced section only says "delete also clears the matching
    `SecretStore` entry" and doesn't fully specify edit-without-changing-
    password semantics. Judgment call: an edit flow that always forces
    re-entering the password would be poor UX and isn't required by the
    brief's Scope item 3, which describes prompting for password as part of
    the *add* flow's field list; `editConnectionCommand` still always
    prompts for a new password (matching Scope item 3's literal field list
    applying identically to edit), but the underlying store method supports
    leaving it untouched if a future caller needs that.
  - Profile `id` generation uses `node:crypto`'s `randomUUID()`. The brief
    doesn't specify an ID scheme; UUID is the standard choice and nothing
    in Files owned/Interfaces conflicts with it.
  - `resolveConnector`'s handling of optional fields (`trustServerCertificate`,
    `ssl`, `connectTimeoutMs`) omits the property entirely from the
    constructed options object when absent on the profile, rather than
    passing `undefined` explicitly — required by this repo's
    `exactOptionalPropertyTypes: true` tsconfig setting (confirmed via a
    successful `npm run typecheck`), not an independent design choice.
- **Risks or limitations:**
  - `resolveConnector` is implemented and tested but intentionally not
    called from any command or wired into `runComparisonCommand` — per the
    brief, that wiring is T-30's scope. Until T-30 lands, connection
    profiles can be created/edited/deleted but cannot yet be used to run a
    real comparison.
  - The command handlers' cancel-handling assumes VS Code's
    `showInputBox`/`showQuickPick` resolve to `undefined` on Escape (the
    documented real behavior); this is exercised via the mocked deps in
    `connectionCommands.test.ts` but not against a real VS Code host
    (`@vscode/test-electron` is not used anywhere in this codebase yet, per
    existing precedent documented in other test files' header comments).
  - Editing a profile's `platform` is technically possible through
    `editConnectionCommand`'s re-prompt-every-field flow (not restricted to
    the original platform). The brief does not prohibit this, and disallowing
    it wasn't asked for; flagged here as a design surface a reviewer may want
    to weigh in on.
- **Blockers:** None.

## Patch or commit identity

- **Branch:** `task/T-29-connection-profiles`
- **Commit:** `87336b6` — "Implement T-29: connection profile management
  (ConnectionProfile, ConnectionProfileStore, resolveConnector, CRUD
  commands)".

## Recommended next step

Independent review by a separate reviewer agent, per this project's
governance (`AGENTS.md`: "Every implementation task receives an independent
review by a reviewer who did not author the task's change"). The brief's
Handoff note asks the reviewer to adversarially check, directly against the
diff (not just by re-running the given tests): (1) no credential ever
reaches `globalState`/`workspaceState` under any field name, and (2)
deleting a profile leaves no orphaned `SecretStore` entry. This
implementer does not have authority to self-approve; do not mark this task
complete or approved from this report alone.
