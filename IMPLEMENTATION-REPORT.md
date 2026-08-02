# ParityLens — Implementation Report T-30

## Status and objective

- **Status:** COMPLETE (implementation and evidence only — not reviewed or approved)
- **Objective:** Per `TASK-BRIEF.md`'s Objective: "Extend
  `paritylens.runComparison`'s connector registry resolution
  (`packages/extension/src/activation/activate.ts`, T-22's
  `buildFixtureRegistry`) so that when a `.paritylens` definition's
  `source.connection`/`target.connection` name matches a saved
  `ConnectionProfile` (T-29), the registry resolves to a real
  `SqlServerConnector`/`PostgresConnector` instance instead of always
  falling back to `FixtureConnector`. Fixture fallback remains for any
  connection name that does not match a saved profile."

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `packages/extension/src/activation/activate.ts` | Added `findProfileByName` (looks up a saved `ConnectionProfile` by its `.name` field, matching the existing lookup-by-name convention `connectionCommands.ts` already uses); added `buildConnectorRegistry` (async — resolves each of source/target connection names to a real `SqlServerConnector`/`PostgresConnector` via `resolveConnector` + `SecretStore.get(secretKeyFor(profile.id))` when a saved profile matches, otherwise constructs the identical `FixtureConnector` `buildFixtureRegistry` always used); added `MIXED_CONNECTION_NOTICE` and `buildRunNotice` (picks the accurate per-run disclosure message — the original `FIXTURE_ONLY_NOTICE` when neither side matched a saved profile, the new mixed-notice otherwise); extended `runComparisonCommand`'s `deps` with optional `connectionProfileStore`/`secretStore` fields and wired them into notice selection and registry building; extended `registerRunComparisonCommand` to take `(connectionProfileStore, secretStore)` and pass them through; reordered two lines in `activate()` so `connectionProfileStore`/`secretStore` are constructed before `registerRunComparisonCommand` is called (construction arguments themselves and the three connection-management command registrations are otherwise untouched). | Per Scope items 1, 2, 3, 4. |
| `packages/extension/src/activation/activate.test.ts` | Added a new `describe("runComparisonCommand (T-30 real-connector wiring)")` block (3 tests) plus extended the shared `vi.mock("vscode", ...)` factory at the top of the file with `ViewColumn` and `window.createWebviewPanel`/`showInformationMessage`/`showErrorMessage` (needed because this new suite calls `runComparisonCommand` directly, which the file's mock previously didn't support — the pre-existing 3 `describe("activate", ...)` tests never exercised that surface). No existing test deleted or weakened. | Per Files owned: "extend with new tests; do not delete or weaken existing T-22/T-29 test coverage." |

No other files were modified. `packages/engine/**`,
`packages/extension/src/connections/**`, and the
`addConnection`/`editConnection`/`deleteConnection` command
registrations/handlers were not touched (read-only consumption only, per
Prohibited changes).

## Behavior and interfaces

- **Behavior delivered:** `paritylens.runComparison` now resolves each of
  `source.connection`/`target.connection` independently: if a saved
  `ConnectionProfile`'s `name` matches, a real `SqlServerConnector`/
  `PostgresConnector` is constructed (password read from `SecretStore`,
  keyed by `secretKeyFor(profile.id)`); otherwise it falls back to the
  exact same `FixtureConnector`/`sqlserver-customer` construction T-22's
  `buildFixtureRegistry` always used. A real connector's construction never
  throws — any actual connectivity failure (bad host, refused connection)
  is left to `runComparison`'s own Layer-1 `testConnection()` check, which
  converts it into a `"failed"`-status `ComparisonResult` (not a thrown
  error), which then flows through `showResultsWebview` exactly like any
  other result. The user-facing notice shown at the start of a run is now
  accurate for what's about to happen: the original fixture-only wording
  when neither connection name matched a saved profile, a mixed-connection
  wording otherwise.
