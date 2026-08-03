# ParityLens — Task Brief T-32

## Objective

Comparison-authoring scaffold: a `paritylens.newComparison` command that
walks the user through picking source/target connections, an object name
and `where` per side, key column(s), and writes a valid, minimal
`.paritylens` YAML file into the current workspace — so users stop
hand-writing YAML from a blank file. Explicitly not the full custom
editor/webview from `DESIGN-SPEC.md`'s Extension Layer row (that item is
tracked in `IMPLEMENTATION-PLAN.md`'s Backlog) — a scaffolding wizard only,
per `IMPLEMENTATION-PLAN.md`'s T-32 row.

## Scope

1. Create `packages/extension/src/authoring/` with a pure, testable
   scaffold-building function — e.g.
   `buildComparisonYaml(answers: NewComparisonAnswers): string` — that
   takes already-collected answers (comparison name, source/target
   connection names + object + optional `where`, key column(s)) and
   returns a YAML string. Keep this function free of any `vscode` API
   usage, matching this codebase's established pure-core /
   injected-VS-Code-glue split (see `runComparisonCommand`'s `deps`
   pattern in `activate.ts`, and `resultsWebview.ts`'s `renderResultsHtml`).
   The produced YAML must, at minimum, set `version`, `name`, `source`,
   `target`, and `keys` — the fields `parseDefinition` (T-08) requires.
2. Implement the interactive collection flow — e.g.
   `runNewComparisonWizard(deps): Promise<NewComparisonAnswers | undefined>`
   — using injected `showQuickPick`/`showInputBox`/`showSaveDialog`-style
   callbacks (same injected-dependency pattern `runComparisonCommand`
   already uses in `activate.ts`, so this is testable without
   `@vscode/test-electron`). Source/target connection pickers should list
   configured `ConnectionProfile` names (T-29, via `ConnectionProfileStore`)
   plus the existing fixture pair names as a fallback option, consistent
   with T-30's fixture-fallback precedent — do not require a saved profile
   to exist. Returning `undefined` at any step (user cancelled) must abort
   the whole flow without writing a file.
3. Add a `paritylens.newComparison` command registration in `activate.ts`
   (new command registration only, following T-22/T-29/T-30's existing
   registration pattern) and a matching entry in
   `packages/extension/package.json`'s `contributes.commands`.
4. Before writing, validate the scaffolded YAML actually round-trips
   through `parseDefinition` (T-08) without throwing — if it doesn't, this
   is a bug in the scaffold builder, not a user-facing error path.
5. Never silently overwrite an existing file at the target path — check
   existence first (e.g. via the injected file-system dependency) and
   either prompt for a different name/location or abort with a clear
   message. Do not implement an auto-numbering/rename-on-conflict scheme
   unless it's trivial; aborting cleanly is an acceptable minimum.

## Dependencies

T-08 (COMPLETE, APPROVED — `parseDefinition`, the round-trip validation
target). T-29 (COMPLETE, APPROVED — `ConnectionProfile`,
`ConnectionProfileStore`, for listing configured connection names in the
picker).

## Files owned

- `packages/extension/src/activation/activate.ts` (extends T-10/T-22/T-29/T-30,
  new command registration only — do not touch existing command handlers)
- `packages/extension/src/authoring/**` (new)
- `packages/extension/package.json` (`contributes.commands` array only —
  add one new entry, do not touch existing entries)

## Interfaces consumed

- `ConnectionProfile`, `ConnectionProfileStore` (T-29,
  `packages/extension/src/connections/`) — read-only consumption (`.list()`
  only; no writes).
- `parseDefinition` (T-08, `@paritylens/engine`) — used only for the
  scaffold's own round-trip self-validation, not to change parsing
  behavior.

## Interfaces produced

- `paritylens.newComparison` command.
- A scaffolded `.paritylens` YAML file, written to the workspace.
- `buildComparisonYaml` (or equivalently named pure builder function) and
  the wizard-running function, both exported for direct unit testing.

## Prohibited changes

- Do not modify `packages/engine/**` (including `definition.ts`/
  `parseDefinition` itself) — this task only produces YAML that parser
  already accepts, it does not change what the parser accepts.
- Do not modify `packages/extension/src/connections/**` (T-29's owned
  files) — read-only consumption only.
- Do not change any existing command registration
  (`runComparison`/`addConnection`/`editConnection`/`deleteConnection`) or
  its handler.
- Do not build the full custom comparison editor/webview — that is
  explicitly out of scope (see `IMPLEMENTATION-PLAN.md`'s Backlog section).
- Never write a credential into the scaffolded YAML — connections are
  referenced by name only, matching every other part of this codebase's
  no-inline-credentials rule (this falls out naturally from only ever
  writing a `connection` name string, but call it out explicitly since
  it's a security-relevant invariant).

## Red-state evidence required

A test invoking the scaffold command (or its wizard/builder functions
directly) with mocked quick-pick/input-box answers, expecting a written
file whose contents `parseDefinition` accepts without throwing — fails
today (module/command does not exist).

## Green-state verification required

The test above passes. Additionally: the scaffolded file round-trips
through `parseDefinition` without error (assert on the actual parsed
`ParityDefinition` shape, not just "did not throw"); a second test confirms
an existing file at the target path is never overwritten (either the wizard
prompts for an alternative or aborts, verify whichever behavior was
chosen); a third test confirms cancelling any step of the wizard (a mocked
callback returning `undefined`) aborts without writing a file. `npm run
verify` passes in full.

## Handoff

Note to reviewer: please adversarially confirm (1) the scaffolded YAML
never contains a credential-shaped field under any answer combination
(e.g. what happens if a user free-types a connection "name" containing
something credential-shaped into an input box — the writer must still only
ever emit a bare string for `connection`, never structured data), and (2)
an existing file at the target path is genuinely never silently
overwritten under any code path, including a wizard interrupted partway
and re-run.
