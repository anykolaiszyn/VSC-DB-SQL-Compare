# REVIEW-REPORT.md — T-48: results webview source/target header line

## Review independence statement

This review was performed by a separate reviewer agent instance with no
memory of authoring the implementation under review. All findings below are
based on direct inspection of the actual diff, direct reading of the current
source, my own independently re-run verification commands, and adversarial
probes I constructed myself — not on trusting IMPLEMENTATION-REPORT.md's
claims. Every claim in that report that could be independently checked was
checked.

## Scope reviewed

- `TASK-BRIEF.md` (T-48, resolving finding T-34-02) at repo root.
- `IMPLEMENTATION-REPORT.md` at repo root.
- Full diff `main..task/T-48-results-webview-header-line`.
- Current source of all 5 owned files plus `PROGRESS-LEDGER.md` for
  T-34-02's original recorded text.
- Fresh `npm run verify` run by this reviewer.

## Findings

### Critical

NONE.

### Important

NONE.

### Minor

| ID | Finding | Evidence | Suggested resolution |
| --- | --- | --- | --- |
| T-48-01 | `deriveSideLabel`'s `sqlFile` branch falls back to the full `filePath` string (not the leading-separator-stripped last segment) when `filePath` ends in a path separator (e.g. `"C:\Users\alex\secrets\"` or `"/home/alex/secrets/"`), because `split` produces a trailing empty string and the `|| side.filePath` fallback then returns the untouched original path — which does leak a full local filesystem path into the header for this one degenerate input shape. | Reproduced by hand: `"/home/alex/secrets/".split(/[/\\]/)` → last segment `""` → falls through to `side.filePath` → `"/home/alex/secrets/"` verbatim. Not exercised by any test in `planner.test.ts` (all three sqlFile-kind tests there use a `filePath` with a real trailing filename, e.g. `source.sql`). | Low severity: `filePath` for `kind: "sqlFile"` is expected to reference a `.sql` file per the type's own contract, so a definition author providing a bare directory path is a malformed definition, not a realistic path through this UI. No user-supplied untrusted string reaches this code (`filePath` is authored by whoever writes the parity YAML — the same person who can already see their own filesystem). Does not block approval; worth a one-line follow-up (`return segments[segments.length - 1] || segments[segments.length - 2] || side.filePath`, or just accept and document the edge case) whenever this code is next touched. |

## Disposition of prior findings this task was meant to resolve

**T-34-02** (OPEN, non-blocking cosmetic, per `PROGRESS-LEDGER.md`): "the
results webview's header meta line omits the `source object → target
object` segment." I independently reproduced the original gap by reading
`main`'s pre-T-48 `resultsWebview.ts` (no `sourceLabel`/`targetLabel`
handling, no segment in the header) and confirmed the fix by rendering the
header both with and without the new fields present (see Verification
below). **Genuinely resolved** — the header now renders `Run <runId> ·
source→target · duration` when both labels are present, and omits the
segment cleanly (no dangling separator, no literal `"undefined"`) when
either or both are absent, including for runs replayed from pre-T-48
persisted JSON (`sourceLabel`/`targetLabel` naturally `undefined` on old
records, exactly as the brief's Prohibited Changes section anticipated).

## Verification performed (independent, by this reviewer)

1. **Scope/ownership check.** `git diff --stat main..task/T-48-results-webview-header-line`
   shows exactly: `IMPLEMENTATION-REPORT.md`, `TASK-BRIEF.md`,
   `packages/engine/src/orchestration/planner/planner.test.ts`,
   `packages/engine/src/orchestration/planner/planner.ts`,
   `packages/extension/src/webview/resultsWebview.test.ts`,
   `packages/extension/src/webview/resultsWebview.ts`,
   `packages/shared/src/result.ts` — the 5 declared owned files plus the
   two handoff docs, nothing else. `packages/shared/src/result.ts`'s diff
   is a pure 18-line addition at the end of the `ComparisonResult`
   interface (two new optional fields plus doc comments) — no
   `DifferenceItem`-derived shape (`SchemaDifference`/`ProfileDifference`/
   `AggregateDifference`/`RowDifference`) touched. `activate.ts` not in the
   diff, confirmed.
2. **Additive-only widening check.** Read the full `result.ts` diff:
   `sourceLabel?: string` / `targetLabel?: string`, both optional, added
   after the existing `queriesUsed?: string[]` field, no existing field
   modified. Grepped the whole `packages/` tree for `ComparisonResult`
   object-literal construction sites (14 files reference the type); none
   outside the 2 changed construction sites in `planner.ts` were touched,
   and a fresh `tsc -b --force` (below) passed clean across the whole
   monorepo, which would have failed immediately had the widening been
   non-optional and any existing literal needed updating.
3. **Header composition trace.** Read the exact spliced markup in
   `resultsWebview.ts`:
   ```
   <span>Run ${runId}</span>
   <span class="meta-sep">&middot;</span>
   ${renderSourceTargetSegment(result)}
   <span>${duration}</span>
   ```
   `renderSourceTargetSegment` returns `""` when either label is
   `undefined`, or `<span>src&rarr;tgt</span><span class="meta-sep">…</span>`
   (with its own trailing separator) when both are present. Traced by
   hand:
   - **Present case:** `Run <id>` + sep + `[src→tgt span + sep]` + duration
     span → renders as `Run <id> · src→tgt · duration`. One separator
     between each of the three segments, no double separator.
   - **Absent case:** `Run <id>` + sep + `""` + duration span → renders as
     `Run <id> · duration`. No dangling/orphaned separator, no missing
     separator — the pre-existing separator after `Run <id>` correctly
     serves as the sole separator between the two remaining segments.
   Confirmed against the actual rendered HTML via
   `resultsWebview.test.ts`'s new ordering assertion (`runIndex <
   segmentIndex < durationIndex`) and the omission tests, all passing.
4. **`deriveSideLabel` correctness and path-leak check**, adversarially
   probed independently (this review runs on Windows, so I tested both the
   "native" backslash-style path and the "wrong" forward-slash style, plus
   a mixed-separator case) by re-implementing the exact function in an
   isolated Node script and running it directly (script deleted after use;
   `git status --short` confirmed clean afterward):
   ```
   "C:\Users\alex\secrets\customers.sql" -> "customers.sql"
   "/home/alex/secrets/customers.sql"    -> "customers.sql"
   "customers.sql"                        -> "customers.sql"
   "mixed/style\path/customers.sql"       -> "customers.sql"
   "C:\Users\alex\secrets\"               -> "C:\Users\alex\secrets\"   (see T-48-01)
   "/home/alex/secrets/"                  -> "/home/alex/secrets/"     (see T-48-01)
   ```
   Base-filename-only extraction confirmed correct and OS-separator-agnostic
   for realistic inputs (a `filePath` ending in an actual filename, which is
   the only shape the `sqlFile` `QueryInput` kind is meant to carry). The
   one degenerate edge case (trailing separator, no filename) is recorded
   as Minor finding T-48-01 above — no `.sql`-file-authoring workflow
   produces this input, so it does not block approval.
   `table`-kind and `query`-kind branches read correctly: `table` uses
   `side.object` verbatim (already short/meaningful, e.g.
   `"dbo.Customer"`); `query` uses a fixed `"(custom query)"` placeholder,
   never the SQL text itself.
5. **`escapeHtml` coverage / XSS probe.** Confirmed both new interpolations
   (`resultsWebview.ts` line ~366) go through `escapeHtml(result.sourceLabel)`
   and `escapeHtml(result.targetLabel)`, identically to every other
   interpolated value in the file. `escapeHtml`'s implementation
   (line 62) escapes `&`, `<`, `>`, `"`, and `'`. The implementer's own
   test constructs `sourceLabel: "<script>alert(1)</script>"` and asserts
   the raw string is absent and the escaped form
   (`&lt;script&gt;alert(1)&lt;/script&gt;`) is present — I re-ran this
   test myself (below) and additionally reasoned through a quote-breakout
   attempt (e.g. `sourceLabel: "\" onmouseover=\"alert(1)"`): `escapeHtml`
   converts `"` to `&quot;`, and the interpolation site
   (`<span>${escapeHtml(...)}</span>`) places the value inside element text
   content, not inside an HTML attribute, so a quote-breakout payload has
   no attribute context to break out of even before escaping — no
   plausible bypass found.
