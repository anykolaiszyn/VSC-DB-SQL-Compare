# REVIEW-REPORT.md — T-36: Custom comparison editor (Source/Target/Keys/Checks)

## Review independence statement

I am a separate reviewer agent instance from whoever implemented this task.
I have no memory of writing this code. All findings below are based on my
own reading of the actual diff/source on `task/T-36-comparison-custom-editor`,
my own execution of `npm run verify`, and adversarial probes I constructed
and ran myself (not the implementer's own test suite, though I also read
and cross-checked that suite). `IMPLEMENTATION-REPORT.md`'s claims were
treated as hypotheses to verify, not facts to accept.

## Scope reviewed

- `packages/extension/src/authoring/comparisonEditorProvider.ts` (new)
- `packages/extension/src/authoring/comparisonEditorProvider.test.ts` (new)
- `packages/extension/src/authoring/comparisonEditorHtml.ts` (new)
- `packages/extension/src/authoring/comparisonEditorHtml.test.ts` (new)
- `packages/extension/src/authoring/buildComparisonYaml.ts` (extended)
- `packages/extension/src/authoring/buildComparisonYaml.test.ts` (extended)
- `packages/extension/src/activation/activate.ts` (extended)
- `packages/extension/package.json` (`contributes.customEditors` added)
- `packages/extension/src/activation/activate.test.ts` (disclosed
  out-of-brief mock-scaffold deviation)

Verified via `git diff --stat main..task/T-36-comparison-custom-editor`
that no other file changed — 10 files total, exactly the declared "Files
owned" list plus the disclosed `activate.test.ts` deviation.
`packages/engine/**` diff is empty (0 lines). `resultsWebview.ts` and
`newComparisonWizard.ts`/`newComparisonWizard.test.ts` have zero diff
against `main`.

## Findings

### Critical

NONE.

### Important

NONE.

### Minor

| ID | Finding | Evidence | Resolution |
| --- | --- | --- | --- |
| T-36-01 | The implementer's own "adversarial bypass" test (`comparisonEditorProvider.test.ts` lines 181–217, titled "REJECTS an internal validation bypass ... must still be blocked by the round-trip guard, not just by client-side validation") does not actually exercise the round-trip guard (`parseDefinition` re-parse) as its name claims. The constructed input (`object: { nested: "not-a-string" }`) is coerced to `""` by `buildAnswersFromApplyMessage`'s own `typeof x === "string" ? x : ""` field parser and is rejected by the **required-field precheck**, never reaching `buildComparisonYaml`/`parseDefinition` at all — the test's own inline comment even says so ("which correctly fails required-field validation and is rejected BEFORE ever reaching buildComparisonYaml/parseDefinition"), which contradicts the test's title/description. This is a mislabeled test, not a missing control: the round-trip guard itself remains sound (see my independent adversarial probes below, which found no way to get invalid YAML past it), but the disclosed evidence overstates what that specific test proves. | `packages/extension/src/authoring/comparisonEditorProvider.test.ts:181-217`; confirmed by reading `buildAnswersFromApplyMessage`'s field parsers in `comparisonEditorProvider.ts:73-101` | Suggested (not required): rename/refocus the test to accurately describe what it verifies (required-field rejection), and optionally add a case that truly reaches `buildComparisonYaml` successfully but fails `parseDefinition` on re-parse, if such a case can be constructed, to genuinely exercise the round-trip-guard code path in `handleApplyMessage` lines 288-293. Does not block approval — the guard's actual behavior was independently confirmed sound (see Verification below). |
| T-36-02 | `checks` Apply payload always reports all four toggle states on every Apply (not just user-touched ones), collapsing "untouched" and "explicitly set to initial state" — disclosed candidly in `IMPLEMENTATION-REPORT.md`'s Assumptions section and confirmed accurate by reading `comparisonEditorHtml.ts`'s `currentChecks()` (`CLIENT_SCRIPT`, lines 394-401), which unconditionally reads all four checkbox `.checked` states. | `packages/extension/src/authoring/comparisonEditorHtml.ts:394-401`; `comparisonEditorProvider.ts`'s `buildAnswersFromApplyMessage` always builds all 4 `checks.*` sub-objects from the Apply message (lines 172-177) | Acceptable for this task's scope per TASK-BRIEF.md Scope item 3 ("four independent booleans is sufficient... do not build UI for tolerance/strategy/..."), and the implementer disclosed it rather than hiding it. No action required now; worth a future task if strict never-write-untouched-fields semantics become a requirement. |

