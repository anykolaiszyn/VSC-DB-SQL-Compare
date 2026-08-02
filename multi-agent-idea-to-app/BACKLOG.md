# multi-agent-idea-to-app — Kit Backlog

Candidate improvements to the kit itself (prompts, agent protocols,
templates), distinct from any adopting project's own product backlog.
Entries here are informed by real defects/friction hit while running the
kit on ParityLens — each should name what happened, not just what's
theoretically nice to have.

Applied items are removed from this list and folded into the relevant
kit file directly (`orchestrator.md`, `HANDBOOK.md`, a prompt file, or a
template) — this file tracks what's still open, not a changelog.

## Open

- **`assertReadOnlyStatement`-class parser gaps have a recurring shape
  across connector tasks.** T-03's original scanner missed a
  paren-wrapped CTE mutation (I-01); T-17 found SQL Server's `GO` batch
  separator wasn't recognized (M-05); T-19 found PostgreSQL dollar-quoting
  could desync the scanner (M-06). Each was caught and fixed
  independently, but a kit-level note in `implementer.md`/`reviewer.md`
  naming "statement-safety-class parsers accumulate dialect-specific
  bypasses over time; a new connector task should proactively probe for
  the dialect's own quoting/comment/batch-separator conventions rather
  than only reproducing prior findings" might catch the next one earlier.
- **No standard pattern yet for "the implementer needs to invoke a real
  GUI/interactive host it cannot drive itself."** `07-release.md`'s step
  5 now has a live-smoke-test pattern for this (see the fix already
  applied), but the same need can arise inside a task-loop cycle too
  (e.g. a task whose acceptance criterion is genuinely UI-visual). No
  `implementer.md`/`reviewer.md` guidance yet for "ask the human operator
  to drive this specific bounded interaction and report back" as a
  sanctioned evidence-gathering technique inside the task loop, only at
  the release phase.
- **`RELEASE-CHECKLIST.md`'s template items ("deterministic source-tree
  output," "deterministic ZIP output," "release handbook") are phrased
  for a generic file-based-artifact release and don't map cleanly onto
  every artifact type** (a VS Code `.vsix`, e.g., has no natural
  "source-tree output" or "release handbook" concept). ParityLens's
  actual `RELEASE-CHECKLIST.md` marked these `N/A` with an explanation
  rather than leaving them literally unaddressed — that's a reasonable
  per-project judgment call, but the template itself could offer an
  explicit "if this checklist item doesn't map to your artifact type,
  mark N/A with a one-line reason rather than deleting or silently
  skipping it" instruction, so future adopters don't have to independently
  arrive at that same judgment call.
- **Artifact-hash reproducibility across independent rebuilds is not
  guaranteed by every packaging toolchain** (confirmed for `@vscode/vsce`,
  which embeds per-file build timestamps in its ZIP output — content is
  reproducible, the compressed byte stream is not).
  `templates/RELEASE-CHECKLIST.md`'s "Artifact hashes are recorded"
  item could note this distinction explicitly (verify integrity by
  content-listing comparison, not by expecting hash equality across
  rebuilds, unless the specific toolchain in use is confirmed
  deterministic) rather than leaving each project to discover and
  disclose it independently.

## Applied (kept here briefly for context, remove once stable)

- ✅ Round-1/round-2 CHANGES REQUIRED procedure codified as
  `orchestrator.md` step 7 (was previously improvised per-task).
- ✅ Interrupted-implementer (infrastructure failure) recovery procedure
  codified as `orchestrator.md` step 7a.
- ✅ Scope-boundary self-stop (implementer correctly refuses an
  out-of-ownership edit) recovery procedure codified as `orchestrator.md`
  step 7b — distinct from 7a's infrastructure-failure case.
- ✅ Reviewer's ledger-edit-vs-review-report-edit git-checkout discard
  failure mode (hit repeatedly across three separate task cycles before
  being fixed at the root) — safe sequence codified as `orchestrator.md`
  step 6a.
- ✅ Citation-discipline rule (quote exactly or don't cite) added to
  `orchestrator.md` step 2's brief-writing guidance.
- ✅ Proportional review-depth note added to `HANDBOOK.md`'s Quality
  gates.
- ✅ Findings-archiving convention added to
  `templates/PROGRESS-LEDGER.md` (open-findings table growing past
  comfortable scanning size).
- ✅ Live, human-driven GUI smoke-test pattern for release-phase step 5,
  codified directly in `prompts/07-release.md`.
