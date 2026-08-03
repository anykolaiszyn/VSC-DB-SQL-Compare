# Self-Service Gap Analysis — Jr. Data Analyst & Jr. Analytics Engineer Personas

Date: 2026-08-02
Status: Research/analysis only — no code changes. Companion document to
`docs/superpowers/specs/2026-08-02-comparison-authoring-ui-design.md`
(Phase 5's approved-but-not-yet-built design).

## Summary

ParityLens today is a genuinely working engine wrapped in a self-service
UI that is roughly half-built: connection management, a scaffolding
wizard, a tree view, and a themed results webview all exist and work
(T-29 through T-34, all COMPLETE/APPROVED), but the actual moment a
comparison runs is still effectively a raw, un-gated `parseDefinition` →
`runComparison` call with a single passive info toast, no SQL preview or
confirmation, and every authoring path past the initial scaffold still
requires hand-editing YAML in a plain text editor — including composite
concepts (column mapping, query/sqlFile-kind sides, checks toggles) the
scaffold wizard doesn't even ask about. A Jr. Analytics Engineer with
some YAML/git comfort could likely get a first schema/profile comparison
running solo, hit real friction the moment they need column mapping or a
non-table source, and would be reading engineer-voiced error strings
(`InvalidDefinitionError`, `MutatingStatementError`, raw driver errors)
verbatim throughout. A Jr. Data Analyst with no YAML background would
almost certainly stall at the first hand-edit of the scaffolded file —
there is no in-product explanation of what a `.paritylens` file's fields
mean, and VS Code itself is assumed background knowledge nowhere
established. Phase 5's approved design (custom editor, column-mapping
tab, pre-execution SQL preview, CodeLens) targets a large share of this
gap directly, but it is design-only today — none of T-36 through T-39
are implemented — so every finding below reflects what actually ships if
someone installs the extension right now.

## Findings

### 1. No onboarding surface at all — empty sidebar, no "what do I do first"

**Persona:** Both, but especially Jr. Data Analyst.
**Journey step:** First activation, before any command is run.

`packages/extension/src/views/parityTreeDataProvider.ts` renders exactly
three static section headers — Connections, Comparisons, Recent Runs
(lines 28–32) — with **no rows under any of them** on first install:
"Connections" is permanently empty-state per this codebase's own comment
("`'connections'` stays empty-state — out of this task's scope", line
199), "Comparisons" only populates from `.paritylens` files already in
the workspace (there are none on day one), and "Recent Runs" only
populates after a run has been persisted. There is no welcome view, no
placeholder text ("Click + to add a connection"), no walkthrough, and no
command-palette-visible "Get Started" entry. A user who installs the
extension and opens the Data Parity icon sees three collapsed, childless
tree sections and nothing else — no signal of what command to run first.

**Why it's a barrier:** VS Code's command palette (`Ctrl+Shift+P`)
requires already knowing to look there, and even then a user must guess
that typing "ParityLens" will surface anything — nothing in the sidebar
itself points there. Both personas are told nothing about the tool's
'shape' (connections → comparisons → results) inside the product itself.

**Phase 5 status:** Not addressed. Phase 5's design (comparison
authoring UI) improves the *authoring* surface once a user already knows
to run `paritylens.newComparison`, but adds no onboarding/first-run
guidance, welcome view, or walkthrough. This is a genuinely new gap.

---

### 2. Command discovery relies entirely on already knowing VS Code's command palette

**Persona:** Jr. Data Analyst (has "never used VS Code extensively" per
persona brief); secondarily Jr. Analytics Engineer.
**Journey step:** Discovering what actions exist.

`packages/extension/package.json`'s `contributes.commands` block (read
via Grep) registers five commands, all titled with a `"ParityLens: "`
prefix (`"ParityLens: Run Comparison"`, `"ParityLens: Add Connection"`,
`"ParityLens: Edit Connection"`, `"ParityLens: Delete Connection"`,
`"ParityLens: New Comparison"`) — but none of them appear as a clickable
affordance anywhere in the tree view itself (no `+`-style inline button
on the "Connections" section, no context-menu entry, no `viewsWelcome`
contribution). The only way to invoke any of them is the command
palette. `activate.ts` confirms this: `registerAddConnectionCommand`,
`registerNewComparisonCommand`, etc. (lines 428–485) are all registered
purely as `vscode.commands.registerCommand` — there is no
`contributes.menus` entry wiring any of them to a tree-view title bar
icon.

