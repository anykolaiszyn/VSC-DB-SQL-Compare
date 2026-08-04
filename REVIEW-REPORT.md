# ParityLens — Review Report T-40

## Review independence

This review was performed by an independent reviewer instance with no
memory of authoring this change. All claims in `IMPLEMENTATION-REPORT.md`
were re-derived from the actual diff and fresh command output rather than
accepted at face value. No implementation-owned file, `TASK-BRIEF.md`, or
`IMPLEMENTATION-REPORT.md` was edited by this review.

## Review scope

- **Task objective:** Add a `contributes.viewsWelcome` entry to
  `packages/extension/package.json` for the `paritylens.dataParityView`
  tree, gated by a new `paritylens.hasNoContent` VS Code context key
  (true iff zero `.paritylens` files AND zero saved connection profiles),
  computed at activation and recomputed after every mutation that can
  change either input.
- **Files and interfaces reviewed:**
  - `packages/extension/package.json` (`contributes.viewsWelcome` diff)
  - `packages/extension/src/activation/activate.ts` (full diff: new
    `HAS_NO_CONTENT_CONTEXT_KEY`, `HasNoContentDeps`,
    `computeHasNoContent`, `refreshHasNoContentContext`, and all wiring
    call sites)
  - `packages/extension/src/activation/hasNoContent.test.ts` (new file,
    read in full, 335 lines)
  - `packages/extension/src/views/parityTreeDataProvider.ts` (to confirm
    `getChildren`'s contract was untouched)
  - `packages/extension/src/connections/connectionProfileStore.ts` /
    `connectionProfile.ts` (to confirm `list()` accessor and
    `ConnectionProfile` shape used correctly, no CRUD logic modified)
- **Evidence reviewed:** `git diff main..task/T-40-onboarding-welcome-view`
  (full, all four changed files), a fresh `npm run verify` run by this
  reviewer, targeted `grep` for `.refresh(` across
  `packages/extension/src`, `grep` of `contributes.commands` for both
  referenced command IDs, `git status`/`git diff --stat` for scope
  confirmation.

## Critical findings

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| NONE | — | — | — |

## Important findings

| ID | Finding | Evidence | Required resolution |
| --- | --- | --- | --- |
| NONE | — | — | — |

## Minor findings

| ID | Finding | Evidence | Suggested resolution |
| --- | --- | --- | --- |
| T-40-01 | No manual VS Code Extension Development Host check was performed to confirm `viewsWelcome` actually renders/hides correctly at runtime; the sole green-state evidence is the `package.json`-shape test. This is explicitly disclosed in both the brief (which anticipates it) and the implementation report, and is a reasonable choice given the automated-test constraint, but it remains an unverified runtime-rendering assumption. | `IMPLEMENTATION-REPORT.md` "Assumptions" section; `hasNoContent.test.ts` lines 160–173 | Track as a follow-up manual smoke check (e.g. next time the extension is run in a dev host) rather than blocking this task; the shape test plus this reviewer's own VS Code `when`-clause syntax check (operator precedence: `==` binds tighter than `&&`, confirmed against VS Code's documented context-key grammar) substantially de-risk it. |
| T-40-02 | `refreshHasNoContentContext` is invoked unconditionally after every `addConnection`/`editConnection`/`deleteConnection`/`newComparison` callback, including on user-cancelled flows where neither input actually changed (e.g. `editConnection` never changes profile count at all). This is intentional per the implementer's own comments ("safe no-op... keeps this call site simple") and is functionally harmless — one extra `findFiles`/`list()` call and one extra `setContext` per command invocation — but is a minor efficiency/precision gap worth noting. | `activate.ts` diff, `registerEditConnectionCommand`/`registerAddConnectionCommand` comments | No action required; acceptable given the low cost and the simplicity benefit of not conditionally branching on each command's internal success/failure. |

## Verification performed

