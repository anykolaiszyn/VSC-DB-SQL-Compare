# TASK-BRIEF.md — T-42: Connection-test-on-add feedback

## Objective

Extend `paritylens.addConnection`'s flow (`addConnectionCommand` in
`packages/extension/src/connections/connectionCommands.ts`) to call the
resolved connector's `testConnection()` (`DataPlatformConnector`, already
defined in `@paritylens/shared`, already usable via `resolveConnector` in
`packages/extension/src/connections/resolveConnector.ts`) after collecting
profile fields and before persisting, showing a blocking "Testing
connection..." progress notification, then either persisting on success or
showing the failure reason with an explicit choice: re-enter fields (do not
persist a profile confirmed broken) or save anyway (some environments are
legitimately unreachable at add-time — VPN-gated hosts, etc. — so this must
not become a hard block). Addresses self-service gap-analysis Finding 3 (no
connection-test feedback at add-time) — today `addConnectionCommand`
persists unconditionally and reports success regardless of whether the
connection actually works, so a typo'd host/port isn't discovered until the
user tries to run a comparison much later.

## Current state (read before starting)

`addConnectionCommand` (`connectionCommands.ts` lines 119-138) currently:
1. Calls `promptForProfileFields(deps)` to collect name/platform/host/port/
   database/user/password.
2. Builds a `ConnectionProfile` with a fresh `id`.
3. Calls `store.add(profile, prompted.password)` unconditionally.
4. Shows a success `showInformationMessage`.

`resolveConnector(profile: ConnectionProfile, password: string): SqlServerConnector | PostgresConnector`
(`resolveConnector.ts`) already exists and constructs a real, ready-to-use
connector instance from a profile + password — this task's `testConnection()`
call is `resolveConnector(profile, prompted.password).testConnection()`
(the `DataPlatformConnector` interface's `testConnection(): Promise<ConnectionTestResult>`
or equivalent — read `@paritylens/shared`'s `connector.ts` for the exact
return shape before writing any success/failure branching logic).

`ConnectionCommandDeps` (lines 15-28) is the existing injected-dependency
interface `addConnectionCommand` receives; it currently has no
progress-notification or confirmation-choice method.

## Scope

