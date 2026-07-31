# ParityLens — Task Brief T-12

## Objective

Implement column mapping (automatic suggestion by exact/case-insensitive/
snake-camel/ordinal matching, per `Idea Prompt.md` section 3) and
normalization rules (trim, case, whitespace collapse, numeric tolerance,
date truncation/timezone, null equivalents, per `Idea Prompt.md` section 4).

Note to whoever dispatches an implementer against this brief: when briefing
the implementer, quote this document's load-bearing requirements verbatim
rather than paraphrasing them. A paraphrase that loosens a requirement (for
example, turning a required field into an offhand "nice to have if there's
time") is a known failure mode — the implementer treats the paraphrase as
authoritative and a real requirement quietly drops. If a dispatch prompt
must summarize this brief for brevity, it should still point back to this
file as the sole authority wherever the two could be read to disagree.

## Dependencies

- **Required completed tasks:** T-09 (orchestration planner). COMPLETE and
  APPROVED per `PROGRESS-LEDGER.md`. (T-08's `NormalizationRule` and
  `ColumnMappingEntry` types, which this task consumes, already exist and
  are also COMPLETE/APPROVED.)
- **Required decisions or approvals:** NONE beyond the already-approved
  `IMPLEMENTATION-PLAN.md` row for T-12.

## Files owned

- `packages/engine/src/comparison-core/mapping/**`
- `packages/engine/src/comparison-core/normalization/**`

Do not touch `packages/engine/src/orchestration/definition/definition.ts`
(T-08's owned file, defines `NormalizationRule`/`ColumnMappingEntry` that
this task consumes read-only) or any other `comparison-core/*` sibling
directory (`type-mapping/`, `schema-diff/`, `profiling/` — each owned by
its own completed task).

## Interfaces

| Direction | Interface | Contract | Producer or consumer |
| --- | --- | --- | --- |
| Consumed | `ColumnDefinition[]` (`packages/shared/src/types.ts`) | Full shape: `name`, `ordinalPosition`, `nativeType`, `canonicalType`, `nullable`, `isPrimaryKeyCandidate`, optional `length`/`precision`/`scale`. Source and target sides each produce their own array via a connector's `getSchema()`. | T-02 |
| Consumed | `NormalizationRule` (`packages/engine/src/orchestration/definition/definition.ts`) | `{ trim?, caseSensitive?, collapseWhitespace?, numericTolerance?: {absolute?, percentage?}, timezone?: {source, target}, truncateTo?, nullEquivalents?: string[] }` — every field optional, a rule may combine any subset. This is the existing, already-implemented shape from T-08; consume it as-is, do not redefine or duplicate it. | T-08 (producer of the type) |
| Consumed | `ColumnMappingEntry` (same file) | Discriminated union: `{source, target}` (plain rename) or `{name, target, sourceExpression?, targetExpression?}` (derived mapping). T-12's `suggestMappings` produces *suggestions*, distinct from this type, which represents a user-authored/approved mapping already present in a `ParityDefinition`. Do not conflate the two — see Prohibited changes. | T-08 (producer of the type) |
| Produced | `suggestMappings(source: ColumnDefinition[], target: ColumnDefinition[]): MappingSuggestion[]` | For each source column, suggests zero or one best-candidate target column using, in order of preference per `Idea Prompt.md` section 3: exact name match, case-insensitive match, snake_case↔camelCase equivalence, then ordinal position as a last-resort fallback. Each suggestion must report which strategy matched (so a caller/UI can show *why* a mapping was suggested) and must not silently auto-apply — per the idea doc, "Users must be able to approve, reject, or manually edit every mapping," meaning this function only proposes, it never mutates a `ParityDefinition`. Worked example from the idea doc to validate against literally: `customer_id → CUSTOMER_ID` (exact, case-insensitive), `cust_nm → CUSTOMER_NAME` is explicitly called out as *not* achievable by simple matching (abbreviation expansion is out of scope — do not attempt fuzzy/abbreviation matching; only implement the four listed strategies), `created_dt → CREATED_TIMESTAMP` (also abbreviation-based, expect no confident match), `active_ind → IS_ACTIVE` (also abbreviation-based, expect no confident match). Prove the exact/case-insensitive/snake-camel cases work correctly rather than claiming the abbreviation cases "mostly work" — they don't, and shouldn't. | T-16 (consumes for a future mapping-approval UI, unscheduled) |
| Produced | `applyNormalization(value: unknown, rule: NormalizationRule): unknown` (or an equivalent name — document your exact choice in the report) | Applies exactly the rule fields present on `NormalizationRule` to a single value, returning the normalized value for comparison purposes only. Must implement, at minimum: `trim`, `caseSensitive: false` (case-fold strings), `collapseWhitespace`, `numericTolerance` (used at comparison time, not as a value transform — document how your implementation exposes this, e.g. a separate `valuesEqualWithinTolerance` helper, since tolerance is inherently a two-value comparison, not a single-value transform), `truncateTo` (date truncation, e.g. `"second"`), `timezone` conversion, and `nullEquivalents` (treat any value in the list as equivalent to null for comparison purposes). Match the idea doc section 4 worked example's rule shapes exactly (`customer_name: {trim, case_sensitive: false, collapse_whitespace: true}`, `order_amount: {numeric_tolerance: {absolute: 0.01}}`, `created_timestamp: {timezone: {source, target}, truncate_to: "second"}`, `cancellation_date: {null_equivalents: [...]}`). | T-13 (volume parity, tolerance evaluation), T-14 (row-level parity, applies normalization before comparing) |

## Prohibited changes

- **Normalization must never mutate source or target data.** `Idea
  Prompt.md` section 4 states explicitly: "These transformations should
  apply only in the comparison engine. They should never alter the
  underlying data." `applyNormalization` must be a pure function returning
  a new normalized value for comparison purposes, never writing back to
  any connector, record, or persisted structure. This is the reviewer's
  primary scrutiny target — see Handoff below.
- Do not modify `packages/engine/src/orchestration/definition/definition.ts`
  — `NormalizationRule` and `ColumnMappingEntry` are T-08's owned types;
  T-12 consumes them read-only. If a genuine gap is found (a field this
  task needs but the type doesn't have), stop and flag it as a blocker
  rather than editing T-08's file.
- Do not implement AI-assisted/semantic mapping suggestions — `Idea
  Prompt.md` section 14 explicitly excludes "AI-generated mappings" from
  MVP scope.
- Do not implement abbreviation/prefix/suffix-removal matching (e.g.
  `cust_nm` → `CUSTOMER_NAME`) — only the four strategies named in this
  brief's Interfaces table (exact, case-insensitive, snake-camel, ordinal)
  are in scope; profile-similarity and value-overlap matching (also listed
  in the idea doc as possible future strategies) are likewise out of scope
  for this task.
- Do not touch `packages/extension/**` — T-12 is engine-only.
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Test or check to add:** A mapping-suggestion test asserting
  `suggestMappings` proposes `customer_id → CUSTOMER_ID` (case-insensitive
  exact match) for a fixture pair of `ColumnDefinition[]` arrays — must
  fail because `suggestMappings` doesn't exist yet. A second, separate
  red-state case for normalization: a test asserting
  `applyNormalization("  Alice  ", {trim: true, caseSensitive: false})`
  equals `"alice"` — must fail because `applyNormalization` doesn't exist
  yet.
- **Command:** `npx vitest run packages/engine/src/comparison-core/mapping packages/engine/src/comparison-core/normalization`
- **Expected failure reason:** Module resolution failure — neither
  directory exists yet under `packages/engine/src/comparison-core/`.
- **Captured output:** Paste the actual failing command output and exit
  code into `IMPLEMENTATION-REPORT.md`, not a paraphrase.

## Green-state and full verification

- **Focused command:** `npx vitest run packages/engine/src/comparison-core/mapping packages/engine/src/comparison-core/normalization`
- **Full command:** `npm run verify`
- **Expected evidence:** Both red-state cases pass; the full worked example
  from `Idea Prompt.md` section 3 (`customer_id → CUSTOMER_ID`) and section
  4 (`customer_name`, `order_amount`, `created_timestamp`,
  `cancellation_date` rules) are each exercised by at least one test with
  the exact literal values from those examples; the previously-passing 298
  tests (per `PROGRESS-LEDGER.md`'s T-11 entry) still pass with no
  regression; `npm run verify` exits 0.

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md`
- **Independent reviewer:** `reviewer` subagent (separate instance from
  whichever `implementer` subagent does this task)
- **Review report location:** `REVIEW-REPORT.md`
- **Commit or patch checkpoint:** Branch `task/T-12-mapping-normalization`

**Note to reviewer:** scrutinize hardest whether `applyNormalization` (or
whatever it's named) has any code path that writes back to a connector,
mutates the input `ColumnDefinition`/record objects in place, or otherwise
alters anything outside its own return value — per
`IMPLEMENTATION-PLAN.md`'s T-12 review-gate column, "confirms normalization
never mutates source data, only comparison-time values." Construct a
concrete adversarial case (e.g. pass an object/array value through
normalization and assert the original reference is unchanged afterward) 
rather than accepting a code-read alone. Also verify `suggestMappings`
genuinely does NOT propose a mapping for the abbreviation-based idea-doc
examples (`cust_nm`, `created_dt`, `active_ind`) — a false-positive
"confident" match on those would contradict the brief's explicit scope
boundary.