6. **Layer-1 short-circuit path scope check.** Read `runComparison`'s two
   `buildFailedResult` call sites (planner.ts lines 193 and 220): both are
   inside `runComparison(definition: ParityDefinition, ...)` with
   `definition` captured by closure, confirming `definition.source`/
   `.target` are genuinely in scope at both call sites, not merely assumed
   to be. `buildFailedResult`'s own diff shows `sourceLabel`/`targetLabel`
   populated via `deriveSideLabel(definition.source)`/
   `deriveSideLabel(definition.target)` unconditionally on that path. The
   implementer's new planner test
   (`"populates sourceLabel/targetLabel on the Layer-1 connectivity-failure
   short-circuit path..."`) exercises the missing-connector-registration
   branch specifically and asserts both labels populate on a
   `status: "failed"` result — re-ran this test myself (below), passed.
7. **Fresh full verification**, run independently by this reviewer:
   ```
   npm run verify
   ```
   Result: `tsc -b --force` clean (no output, exit 0); `eslint .` clean;
   `vitest run` → **34 test files passed, 2 skipped (36 total); 615 tests
   passed, 27 skipped (642 total)**. This matches
   IMPLEMENTATION-REPORT.md's claimed numbers exactly. Independently
   cross-checked the claimed baseline (606 passed) by counting `it(`
   occurrences in `main`'s pre-T-48 versions of the two test files: 16 in
   `resultsWebview.test.ts` (+5 new = 21, matches the file's reported
   21/21) and 22 in `planner.test.ts` (+4 new = 26, matches the file's
   reported 26/26); 606 + 9 = 615 reconciles exactly with the fresh run.
8. **Residue check.** The only throwaway artifact created during this
   review was a temporary Node script in the session scratchpad directory
   (outside the repo), deleted before finishing;
   `git status --short` in the repo shows no uncommitted changes beyond
   this report.

## Final disposition

**APPROVED.**

Zero Critical, zero Important findings. One Minor finding (T-48-01,
degenerate trailing-separator edge case in `deriveSideLabel`'s `sqlFile`
branch) does not block approval — it has no realistic trigger given the
`sqlFile` `QueryInput` kind's own contract (a definition author supplying a
bare directory path with no filename is a malformed definition, not a
normal input), and is recorded here for optional cleanup whenever
`deriveSideLabel` is next touched.

All five re-verification points from TASK-BRIEF.md's Handoff section
confirmed independently: (1) the `ComparisonResult` widening is genuinely
additive/optional; (2) no difference-array shape was touched; (3) the
header segment is correctly omitted (no literal `"undefined"` text) when
either label is absent, on both the main-run and Layer-1 short-circuit
paths; (4) `escapeHtml` covers both new interpolations; (5) a fresh full
`npm run verify` is green and matches the claimed 615/27/642 counts, up
from the independently-reconstructed 606/27/633 baseline.

Finding T-34-02 is genuinely resolved.
