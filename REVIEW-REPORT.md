# ParityLens — Review Report T-26

## Independence statement

This review was performed by a separate agent instance from whoever wrote
`IMPLEMENTATION-REPORT.md` and the T-26 commits. No memory of authoring the
change was available or used. Every factual claim in the implementation
report was independently re-derived from the actual diff, the actual source
files, and fresh command/tool execution rather than trusted at face value.

## Scope reviewed

- Branch `task/T-26-activity-bar-icon`, tip commit `f809230`, based on
  `main` at `f164a36`.
- Commits: `3ee2a64` (implementation), `f809230` (implementation report).
- Files changed: `packages/extension/media/icon.svg` (new),
  `packages/extension/package.json`, `IMPLEMENTATION-REPORT.md`.
- Cross-checked against `TASK-BRIEF.md` (sole authority per this project's
  `AGENTS.md`) and `PROGRESS-LEDGER.md`'s T-26 row / X-01 finding / the
  2026-08-01 decision-log entry describing the original live smoke test.

## Scope and ownership check

`git diff main task/T-26-activity-bar-icon --stat` (excluding
`IMPLEMENTATION-REPORT.md`, which every task rewrites by convention):

```
packages/extension/media/icon.svg | 8 ++++++++
packages/extension/package.json   | 3 ++-
2 files changed, 10 insertions(+), 1 deletion(-)
```

`packages/extension/package.json`'s full diff is exactly:

```diff
         {
           "id": "paritylens",
-          "title": "Data Parity"
+          "title": "Data Parity",
+          "icon": "media/icon.svg"
         }
```

No other field in `package.json` changed (`name`, `publisher`, `private`,
`views`, `commands`, `scripts` all untouched — confirmed by reading the
full file). This matches the brief's "Files owned" section exactly:
`packages/extension/media/**` (new) and the single `icon` field. No file
under `packages/*/src/**` was touched. Scope check: **pass, no findings.**

## Verification performed (fresh, independent)

### 1. `npm run verify`

Ran fresh from repo root on the checked-out branch:

```
Test Files  22 passed | 2 skipped (24)
     Tests  404 passed | 27 skipped (431)
Exit code: 0
```

Matches both the report's claim and the brief's expected baseline
(404 passed / 27 skipped / 431 total) exactly. **Confirmed.**

### 2. Icon asset inspection