1. Extend `ConnectionCommandDeps` with whatever new injected methods are
   needed:
   - A progress-notification method (VS Code's real API is
     `vscode.window.withProgress`; inject a narrow function type covering
     only what this task needs — a title string and an async callback to
     run while the notification shows — rather than the full
     `withProgress` signature, matching this file's existing
     narrow-injected-dependency style).
   - A choice/confirmation method for the failure case (VS Code's real API
     is `vscode.window.showWarningMessage(message, ...items)` resolving to
     the clicked item's label or `undefined`; inject similarly narrowly).
2. After `promptForProfileFields` resolves successfully (before
   `store.add`), construct the connector via `resolveConnector` and call
   `testConnection()`, wrapped in the injected progress-notification
   dependency with a title like `"Testing connection..."`.
3. On a successful test result: proceed to `store.add` and the existing
   success message, unchanged.
4. On a failed test result: show the failure reason (from
   `ConnectionTestResult` or whatever `@paritylens/shared` actually calls
   it — read the real shape, do not assume a field name) via the injected
   confirmation dependency, offering exactly two choices: something like
   "Save Anyway" and "Don't Save" (exact wording your call, keep it clear).
   - "Save Anyway" (or equivalent): proceeds to `store.add` and a success
     message, same as today's unconditional behavior — this preserves the
     current always-succeeds-eventually behavior as an explicit opt-in,
     not a removed capability.
   - "Don't Save" (or equivalent), or dismissing the prompt (`undefined`):
     aborts without calling `store.add` — the typed profile fields and
     password are discarded, matching how a cancelled `showInputBox` prompt
     already behaves elsewhere in this same file.
5. `testConnection()` itself throwing (vs. resolving a failure result) must
   be handled the same as a failed test result, not let the outer
   try/catch's generic "add connection failed" error message swallow it
   without offering the save-anyway choice — read `DataPlatformConnector`'s
   documented contract for `testConnection()` to confirm whether it's
   expected to throw or always resolve (implement to match whichever the
   interface documents; if ambiguous, handle both defensively).

## Files owned

- `packages/extension/src/connections/connectionCommands.ts`
  (`addConnectionCommand`'s flow, plus `ConnectionCommandDeps`'s
  extension — `editConnectionCommand`/`deleteConnectionCommand` and
  `promptForProfileFields` must remain byte-for-byte unchanged except for
  whatever `ConnectionCommandDeps` type extension is shared by all three
  functions' signature)
- `packages/extension/src/connections/connectionCommands.test.ts`
  (new/extended tests for `addConnectionCommand`'s new behavior)
- `packages/extension/src/activation/activate.ts` (extends T-10/T-22/T-29/
  T-30/T-32/T-33/T-40, **only** `buildConnectionCommandDeps`'s (or
  equivalent) real-`vscode`-backed implementation of the new injected
  dependencies added to `ConnectionCommandDeps` — no other change to this
  file)

## Interfaces consumed

- `resolveConnector` (`connections/resolveConnector.ts`, T-29, read-only —
  do not modify)
- `DataPlatformConnector.testConnection()` (`@paritylens/shared`, already
  defined, read-only usage)
- `ConnectionProfileStore.add` (T-29, read-only — do not modify)

## Prohibited changes

- Do not modify `editConnectionCommand` or `deleteConnectionCommand`'s own
  flow/behavior (only a shared `ConnectionCommandDeps` type extension may
  touch code near them, and only if TypeScript requires it — verify with a
  diff that their actual runtime behavior is untouched).
- Do not modify `resolveConnector.ts`.
- Do not modify `ConnectionProfile`'s shape (`connectionProfile.ts`) or
  `ConnectionProfileStore`'s persistence logic (`connectionProfileStore.ts`).
- Do not add a new npm dependency.
- Do not log or display the plaintext password anywhere in the
  progress/failure/success messaging.

## Red-state evidence required

A test asserting `addConnectionCommand` with a mocked `testConnection()`
returning a failure, expecting the user to see the failure reason and be
offered a choice — fails today (current flow calls `store.add`
unconditionally and never calls `testConnection`).

## Green-state evidence required

1. The scoped diff across the owned files.
2. A test proving a successful `testConnection()` result persists the
   profile and shows the existing success message, unchanged from today's
   behavior.
3. A test proving a failed `testConnection()` result shows the failure
   reason and, on "Save Anyway", still persists the profile (preserving
   today's always-succeeds-eventually behavior as an explicit opt-in).
4. A test proving a failed `testConnection()` result with "Don't Save" (or
   dismissal) does NOT call `store.add` — no credential or profile
   persisted for a confirmed-broken connection unless explicitly chosen.
5. A test proving `testConnection()` throwing is handled the same as a
   failed result (offers the same choice), not swallowed by the generic
   catch block's error message.
6. A diff-based confirmation that `editConnectionCommand`/
   `deleteConnectionCommand`'s actual behavior is unchanged (their own
   existing tests must continue passing unmodified).
7. Confirmation that no credential/password ever appears in any of the new
   progress/failure/success message strings (read every new
   template-string literal touching `password`/`prompted.password`).
8. A full fresh `npm run verify` passing with no regression versus the
   645/645 baseline; report the before/after test count.

## Handoff

- Write `IMPLEMENTATION-REPORT.md` using
  `multi-agent-idea-to-app/templates/IMPLEMENTATION-REPORT.md`.
- Commit on branch `task/T-42-connection-test-on-add`.
- Recommend independent review as the next step.
- Reviewer should specifically re-verify: (1) `testConnection()` failures
  never silently discard a user's typed input — the "Save Anyway" path
  must still work; (2) no credential is logged/displayed anywhere in the
  new messaging (grep every new string literal); (3)
  `editConnectionCommand`/`deleteConnectionCommand` remain genuinely
  untouched (diff against `main`); (4) the thrown-vs-resolved-failure
  handling for `testConnection()` is adversarially probed with both shapes
  (a mocked rejection AND a mocked resolved-failure result), not just one;
  (5) a fresh full `npm run verify` is green with the reported test count.
