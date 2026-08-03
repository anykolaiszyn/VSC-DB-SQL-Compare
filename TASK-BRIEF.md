# TASK-BRIEF.md — T-39: CodeLens actions (final Phase 5 task)

## Objective

Add inline CodeLens actions above an open `.paritylens` file — **Run
Profile**, **Run Schema Check**, **Run Full Comparison**, **Open Last
Result** — per `Idea Prompt.md` section 6's sketch. CodeLens must work
whether the file is open via T-36's custom editor or as plain text (a
`CodeLensProvider` is a document-level feature, independent of which
editor has the document open).

This is the final task in Phase 5. See
`docs/superpowers/specs/2026-08-02-comparison-authoring-ui-design.md`
("CodeLens actions" section) for the original design context.

**Two design decisions made before this brief, disclosed here** (the
original plan row didn't anticipate either — both are genuine gaps this
brief closes rather than leaving for the implementer to discover):

1. **`paritylens.runComparison` today always opens a file picker
   dialog** — it has no way to accept "run this specific file" as an
   argument, which is what clicking a CodeLens on an already-open file
   implies. This task extends `runComparisonCommand` to accept an
   optional `vscode.Uri` argument: when supplied (from a CodeLens click),
   skip `showOpenDialog` and use that file directly; when absent (command
   palette invocation), behave exactly as today. This must be backward
   compatible — every existing call site/test that invokes the command
   with no argument keeps working unchanged.
2. **"Run Profile"/"Run Schema Check" need to run only a subset of
   checks**, but `definition.checks.*.enabled` comes from the parsed YAML
   itself — there is no existing per-invocation override mechanism.
   This task adds one: extend `runComparisonCommand`'s call site (or the
   underlying flow) to accept an optional check-subset override (e.g.
   `{ schema: true, profile: false, rowCount: false, rowLevel: false }`)
   that, when present, temporarily overrides the parsed definition's
   `checks` **in memory only** before calling `planQueries`/
   `runComparison` — the file on disk is never modified. When absent, the
   definition's own `checks` are used exactly as today. Confirm
   `planQueries` (T-38) naturally respects this since it already reads
   `definition.checks.*` — passing an overridden `ParityDefinition` object
   (a shallow copy with `checks` replaced) should require no change to
   `planQueries`/`runComparison` themselves, only to what
   `runComparisonCommand` passes them.

## Scope

1. **`comparisonCodeLensProvider.ts`** (new) — a `vscode.CodeLensProvider`
   implementation registered for `.paritylens` files. `provideCodeLenses`:
   - Reads the document text, attempts `parseDefinition` (T-08).
   - **If parsing fails** (malformed YAML, missing required fields):
     return an empty array (no lenses) — do not show lenses that would
     crash on click, and do not throw out of `provideCodeLenses` itself
     (VS Code calls this on every keystroke-adjacent document change;
     throwing repeatedly would be disruptive).
   - **If parsing succeeds**: return 4 `CodeLens` instances at line 0 (or
     wherever the design's convention places them — document your
     choice), each with a `command` object:
     - **Run Profile**: invokes the run command with a check-subset
       override enabling only `profile`.
     - **Run Schema Check**: invokes the run command with a check-subset
       override enabling only `schema`.
     - **Run Full Comparison**: invokes the run command with the
       document's own URI, no check-subset override (runs exactly what
       the file specifies) — this must route through T-38's confirmation
       step exactly like any other full run; do not bypass it.
     - **Open Last Result**: looks up the most recent persisted run for
       this document's comparison `name` via `listRecentRuns()` (T-31),
       filtering by `name` and taking the most recent `timestamp` (same
       lookup-by-name pattern T-33's tree view already uses — do not
       reimplement differently), then invokes `paritylens.reopenRun` with
       that run's `id`. If no matching run exists yet, this lens should
       either not appear or invoke a command that shows a clear "no runs
       yet for this comparison" message — your call, document it (do not
       silently no-op).

2. **Extend `runComparisonCommand`** (`activate.ts`) per this brief's two
   disclosed design decisions above: optional `vscode.Uri` argument
   (skip dialog when supplied) and an optional check-subset override
   (in-memory only, never written to disk). Both must be additive/
   backward compatible — every existing call site and test must keep
   compiling and behaving identically when these new parameters are
   omitted.

3. **Register the `CodeLensProvider`** in `activate.ts`
   (`vscode.languages.registerCodeLensProvider`, matched against
   `.paritylens` files — check `@types/vscode`'s actual API for the
   right document selector shape, do not guess).

## Dependencies

- T-08 (`parseDefinition`) — complete.
- T-30 (real-connector-aware run command) — complete.
- T-31 (`listRecentRuns`, `loadRun`) — complete.
- T-33 (`paritylens.reopenRun`, the lookup-by-name pattern to mirror) —
  complete.