**Why it's a barrier:** A Jr. Data Analyst persona explicitly described
as not having used VS Code extensively has no guided path to "add a
connection" — they'd need to already know VS Code's command-palette
convention, then guess the right search term, entirely unprompted by the
UI.

**Phase 5 status:** Not addressed. CodeLens (T-39) adds inline actions,
but only *inside an already-open `.paritylens` file* — it does nothing
for the earlier "how do I even create my first connection/comparison"
step.

---

### 3. The connection-setup flow is a blind sequence of input boxes with no validation feedback and a plaintext-looking password field

**Persona:** Both.
**Journey step:** `paritylens.addConnection`.

`packages/extension/src/connections/connectionCommands.ts`'s
`promptForProfileFields` (lines 50–111) walks the user through six
sequential `showInputBox`/`showQuickPick` prompts — Connection name,
Platform, Host, Port, Database, User, Password — each a bare VS Code
input box with only a `prompt` string (e.g. `"Host"`, `"Database"`,
`"User"`) and no placeholder example, no help text, and no indication of
what a valid value looks like (is "Host" a server name, an IP, a full
connection string?). The only validation present anywhere in the flow is
`parsePort` (lines 31–34) rejecting a non-positive-integer port. There is
**no connection test at add-time** — `addConnectionCommand` (lines
119–138) calls `store.add(profile, prompted.password)` and immediately
reports success (`"ParityLens: added connection \"${profile.name}\""`)
with zero verification that the host/credentials actually work.
Discovering a typo'd host or wrong password happens only later, the
first time a comparison is run against it (surfacing as a raw driver
error via `runComparison`'s Layer-1 connectivity check).

**Why it's a barrier:** Neither persona gets feedback at the point where
a mistake is cheapest to catch. A fat-fingered host or wrong port
produces a false "success" message, and the failure only surfaces
minutes later in a different command, disconnected from the
input step that caused it.

**Phase 5 status:** Not addressed. Nothing in the Phase 5 design touches
`connectionCommands.ts` or adds a "Test Connection" action — it is out
of scope entirely (Phase 5 assumes T-29's connection flow as a given
input, e.g. "Connection picker lists T-29's saved `ConnectionProfile`s
by name").

---

### 4. Authoring a comparison beyond the wizard's minimal scaffold requires hand-editing YAML with zero in-product explanation of the format

**Persona:** Jr. Data Analyst (severe — "doesn't know what YAML is beyond
having seen it once"); Jr. Analytics Engineer (moderate — comfortable
with YAML conceptually, but has no context on *this* schema).
**Journey step:** Post-scaffold authoring — column mapping, checks
toggles, non-table sources.

`packages/extension/src/authoring/newComparisonWizard.ts`'s
`runNewComparisonWizard` (lines 110–157) only collects: comparison name,
source connection + object name + optional WHERE, target connection +
object name + optional WHERE, and comma-separated key columns. It writes
"a minimal `.paritylens` YAML file (`version`/`name`/`source`/`target`/
`keys` only)" per `PROGRESS-LEDGER.md`'s own T-32 description (line 66).
Notably absent from the wizard: **column mapping**, **checks toggles**
(schema/profile/rowCount/rowLevel), **normalization rules**, and any
non-table (`query`/`sqlFile`) source kind. All four require a user to
open the generated `.paritylens` file as plain YAML text and add fields
by hand, guided by nothing but the file itself — no comment scaffolding,
no VS Code snippet/IntelliSense (no `.paritylens` JSON schema is
registered anywhere in `package.json`), and no docs surfaced inside the
product. If a user's source and target column names differ even
slightly (the single most common real-world migration scenario — e.g.
`customer_id` vs `CUSTOMER_ID`), they must discover on their own that a
`column_mapping:` block exists, learn its two supported shapes (`Idea
Prompt.md` section 3's simple map vs. entry-list-with-expressions form),
and hand-type it correctly enough to satisfy `parseDefinition`'s ~15
different `InvalidDefinitionError` throw sites for that one field alone
(`definition.ts` lines 355–398, e.g. `'"column_mapping[${index}].target"
is required and must be a string.'`).

**Why it's a barrier:** This is the single largest gap for the Jr. Data
Analyst persona specifically — the persona brief states they don't know
what YAML is beyond having seen it once, yet the *default*, ship-today
path past the first five minutes requires reading and writing raw YAML
with an error-prone nested structure and no in-editor guidance.

**Phase 5 status:** Directly and substantially addressed — this is
exactly what T-36 (custom editor with Source/Target/Keys/Checks tabs)
and T-37 (SSIS-style Column Mapping tab) are designed to fix. **Not yet
built** — Phase 5's task register shows only T-35a/T-35b (engine-level
groundwork extending `ParitySide`/`buildComparisonYaml` to support the
data shapes) as COMPLETE; T-36–T-39 (the actual editor UI, mapping tab,
SQL preview, CodeLens) have no implementation yet per
`PROGRESS-LEDGER.md`'s task register.

---

### 5. Running a comparison executes real queries against real databases with only a passive, easy-to-miss info toast — no confirmation, no SQL shown before execution

**Persona:** Both, but higher-stakes for Jr. Analytics Engineer running
against anything resembling production-adjacent data.
**Journey step:** `paritylens.runComparison`.

`packages/extension/src/activation/activate.ts`'s `runComparisonCommand`
(lines 228–346) does this, in order: parse the definition, look up saved
connection profiles, call
`deps.showInformationMessage(buildRunNotice(sourceProfile,
targetProfile))` (line 295) — a single `showInformationMessage` toast,
VS Code's least intrusive, auto-dismissing, non-blocking notification
type — and then **immediately** calls `await
runComparison(definition, registry)` (line 307), which begins live
execution against real connectors with no wait for user acknowledgment
of the toast, no explicit "confirm this will run against
[host]/[database]" dialog, and no preview of the SQL about to execute.
The toast text itself
(`MIXED_CONNECTION_NOTICE`, lines 95–98) is also written in
implementation-detail language: *"connection names matching a saved
connection profile run against the real database; any connection name
without a matching saved profile falls back to built-in fixture data...
for this run"* — this assumes the reader already understands the
fixture/real-connector distinction as an engineering concept, which
neither persona would have context for.

**Why it's a barrier:** `DESIGN-SPEC.md` itself names "generated SQL is
shown to the user for preview before execution" as a design requirement
("Security, privacy, and safety" section) — this is not yet honored by
the shipped command. For a Jr. Analyst pointing at even a lightly
protected environment, there is no moment to double-check "wait, is this
about to scan my whole production table?" before it happens.

**Phase 5 status:** Directly addressed by T-38 (`planQueries` dry-run +
blocking pre-execution confirmation UI) — but again, not yet built.
Today's shipped behavior is exactly the gap Phase 5's design document
itself calls out as unaddressed: *"T-16b built a real SQL preview panel
and `queriesUsed` field, but it's only ever populated as a side effect
of the planner's own internal execution, not exposed as a pre-execution
confirmation step"* (design doc, Context section).

---

### 6. Error messages are accurate but written for someone who already knows the engine's internal vocabulary, with no "what to do next"

**Persona:** Both, most acutely Jr. Data Analyst.
**Journey step:** Any failure — malformed YAML, mutating-statement
rejection, bad connection.

Concrete strings pulled from source:

- `packages/engine/src/orchestration/definition/definition.ts` (dozens
  of throw sites, e.g. line 355):
  `` `"column_mapping.${source}" must be a string.` `` — uses the raw
  YAML field-path syntax (`column_mapping.customer_id`) as the subject of
  the sentence, assuming the reader parses that as "look at this key in
  your file," with no line number, no "here's what a correct value looks
  like," and no link back to which part of the UI/file to fix.
- `packages/engine/src/connector-sdk/safety/statement-safety.ts`, the
  `MutatingStatementError` constructor (lines 40–44):
  `` `Statement rejected: mutating keyword "${keyword}" is not permitted
  for read-only dialect "${dialect}". Offending statement:
  ${statement.trim().slice(0, 200)}` `` — accurate and even prints the
  offending SQL, but "dialect", "mutating keyword", and the whole framing
  assume the reader already knows this is a *safety* feature working as
  intended, not a bug. A Jr. Analyst who wrote a query with an innocuous
  `EXEC` (e.g. calling a stored procedure they assumed was read-only)
  gets no guidance that this block is deliberate and how they might
  restructure the query.
- `activate.ts`'s outer catch (line 343):
  `` `ParityLens: run comparison failed — ${message}` `` — this simply
  wraps whatever `Error.message` the underlying failure produced
  (including raw driver errors from `mssql`/`pg` for a real connection
  failure) with no translation layer at all. A real SQL Server auth
  failure would surface its native driver error text verbatim inside a
  VS Code error toast.

**Why it's a barrier:** None of these messages suggest a next action
("check your `column_mapping` block's target field," "this query
contains a stored-procedure call which ParityLens blocks by design —
rewrite it as a SELECT," "verify the host/port/credentials for this
connection profile"). They report *what* is wrong in engineering terms,
never *what to do about it*.

**Phase 5 status:** Not addressed. Phase 5's own Error Handling section
explicitly defers to "the same Layer-1 connectivity-failure path
`DESIGN-SPEC.md` already defines" and validation "mirroring
`parseDefinition`'s own required-field rules" — i.e., it inherits these
exact same raw messages rather than rewriting them for a non-engineer
audience. The custom editor (T-36) does add *client-side* inline
validation before Apply, which would catch some malformed-definition
cases earlier and with tab/field context — a partial improvement — but
the underlying message text is not redesigned.

---

### 7. Results webview presents severity-tagged, engineering-shaped diff tables with no explanation of what "Compatible"/"Review"/"Risk" or a schema/profile "difference" means or implies for action

**Persona:** Jr. Data Analyst (primary); Jr. Analytics Engineer (lesser,
since they'd likely infer meaning from SQL/dbt-adjacent experience).
**Journey step:** Reading results after a run.

`packages/extension/src/webview/resultsWebview.ts` renders five tabs
(Schema/Profile/Volume/Row-Level/SQL Preview per T-34) as literal data
tables: the Schema section's columns are `Severity | Column | Kind |
Source Type | Target Type | Message` (line 397), directly surfacing
engine-internal field names (`kind`, the `SchemaDifference` discriminant
value itself, e.g. values like `"type-mismatch"` or similar
`d.kind` strings) with no header tooltip, legend, or explanation
anywhere in the webview of what severities mean in terms of "should I
be worried" or what action to take for a given `kind` of difference.
The type-mapping layer's `Compatible`/`Review`/`Risk` classification
(`Idea Prompt.md` section 2, `packages/engine/src/comparison-core/
type-mapping`) maps internally to `Severity` values (`schema-diff.ts`
line 72: `Risk: "Failure"`) but that translation is invisible in the UI
— a user just sees a colored "Failure" tag with no link to "this means
the two platforms' types are considered fundamentally
incompatible, not just cosmetically different." Similarly, the Row-Level
tab's category labels (`CATEGORY_LABELS`, lines 113–122, e.g.
`"matched-key-differing-values"` → `"Matched key, differing values"`)
are clearer, but the underlying `message` field for each row
(`d.message`, rendered verbatim at line 515/530) is whatever free-text
string the comparison-core layer generated — again engineering-voiced,
e.g. the schema-diff messages quoted in Finding 6 above use identical
phrasing (`` `Column "${source.name}": nullable=${source.nullable}
(source) vs nullable=${target.nullable} (target).` ``) whether shown in
an error or a results row.

**Why it's a barrier:** A Jr. Data Analyst can read a table of
"Severity: Failure, Column: CreditLimit, Kind: type-mismatch, Message:
..." but has no in-product guidance on whether that's something they
fix in their own query, escalate to an engineer, or accept as expected
migration noise. The product's fundamental value proposition (per `Idea
Prompt.md` section 17 — "A migration needs an auditable definition of
what 'equal' means") depends on a human being able to *judge* differences,
but the UI gives them a raw data dump with severity color-coding and
nothing else to reason with.

**Phase 5 status:** Not addressed at all — Phase 5's explicit Non-goals
section states "Run History and Differences tabs inside the editor... —
reviewing past runs/results continues to happen via the existing results
webview," i.e. Phase 5 deliberately leaves `resultsWebview.ts` untouched.
This is a genuinely new, unaddressed gap.

---

### 8. Fixing a mistake (wrong column mapping, wrong object) means re-opening the same blind YAML edit path — no guided "what changed, what does it fix" loop

**Persona:** Both.
**Journey step:** Recovery after seeing a schema/row-level finding
caused by a mapping or object mistake.

There is no "jump to source" affordance anywhere: results in
`resultsWebview.ts` are read-only HTML (`enableScripts: false`,
confirmed by the file's own header comment) with no click-through back
to the `.paritylens` file, no "edit this comparison" button, and no
CodeLens yet (T-39, unbuilt). A user who sees a `missing_target_column`
finding caused by a mistyped `column_mapping` entry must: recall which
file produced the run (the results panel's title/meta line is the only
clue — T-34's own disclosed limitation, T-34-02, notes "header meta line
omits the `source→target` object segment," per `PROGRESS-LEDGER.md` line
68), manually locate and reopen that `.paritylens` file via the
Comparisons tree section or file explorer, hand-edit the YAML again with
the same lack of guidance as Finding 4, save, and re-invoke
`paritylens.runComparison` via the open-file-dialog flow (there is no
"re-run this exact file" button from the results webview itself — only
from the tree view's Comparisons section, a different UI surface
entirely).

**Why it's a barrier:** The edit-run-review loop that is the whole point
of an iterative parity tool has no closed loop in the product today —
every step requires switching between three disconnected UI surfaces
(tree view, plain-text YAML editor, results webview) with no
cross-navigation between them.

**Phase 5 status:** Partially addressed. T-39's CodeLens gives an
"Open Last Result" action from inside the file, and T-36's custom editor
gives a friendlier place to fix the mistake once found — but neither
closes the reverse link (results webview → back to the authoring
surface for the file that produced it). This reverse link is not named
anywhere in the Phase 5 design's Non-goals or Goals sections, so it's an
uncovered residual gap even after Phase 5 ships.

---

### 9. Fixture-vs-real-connector ambiguity is silently possible and only disclosed via a toast a user could easily dismiss/miss

**Persona:** Jr. Analytics Engineer, moderate risk (would understand the
concept if flagged clearly); Jr. Data Analyst, higher risk (may not
register the distinction at all).
**Journey step:** Running a comparison whose connection name doesn't
exactly match a saved profile.

`buildFixtureRegistry`/`buildConnectorRegistry` (`activate.ts`, lines
123–194) silently fall back to `FixtureConnector` (canned demo data) for
*any* connection name that doesn't exactly match a saved
`ConnectionProfile.name` — a typo in the YAML's `source.connection`
value produces no error at all, just a quiet swap to fixture data, with
the only signal being the passive `MIXED_CONNECTION_NOTICE`/
`FIXTURE_ONLY_NOTICE` toast text discussed in Finding 5. A user could
run what they believe is a real comparison, see a clean "Passed" result,
and never realize they were actually comparing two slices of the
built-in `sqlserver-customer` demo fixture.

**Why it's a barrier:** This is a correctness trap disguised as a
convenience feature (the fixture fallback exists deliberately, per
T-22/T-30's design, so the demo command always works) — but nothing
distinguishes "intentional fixture demo" from "accidental typo" for the
user at the point of failure.

**Phase 5 status:** Not addressed — not mentioned anywhere in the Phase
5 design document. Genuinely new gap.

---

## Ranked by impact

Ordered by how early in a realistic solo journey each gap would stop a
Jr. Data Analyst or Jr. Analytics Engineer cold:

1. **Finding 1 (no onboarding) + Finding 2 (command-palette-only
   discovery)** — combined, this is the very first moment of contact.
   Neither persona has any in-product signal of what to click or type
   first. The Jr. Data Analyst persona in particular is likely to stop
   here entirely, since "figure out VS Code's command palette
   unprompted" is itself outside their stated comfort zone.

2. **Finding 4 (hand-authoring YAML past the minimal scaffold)** — the
   first realistic comparison almost always needs column mapping (source
   and target column names essentially never match exactly across
   platforms per the product's own stated use cases). This is where the
   Jr. Data Analyst persona's "doesn't know what YAML is" ceiling is hit
   hardest, and even the Jr. Analytics Engineer persona — YAML-literate
   but with zero context on this specific schema — would need to
   reverse-engineer the format from `Idea Prompt.md`/source rather than
   the product itself. This is Phase 5's single biggest addressed item
   (T-36/T-37), but it's not built yet.

3. **Finding 5 (no pre-execution confirmation/SQL preview)** — a
   trust/safety gap more than a comprehension gap: both personas can
   technically get past this (the run just happens), but it's the point
   where "self-service" tips into "self-service without a safety net,"
   which matters most for the Jr. Analytics Engineer persona running
   against anything beyond a sandbox. Also the one finding explicitly
   named as a still-open `DESIGN-SPEC.md` requirement, not just a UX
   nicety.

4. **Finding 7 (results not actionable for a non-engineer)** — even if a
   user gets a comparison running successfully, this is where the tool's
   entire value proposition (making an informed judgment about parity)
   breaks down for the Jr. Data Analyst persona specifically. Notably
   the one finding Phase 5 does **not** touch at all.

5. **Finding 6 (engineer-voiced error messages) + Finding 3 (no
   connection-test feedback)** — both are "the tool works, but recovery
   from any mistake requires interpreting text written for engineers."
   Lower in this ranking only because they occur after a user has
   already cleared gaps 1–2, meaning by the time they hit these, they've
   demonstrated enough persistence/comfort to likely puzzle through
   error text with some trial and error — but still a real ceiling,
   especially for the Jr. Data Analyst persona, and one Phase 5's design
   explicitly does not rewrite.
