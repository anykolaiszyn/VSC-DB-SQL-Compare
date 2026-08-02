# ParityLens — Review Report T-29

## Review independence

This review was performed by a separate agent instance from whoever
implemented T-29. I did not author any of the changed files under review. I
did not edit any implementation-owned file, `TASK-BRIEF.md`, or
`IMPLEMENTATION-REPORT.md` while producing this report. All findings below
are based on my own inspection of the actual diff, my own fresh execution of
`npm run verify`, and my own adversarial probes (constructed as throwaway
test files, run, and deleted — confirmed via `git status` that no residue
beyond this report remains).

## Review scope

- **Task objective:** Implement connection profile management — a
  `ConnectionProfile` type, a `ConnectionProfileStore` (globalState +
  `SecretStore`-backed), a `resolveConnector` profile-to-connector factory,
  and three CRUD commands (`paritylens.addConnection`/`editConnection`/
  `deleteConnection`), per `TASK-BRIEF.md`'s current (amended) form. Does
  **not** wire these into `runComparisonCommand` (T-30's scope).
- **Branch / commits reviewed:** `task/T-29-connection-profiles`, commits
  `87336b6` (implementation) and `38aab83` (report hash correction), diffed
  against `main`.
- **Files and interfaces reviewed:**
  - `packages/extension/src/connections/connectionProfile.ts` (new)
  - `packages/extension/src/connections/connectionProfileStore.ts` (new)
  - `packages/extension/src/connections/resolveConnector.ts` (new)
  - `packages/extension/src/connections/connectionCommands.ts` (new)
  - `packages/extension/src/connections/*.test.ts` (new, all three)
  - `packages/extension/src/activation/activate.ts` (extended)
  - `packages/extension/package.json` (`contributes.commands` append)
  - `packages/engine/src/index.ts` (Amendment-scoped re-export widening)
  - `packages/extension/src/secrets/secretStore.ts` — confirmed **not**
    modified (read-only consumption requirement)
  - `packages/engine/src/connector-sdk/sqlserver/sqlServerConnector.ts`,
    `packages/engine/src/connector-sdk/postgres/postgresConnector.ts` —
    confirmed **not** modified
- **Evidence reviewed:** `TASK-BRIEF.md` (current amended form),
  `IMPLEMENTATION-REPORT.md`, the actual `git diff main..38aab83` for every
  changed file, `git show` on both commits individually (confirming neither
  touches `PROGRESS-LEDGER.md`), and my own fresh `npm run verify` run plus
  four throwaway adversarial probe tests (deleted after use).

## Critical findings

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| NONE | | | |

## Important findings

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| NONE | | | |

## Minor findings

| ID | Finding | Evidence | Suggested resolution |
| --- | --- | --- | --- |
| T-29-01 | `ConnectionProfileStore.add`/`update` perform no runtime validation that the object being persisted to `globalState` is free of credential-shaped fields — the "never leaks a password" guarantee rests entirely on `ConnectionProfile`'s static TypeScript shape (no `password` field) plus disciplined call sites, not a runtime allowlist/strip. Confirmed by an adversarial probe: constructing a `{ ...profile, password: "leaked!!" }` object via `as unknown as ConnectionProfile` (simulating a future caller bypassing the type system, e.g. via a bug or a careless spread) and passing it to `store.update()` results in the `password` property being written verbatim into the mocked `globalState`'s raw stored array — i.e. `ConnectionProfileStore` is a pass-through store, and the only real defense is the type system + the one call site (`connectionCommands.ts`) never doing this today, which I confirmed it does not. This matches the same design already accepted for the rest of this codebase (`ConnectionProfile`'s own header comment even documents this as the enforcement mechanism), so it is not a deviation from convention, but it is worth recording as residual defense-in-depth debt given the credential-leak severity class, mirroring how `assertReadOnlyStatement`'s known gaps are tracked as accepted Minor findings rather than silently unmentioned. | Adversarial probe (throwaway test, deleted after use): `store.update({ ...p, password: "leaked!!" } as unknown as ConnectionProfile)` → raw `globalState` array contains a `password` key. | No action required to approve this task (the two call sites that exist today — `add`/`update` inside `connectionCommands.ts` — are correctly typed and never do this). Consider a lightweight runtime `omit`-based guard in `ConnectionProfileStore.add`/`update` in a future task if this store gains additional call sites, as low-cost defense in depth. |
| T-29-02 | `packages/engine/src/index.test.ts` (T-22's package-entry-point smoke test) was not extended to assert `SqlServerConnector`/`PostgresConnector` are reachable from `@paritylens/engine`'s public entry point, even though the Amendment specifically added those two re-export lines to that file. The re-export is exercised indirectly (via `resolveConnector.test.ts` importing `SqlServerConnector`/`PostgresConnector` from `@paritylens/engine`), so there is real test coverage of the new surface, just not a direct assertion in the file whose own header comment says it exists precisely so "a missing export here would only surface indirectly." `index.test.ts` is not in T-29's declared Files owned, so this is not a scope violation, just a coverage gap the implementer reasonably could have closed via `resolveConnector.test.ts` (which it effectively already does). | `packages/engine/src/index.test.ts` unchanged in `git diff main..38aab83`; `resolveConnector.test.ts` imports `SqlServerConnector`, `PostgresConnector` from `@paritylens/engine` and asserts `instanceof`, which does exercise the amendment's export lines. | No action required; optionally add two `expect(...).toBeDefined()` lines to `index.test.ts` in a future task touching that file for direct, co-located coverage. |
| T-29-03 | `deleteConnectionCommand`/`editConnectionCommand` select a profile by matching `showQuickPick`'s returned *name* string back to a profile via `profiles.find((p) => p.name === selectedName)`. If two profiles share the same display name (nothing in the brief or the type prevents this), the picker's returned string is ambiguous and `.find()` silently resolves to the first array match, deleting/editing that one rather than surfacing the ambiguity to the user. Confirmed via an adversarial probe: two profiles with `name: "dup"` but different `id`s — `deleteConnectionCommand` deletes only `id-1` (list order), and `id-2`'s `SecretStore` entry is left intact and un-orphaned (correct — nothing was falsely deleted), but the user has no way to control or even see which of the two "dup"-named connections they just removed. | Adversarial probe (throwaway test, deleted after use): two profiles both named `"dup"` with distinct ids; `deleteConnectionCommand` with quick-pick answer `"dup"` deletes `id-1` and leaves `id-2`'s secret in place. Not a credential-leak or orphan bug — purely a UX ambiguity. | No action required for T-29 (not called out in the brief, no data-loss/leak consequence, since a full profile round-trip through `SecretStore` is still correct for whichever profile is matched). Worth a future UX task disambiguating by id (e.g. quick-pick items styled with a `description` showing host/database, VS Code's own `QuickPickItem` convention) if duplicate names turn out to be common in practice. |
| T-29-04 | `activate.ts`'s three new `register*ConnectionCommand` functions cast `buildConnectionCommandDeps()` to `as never` when passing it to the extracted command handlers, e.g. `addConnectionCommand(store, buildConnectionCommandDeps() as never)`. This silences a real structural type mismatch between VS Code's actual `showInputBox`/`showQuickPick` overloaded signatures and `ConnectionCommandDeps`'s narrower shape, rather than adapting the real API's return type explicitly. `npm run typecheck` passes only because `as never` suppresses the check entirely (not because the shapes are actually compatible) — the same risk class as an `any`-cast, just spelled differently. This is a code-quality concern, not a scope or security defect: the underlying real-object binding (`vscode.window.showInputBox.bind(vscode.window)`, etc.) is behaviorally correct for the subset of the API this code path actually calls. | `packages/extension/src/activation/activate.ts` lines ~189, ~196, ~203 (`registerAddConnectionCommand`/`registerEditConnectionCommand`/`registerDeleteConnectionCommand`), each ending in `... as never)`. | No action required to approve; a future pass through `activate.ts` (not owned by this task) could replace the `as never` cast with a proper adapter or narrower explicit typing of `buildConnectionCommandDeps()`'s return value against `ConnectionCommandDeps`. |

## Verification performed

| Check | Exact command or inspection | Result |
| --- | --- | --- |
| Fresh full verification | `npm run verify` (Node v24.3.0, no stale `dist-bundle` present) | Exit 0. `typecheck` clean, `lint` clean, `test`: **25 passed / 2 skipped (27) test files, 425 passed / 27 skipped (452) tests** — matches `IMPLEMENTATION-REPORT.md`'s claimed numbers exactly (425/27/452). |
| `packages/engine/src/index.ts` amendment scope | `git diff main..38aab83 -- packages/engine/src/index.ts` (full-file read) | Exactly two additive `export *` lines added, plus a comment block extending the existing convention in the same style; the three pre-existing re-export lines and their original comment text are byte-identical to `main`. No other edit present. Matches the Amendment's authorization exactly. |
| Connector/SecretStore read-only consumption | `git diff main..38aab83 -- packages/extension/src/secrets/secretStore.ts packages/engine/src/connector-sdk/sqlserver/sqlServerConnector.ts packages/engine/src/connector-sdk/postgres/postgresConnector.ts` | Empty diff on all three files — confirmed unmodified, satisfying "Prohibited changes." |
| `activate.ts` scope | `git diff main..38aab83 -- packages/extension/src/activation/activate.ts` (full diff read) | Only additive: three new command-ID constants, `buildConnectionCommandDeps()`, three `register*ConnectionCommand` functions, and three `context.subscriptions.push(...)` calls plus one `ConnectionProfileStore` construction inside `activate()`. Existing tree-view, `SecretStore`, and `runComparisonCommand` wiring lines are untouched. |
| `package.json` scope | `git diff main..38aab83 -- packages/extension/package.json` (full diff read) | Only the `contributes.commands` array gained three new entries (`addConnection`/`editConnection`/`deleteConnection`); no other field touched. |
| Credential-in-`globalState` adversarial probe #1 (brief's own required test) | Read `connectionProfileStore.test.ts`'s "never writes a credential-shaped property..." test in full; independently re-derived its assertions rather than trusting the pass | Test inspects the *raw* mock `globalState` map directly (bypassing the store's own accessors), asserting no key matches `/password\|secret\|credential\|token/i` and the plaintext password string does not appear anywhere in any raw stored value (`JSON.stringify` scan across the whole map, not just the profiles array). This is a real, not cosmetic, raw-storage inspection — matches the brief's Green-state requirement and T-10's own review-gate pattern. |
| Credential-in-`globalState` adversarial probe #2 (my own, beyond the given tests) | Throwaway test: `store.update({ ...profile, password: "leaked!!" } as unknown as ConnectionProfile)`, then inspected `globalState.__raw` | `password` key **was** present in the raw stored array — confirms `ConnectionProfileStore` has no runtime filtering and depends entirely on the static type + correct call sites (recorded as Minor finding T-29-01; not a live bug since no real call site does this). |
| Orphaned-secret adversarial probe #1 (brief's own required test) | Read `connectionProfileStore.test.ts`'s `delete()` test and `connectionCommands.test.ts`'s delete-command test in full | Both assert `secretStore.get(secretKeyFor(id))` is `undefined` after delete, and the store test additionally asserts `secrets.__raw.has(secretKeyFor(id))` is `false` — a real raw-storage check, not just an accessor-mediated one. Traced `ConnectionProfileStore.delete()`'s implementation directly (not just the test): it unconditionally calls `this.secretStore.delete(secretKeyFor(id))` in the same method body that removes the metadata, with no branch that could skip it. |
| Orphaned-secret adversarial probe #2 (my own) | Throwaway test: delete a nonexistent id — confirms no unrelated secret is touched | `store.delete("does-not-exist")` leaves an existing unrelated profile's secret (`pw-a`) intact. No false-positive deletion. |
| Orphaned-secret adversarial probe #3 (my own) | Throwaway test: two profiles sharing a display name, delete by name via the command handler | Only the first list-order match (`id-1`) is deleted; `id-2`'s secret remains correctly intact (not orphaned, not falsely deleted) — but surfaced as a UX ambiguity, recorded as Minor finding T-29-03. |
| Cancel-mid-edit adversarial probe (my own) | Throwaway test: cancel `editConnectionCommand` at the password prompt (last field) | `store.update()` is never called; the original profile and its original stored password are both left untouched. Confirms partial-edit state cannot corrupt an existing profile. |
| Cleanup | `git status --short` after removing the throwaway adversarial test file | Clean — no residual files beyond this `REVIEW-REPORT.md`. |

## Prior-finding disposition

No prior open finding names T-29 as its resolving task. `PROGRESS-LEDGER.md`'s
open-findings table (T-25-02, and others) is unrelated to this task's scope
and untouched by either reviewed commit. No prior finding to re-verify here.

## Approval status

- **Status:** APPROVED
- **Reviewer:** Independent Reviewer subagent (Claude Sonnet 5), separate
  instance from the T-29 implementer
- **Date:** 2026-08-02
- **Release or dependency impact:** Unblocks T-30 (wiring `resolveConnector`
  into `runComparisonCommand`), which depends on this task's
  `ConnectionProfile`/`ConnectionProfileStore`/`resolveConnector` interfaces
  exactly as produced here. No release-candidate impact — this task does not
  touch anything in the already-shipped `paritylens-0.0.1.vsix` release
  scope. Four Minor findings recorded (T-29-01 through T-29-04), none
  blocking; T-29-01 (no runtime credential-field guard on
  `ConnectionProfileStore`) is the one worth the most attention from T-30's
  implementer/reviewer, since T-30 will add the first real call site
  consuming `resolveConnector`'s output and should confirm it continues the
  same discipline of never spreading a password onto a `ConnectionProfile`-
  shaped object.