- T-36 (custom editor — CodeLens must coexist with it, not conflict) —
  complete.
- T-38 (`planQueries`, the confirmation-panel flow "Run Full Comparison"
  and the two subset lenses must route through, never bypass) — complete.

## Files owned

- `packages/extension/src/codelens/comparisonCodeLensProvider.ts` (new)
- `packages/extension/src/codelens/comparisonCodeLensProvider.test.ts`
  (new)
- `packages/extension/src/activation/activate.ts` (extends T-10/T-22/
  T-30/T-33/T-36/T-38 — CodeLens registration, `runComparisonCommand`'s
  URI/check-override parameter additions only)
- `packages/extension/src/activation/activate.test.ts` (extends, for the
  new parameter tests)

## Prohibited changes

- Do not modify `planQueries` or `runComparison` (`packages/engine/**`)
  — the check-subset override happens entirely at the `activate.ts` call
  site, by passing a modified-in-memory `ParityDefinition` object; the
  engine functions themselves need no change since they already read
  `definition.checks.*`.
- Do not modify `comparisonEditorProvider.ts`/`comparisonEditorHtml.ts`
  (T-36) or `runConfirmationWebview.ts` (T-38) — CodeLens invokes the
  same existing command flow, it doesn't need to touch either editor's
  internals.
- Do not write a check-subset override back to the `.paritylens` file on
  disk under any circumstance — it is strictly a one-invocation, in-memory
  override.
- Do not remove or change `paritylens.runComparison`'s existing
  no-argument (file-picker-dialog) behavior — it must remain exactly as
  it is today for command-palette invocation.

## Interfaces consumed / produced

- Consumed (read-only): `parseDefinition` (T-08); `listRecentRuns`,
  `loadRun` (T-31); `REOPEN_RUN_COMMAND_ID`/`reopenRunCommand` (T-33);
  `planQueries`/the confirmation flow (T-38).
- Produced: registered `CodeLensProvider` for `.paritylens`; extended
  `runComparisonCommand` accepting optional `vscode.Uri` and check-subset
  override parameters (document the exact new signature clearly in your
  implementation report — this is the interface any future task touching
  the run command needs to know about).

## Red/Green/Full verification evidence required

- **Red**: a test opening a valid `.paritylens` document, expecting 4
  CodeLenses, fails today (provider doesn't exist).
- **Green**:
  - Same test passes.
  - A test confirming an unparseable/invalid document produces zero
    CodeLenses (or a documented safe alternative), not lenses that would
    crash on click.
  - A test confirming "Run Full Comparison"'s command invokes the same
    confirmation-then-run flow T-38 established — no bypass (e.g. confirm
    it still calls `planQueries` and blocks on confirmation, doesn't call
    `runComparison` directly).
  - A test confirming "Run Profile"/"Run Schema Check" pass the correct
    check-subset override and that the override never touches the
    on-disk file content (document text/hash unchanged after invocation).
  - A test confirming `runComparisonCommand` with a supplied `Uri` skips
    the file-picker dialog, and a test confirming it still shows the
    dialog when no `Uri` is supplied (regression guard for existing
    command-palette behavior).
  - A test confirming "Open Last Result" correctly finds the most recent
    run matching the document's comparison name (not just any run).
- **Full**: `npm run verify` (typecheck + lint + test) green.

## Handoff note for the reviewer

Please adversarially confirm, independent of the implementation report:

1. **Lenses never appear for an invalid document**: construct your own
   malformed YAML and missing-required-field cases beyond whatever the
   implementation report discloses.
2. **"Open Last Result" reuses T-31's exact lookup**: confirm it calls
   `listRecentRuns`/`reopenRunCommand` as-is, not a reimplementation with
   subtly different name-matching or sort-order logic.
3. **No lens bypasses T-38's confirmation**: for both "Run Full
   Comparison" and the two subset lenses, trace the actual call path and
   confirm `runComparison` is never called directly without first going
   through `planQueries`/the confirmation panel.
4. **Check-subset override never persists**: construct a test that
   invokes "Run Profile," then re-reads the document from disk, and
   confirms it is byte-for-byte unchanged.
5. **Backward compatibility**: confirm every existing call site/test for
   `runComparisonCommand` (with no `Uri`/override arguments) still
   compiles and behaves identically — diff against `main`.
6. **File-ownership diff**: confirm via `git diff --stat main..<branch>`
   that only the declared files changed — `packages/engine/**`,
   `comparisonEditorProvider.ts`, `comparisonEditorHtml.ts`, and
   `runConfirmationWebview.ts` untouched.

## Branch

`task/T-39-codelens-actions`