## Disposition of prior findings

No prior open finding in `PROGRESS-LEDGER.md` names T-36 as its required
resolution target — this is fresh implementation work, not a re-review of
a previously blocked task. No re-verification of an earlier failing case
was needed.

## Verification performed (independent)

### 1. Fresh full verification

Ran `npm run verify` myself on the checked-out branch:

```
tsc -b --force        -> clean
eslint .               -> clean
vitest run             -> 30 passed | 2 skipped (32 files); 543 passed | 27 skipped (570 tests)
```

This matches `IMPLEMENTATION-REPORT.md`'s claimed `543 passed / 27 skipped
/ 32 test files` exactly. No discrepancy.

### 2. Apply-blocking validation is real (adversarial, independent of the implementer's test suite)

I wrote my own temporary probe test file
(`packages/extension/src/authoring/__reviewer_probe.test.ts`, deleted
before finishing — confirmed via `git status --short` showing a clean
tree at the end of this review) that called `handleApplyMessage` and
`ComparisonEditorProvider.resolveCustomTextEditor` directly, bypassing
any client-side script entirely:

- **YAML-injection-shaped `comparisonName`** (containing embedded
  newlines, `{nested: true}`, and a YAML-mapping-looking
  `source:\n  connection: hacked` payload designed to break out of its
  scalar position if quoting were broken): `handleApplyMessage` returned
  `ok: true` with YAML that, when re-parsed through the real
  `parseDefinition`, preserved the entire string as a single scalar value
  (`parsed.name` equaled the exact original string; `parsed.source.connection`
  stayed `"sqlserver-customer"`, unaffected) — confirms `yamlQuotedString`'s
  escaping genuinely prevents structural injection, not just that no error
  was thrown.
- **Whitespace-only `object` field** (`"   "`, which a naive
  `!== ""` check would accept): went through a full simulated
  `resolveCustomTextEditor` message-handler call with a mocked `applyEdit`
  spy. Result: `applyEdit` was never called. Confirms the `.trim() !== ""`
  check in `buildAnswersFromApplyMessage` (`comparisonEditorProvider.ts:139`)
  is real and the document is genuinely left untouched, not just that the
  webview's own script would have disabled the Apply button.
- **host/port/user/password-shaped fields injected directly into the
  Apply message's `source` object** (bypassing the client script and the
  connection-picker UI entirely, simulating a compromised/malicious
  webview): `handleApplyMessage` returned `ok: true`, and I asserted the
  emitted YAML text did not contain any of `"evil.example.com"`,
  `"hunter2"`, `"sa"`, or `"1433"` — confirmed. `parseSideMessage` (lines
  78-101) only ever reads `connection`/`sql`/`filePath`/`object`/`where`
  off the incoming object; extra fields are silently dropped, never
  passed through to `buildComparisonYaml`.

All 3 probes passed (`npx vitest run
packages/extension/src/authoring/__reviewer_probe.test.ts` — 3 passed).
The probe file was deleted immediately after; `git status --short` at the
end of this review shows a clean tree.

Separately, I confirmed T-36-01 above (the implementer's own labeled
"bypass" test does not exercise the actual round-trip-guard code path) —
downgraded to Minor because my own independent probes found the guard's
actual runtime behavior sound; the finding is about test-description
accuracy, not a functional gap.

### 3. `enableScripts: true` scoping

```
git diff main..task/T-36-comparison-custom-editor -- packages/extension/src/webview/resultsWebview.ts packages/extension/src/authoring/newComparisonWizard.ts
```
Output: empty. Both files are byte-for-byte unchanged from `main`.
`resultsWebview.ts`'s `enableScripts: false` contract is untouched.
`enableScripts: true` appears only in
`comparisonEditorProvider.ts:335` (`resolveCustomTextEditor`), scoped
to this new file, matching the brief's pre-approved deviation exactly.

### 4. No credential-shaped field reachable

- `ComparisonEditorConnectionOption` (`comparisonEditorHtml.ts:68-70`)
  only has a `name: string` field — structurally cannot carry
  host/port/user/password.
- `comparisonEditorProvider.ts`'s `resolveCustomTextEditor` builds
  `connectionOptions` via
  `this.deps.listConnectionNames().map((name) => ({ name }))` —
  `listConnectionNames` returns `string[]` (bound in `activate.ts` to
  `connectionProfileStore.list().map((profile) => profile.name)`), so
  only `.name` is ever read off a `ConnectionProfile` at any point in the
  chain.
- `parseSideMessage` (provider) only reads `connection`/`sql`/`filePath`/
  `object`/`where` off an incoming Apply message; verified via my own
  probe (above) that extra host/port/user/password-shaped fields are
  silently dropped, never reaching the emitted YAML.
- `buildComparisonYaml.ts`'s `renderSide` always writes `connection` as
  `yamlQuotedString(connection)` — a bare scalar string, never a nested
  object, regardless of the string's content.

### 5. Purity and XSS coverage of `renderComparisonEditorHtml`

Ran `comparisonEditorHtml.test.ts` directly (13 tests, all passed) and
independently read every interpolation site in
`comparisonEditorHtml.ts`:

- `renderTabStrip`, `renderSideModeOptions`, `renderConnectionOptions`,
  `renderSideTab`, `renderKeysTab`, `renderChecksTab`, and the top-level
  `renderComparisonEditorHtml` all route every draft-derived string
  through `escapeHtml` before placing it in an HTML attribute or text
  position. I walked each one; found no bare interpolation of
  user-controlled data.
- The one dynamic value near a `<script>` tag —
  `window.__PARITYLENS_DRAFT__ = ${draftJson}` — goes through
  `escapeForScriptJson`, which escapes `<`/`>` to Unicode escapes,
  preventing a `</script`-containing value from prematurely closing the
  tag. Confirmed by the implementer's own test (`comparisonEditorHtml.test.ts:97-108`)
  and consistent with my own reading of the function.
- `CLIENT_SCRIPT` is a single fixed template-literal constant, never
  interpolated with any `draft` field — confirmed by reading the full
  ~150-line script body (lines 356-509): every reference to dynamic data
  inside it reads from `window.__PARITYLENS_DRAFT__` or live DOM state at
  runtime, never from a string substitution at render time.
- Purity: `renderComparisonEditorHtml(BASE_DRAFT) === renderComparisonEditorHtml(BASE_DRAFT)`
  and `renderComparisonEditorHtml(BASE_DRAFT) === renderComparisonEditorHtml(deepCopy)`
  both hold per the implementer's own tests; I did not find any
  non-deterministic construct (`Date.now()`, `Math.random()`, object-key
  iteration order dependent on non-plain-object input, etc.) anywhere in
  the file.

### 6. `checks` round-trip fidelity

Independently re-read `parseChecks` in
`packages/engine/src/orchestration/definition/definition.ts` (lines
502-558) and confirmed the YAML keys `renderChecks`
(`buildComparisonYaml.ts:250-274`) emits — `schema`, `row_count`,
`profile`, `row_level` — match exactly what `parseChecks` reads
(`obj["schema"]`, `obj["row_count"]`, `obj["profile"]`,
`obj["row_level"]`). Ran `buildComparisonYaml.test.ts` (22 tests,
including the 5 new `checks` tests) and independently traced two of
them:
- schema+rowCount enabled → `parsed.checks` equals
  `{ schema: { enabled: true }, rowCount: { enabled: true } }` exactly
  (not just "no error thrown").
- profile enabled + rowLevel explicitly disabled → `parsed.checks` equals
  `{ profile: { enabled: true }, rowLevel: { enabled: false } }` exactly.

Both match the brief's required "at least 2 of the 4 toggles" round-trip
evidence and my own reading of `parseChecks` confirms no key-name
mismatch exists.

### 7. File-ownership diff

```
git diff --stat main..task/T-36-comparison-custom-editor
```
10 files changed: the 8 declared "Files owned" files plus
`IMPLEMENTATION-REPORT.md` and the disclosed `activate.test.ts`
deviation. `packages/engine/**` diff: 0 lines.
`resultsWebview.ts`/`newComparisonWizard.ts`(`.test.ts`): 0 lines.

### 8. `activate.test.ts` deviation characterization

```
git diff main..task/T-36-comparison-custom-editor -- packages/extension/src/activation/activate.test.ts
```
Confirmed: the diff is exactly 2 new mock properties
(`registerCustomEditorProvider` — a no-op disposable factory,
`applyEdit` — a `vi.fn(async () => true)`) added to the file's existing
hoisted `vi.mock("vscode", ...)` factory's `window`/`workspace` return
objects, plus one added inline comment explaining why. No existing
assertion, `it(...)` title, or test body was touched. Also independently
ran `npx vitest run packages/extension/src/activation` — 20 passed (12
`activate.test.ts` + 8 `runComparisonCommand.test.ts`), matching the
report's claim and confirming the mock-only edit changed no existing
test's outcome. The characterization in `IMPLEMENTATION-REPORT.md` is
accurate.

Also independently verified `activate.ts`'s actual diff (not just the
report's description): the new `registerComparisonEditorProvider`
function binds `listConnectionNames` to
`connectionProfileStore.list().map((profile) => profile.name)` (name
only) and `applyEdit` to the live `vscode.workspace.applyEdit` — exactly
matching the `ComparisonEditorProviderDeps` contract read in item 4
above.

## Summary judgment

The implementation matches its brief closely and matches its own report
accurately, including the one disclosed out-of-ownership deviation
(`activate.test.ts`), which I independently confirmed to be exactly what
it claims: 2 mechanical mock additions, zero assertion changes. The
single most important correctness property — Apply must never write a
document that would fail `parseDefinition` — held up under my own
adversarial probing, including cases the implementer's disclosed test
suite did not construct (YAML-structural-injection attempt via
`comparisonName`, whitespace-only required fields, and a simulated
compromised-webview payload carrying credential-shaped field names). The
one Minor finding (T-36-01) is about a mismatch between a test's title
and what it actually exercises, not a functional gap in the guard itself
— the guard's real behavior was independently confirmed sound via my own
probes that did reach `buildComparisonYaml` successfully before
re-parsing.

No credential-shaped data is reachable through the connection picker or
Apply pipeline. `enableScripts: true` is correctly scoped to the new file
only; `resultsWebview.ts` is byte-for-byte unchanged.
`renderComparisonEditorHtml` is pure and every interpolation is
`escapeHtml`-covered; the embedded `<script>` is static text, and the one
dynamic JSON payload near it is safely escaped against `</script>`
breakout. `checks` round-trips through the real `parseDefinition` with
exact key-name fidelity (verified against `parseChecks`'s actual
snake_case reads, not assumed). File ownership is clean:
`packages/engine/**`, `resultsWebview.ts`, and `newComparisonWizard.ts`
are all confirmed untouched.

## Final disposition

**APPROVED**

0 Critical, 0 Important, 2 Minor (neither blocks approval — one is a
test-description accuracy issue with no functional consequence given
independently-confirmed guard behavior; the other is a disclosed,
brief-scoped, accepted limitation).