- **Interfaces consumed:** `ConnectionProfileStore.list()` (read-only,
  `packages/extension/src/connections/connectionProfileStore.ts`);
  `secretKeyFor` (same file); `resolveConnector(profile, password)`
  (`packages/extension/src/connections/resolveConnector.ts`);
  `SecretStore.get` (`packages/extension/src/secrets/secretStore.ts`);
  `ConnectorRegistry`, `runComparison`, `parseDefinition`,
  `FixtureConnector` (`@paritylens/engine`) — all unchanged, all read-only
  consumption.
- **Interfaces produced:** `buildConnectorRegistry` — the new
  real-connection-aware `ConnectorRegistry`-building function used by
  `runComparisonCommand` in place of always calling `buildFixtureRegistry`
  (the latter is preserved, now used only as the per-side fallback).
  `runComparisonCommand`'s `deps` shape gained two new optional fields
  (`connectionProfileStore?`, `secretStore?`) — see the Assumptions section
  below for why these are optional rather than required.

## Verification evidence

All commands run from the repo root (`V:\Secret Projects\VSC-DB-SQL-Compare`).

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline (pre-change) | `npm run verify` | Exit 0; typecheck clean, lint clean; 425 passed, 27 skipped, 452 total | Captured directly in this session, before any edit |
| Red state | `npx vitest run packages/extension/src/activation/activate.test.ts` (after adding the new `describe("runComparisonCommand (T-30 real-connector wiring)")` block to `activate.test.ts`, before any change to `activate.ts`) | 1 test file failed, 2 of 6 tests failed for exactly the predicted reason: `"resolves a connection name matching a saved ConnectionProfile to a real SqlServerConnector instead of FixtureConnector"` — `expected { …(10) } to be undefined` (the run succeeded against `sqlserver-customer` fixture data, proving the saved profile was never consulted); `"surfaces a real connection failure via runComparison's Layer-1 failed-result path..."` failed the same way. The third new test (`"falls back to FixtureConnector for a connection name with no matching saved profile"`) already passed, as expected (T-22's existing fallback behavior was never broken). | Captured directly in this session |
| Focused green state | `npx vitest run packages/extension/src/activation` (both `activate.ts` and `activate.test.ts` changes applied) | 2 test files passed, 10 tests passed (6 in `activate.test.ts`, 4 in the pre-existing `runComparisonCommand.test.ts`, unmodified and unbroken) | Captured directly in this session |
| Full verification | `npm run verify` | Exit 0; typecheck clean, lint clean; 428 passed, 27 skipped, 455 total (net +3 tests vs. baseline, skip count unchanged — same two Docker-gated integration suites) | Captured directly in this session |

## Assumptions and risks

- **Judgment call — `deps.connectionProfileStore`/`deps.secretStore` typed
  optional, not required:** `packages/extension/src/activation/
  runComparisonCommand.test.ts` is T-22's own pre-existing test file that
  calls `runComparisonCommand` directly with a `deps` object lacking these
  fields entirely (via a `deps as never` cast). It is **not** listed under
  this task's "Files owned" (only `activate.ts` and `activate.test.ts`
  are), so it is out of this task's edit scope per AGENTS.md's ownership
  rule. Making the new fields required on `runComparisonCommand`'s `deps`
  type would compile (the `as never` cast suppresses the type error at
  that call site) but fail at runtime the moment
  `deps.connectionProfileStore.list()` is invoked against `undefined`,
  breaking that file's existing coverage — which TASK-BRIEF.md's
  "Prohibited changes" section explicitly forbids ("do not remove or
  weaken the fixture-fallback path"). I resolved this by typing both
  fields optional and treating an absent `connectionProfileStore`/
  `secretStore` as "no saved profiles, use fixture fallback for both
  sides" — this preserves `runComparisonCommand.test.ts`'s exact existing
  behavior unmodified while the real `activate()`/
  `registerRunComparisonCommand` call site always supplies both. I did not
  self-authorize touching `runComparisonCommand.test.ts` to make the
  fields required instead; if the reviewer or orchestrator prefers that
  shape, it would need a revised brief adding that file to Files owned.
- **Judgment call — profile lookup by `.name`, not `.id`:**
  TASK-BRIEF.md's Scope item 1 says "Looking up a saved `ConnectionProfile`
  by name via `ConnectionProfileStore`," but `ConnectionProfileStore.get(id)`
  actually matches by `.id` (an internally generated UUID), not `.name`
  (the human-chosen connection name a `.paritylens` definition's
  `source.connection`/`target.connection` fields would reference). I used
  `store.list().find((profile) => profile.name === connectionName)`
  instead, matching the exact lookup-by-name pattern
  `connectionCommands.ts`'s `editConnectionCommand`/
  `deleteConnectionCommand` already use for their own `showQuickPick`
  selections. This is a read-only consumption of `ConnectionProfileStore`
  (I did not modify that file), so it stays within this task's ownership.
- **Judgment call — `activate()` line reorder:** `connectionProfileStore`'s
  construction (`new ConnectionProfileStore(...)`) was originally written
  after `registerRunComparisonCommand()` was called. Since that function
  now needs `connectionProfileStore`/`secretStore` as arguments, I moved
  its construction two lines earlier, above the call. This is a minimal
  reorder — neither constructor's own arguments change, nor do the three
  connection-management command registrations below it — but it is a
  literal edit to lines TASK-BRIEF.md's Files owned note says "must remain
  untouched" ("the tree-view/`SecretStore`-construction/command-
  registration wiring for `paritylens.addConnection`/`editConnection`/
  `deleteConnection` from T-29 must remain untouched"). I judged this
  in-scope because it is mechanically required by Scope item 2's own
  instruction to "extend `deps` (or add a parameter)" for
  `ConnectionProfileStore`, and it changes no behavior of the T-29 wiring
  itself — flagging it explicitly here per the Implementer contract's
  instruction to call out such edits separately rather than fold them in
  silently.
- **Risks or limitations:** The "surfaces a real connection failure" test
  and the "resolves to a real SqlServerConnector" test both rely on a real
  TCP/DNS attempt against a non-existent host (`db.example.internal`)
  failing quickly in the test environment — this worked reliably in this
  session (both tests run well under the 15s timeout I set) but is an
  external-environment dependency (DNS resolution behavior) rather than a
  fully hermetic mock; a reviewer re-running this in an environment with
  different DNS/firewall behavior for unresolvable hostnames could see
  different timing, though the pass/fail assertion itself (does the run
  produce a `"failed"`-status result via Layer-1, not a fixture-success
  result) should hold either way. `MIXED_CONNECTION_NOTICE`'s exact wording
  is my own choice — TASK-BRIEF.md Scope item 3 permits "a conditional
  message (or two variants)" without specifying exact text, so I judged
  this a low-risk wording choice rather than a material ambiguity needing
  escalation.
- **Blockers:** None.

## Patch or commit identity

- **Patch or commit:** (recorded after commit — see below)
- **Branch or workspace:** `task/T-30-real-connector-wiring`

## Recommended next step

Independent review by a reviewer who did not author this change (per
AGENTS.md: "Every implementation task receives an independent review by a
reviewer who did not author the task's change"). Per TASK-BRIEF.md's
Handoff note, the reviewer should adversarially confirm (1) the
fixture-fallback path is genuinely byte-for-byte unchanged in behavior
from T-22 for any unmatched connection name, and (2) a real-profile
connection failure flows through `runComparison`'s existing Layer-1
failure handling rather than being caught and reshaped by a new, redundant
try/catch in `activate.ts` — and should independently judge the three
judgment calls documented above, particularly whether the
optional-vs-required `deps` field decision is the right resolution or
whether a revised brief adding `runComparisonCommand.test.ts` to Files
owned would be preferable. This report does not constitute review or
approval of any kind.
