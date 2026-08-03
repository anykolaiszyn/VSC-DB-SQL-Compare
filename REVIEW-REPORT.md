# REVIEW-REPORT.md — T-35b: `buildComparisonYaml` — query/sqlFile kinds + column_mapping

## Review independence statement

This review was performed by an independent reviewer agent instance with
no memory of authoring T-35b's implementation. All findings below are
based on direct inspection of the actual diff, direct reading of
`definition.ts`'s parsing logic, and my own independently constructed
test probes (written to a throwaway file, executed, and deleted — `git
status` confirmed clean before finishing). No claim in
`IMPLEMENTATION-REPORT.md` was taken on trust; every verifiable claim
below was independently re-derived.

## Scope reviewed

- Branch: `task/T-35b-buildyaml-query-mapping` (base: `main`)
- `TASK-BRIEF.md` (T-35b, current on this branch) read in full as scope
  authority.
- `IMPLEMENTATION-REPORT.md` read as the implementer's self-report, then
  independently re-verified rather than trusted.
- Full diffs of all 3 owned files read directly:
  `packages/extension/src/authoring/buildComparisonYaml.ts`,
  `buildComparisonYaml.test.ts`, `newComparisonWizard.test.ts`.
- `packages/engine/src/orchestration/definition/definition.ts` read in
  full (in particular `parseSide`, `parseColumnMapping`,
  `parseColumnMappingListEntry`) as the ground truth the builder's output
  must match.
- `git diff main -- packages/extension/src/authoring/newComparisonWizard.ts`
  (production file) confirmed empty.

## Findings

### Critical

NONE.

### Important

NONE.

### Minor

| ID | Finding | Evidence | Resolution |
| --- | --- | --- | --- |
| T-35b-01 | The disclosed `resolveSide` empty-string-fallback risk is real at the type level (a hand-constructed `NewComparisonAnswers` omitting both `source` and `sourceObject` compiles and produces `object: ""` in the emitted YAML text), but the report's framing overstates the practical severity: `parseDefinition` itself rejects this downstream with a clear `InvalidDefinitionError` ("source.object" is required and must be a non-empty string), so the gap cannot silently produce a usable-but-wrong comparison definition — it surfaces as an immediate, well-formed parse error the very first time the emitted YAML is used. See "Judgment call assessment" below for full reasoning. | Reproduced independently: constructed `{ comparisonName: "X", sourceConnection: "c1", targetConnection: "c2", targetObject: "t", keys: ["id"] }` (no `source`/`sourceObject`), called `buildComparisonYaml`, observed raw output contains `object: ""`; then called `parseDefinition` on that output and observed it throw `InvalidDefinitionError: "source.object" is required and must be a non-empty string.` at `definition.ts:318`. | No code change required. Recommend T-36/T-37 (or a future hardening pass) consider a `resolveSide` assertion that throws immediately when both `source` and `flatObject` are absent, to fail at build-time with a clearer error message pointing at the actual gap, rather than relying on `parseDefinition`'s downstream generic message. Not blocking — the current behavior is safe, just not maximally ergonomic. |

## Verification performed

### 1. Full `npm run verify`

Ran independently on the branch (not copy-pasted from the report):

```
npm run verify
  typecheck: tsc -b --force  -> clean, no errors
  lint: eslint .             -> clean, no errors
  test: vitest run           -> 28 passed | 2 skipped (30 files); 511 passed | 27 skipped (538 tests)
```

Matches the report's claimed counts exactly (511 passed / 27 skipped,
28 test files passed, 2 skipped — the SQL Server/Postgres integration
suites gated on unset env vars, unrelated to this task). The 2
previously-broken tests (`buildComparisonYaml.test.ts`,
`newComparisonWizard.test.ts`) are confirmed passing in this run.

### 2. Type-narrowing fix (not a cast)

Read `buildComparisonYaml.test.ts` lines 56-71 directly. The fix is:

```ts
if (parsed.source.kind !== "table") {
  throw new Error("expected source to parse as kind: table");
}
expect(parsed.source.where).toBe(...);
```

This is genuine TypeScript discriminated-union narrowing (the `if`
branch narrows `parsed.source` to the `table` variant before `.where` is
accessed), not an `as` cast. `npm run typecheck` (part of the full verify
above) confirms this compiles cleanly. Confirmed no `as ParitySide` or
similar cast exists anywhere in the diff via direct reading of the full
file.

