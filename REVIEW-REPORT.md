# REVIEW-REPORT.md — T-37: Column Mapping tab (SSIS-style)

## Review independence statement

This review was performed by a separate agent instance from whoever
implemented T-37, with no memory of writing the code under review. All
findings below are based on direct reading of the actual diff and source
files on `task/T-37-column-mapping-tab`, my own fresh run of
`npm run verify`, and adversarial probes I constructed independently (a
standalone throwaway test file, deleted before finishing — confirmed via
`git status` that the working tree is clean and no residue remains).
`IMPLEMENTATION-REPORT.md`'s claims were treated as things to verify, not
trust; every claim below was re-derived from source rather than copied
from the report. (Note: this file previously held the T-36 review report
from an earlier task on this same control-file path; it has been fully
replaced with this T-37 review, which was read before being overwritten
per this process's requirements.)

## Scope reviewed

- `TASK-BRIEF.md` (T-37, current checkout) read in full as scope authority.
- `IMPLEMENTATION-REPORT.md` read as the implementer's self-report, cross-
  checked against source.
- Full diff `main..task/T-37-column-mapping-tab` (`git diff --stat`).
- Full read of `packages/extension/src/authoring/comparisonEditorProvider.ts`,
  `columnMapping.ts`, relevant sections of `comparisonEditorHtml.ts`
  (render functions, escaping, client script wiring), and
  `packages/extension/src/activation/activate.ts` (`buildConnectorRegistry`,
  `buildResolveConnectorByName`, `registerComparisonEditorProvider`,
  `activate()`).
- Existing test files `comparisonEditorProvider.test.ts` and
  `comparisonEditorHtml.test.ts` read for coverage shape (not trusted as
  proof — independently re-probed, see below).

## Findings

### Critical

NONE.

### Important

NONE.

### Minor

| ID | Finding | Evidence | Resolution |
| --- | --- | --- | --- |
| T-37-01 | No debounce on `requestColumnFetch()` — every `input`/`change` event on any of the six listened Source/Target fields fires a `fetch-columns` message, which (once the Table-mode gate passes) triggers a real `getSchema` round trip and a `SecretStorage` read per side on every qualifying keystroke. | `packages/extension/src/authoring/comparisonEditorHtml.ts:695-705` (`requestColumnFetch` wired to `input`/`change` with no debounce/throttle); disclosed by the implementer in IMPLEMENTATION-REPORT.md's Risks section. | Not blocking — no correctness or security impact, only redundant round trips during fast typing. Track as a follow-up (client-side debounce) if the orchestrator wants it tracked; no brief requirement was violated (TASK-BRIEF.md did not specify a performance/debounce requirement). |

This item was disclosed candidly in the implementation report rather than
discovered independently as an omission — the report describes it
accurately.

## Disposition of prior findings

No prior open finding in `PROGRESS-LEDGER.md` names T-37 as its required
resolution target — this is fresh implementation work extending T-36, not
a re-review of a previously blocked task. No re-verification of an
earlier failing case was needed.

## Verification performed (my own, independent of the report)

### 1. Table-mode-only gating is genuine, gate checked before resolution

Traced `fetchColumnMappingDraft` (`comparisonEditorProvider.ts:438-469`):
`bothSidesReadyForLiveFetch(source, target)` is evaluated as the
function's first statement and returns `defaultColumnMappingDraft()`
immediately if either side fails the check — `resolveConnectorByName` is
not referenced anywhere before that early return.

I constructed my own standalone adversarial test (not reusing the
implementer's `comparisonEditorProvider.test.ts`) asserting
`resolveConnectorByName` — the mock function itself, not just `getSchema`
— is **never called** for a Query-mode source, and for a mixed
table/query pairing. Both passed:

```
✓ Query-mode source: resolveConnectorByName is NEVER called at all (gate before resolution, not just before getSchema)
✓ mixed: table-mode source but query-mode target -- resolveConnectorByName not called for either side
```

This confirms the gate is checked before any connector resolution attempt
(and therefore before any `SecretStorage` read), not merely before the
`getSchema` call — exactly what the brief's Handoff item 1 asked me to
verify independently, not just by trusting a passing test.

### 2. `resolveConnectorByName` composition mirrors `buildConnectorRegistry`

Read `activate.ts:141-195` (`findProfileByName`, `buildConnectorRegistry`)
and `activate.ts:566-578` (`buildResolveConnectorByName`) side by side.
Both use the identical resolution chain:
`findProfileByName(store, name)` → `secretStore.get(secretKeyFor(profile.id))`
→ `resolveConnector(profile, password)`. The only behavioral difference is
the terminal fallback: `buildConnectorRegistry` falls back to
`new FixtureConnector(...)` for an unmatched name (existing, pre-T-37
behavior for `runComparisonCommand`), while `buildResolveConnectorByName`
returns `undefined` — a deliberate, documented, and reasonable divergence
for an editing UI (no silent fixture substitution). No credential
resolution logic is reimplemented differently; it is the same three
pieces (`ConnectionProfileStore`, `SecretStore`, `resolveConnector`)
composed the same way, in the same file, with a single shared
`findProfileByName`/`secretKeyFor` helper reused by both functions.

Confirmed `comparisonEditorProvider.ts` does not import `SecretStore` or
`ConnectionProfileStore`:

```
grep -n "import" comparisonEditorProvider.ts
```
only shows imports of `vscode`, `@paritylens/engine`, `@paritylens/shared`
(type-only), `./buildComparisonYaml`, `./columnMapping`. No store imports
anywhere in the file.

### 3. No credential ever reaches the webview

Read every place `ComparisonEditorColumnMappingDraft`/`ColumnMappingRow`
data is produced (`columnMapping.ts`'s `buildMappingRowsFromColumns` only
extracts `.name` off `ColumnDefinition[]`) and rendered
(`renderMappingTab`/`renderMappingTargetSelect` in `comparisonEditorHtml.ts`
only interpolate `row.source`, `row.target`, `row.targetOptions` entries,
and `mapping.fetchError`). No connector object, profile, or password value
is ever passed into the render path.

I independently wrote a test asserting the rendered HTML contains none of
a broader set of credential-shaped substrings than the implementer's own
single `"password"` check (`password`, `secret`, `connectionstring`,
`connection_string`, `apikey`, `api_key`, `token=`, `pwd=`) after a
successful two-sided fetch. Passed.

### 4. Failure isolation — constructed my own scenarios, not the implementer's

Two independent scenarios beyond what `comparisonEditorProvider.test.ts`
covers:
- A connector whose `getSchema` throws a **raw string** (not an `Error`
  instance) rather than a rejected `Error` — confirms the
  `err instanceof Error ? err.message : String(err)` fallback in
  `fetchColumnMappingDraft`'s catch block genuinely handles a non-Error
  rejection value, not just the happy-path `Error` case the implementer's
  own test used.
- One side resolves to a real connector, the other side's
  `resolveConnectorByName` returns `undefined` (unresolvable name) —
  distinct failure mode from a `getSchema` rejection.

Both scenarios: the Mapping tab shows the inline "could not fetch
columns" banner, and a subsequent, independently-constructed Apply message
(different `comparisonName`/values than any fixture in the implementer's
tests) still calls `applyEdit` exactly once and posts `ok: true`. All
passed.

### 5. Purity and escaping — adversarial inputs beyond the implementer's tests

- `renderComparisonEditorHtml` called twice with the identical
  `ComparisonEditorDraft` reference (populated `columnMapping.mode:
  "fetched"` with two rows) produces byte-identical output. Additionally
  called a third time with a **freshly-constructed, deep-cloned** (not the
  same object reference) structurally-equal draft — also byte-identical.
  This is a stronger purity check than reference reuse alone.
- Adversarial source column name `<script>alert(1)</script>` in
  fetched-mode: rendered output does not contain the raw tag; contains
  `&lt;script&gt;` instead.
- Adversarial manual-mode column name `"><img src=x onerror=alert(1)>`:
  rendered output contains neither the raw payload nor the bare
  `<img src=x onerror=alert(1)>` fragment (i.e. it doesn't break out of
  the `value="..."` attribute).
- Adversarial `fetchError` message containing
  `<img src=x onerror=alert('pwned')>`: escaped in the inline banner, not
  present raw.

All four passed. Every fetched/manual column-name and error-message
interpolation site in `renderMappingTab`/`renderMappingTargetSelect` goes
through `escapeHtml`, consistent with every other value this file renders
(verified by grep: all six interpolation points in the mapping-tab render
functions call `escapeHtml`, no exceptions).

Also verified the `columnMapping` draft sub-state is **not** embedded into
the client script's `window.__PARITYLENS_DRAFT__` JSON blob (which uses a
separate `escapeForScriptJson` mechanism for `</script>`-breakout safety)
— `renderMappingTab` renders it directly server-side as already-escaped
HTML, avoiding a second, differently-escaped injection surface for the
same data. This is a sound design choice, not a gap.

### 6. File-ownership diff

```
git diff --stat main..task/T-37-column-mapping-tab
```
Changed files: `IMPLEMENTATION-REPORT.md`,
`packages/extension/src/activation/activate.ts`,
`packages/extension/src/authoring/columnMapping.ts` (new),
`columnMapping.test.ts` (new), `comparisonEditorHtml.ts`,
`comparisonEditorHtml.test.ts`, `comparisonEditorProvider.ts`,
`comparisonEditorProvider.test.ts`. Exactly the declared "Files owned"
list plus the implementation report itself (expected, not an
implementation file). Independently confirmed via a scoped diff that
`buildComparisonYaml.ts`, `resultsWebview.ts`, `newComparisonWizard.ts`,
and `packages/engine/**` show zero changes (`git diff --stat` restricted
to those paths returned empty).

### 7. No UI for the derived `ColumnMappingEntry` variant

Grepped the entire extension source tree for `sourceExpression`/
`targetExpression`: the only hits are `buildComparisonYaml.ts` (untouched,
out of scope, T-35b's pre-existing emission logic) and its own test file,
plus a single explanatory doc comment in `columnMapping.ts` describing why
that variant is *not* built here. `columnMapping.ts`'s exported functions
(`buildMappingRowsFromColumns`, `buildManualMappingRows`,
`mappingRowsToColumnMappingEntries`) and `comparisonEditorHtml.ts`'s
`renderMappingTab`/`renderMappingTargetSelect` only ever produce/render
the plain `{source, target}` shape. Confirmed no UI path for the derived
variant exists.

### Fresh full verification

Ran `npm run verify` myself (not trusting the report's numbers):

```
typecheck: tsc -b --force -> clean, no errors
lint: eslint . -> clean
test: vitest run -> Test Files 31 passed | 2 skipped (33), Tests 565 passed | 27 skipped (592)
```

This matches IMPLEMENTATION-REPORT.md's claimed numbers exactly (565
passed, 27 skipped, 33 test files; the 2 skipped files are the pre-existing
Docker-gated SQL Server/PostgreSQL integration suites, unrelated to this
task). No discrepancy between claimed and observed results.

## Summary judgment

The implementation matches TASK-BRIEF.md's scope precisely. The Table-
mode-only gate is genuinely checked before any connector resolution
(confirmed via a spy that would catch a resolve-then-skip-fetch version of
the bug, not just a getSchema-not-called check); `resolveConnectorByName`
is composed in `activate.ts` from the exact same
`ConnectionProfileStore`/`SecretStore`/`resolveConnector` pieces
`buildConnectorRegistry` already uses, with `comparisonEditorProvider.ts`
never importing either store directly; no credential-shaped value crosses
into the webview under any of the failure/success paths I probed; a
`getSchema` failure (including non-Error rejection values and
unresolvable-connector cases the implementer's own tests didn't cover) is
fully isolated from the other four tabs' Apply behavior; `escapeHtml`
coverage is complete for every fetched/manual column name and error
message, verified against XSS-shaped adversarial inputs; purity holds
under both reference-reuse and deep-clone reconstruction; the file-
ownership diff matches the declared list exactly with no prohibited files
touched; and no UI exists for the out-of-scope derived
`ColumnMappingEntry` variant. My own fresh `npm run verify` run matches
the implementation report's claimed numbers exactly.

The only finding (T-37-01, no debounce on the fetch trigger) is Minor,
was already disclosed by the implementer, and has no correctness or
security impact — it does not block approval.

## Final disposition

**APPROVED**

0 Critical, 0 Important, 1 Minor (disclosed, does not block approval).
