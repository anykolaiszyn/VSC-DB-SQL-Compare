# ParityLens — Review Report T-31 (Result Store)

## Review independence statement

I am a separate reviewer instance from the implementer of this task. I have
no memory of writing this code. All findings below come from my own
inspection of the diff (`db169fc`, `f7fb004` on `task/T-31-result-store`
against `main`), my own execution of the verification commands, and my own
constructed adversarial test cases (subsequently deleted — confirmed via
`git status`). I did not take `IMPLEMENTATION-REPORT.md`'s claims at face
value; every claim below marked "confirmed" was independently re-derived.

## Scope reviewed

- `TASK-BRIEF.md` (T-31, sole scope authority) — read in full.
- `IMPLEMENTATION-REPORT.md` — read in full, treated as claims to verify,
  not fact.
- Diff `main..task/T-31-result-store`:
  - `packages/extension/src/runHistory/runHistory.ts` (new, 189 lines)
  - `packages/extension/src/runHistory/runHistory.test.ts` (new, 92 lines)
  - `IMPLEMENTATION-REPORT.md` (overwritten, expected per-task pattern)
- `packages/extension/src/export/writeExport.ts` and `exporters.ts` (read,
  unmodified — confirmed via `git diff main..task/T-31-result-store --
  packages/extension/src/export/ packages/engine/ packages/shared/`,
  which produced empty output).
- `DESIGN-SPEC.md` (Architecture table line 72, Data Flow step 5, "Write
  safety" principle lines 122-123), `IMPLEMENTATION-PLAN.md` (T-31/T-33
  rows), `PROGRESS-LEDGER.md` (current state, T-30 precedent).

## Scope and ownership check

Only files under `packages/extension/src/runHistory/**` plus
`IMPLEMENTATION-REPORT.md` changed. `packages/extension/src/export/**`,
`packages/engine/**`, `packages/shared/**` are byte-identical to `main`
(confirmed by an explicitly-scoped empty `git diff`). No wiring into
`activate.ts`, tree view, or status bar (confirmed by `git diff --stat`
showing no other files touched). **No scope violations.**

## Judgment call 1 — `RunSummary` vs. literal `RunRecord[]`