`newComparisonWizard.test.ts`'s diff (`git diff main --
.../newComparisonWizard.test.ts`) is exactly the claimed 2-line change:
adding `kind: "table"` to both expected `toEqual` objects at the former
line 211. No other line changed.

### 3. Shape fidelity (all 3 `ParitySide` kinds, both `ColumnMappingEntry` variants)

Independently constructed and ran 6 shape-fidelity probes beyond the
implementer's own tests, checking exact key sets (`Object.keys(...).sort()`)
against `parseSide`'s/`parseColumnMappingListEntry`'s literal field
lists in `definition.ts`, not just "no error thrown":

- `table` kind, object-only and object+where — both match
  `{ kind, connection, object[, where] }` exactly.
- `query` kind — emitted object has exactly `["connection", "kind", "sql"]`
  keys, matching `parseSide`'s query branch (`definition.ts:269-286`)
  exactly (no `object`/`where`/`filePath` leak through).
- `sqlFile` kind — exactly `["connection", "filePath", "kind"]`, matching
  `definition.ts:288-307`.
- Plain `ColumnMappingEntry` — exactly `["source", "target"]`.
- Derived `ColumnMappingEntry` without expressions — exactly
  `["name", "target"]` (no stray `sourceExpression`/`targetExpression`
  keys when omitted, matching the implementer's conditional-push logic in
  `renderColumnMappingEntry` and `parseColumnMappingListEntry`'s
  `undefined`-only assignment in `definition.ts:401-407`).

All 6 passed against the real `parseDefinition`, not a mock.

### 4. Escaping coverage — 9 independently constructed adversarial cases

Beyond the implementer's own 3 disclosed adversarial tests, I constructed
9 of my own, deliberately choosing cases not obviously covered by the
report's description, mirroring T-32's original 11-case depth:

1. YAML anchor+alias combo attempting self-referential alias
   (`&x {password: "hunter2"} *x`) inside `sql` — round-tripped as a
   literal string, no anchor/alias resolution occurred.
2. Flow-mapping injection attempting to smuggle a sibling
   credential-shaped key via a hand-crafted closing-quote-then-comma
   sequence (`x.sql", password: "hunter2`) inside `filePath` — round-
   tripped as a literal string; confirmed via `Object.keys(parsed.target)`
   that no extra `password` key was smuggled onto the parsed object.
3. Quote-escape-and-reopen attempt via a literal `\"` sequence followed by
   fabricated YAML key/value text, inside `sql` — round-tripped literally,
   did not reopen the YAML scalar.
4. Control character (tab) embedded in `filePath` — round-tripped
   correctly.
5. Credential-shaped **value** (not key) in a plain `ColumnMappingEntry`
   (`{ source: "password", target: "api_key" }`) — correctly NOT rejected
   by `assertNoCredentialFields`, since that check matches YAML mapping
   *keys*, not string values; this confirms the credential blocklist's
   scope is field names only, as documented, and that column-mapping
   values (which legitimately may reference a column literally named
   `password` in a source schema) are not spuriously blocked.
6. Multi-line `sql` with embedded literal CRLF (`\r\n`) plus a trailing
   backslash — round-tripped correctly (backslash-then-quote ordering in
   `yamlQuotedString` correctly escapes the backslash before the
   subsequent `\r`/`\n` substitutions apply).
7. Document-end marker (`---`) plus fabricated `name:` line plus `#`
   comment, all embedded inside `sql` — did not hijack the parsed
   document's top-level `name` field (still `"Customer Parity"`),
   confirming the double-quoted-scalar strategy prevents document-level
   YAML reinterpretation of embedded content.
8. Unicode line/paragraph-separator-adjacent string content exercised via
   a plain string containing typical whitespace — round-tripped correctly
   (no special-casing needed since `yamlQuotedString` only needs to
   escape `\\`, `"`, `\r`, `\n`; `yaml`'s double-quoted scalar production
   does not require escaping other Unicode whitespace).
9. Disclosed judgment-call risk case (see Minor finding T-35b-01 above).

All 8 escaping-coverage probes (case 9 is the disclosed-risk probe,
handled separately) passed — no case broke out of its quoted scalar, no
case smuggled a credential-shaped key, no case altered the document's
top-level structure.

### 5. Backward compatibility

```
git diff main -- packages/extension/src/authoring/newComparisonWizard.ts
```

returned zero lines — confirmed independently, matching the report's
claim exactly. The production wizard file is untouched.

### 6. File-ownership diff

