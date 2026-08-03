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

None currently.

## Applied (kept here briefly for context, remove once stable)

- ✅ Statement-safety-class parser guidance ("check the dialect, not just
  prior findings") added to `implementer.md`, prompted by the recurring
  pattern across T-03/T-17/T-19's independently-found scanner gaps
  (paren-wrapped CTE mutation, SQL Server `GO` separator, PostgreSQL
  dollar-quoting).
- ✅ Human-driven GUI/interactive-evidence pattern extended into the
  task-loop cycle itself (previously only in `07-release.md`'s step 5) —
  `implementer.md` now covers disclosing an unverifiable visual criterion
  and requesting a bounded human-driven check; `reviewer.md` now covers
  how to handle that disclosure without penalizing it.
- ✅ `templates/RELEASE-CHECKLIST.md`'s Fresh verification section now
  explicitly instructs marking a non-applicable item `N/A` with a
  one-line reason rather than deleting or silently skipping it.
- ✅ `templates/RELEASE-CHECKLIST.md`'s "Artifact hashes are recorded"
  item now notes that not every packaging toolchain is byte-reproducible
  across rebuilds and to verify via content-listing comparison instead
  where that's the case.

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
