# ParityLens — Review Report T-32

## Review independence statement

I am a separate reviewer instance from whoever implemented this task. I did
not write any of the code under review. All findings below are based on my
own fresh reading of `TASK-BRIEF.md`, the actual diff (`git diff
main...HEAD`), the actual current source of every changed file, and my own
re-run of verification and adversarial probes — not on the implementer's
characterization of them in `IMPLEMENTATION-REPORT.md`.

## Scope reviewed

Branch `task/T-32-comparison-authoring-scaffold`, commits `f3388cc` and
`64d017a`, diffed against `main`. Changed files (confirmed via `git diff
main...HEAD --name-only`, 7 files):

- `packages/extension/src/authoring/buildComparisonYaml.ts` (new)
- `packages/extension/src/authoring/buildComparisonYaml.test.ts` (new)
- `packages/extension/src/authoring/newComparisonWizard.ts` (new)
- `packages/extension/src/authoring/newComparisonWizard.test.ts` (new)
- `packages/extension/src/activation/activate.ts` (modified)
- `packages/extension/package.json` (modified)
- `IMPLEMENTATION-REPORT.md` (modified, per this kit's per-task pattern)

## Scope and ownership check

All changed files fall within `TASK-BRIEF.md`'s declared "Files owned":
`activate.ts` (new command registration only), `authoring/**` (new), and
`package.json`'s `contributes.commands` array. Verified independently:

- `git diff main...HEAD -- packages/engine` → empty. `packages/engine/**`
  (including `parseDefinition`/`definition.ts`) is untouched, per the
  brief's Prohibited Changes.
- `git diff main...HEAD -- packages/extension/src/connections` → empty.
  T-29's owned files are untouched.
- `activate.ts` diff is strictly additive: one new import, one new command
  ID constant, one new `registerNewComparisonCommand` function, one new
  `context.subscriptions.push(...)` call, and a doc-comment update. No
  existing command handler or registration (`runComparison`/
  `addConnection`/`editConnection`/`deleteConnection`) was touched.
- `package.json` diff adds exactly one new entry to `contributes.commands`
  (`paritylens.newComparison`); no existing entry was touched.

No unauthorized scope expansion found.

## Verification performed

### Fresh full verification (`npm run verify`)

Ran independently, not copied from the report:

```
Test Files  28 passed | 2 skipped (30)
     Tests  450 passed | 27 skipped (477)
```

typecheck clean, lint clean, all test files green except the two
integration suites (SQL Server/Postgres) that skip by design when
`PARITYLENS_TEST_*` env vars are unset — matching this repo's documented
baseline. This matches the report's claimed full-verification numbers
exactly (450 passed / 27 skipped / 28 files passed / 2 skipped).

### Focused authoring suite

`npx vitest run packages/extension/src/authoring` → `buildComparisonYaml.test.ts`
(5 tests) + `newComparisonWizard.test.ts` (13 tests), all green — matches
the report's claimed 18/18.

### Adversarial probe 1 — credential/structural-injection into scaffolded YAML

Per the brief's Handoff note, I wrote an independent adversarial test file
(`packages/extension/src/authoring/__reviewer_probe.test.ts`, deleted after
the run — confirmed via `git status --short` showing a clean tree) that
goes beyond the implementer's own tests. It fed `buildComparisonYaml` +
`parseDefinition` together (round-tripping through the real parser, not
just inspecting the builder's string output) with:

- YAML anchor/alias injection (`"&anchor foo\ntarget:\n  connection: hijacked"`)
- Flow-mapping injection (`"{password: hunter2}"`)
- Quote-escape-and-reopen-mapping attempts on `connection`, `object`, and
  `where` fields specifically crafted to try to break out of the
  double-quoted scalar and inject a sibling `password:` key
  (`'x"\n  password: hunter2\n  connection: "y'` and analogous variants for
  `object`/`where`/top-level `name`/`keys[]`)
- A trailing-backslash-before-closing-quote case (`"trailing\\"`) to check
  the escape doesn't consume the closing delimiter
- Tab/control characters
- An empty-string connection (confirmed rejected by `parseDefinition`
  itself, not something the builder needs to special-case)
- A sweep of six credential-shaped substrings (`password:`, `secret:`,
  `token:`/`refresh_token:`, a quoted-nested-object string, a list-item
  form, and a literal `connection: {password: x}` string) fed into both
  `sourceConnection` and `targetConnection` simultaneously

Result: **all 11 probe cases passed** — `parseDefinition` on the builder's
output always returned the literal adversarial string, unmodified, as a
plain JS string value for the relevant field, and in the anchor-injection
case the sibling `target.connection` was confirmed *not* hijacked
(`"postgres-products"`, unchanged). No case produced a nested
object/mapping, no case allowed a `password`/`secret`/`token`-shaped key to
appear anywhere in the parsed structure outside of being a literal
substring of a scalar value. `yamlQuotedString`'s escaping
(backslash → `\\`, `"` → `\"`, `\r` → `\r`, `\n` → `\n`) is sufficient for
every double-quoted-YAML-scalar-breakout technique I could construct, and
I probed all five user-facing string-bearing fields
(`comparisonName`/`sourceConnection`/`sourceObject`/`sourceWhere`/`keys[]`),
not just `connection` as the implementer's own tests focused on.

This independently confirms the brief's Handoff point (1): the scaffolded
YAML never contains a credential-shaped field under any answer combination
I could construct, including inputs the implementer's own test suite did
not cover (object/where/name/keys fields, anchors, flow mappings, and
explicit quote-breakout attempts).

### Adversarial probe 2 — overwrite check tracing

Traced `runNewComparisonCommand` (`newComparisonWizard.ts` lines 184–216)
by hand:

1. Runs the wizard to completion (aborts early, before any file-system
   touch, if any step returns `undefined`).
2. Prompts for a file name; aborts (no write) if cancelled.
3. Resolves `targetPath` via `deps.resolveTargetPath`.
4. Calls `deps.fileExists(targetPath)` — **before** any call to
   `buildComparisonYaml`, `parseDefinition`, or `deps.writeFile`. If true,
   shows an error and returns `undefined` immediately; none of the
   subsequent steps run.
5. Only if the file does not exist does it build the YAML, self-validate
   via `parseDefinition`, and call `deps.writeFile`.

There is exactly one call site to `deps.writeFile` in the whole module
(confirmed by inspection — no other write path, no retry-with-overwrite
branch, no auto-numbering). The "wizard interrupted partway and re-run"
case the brief specifically asks about: because `writeFile` is only ever
reached at the very end of a single linear async sequence, a cancelled run
(at any step, including the file-name prompt) never calls `writeFile` at
all — there is no partial-write state left behind to collide with on a
second run. A second run against the same target path re-enters the same
`fileExists` check with the same result, so a file created by a completed
first run is correctly detected and blocks a second run's write.

The real `activate.ts` wiring backs `fileExists` with `node:fs/promises`
`stat` wrapped in try/catch (true on success, false on any throw,
including `ENOENT`) — a standard, correct existence check. The report
discloses a check-then-write TOCTOU gap (no `O_EXCL`); I agree this is a
theoretical, disclosed, and out-of-scope gap under the brief's explicit
"aborting cleanly is an acceptable minimum" / no-required-atomic-create
wording, and it is consistent with this codebase's existing
`writeExport.ts` precedent (also not atomic). Not a blocking finding.

Confirmed via the existing `newComparisonWizard.test.ts` test "never
overwrites an existing file at the target path -- aborts without
writing" plus my own trace: `deps.writeFile` is asserted never called when
`existingFiles` seeds the target path, and `showErrorMessage` is called
with an "already exists" message. This independently confirms the brief's
Handoff point (2).

### Round-trip self-validation

Confirmed `runNewComparisonCommand` calls `parseDefinition(yamlText)`
(line 211) directly on the builder's own output, uncaught, before the
`writeFile` call — a real self-validation step, not a decorative no-op.
The "writes a scaffolded file whose contents parseDefinition accepts"
test asserts on the actual parsed `ParityDefinition` shape field-by-field
(`version`, `name`, `source`, `target`, `keys`), not just "did not throw",
matching the brief's Green-state requirement wording exactly. I also
independently re-parsed the written YAML from my own adversarial probe
cases above and confirmed the shape assertions hold there too.

### Cancellation coverage

Traced `runNewComparisonWizard`: every one of its six `showInputBox`/
`showQuickPick` calls (comparison name, source connection, source
object+where, target connection, target object+where, keys) is followed
by an `=== undefined` check that returns `undefined` immediately, before
any later step runs or any answer is assembled. `runNewComparisonCommand`
adds two more early-return points (file-name prompt cancellation,
never-overwrite abort) before `buildComparisonYaml`/`writeFile` are ever
reached. Cross-checked against the report's claimed test count: eight
dedicated cancel/abort-path tests exist across both test files (six in
`runNewComparisonWizard`'s describe block, two more in
`runNewComparisonCommand`'s), all asserting `writeFile` was never called.
This matches.

### Fixture-pair-name fallback list claim

Independently confirmed via direct inspection: `packages/engine/src/index.ts`
re-exports only `orchestration/definition/definition.js`,
`orchestration/planner/planner.js`, and the three connector modules
(`fixture-connector.js`, `sqlServerConnector.js`, `postgresConnector.js`)
— it does **not** re-export `packages/engine/fixtures/index.ts` or any
`FIXTURE_SET_IDS`-shaped constant. The implementer's claim that this
module is not part of `@paritylens/engine`'s public surface is accurate.
I also confirmed `activate.ts` already contains a pre-existing hardcoded
`"sqlserver-customer"` string literal precedent (in
`buildFixtureRegistry`/`buildConnectorRegistry`, both outside this task's
diff) for exactly the same reason — this is a genuine, honest precedent
in the codebase, not a fabricated justification. Importing the fixtures
module directly would require either a prohibited `packages/engine/**`
change (adding the re-export) or a cross-package deep import this
codebase's own `index.ts` header comment explicitly disclaims
("no file in this monorepo deep-imports across the @paritylens/engine
package boundary"). The hardcoded three-literal list
(`FIXTURE_PAIR_NAMES` in `newComparisonWizard.ts`) was the only option
available within this task's ownership constraints; this was not
avoidable without a scope violation. I agree with the implementer's
disclosed risk that a user picking `snowflake-orders`/`postgres-products`
from this list would hit a runtime surprise on `paritylens.runComparison`
(only `sqlserver-customer` currently resolves to a wired connector) — this
is honestly disclosed in both the implementation report and in a code
comment in `newComparisonWizard.ts` itself, and is a reasonable judgment
call given the brief's plural "fixture pair names" wording and
`IMPLEMENTATION-PLAN.md`'s T-32 row wording. Not a blocking finding, but
noting it as a candidate for a future task to reconcile (e.g. widening
`buildConnectorRegistry`'s fixture wiring, or narrowing this list) rather
than silent scope creep here.

## Findings

### Critical

NONE.

### Important

NONE.

### Minor

| ID | Finding | Evidence | Resolution |
| --- | --- | --- | --- |
| T-32-01 | Fixture-pair fallback list offers `snowflake-orders`/`postgres-products` as connection names even though `activate.ts`'s `buildConnectorRegistry` currently only wires a real connector for `sqlserver-customer` — a user picking one of the other two in `newComparison`'s quick pick gets a syntactically valid `.paritylens` file that will fail at `runComparison` time with an unresolved-connection error. | `packages/extension/src/authoring/newComparisonWizard.ts` lines 15-34 (`FIXTURE_PAIR_NAMES`); `packages/extension/src/activation/activate.ts` `buildFixtureRegistry`/`buildConnectorRegistry` (pre-existing, outside this diff) only registers `"sqlserver-customer"`. | Honestly disclosed by the implementer in both the report and an in-code comment; not a defect introduced by dishonesty or an unjustified reading of the brief. Suggest a follow-up task widen `buildConnectorRegistry`'s fixture wiring to match, or narrow this list to only the fixture(s) actually resolvable today — does not block this task's approval. |
| T-32-02 | Check-then-write TOCTOU gap in the never-overwrite check (`deps.fileExists` then, later, `deps.writeFile`, not atomic). | `packages/extension/src/authoring/newComparisonWizard.ts` lines 200-213. | Disclosed by the implementer; consistent with this codebase's existing `writeExport.ts` precedent (also non-atomic) and explicitly permitted by the brief's "aborting cleanly is an acceptable minimum" wording (no atomic-create requirement stated). No action required; noting for completeness only. |

## Disposition of prior findings

No prior review round or open finding was assigned to T-32 specifically —
this is the first review pass for this task. `PROGRESS-LEDGER.md`'s
existing open findings (I-01/I-02, the SQL Server `GO`-separator and
PostgreSQL dollar-quoting statement-safety gaps) are unrelated to this
task's scope (`assertReadOnlyStatement` and connector execution paths are
untouched by this diff) and are not re-litigated here.

## Final approval status

**APPROVED**

Both Handoff-note adversarial requirements are independently confirmed:
(1) the scaffolded YAML never contains a credential-shaped field under any
answer combination I could construct, across all five user-facing string
fields, including anchor/flow-mapping/quote-breakout injection attempts
the implementer's own tests did not cover; (2) an existing file at the
target path is genuinely never silently overwritten under any code path,
including a wizard interrupted partway and re-run — there is exactly one
write call site, reached only after a successful existence check, and a
cancelled/interrupted run never reaches it at all. Fresh `npm run verify`
matches the report's claimed numbers exactly (450 passed / 27 skipped / 28
files passed / 2 skipped). Scope is fully within the brief's declared file
ownership with zero touches to `packages/engine/**` or
`packages/extension/src/connections/**`. The fixture-pair-name hardcoding
claim was independently verified against `packages/engine/src/index.ts`'s
actual exports and found accurate, not a convenient fabrication. No
Critical or Important findings. Two Minor findings recorded, both already
honestly disclosed by the implementer and consistent with the project's
existing risk model (documented non-atomic-write precedent,
plural-reading-of-brief judgment call) — neither blocks approval.