| Check | Exact command or inspection | Result |
| --- | --- | --- |
| Fresh full verification | `npm run verify` (run by this reviewer, not copied from the report) | **Pass** — typecheck clean, lint clean, `637 tests passed`, `27 skipped` (664 total), `35 test files passed`, `2 skipped` (37 total). Matches `IMPLEMENTATION-REPORT.md`'s claimed post-change numbers exactly, and matches the claimed baseline arithmetic (624 baseline + 13 new = 637). |
| AND-logic adversarial probe (case 1: one `.paritylens` file, zero profiles) | Read `hasNoContent.test.ts` lines 132–139 (`computeHasNoContent` unit test) plus manual re-derivation of `computeHasNoContent`'s body (`comparisonFiles.length === 0 && profiles.length === 0`) | **Correctly stays hidden (returns `false`)** — one file makes `comparisonFiles.length === 0` false, short-circuiting the AND to `false` regardless of profile count. Confirmed both by the existing test and by independently re-reading the implementation. |
| AND-logic adversarial probe (case 2: zero files, one profile) | `hasNoContent.test.ts` lines 141–148, cross-checked against `computeHasNoContent`'s body | **Correctly stays hidden (returns `false`)** — symmetric case, `profiles.length === 0` is false. Confirmed. |
| Combined case (one file AND one profile) | `hasNoContent.test.ts` lines 150–157 | **Correctly stays hidden** — this is the test the brief explicitly asks for to rule out an accidental OR; independently re-derived and correct. |
| `when`-clause AND-vs-OR at the VS Code manifest level | `grep '"when"' packages/extension/package.json` → `"view == paritylens.dataParityView && paritylens.hasNoContent"` | Standard VS Code `when`-clause grammar: `==` has higher precedence than `&&`, so this parses as `(view == paritylens.dataParityView) && (paritylens.hasNoContent)` — a genuine AND scoped to the correct view, not an accidental OR or unscoped clause. |
| Both `command:` URIs reference real, registered command IDs | `grep -n '"command"' packages/extension/package.json \| grep -E "addConnection\|newComparison"` → both present at lines 46 and 58 of `contributes.commands` | Confirmed independently (not just trusting the report's own shape-test assertion). `paritylens.addConnection` and `paritylens.newComparison` are both real, pre-existing, already-registered command IDs; no typo. |
| `refresh()` call-site claim (Scope item 3c premise) | `grep -n "\.refresh(" -r packages/extension/src` → only hit is `packages/extension/src/views/parityTreeDataProvider.test.ts:119: provider.refresh();` | **Confirmed independently.** The brief's premise ("`ParityTreeDataProvider.refresh()` is already called after add/edit/delete-connection... elsewhere in the codebase") does not hold — the implementer's disclosure is accurate, not a misreading of the brief. See judgment call below. |
| Coverage of every content-mutating command | Read all `COMMAND_ID` constants and all `register*Command` functions in `activate.ts`; grepped for the only `.paritylens`-file-writing call (`writeFile`, line 751, inside `registerNewComparisonCommand`) | Only five commands exist total (`runComparison`, `addConnection`, `editConnection`, `deleteConnection`, `newComparison`, `reopenRun`). Of these, only the four wired ones can change `computeHasNoContent`'s inputs. `runComparison` requires an *existing* `.paritylens` file (via `showOpenDialog`/tree click) and never creates one — confirmed by reading `runComparisonCommand`'s signature and the only file-write call site being inside `registerNewComparisonCommand`. No unwired mutation path exists. |
| Fire-and-forget activation call — race/uncaught-rejection probe | Read `activate.ts` lines 1004–1013: `void refreshHasNoContentContext(connectionProfileStore).catch(() => undefined);` | No uncaught-rejection risk — the `.catch(() => undefined)` swallows any rejection from `findFiles`/`setContext`. The four command-wrapper call sites use `await` inside the command's own async callback, so any rejection there propagates through the command promise exactly as any other command error already would (not a new pattern introduced by this task). Worst case at activation is a stale/absent context key for one microtask tick, as disclosed — a cosmetic gap, not a functional one, consistent with VS Code's context-key default-falsy behavior. |
| `package.json`-shape test validity | Read `hasNoContent.test.ts` lines 175–241 in full | The test loads the real `package.json` from disk (`readFileSync`, not a fixture copy), asserts exactly one `viewsWelcome` entry targeting the correct view, asserts the exact `when` string, extracts `command:` URIs via regex and cross-references them against the real `contributes.commands` array, and asserts the explanatory-sentence-then-links shape. This is a legitimate proof of manifest shape and command-ID correctness (which is what it claims), not a proof of runtime rendering (which it explicitly disclaims) — no overstatement found. |
| Scope / file-ownership check | `git diff main..task/T-40-onboarding-welcome-view --name-only` | Exactly four files changed: `IMPLEMENTATION-REPORT.md`, `packages/extension/package.json`, `packages/extension/src/activation/activate.ts`, `packages/extension/src/activation/hasNoContent.test.ts`. All within brief's "Files owned" list. No `connections/**` CRUD logic touched, no `ParityTreeDataProvider.getChildren` modification, no new dependency in `package.json` (only `contributes.viewsWelcome` added). |
| Residue check | `git status` | Clean working tree; no throwaway probe files left behind (none were created — all adversarial checks were read-only `grep`/`git diff` inspections). |

## Prior-finding disposition

No prior findings from an earlier review round were assigned to T-40 (this
is this task's first review cycle). The brief's own stated premise for
Scope item 3c ("refresh() is already called elsewhere") is not a prior
finding but a false premise baked into the brief text itself; see judgment
call below rather than a "prior finding" table entry.

| Finding ID | Disposition | Evidence of resolution |
| --- | --- | --- |
| NONE | N/A — first review round for T-40 | — |

## Judgment call: Scope item 3c wiring-point discrepancy

The brief instructed the implementer to find existing
`ParityTreeDataProvider.refresh()` call sites in `activate.ts` and add the
context-key recomputation alongside each one. This reviewer independently
confirmed via `grep -n "\.refresh(" -r packages/extension/src` that no such
call site exists anywhere in `packages/extension/src` outside of
`parityTreeDataProvider.test.ts`'s own unit test — the brief's premise does
not hold, and the implementer's disclosure of this is accurate rather than
a misreading.

Given that, the implementer's actual choice — wiring
`refreshHasNoContentContext` directly into the tail of
`registerAddConnectionCommand`, `registerEditConnectionCommand`,
`registerDeleteConnectionCommand`, and `registerNewComparisonCommand`'s
registered callbacks, plus once at `activate()` — satisfies the brief's
actual intent (the context key must transition stale-to-fresh after every
relevant mutation) at least as well as the brief's literal instruction
would have, and arguably more precisely: it ties the recompute directly to
the exact command handlers whose outcomes can change `computeHasNoContent`'s
inputs, rather than depending on a `refresh()` call site whose own
relationship to those mutations this task doesn't own or control. This
reviewer's own coverage check (above) confirms no content-mutating command
was left unwired. The implementer did not invent a nonexistent call site,
did not silently drop the requirement, and did not touch
`ParityTreeDataProvider` itself (respecting the brief's prohibited-changes
section). This is judged a correct and appropriately conservative
resolution of a brief premise that did not match the codebase's actual
state — not a deviation requiring rework.

## Approval status

- **Status:** APPROVED
- **Reviewer:** Independent Reviewer (T-40)
- **Date:** 2026-08-03
- **Release or dependency impact:** None blocking. Two Minor findings
  recorded (T-40-01: no manual Extension Development Host smoke check
  performed — recommend as a lightweight follow-up whenever the extension
  is next run in a dev host, not a blocker; T-40-02: unconditional
  recompute on cancelled/no-op command paths — accepted as harmless by
  design). No Critical or Important findings. Fresh `npm run verify`
  independently reproduced by this reviewer: 637 tests passed, 27 skipped,
  35/37 test files passed, matching the implementation report's claimed
  numbers exactly. The Scope-item-3c premise mismatch was independently
  confirmed real and the implementer's alternative wiring judged sound.