`packages/extension/media/icon.svg` exists, is well-formed SVG (24x24
viewBox, parsed successfully with Node's basic string checks), and uses
`stroke="currentColor"` on all three drawn elements (`fill="none"`
throughout) — no hardcoded hex/named colors anywhere in the file. This
correctly inherits VS Code's theme icon color in both light and dark
themes, satisfying the brief's "do not hardcode a specific color"
requirement.

**Minor internal inconsistency noted:** the SVG's own header comment
says `fill="currentColor"` twice, but the actual technique used is
`stroke="currentColor"` with `fill="none"`. The implementation report
correctly describes the real technique (`stroke="currentColor"`) and
explicitly justifies deviating from the brief's literal `fill="currentColor"`
suggestion as a judgment call (VS Code's own built-in icon convention) —
so the report is accurate; only the in-file code comment is stale/wrong.
Cosmetic, not a functional defect (browsers/VS Code do not parse SVG
comments). See T-26-03 below.

### 3. Real `.vsix` rebuild and content verification

Ran `npm run build` (tsc -b, exit 0) then, from `packages/extension`,
`npx --no-install @vscode/vsce package --no-dependencies` against the
current (fixed) branch tip. Output confirmed:

```
extension/media/icon.svg [0.71 KB]
DONE  Packaged: ...\paritylens-0.0.1.vsix (21 files, 23.3 KB)
```

Unzipped the produced `.vsix` directly (not trusting `vsce`'s own file
listing) and confirmed `extension/media/icon.svg` is genuinely present in
the archive with byte-identical content to the source file. **Confirmed —
matches the implementation report's claim.**

Also independently confirmed the pre-existing `WARNING  LICENSE,
LICENSE.md, or LICENSE.txt not found` message from `vsce package`
(present on every build, red and green state), and that a `LICENSE` file
does exist at the repo root (`V:\...\VSC-DB-SQL-Compare\LICENSE`, MIT,
added by T-24). This is accurately disclosed in the implementation
report as pre-existing and out of T-26's scope (`vsce` only looks for a
LICENSE colocated with the manifest it packages, not at the monorepo
root) — **confirmed accurate, correctly not treated as a T-26 defect.**
Filed as a new tracked finding below per the dispatch instructions,
attributed to a future packaging-scope task, not T-26.

### 4. Independent real extension-host sandbox launches (green state)

Installed the freshly-built `.vsix` into my own fresh sandbox
(`--extensions-dir`/`--user-data-dir` under a scratch OS temp folder,
never any real profile) and launched with `--verbose` against a scratch
workspace. Extension installed successfully
(`parity-lens-dev.paritylens-0.0.1` present in the sandbox's extensions
dir). Let the workbench run to a fully-idle state (lifecycle phase 4,
observed continuously for ~50+ seconds of console output) before
searching.

Searched every log file under the session's `logs/<timestamp>/` tree —
`main.log`, `window1/renderer.log`, `window1/exthost/exthost.log`,
`window1/views.log`, and all others — for `icon is mandatory` and
`View container 'paritylens' does not exist`. **Zero matches for either
string, in any log file.** The only `paritylens`-containing lines found
were two benign trace lines (`pickRunningLocation for
parity-lens-dev.paritylens...`, `Checking updates for extensions
github.copilot-chat, parity-lens-dev.paritylens`) — matching the
implementation report's description almost exactly.

### 5. Independent real extension-host sandbox launch (red state) — material discrepancy found

Per the brief's explicit "Note to reviewer" instruction to independently
reproduce the red state, I did not rely on reading `main`'s manifest
alone (though I did confirm `main`'s `package.json` genuinely has no
`icon` field via `git show main:packages/extension/package.json`). I
went further and actually rebuilt and launched the pre-fix `.vsix`:
created a `git worktree` of `main` (`f164a36`), ran `npm install`,
`npm run build`, and `vsce package --no-dependencies` there — producing
a genuinely icon-less `.vsix` (20 files vs. 21 for the fixed build, no
`media/` directory) — then installed and launched it in a **second,
independent, fresh sandbox** (different scratch folders from the
green-state run), with `--verbose`, letting it settle to a fully-idle
workbench state before searching (confirmed via live process listing
that the instance was not killed mid-startup; watched console output
run continuously from initial launch through ~60 seconds of idle
`User data changed` / chat-model heartbeat lines, i.e. genuinely
fully loaded, not truncated).

**Result: my independent red-state reproduction found zero occurrences
of either target error string (`icon is mandatory`, `View container
'paritylens' does not exist`) anywhere in any log file, including
`main.log`, `renderer.log`, and `exthost.log`.** No `[warning]`-level
log line of any kind appears in this sandbox's logs at all — the same
absence of warning-level entries in the red-state run as in the
green-state run.

This directly contradicts the implementation report's specific red-state
evidence claim, which cites exact locations: `renderer.log (line 753)`
and `telemetry.log (line 417)` containing the verbatim error text. I
could not reproduce that. I made two independent attempts (one shorter,
one with a longer, verified-not-killed-early settle period) with the
same negative result both times.

**What this finding does and does not mean:**
- It does **not** mean the fix itself is wrong. VS Code's manifest schema
  genuinely requires an `icon` for a custom `viewsContainers.activitybar`
  entry per Microsoft's own extension manifest documentation, and adding
  one is unambiguously correct regardless of whether this specific VS
  Code build's error-surfacing behavior matches what was originally
  observed. The green-state fix — icon field added, real SVG asset
  shipped, packaged into the `.vsix` — is independently confirmed correct
  on its own terms (finding #3/#4 above).
- It **does** mean I cannot independently corroborate the implementation
  report's claimed direct evidence that the specific red-state error text
  was reproduced by the implementer, because my own attempt to reproduce
  the same red state, using the same method the brief itself prescribes,
  did not surface it. Plausible explanations include: a VS Code version
  or build-channel difference between my environment and the
  implementer's/original smoke-test's session (both report and my
  session used the same locally-installed VS Code v1.131.0 CLI, so a
  version mismatch is not obviously the explanation, but a state/cache
  difference in a shared local install is possible); the warning being
  logged at a verbosity/channel my grep didn't cover; or the original
  report's cited line numbers being inaccurate. I am not able to
  determine which from available evidence.
- Given the fix is independently correct and verifiable on its own merits
  (finding #4, and the manifest-schema requirement is well-documented and
  not in dispute), I am **not** blocking approval on this alone, but it
  is a real, material verification-evidence discrepancy that must be
  recorded rather than silently accepted, per this project's "don't
  report a pass because the implementer said so" discipline.

## Adversarial / disclosed-risk probing

- The implementer disclosed they could not visually confirm the icon
  glyph renders legibly (no screenshot/GUI tooling in their session).
  This is an honest, correctly-scoped limitation — I do not have
  screenshot-capable GUI tooling in this review session either, so I
  cannot close this gap. **This remains open, needing human visual
  confirmation**, exactly as both the brief and the report state.
- Checked whether the icon path could be exploited/malformed (e.g. path
  traversal in the `icon` field) — not applicable; it's a static
  relative path (`media/icon.svg`) inside the extension's own owned
  directory, packaged correctly, no user input involved.
- Confirmed no credentials, secrets, or mutating-statement logic are
  touched by this task (static asset + one manifest string field) — no
  security-relevant surface exists in this change to adversarially probe
  beyond the verification already performed.

## Findings

| ID | Severity | Description | Evidence | Required/suggested resolution |
| --- | --- | --- | --- | --- |
| T-26-01 | Important | Implementation report's red-state evidence (exact claimed log lines "renderer.log line 753" / "telemetry.log line 417" containing the two error strings) could not be independently reproduced. Two independent sandbox launches of a freshly-built pre-fix `.vsix` (from a `main`-worktree rebuild), both allowed to settle to a fully-idle workbench state, produced zero matches for either error string in any log file. | See "Verification performed" section 5 above; scratch sandbox logs were inspected then deleted per this task's cleanup requirement, so the negative evidence itself is not preserved as an artifact — reproducible by any reviewer following the same red-state rebuild-and-launch steps in the brief. | Does not block approval: the fix itself (icon field + valid themed SVG asset, correctly packaged) is independently verified correct on its own merits against VS Code's documented manifest requirement, independent of whether this specific error string reproduces in this environment. Recommend a follow-up note in the ledger flagging that the original smoke test's error text should be treated as strong but not independently reconfirmed evidence, and that future extension-host smoke tests capture the full session log bundle as a durable artifact (not deleted) so this class of discrepancy can be diagnosed rather than re-litigated from scratch each time. |
| T-26-02 | Minor | Pre-existing `vsce package` "LICENSE, LICENSE.md, or LICENSE.txt not found" warning, confirmed accurate (LICENSE exists at repo root from T-24; `vsce` only checks alongside the manifest it packages, i.e. `packages/extension/`). Correctly disclosed by the implementer as out of T-26's scope and not fixed here. | Reproduced directly: `vsce package --no-dependencies` printed the warning on every build in this review session; `LICENSE` confirmed present at `V:\...\VSC-DB-SQL-Compare\LICENSE`. | Not a T-26 defect. File as a new tracked finding for a future packaging-scope task (e.g. copy/symlink `LICENSE` into `packages/extension/`, or accept via `--allow-missing-repository`-style flag if `vsce` offers an equivalent for LICENSE). Recorded in `PROGRESS-LEDGER.md`'s open findings below. |
| T-26-03 | Minor | `packages/extension/media/icon.svg`'s own header comment says the icon uses `fill="currentColor"`, but the actual technique used on all three shapes is `stroke="currentColor"` with `fill="none"`. The implementation report correctly and explicitly describes the real `stroke`-based technique as a deliberate judgment call — only the in-file SVG comment is stale/inaccurate. | `packages/extension/media/icon.svg` lines 2-4 (comment) vs. lines 5-7 (actual `stroke`/`fill="none"` attributes). | Cosmetic only — does not affect rendering or theme-color inheritance (SVG comments are not parsed). Suggest a one-line comment fix next time this file is touched; not worth a dedicated task. |

**No Critical findings.**

## Prior findings disposition

- **X-01** (extension tests use a mocked `vscode` module, no real
  extension-host verification) — T-26 does not close X-01 in general
  (it remains open and correctly scoped to a future dedicated
  extension-host test-harness task), but T-26 is the concrete instance
  the ledger already logged as X-01 "turning out to hide a real defect."
  This task's own verification (both the report's and mine) is itself
  additional real-extension-host evidence, consistent with X-01's
  remediation direction, though it does not substitute for an automated
  `@vscode/test-electron`-based regression test — none was added or
  required by this task's brief.

## Disposition

**APPROVED.**

Rationale: the change is exactly and only what the brief authorized (one
manifest field, one new static asset, both within declared ownership).
The fix is independently correct against VS Code's own documented
manifest schema requirement for custom activity-bar containers,
regardless of the T-26-01 evidence discrepancy. The icon asset is valid,
theme-adaptive, and confirmed present byte-for-byte inside a freshly
rebuilt `.vsix`. `npm run verify` is unchanged from baseline (404
passed / 27 skipped / 431 total, exit 0). No Critical or Important
finding blocks approval — T-26-01 is recorded as Important but explicitly
does not block, per the reasoning given in that row (the underlying fix
is independently verifiable correct on its own terms, and the
discrepancy is about whether a specific historical error string
reproduces in this specific environment, not about whether the shipped
fix is right). The one remaining gap — visual, human confirmation that
the icon glyph renders legibly in a live activity bar — was honestly
disclosed as out of both the implementer's and this reviewer's tooling
reach, and is recommended as the next concrete step before Release step
5 is marked closed.

## Suggested ledger updates (for the Lead Orchestrator, not applied by this reviewer)

- Close T-26 as APPROVED, 0 Critical / 1 Important (non-blocking,
  T-26-01) / 2 Minor (T-26-02, T-26-03).
- Add T-26-02 as a new open finding (LICENSE not colocated with
  `packages/extension/package.json` for `vsce` packaging purposes),
  routed to a future packaging-scope task — do not attribute it to T-26
  or T-25, both correctly disclosed it as pre-existing/out-of-scope.
- Record T-26-01 as an open observation: the original live-smoke-test
  error text is not independently re-confirmed reproducible in a
  from-scratch rebuild-and-relaunch, though the fix is still correct and
  approved. Recommend the next real extension-host smoke test (Release
  step 5's re-run) preserve its full log bundle as a committed or
  attached artifact rather than deleting it after transcript capture, so
  this class of discrepancy is diagnosable rather than repeatedly
  re-investigated.
- Release step 5 still needs a human to visually confirm the Data Parity
  icon actually renders legibly in the activity bar — neither this
  review nor the implementation had GUI/screenshot tooling available to
  close that specific gap.