`TASK-BRIEF.md` §3 states verbatim: *"Implement `listRecentRuns(...):
Promise<RunRecord[]>` (or a lighter summary type if reading full
`ComparisonResult` bodies for every listed run is wasteful — your call,
document it)."* This is a genuine, explicit authorization in the Scope
section to deviate from the literal `RunRecord[]` return type stated later
in the brief's own "Interfaces produced" section (and echoed verbatim in
`IMPLEMENTATION-PLAN.md`'s T-31 row). The report is correct that these two
sections of the brief are in tension, and correct that Scope's explicit,
reasoned invitation is the more authoritative signal — it is where the
brief actually reasons about the tradeoff, whereas the Interfaces-produced
table reads as short-form restatement.

Verified in code: `RunSummary = Omit<RunRecord, "result">`
(`runHistory.ts` line 34), returned by `listRecentRuns`, with a doc comment
(lines 22-33) explaining the tradeoff (avoiding reading/parsing every full
`ComparisonResult` body, including potentially large row-difference
arrays, just to render a name/timestamp list) and pointing to `loadRun` as
the mechanism for retrieving a full body on demand. This is honestly
documented, not silently substituted. **Accepted, not a finding** — the
brief authorized this and the deviation is disclosed both in code comments
and in the implementation report.

## Judgment call 2 — duplicated path-containment expression

Claim: `writeExport.ts` exposes no standalone path-resolution/containment
function separate from the coupled read+write `writeExport`, so `loadRun`
cannot import a shared helper and instead mirrors the identical expression.

**Verified.** `grep -n "^export" packages/extension/src/export/*.ts` shows
exactly three exports: `exportToCsv`, `exportToJson`, `exportToMarkdown`
(pure, in `exporters.ts`) and `writeExport` (the only I/O-performing
export, in `writeExport.ts`). No standalone containment-check function
exists to import. The claim is accurate, and the brief's own Prohibited
Changes section (T-31 may not modify `packages/extension/src/export/**`)
forecloses extracting one as part of this task.

**Byte-for-byte comparison of the two expressions**, done directly rather
than trusting the report's "verified word-for-word" claim:

`writeExport.ts` lines 31-32:
```
const rel = relative(resolvedRoot, resolvedTarget);
const escapesRoot = rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
```

`runHistory.ts` lines 91-92:
```
const rel = relative(resolvedRoot, resolvedTarget);
const escapesRoot = rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
```

Identical, character for character, including the resolution pattern one
line above each (`resolve(safeOutputRoot, targetPath)` / `resolve(id...)`
against `resolve(safeOutputRoot)` as root). No divergence found.

**Adversarial probing.** I wrote a temporary test file
(`packages/extension/src/runHistory/_adversarial.test.ts`, deleted after
use — confirmed clean via `git status --short` post-cleanup) covering
cases beyond the implementer's own two escape tests:

| Case | Input | Result |
| --- | --- | --- |
| Empty id → root itself (`rel === ""`) | `loadRun("", tempRoot)` | Rejected (throws) |
| Sibling-directory-prefix trick (`/base/bar` root, `/base/barEVIL` target — a classic string-prefix-check bypass) | `loadRun("../barEVIL/secret", tempRootAtBar)` | Rejected (throws) — confirms containment uses `path.relative`, not a naive `startsWith` string check, exactly as documented |
| Backslash-style traversal | `loadRun("..\\..\\etc\\passwd", tempRoot)` | Rejected (throws) |
| Non-`..`-literal traversal variant | `loadRun("....//....//etc/passwd", tempRoot)` | Rejected (throws — resolves to a literal `....` named entry outside root via `..` collapsing, still caught) |

All four passed (rejected as expected); test run output: `4 tests`, `1
passed (1)` file, `4 passed (4)`. No path-escape bypass found in either
direction — `resolveRecordPath` neither over-rejects legitimate cases (the
implementer's own byte-for-byte round-trip and two-runs tests pass) nor
under-rejects adversarial ones.

**Disposition:** the duplication is real but faithful, disclosed, and
adversarially confirmed non-divergent. No finding.

## Immutability check (brief Handoff item a)

`persistRun` (lines 116-130) always constructs a fresh filename via
`buildIdStem`, which embeds an ISO millisecond timestamp plus a random
6-character base36 suffix (`Math.random().toString(36).slice(2, 8)`).
Traced every call site: `persistRun` is the only function that writes
(via `writeExport`); `loadRun` and `listRecentRuns` only read
(`readFile`/`readdir`). There is no update/overwrite path anywhere in the
module — no function takes an existing `id` and rewrites its content. Two
back-to-back `persistRun` calls with the same `comparison` name (the
implementer's own third required test, and a case I re-ran independently)
produced two distinct ids and two distinct files, both independently
loadable. The random suffix closes the theoretical same-millisecond
collision gap the brief flagged as acceptable to leave undocumented-but-flagged;
here it's actually closed rather than merely documented, which exceeds the
brief's minimum bar without adding lock/retry machinery — a reasonable,
disclosed judgment call, not scope creep. **Confirmed: no code path can
cause one run's record to overwrite another's.**

## `writeExport` reuse check (brief Handoff item b)

`runHistory.ts` line 4: `import { writeExport } from "../export/writeExport";`
Line 127: `await writeExport(targetPath, JSON.stringify(record), safeOutputRoot);`
— genuinely imported and called, not reimplemented. `persistRun` performs
no `fs.writeFile`/`fs.mkdir` calls of its own anywhere in the file (only
`readFile`/`readdir` appear, both exclusively in `loadRun`/
`listRecentRuns`). **Confirmed genuine reuse for the write path.**

## Independent verification performed

```
npm run verify
```
Result: exit 0. `tsc -b --force` clean, `eslint .` clean,
`vitest run`: **26 test files passed, 2 skipped (28 total)**;
**432 tests passed, 27 skipped (459 total)**. This matches
`IMPLEMENTATION-REPORT.md`'s claimed full-verification numbers exactly
(432/27/459, 26/2/28) — no discrepancy between my fresh run and the
report's claim.

```
npx vitest run packages/extension/src/runHistory
```
4/4 tests passed, matching the report's focused-green claim.

Reviewed `runHistory.test.ts` line-by-line against the brief's three
required Green-state tests (byte-for-byte round trip, escape rejection,
no-overwrite-on-collision) — all three present and doing what they claim;
a fourth (ordering) test is additive coverage, not required but
reasonable.

## Findings

### Critical
NONE.

### Important
NONE.

### Minor
NONE. Both disclosed judgment calls (RunSummary vs. RunRecord[], the
duplicated containment expression) were adversarially checked and found
sound, faithful to their justification, and explicitly authorized or
foreclosed-by-brief respectively — they do not rise to findings requiring
follow-up tracking. The `listRecentRuns` silent-skip-on-parse-failure
behavior and shared-directory risk the implementer flagged under "Risks or
limitations" are reasonable, in-scope-for-now design notes correctly
routed to a future task (T-33) rather than defects in this one.

## Disposition of prior findings

No prior findings were opened against T-31 (this is its first review
round); nothing carried forward to re-verify.

## Approval status

**APPROVED**

Rationale: scope is clean (only owned files touched), fresh verification
matches the report's claims exactly, both disclosed judgment calls were
independently checked against the brief text and the actual code (not
trusted from the report's description), the safe-output-root reuse for
writes is genuine, the path-containment duplication for reads is
byte-for-byte identical to `writeExport`'s and survived adversarial
probing with inputs beyond the implementer's own test suite, and record
immutability holds under every traced code path.