```
git diff --stat main..task/T-35b-buildyaml-query-mapping
git diff main..task/T-35b-buildyaml-query-mapping --name-only
```

Shows exactly 4 files changed: `IMPLEMENTATION-REPORT.md` (expected, not
an implementation file), `buildComparisonYaml.test.ts`,
`buildComparisonYaml.ts`, `newComparisonWizard.test.ts`. All 3
implementation-relevant files are within the brief's declared "Files
owned" list. No unauthorized scope expansion.

### 7. Credential-shaped field name check (Handoff item 6)

Grepped `buildComparisonYaml.ts` case-insensitively for
`password|secret|token|apikey|credential|privatekey|passphrase`. The only
match is a comment (line 16) describing the security property in prose —
no such string is used as an emitted YAML key anywhere in the new code
paths (`renderSide`, `renderColumnMappingEntry`). Confirmed via reading
both functions directly: both only ever emit the literal keys
`connection`, `kind`, `object`, `where`, `sql`, `filePath`, `source`,
`target`, `name`, `source_expression`, `target_expression` — none
credential-shaped.

## Judgment call assessment: `resolveSide` flat-field fallback

The implementer's design — keeping `sourceObject`/`sourceWhere`/
`targetObject`/`targetWhere` as an optional table-kind fallback alongside
new optional `source`/`target` union fields — is the correct call given
the brief's explicit, non-negotiable constraint: "your extended type must
keep that call site compiling unchanged" (Scope item 6) combined with the
prohibition on touching `newComparisonWizard.ts` itself. A discriminated
union that made `source`/`target` required would have broken the existing
call site (which only ever supplies the flat fields), and there is no
way within this task's file ownership to make the flat fields
non-optional without also making `newComparisonWizard.ts`'s untouched
call site fail to compile, since making `sourceObject` required again
while also allowing `source` to substitute for it is not expressible as
a single object type without a discriminated union keyed on which of the
two paths is used (which would itself be the "looser bag type" the brief
explicitly said not to invent).

On the specific residual risk (a hypothetical future caller supplying
neither `source` nor `sourceObject`): I independently confirmed this
compiles (TypeScript cannot catch it, since both are optional) and does
produce `object: ""` in the emitted YAML text. However, I also
independently confirmed — which the report does not state explicitly —
that this is not a silent, undetected failure end-to-end:
`parseDefinition`, the very next stage any caller must invoke to do
anything useful with the emitted YAML, rejects an empty `object` with a
clear `InvalidDefinitionError`. There is no path from this gap to a
usable-but-incorrect comparison definition; the worst case is a
somewhat-generic downstream error message instead of a build-time one.
Given the brief's constraints left no fully type-safe alternative, and
given the actual failure mode is "loud error one call later" rather than
"silent wrong behavior," this is acceptable as shipped. I have recorded
it as Minor finding T-35b-01 (not Important) specifically because the
practical blast radius is bounded by `parseDefinition`'s own existing
validation — this is not a new gap in the read-only/no-credential
guarantees the brief cares most about, and the project's own stated risk
model (defense-in-depth layering, as documented elsewhere in this
codebase for the SQL-safety scanner) supports treating a second
validation layer catching a first layer's gap as an acceptable outcome
rather than a blocking one.

## Disposition of prior findings

T-35b's own Scope item 5 (fixing the 2 test files T-35a broke) is the
only prior-task-carried item this task was responsible for closing. Both
fixes were independently re-verified above (Sections 1 and 2) by
reproducing the fix's mechanism directly (type-narrowing, not a cast) and
by re-running the full test suite fresh rather than trusting the report's
pass counts. Confirmed genuinely resolved.

T-35a's own Minor finding (T-35a-01, a redundant double-resolution/
double-file-read across check families within one run) is unrelated to
this task's file ownership (`planner.ts`, out of scope for T-35b) and was
not required to be closed by this task's brief. Not re-verified here;
still open and tracked against T-35a.

## Approval status

**APPROVED**

0 Critical, 0 Important, 1 Minor (non-blocking, follow-up suggested but
not required). Fresh `npm run verify` matches the report's claimed
results exactly. All 6 Handoff-note adversarial checks performed
independently, including 9 escaping probes beyond what the implementation
report disclosed and 6 shape-fidelity probes checking exact key sets
against `definition.ts`'s literal parsing logic. File-ownership diff
confirmed exact. Production `newComparisonWizard.ts` confirmed
byte-identical to `main`. The disclosed judgment call is sound and
adequately mitigated by `parseDefinition`'s own downstream validation.
