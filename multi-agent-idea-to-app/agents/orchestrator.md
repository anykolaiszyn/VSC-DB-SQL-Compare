---
name: orchestrator
description: Reference protocol for acting as Lead Orchestrator under the multi-agent-idea-to-app lifecycle kit. Not a dispatchable subagent — read and follow this directly when coordinating an implementer/reviewer task loop; do not spawn it via the Agent tool. Covers task-brief authoring, dispatch sequencing, reconciliation, and ledger discipline.
---

This is a protocol document, not an agent persona to dispatch. The Lead
Orchestrator role stays with whoever (or whatever) is driving the session
directly — it makes approval-adjacent judgment calls (what counts as
in-scope, whether a finding blocks merge, how to phrase a decision that
needs human sign-off) that should not be delegated to a spawned subagent
with no memory of the surrounding conversation. Read this file and follow
it; do not invoke it through the Agent tool the way `implementer` or
`reviewer` are invoked.

## Where this fits

The multi-agent-idea-to-app kit (`multi-agent-idea-to-app/HANDBOOK.md` in a
project that has adopted it) defines an eight-phase lifecycle: Discovery,
Design, Implementation Planning, Task Loop, Integration, Real-World
Validation, Release, Handoff. This protocol covers the **Task Loop** phase
specifically — the repeated cycle of implementing and reviewing one
approved task at a time from an approved `IMPLEMENTATION-PLAN.md`. For the
other phases, follow the kit's own numbered prompts
(`multi-agent-idea-to-app/prompts/01-discovery.md` through `08-handoff-and-
resume.md`) directly; this file does not replace them.

## The per-task cycle

For each task ID in the approved implementation plan, in dependency order:

1. **Check the ledger.** Read `PROGRESS-LEDGER.md` first, every time —
   confirm the lifecycle phase, that no other task is currently active
   (exactly one active task per execution lane is the default), and that
   this task's dependencies are all COMPLETE/APPROVED. Do not start a task
   whose dependency is still open.
2. **Write `TASK-BRIEF.md`** from the plan's row for this task plus the
   project's brief template. This is the single most consequential
   document in the cycle — the implementer treats it as sole authority,
   and every subsequent finding traces back to whether this brief was
   precise. Include, explicitly:
   - Objective, in one or two sentences.
   - Dependencies (which prior tasks, which approvals).
   - Files owned — exact paths or globs. Ambiguity here is the single
     most common source of scope-creep findings.
   - Interfaces consumed and produced, with enough field-level detail
     that "what does this function actually return" isn't a judgment
     call left to the implementer.
   - Anything a prior review found that this task must resolve — quote
     the finding ID and its exact required resolution, don't paraphrase
     it into something looser.
   - Prohibited changes — name the adjacent files/shapes that look
     temptingly related but are out of scope.
   - Any citation to another control file (a spec section, a task ID, a
     prior commit hash) — quote the source line verbatim or omit the
     citation entirely. A paraphrased citation has repeatedly turned out
     wrong in practice (wrong section number, a fabricated commit hash);
     it's never been the cause of a functional defect, but it wastes a
     reviewer's time chasing a citation instead of the substance, so treat
     "cite exactly or don't cite" as a hard rule for brief-writing.
   - Red-state and green-state evidence requirements — specific enough
     that "did the implementer actually prove this" is checkable.
   - Handoff: report locations, and a note to the reviewer about what
     they should specifically scrutinize (a disclosed risk, a security-
     sensitive path, a prior finding to re-verify).
3. **Activate in the ledger.** Update `PROGRESS-LEDGER.md`: mark this task
   ACTIVE, set it as the ledger's one active task, record the assigned
   implementer.
4. **Dispatch the implementer.** Use the `implementer` subagent (or
   equivalent) with a prompt that names the working directory, points at
   `TASK-BRIEF.md` as sole authority, and gives just enough task-specific
   pointers (which files to read first, what the primary red-state test
   should exercise) to save the implementer a cold-start search — but do
   not restate the brief's contract in your own words as if it were
   authoritative. **This is the highest-leverage discipline in the whole
   cycle**: a paraphrase that loosens a requirement (e.g. turning a firm
   "must include X" into an offhand "X would be nice if there's time") is
   a known, observed failure mode — the implementer will treat your
   paraphrase as if it were the brief, and a real requirement quietly
   drops. When summarizing the brief in a dispatch prompt, quote its
   load-bearing language verbatim rather than restating it.
5. **Before dispatching the reviewer, verify the implementer's work is
   actually committed.** Run `git status`/`git log` on the task branch
   yourself — confirm the expected files are committed (not just changed
   on disk) and that `IMPLEMENTATION-REPORT.md` reflects the current task,
   not stale content from a prior one. Do not assume this from the
   implementer's own report; check it directly. If work is uncommitted,
   either commit it yourself (staging only the files the brief authorizes)
   or send it back — but do not dispatch a reviewer against an empty or
   stale diff, since the reviewer has no way to detect that from inside
   its own isolated context and will waste its dispatch reviewing nothing.
6. **Dispatch the reviewer.** A different subagent instance from the
   implementer, always — never let the same context that wrote the code
   also review it. Point the reviewer at the brief, the implementation
   report, and the actual diff, and tell it explicitly what to scrutinize
   hardest: anything the implementer's own report disclosed as a risk or
   limitation, anything security- or safety-relevant, and any prior
   finding this task claims to resolve. A reviewer that only re-runs the
   implementer's own tests and agrees isn't doing independent review —
   it should write and run its own adversarial probes and its own
   from-scratch verification of any nontrivial arithmetic or claim.
7. **If the reviewer returns CHANGES REQUIRED, follow the round-1/round-2
   procedure exactly — do not improvise a variant per task.** This is a
   named, repeatable sub-procedure, not something to reason out fresh each
   time a Critical finding lands:
   1. **Record the finding on the trunk branch, not the task branch.**
      Switch to trunk, append the finding to `PROGRESS-LEDGER.md`'s open
      findings table (severity, evidence, required resolution, a
      task-ID-prefixed finding ID such as `T-20-01`) and to the
      task-register row (status → `CHANGES REQUIRED (round 1)`), commit
      there. The task branch stays untouched by ledger edits — this keeps
      the branch's diff scoped to actual code and avoids stale-branch
      merge-base drift when the branch is later diffed against trunk.
   2. **Dispatch a new, bounded implementer task scoped only to that
      finding** — same task branch, new commit, new red-state evidence
      that reproduces the exact reported bypass/gap before fixing it. Do
      not fold in unrelated cleanup even if the implementer notices
      something else while in the file.
   3. **Dispatch a fresh reviewer instance** (a new instance specifically —
      round two is exactly the case where "did the fix actually work" must
      not be taken on the fixer's word) that re-verifies the original
      finding by independently reproducing the original failing case
      itself, not by trusting the fix report's claim that it's resolved.
      Have it also spend some independent time re-probing the surrounding
      area beyond just the one finding — round-2 reviews have repeatedly
      surfaced a second, previously-undetected issue precisely because the
      reviewer was already deep in the relevant code (e.g. a disclosed
      risk turning out understated). Do not advance until round two comes
      back APPROVED with the original finding explicitly marked resolved
      in the ledger.
   4. **Reconcile round two as a single ledger update**: task-register row
      → `COMPLETE`/`APPROVED (round 2)` with the fresh verification count,
      the original finding → `RESOLVED (confirmed by independent round-2
      review, <date>)`, plus any new finding the round-2 reviewer
      surfaced, filed as its own row rather than folded into the original.

7a. **If an implementer's dispatch is interrupted by an infrastructure
    failure (session/API/quota limit) rather than a design or scope
    failure**, treat whatever work exists as real and worth preserving —
    do not discard it and do not leave it sitting uncommitted on trunk.
    Recovery procedure:
    1. **Inspect before acting.** Read what's actually in the working
       tree and run the task's verification command yourself to establish
       the true state (e.g. "13 of 15 tests pass") — don't rely on
       whatever partial status the interrupted dispatch happened to report
       last.
    2. **Create the task branch now if it doesn't exist yet**, and commit
       the interrupted state as an explicit checkpoint with an honest
       commit message disclosing exactly what's known-incomplete or
       known-failing (e.g. "2 of 15 tests failing: injection-rejection
       assertions need rework — see below" — not a message that reads as
       if the work were finished).
    3. **Restore trunk to clean** (`git checkout main -- <files>` for
       anything that leaked there, or `git status` + stash if uncertain)
       before doing anything else — an interrupted dispatch must never
       leave trunk in an ambiguous state for the next thing that reads it.
    4. **Dispatch a fresh implementer instance to resume from the
       checkpoint**, with a prompt that points it at the specific
       known-failing pieces rather than a generic "finish this task" — a
       targeted pointer (e.g. "read `FixtureConnector.quoteIdentifier`'s
       actual implementation before assuming the test's expectation is
       correct") saves the resumed instance from re-deriving root cause
       from scratch.
    5. **Record the interruption and recovery as a decision-log entry**,
       not just a passing mention — future orchestration benefits from
       knowing this happened and why the checkpoint-and-resume approach
       was chosen over discarding the work.
8. **Reconcile.** Once approved: commit the review report on the task
   branch, merge to the trunk branch (`--no-ff`, so the task's history
   stays visible), install any new dependencies and re-run the full
   verification command fresh on the merged trunk — the merge itself is
   not evidence, a green run *after* merging is. Update
   `PROGRESS-LEDGER.md`: mark the task COMPLETE/APPROVED with the fresh
   post-merge verification result, close or update any findings this task
   resolved, note which downstream tasks are now unblocked, record
   Minor/informational findings that don't block anything but should be
   traceable, and clear the "one active task" slot. Delete the merged
   task branch. Push, if the project's workflow does that per task. If the
   open-findings table has grown past comfortable scanning, this is also
   the point to apply the archiving convention in
   `templates/PROGRESS-LEDGER.md`'s open-findings section — never mid-task.
9. **Session maintenance: compact now — this is a hard gate, not a
   suggestion.** Do not proceed to step 10 without either compacting or
   explicitly telling the human you are deliberately deferring it and why.
   Right after reconciliation is the safest point in the whole cycle to
   run `/compact` (or equivalent) — the ledger has just been brought fully
   current, so nothing about the finished task's state depends on the
   orchestrator's own conversational memory anymore. "I meant to compact
   but moved on to the next task instead" is exactly the failure this step
   exists to prevent — treat reaching step 10 with an uncompacted, unaddressed
   session as a process violation, the same category of failure as
   skipping independent review.
   - **Before compacting**, confirm `PROGRESS-LEDGER.md` genuinely
     reflects reality: no task marked ACTIVE that isn't, no finding
     resolved in your head but not in the findings table, no decision made
     but not recorded in the decisions log. If the ledger is current,
     compact immediately. If it isn't, catch it up first, then compact —
     compacting a stale ledger state is a real way to lose a decision that
     only ever existed in conversation.
   - **After compacting** (or after deciding not to, with the human's
     explicit agreement), state plainly that you did, or that you didn't
     and why, before moving on. Do not let this step pass silently.
   - This does not affect or interrupt implementer/reviewer subagent
     dispatches — each one runs in its own isolated context regardless of
     the orchestrator's own compaction history, so there is no in-flight
     work at risk.
   - Do not compact mid-task (between activating a task and reconciling
     it) unless forced to — you would be discarding your own working
     memory of what the current dispatch was told and why, with no ledger
     checkpoint yet to recover it from. The hard-gate requirement applies
     at the post-reconciliation checkpoint specifically, not at arbitrary
     points mid-cycle.
10. **Move to the next unblocked task** in dependency order, or stop and
    surface a choice to the human if more than one task is unblocked and
    the order isn't obvious from the plan.

## Judgment calls that stay with the orchestrator, not a subagent

- **Whether a file touched outside the brief's literal ownership is a
  minimal mechanical necessity (acceptable, note it and move on) or real
  scope creep (needs a revised brief).** A reviewer will usually flag the
  fact of the deviation; deciding whether it's acceptable and recording
  that as a standing precedent for future tasks is an orchestrator call.
- **Whether a disclosed residual risk blocks merge or is accepted as
  tracked, non-blocking debt.** Weigh it against the project's own stated
  risk model (e.g. a documented defense-in-depth framing) rather than
  applying a blanket rule.
- **When a finding implies a genuine ambiguity in a prior brief** (not
  just an implementer mistake), correct the process going forward — note
  it explicitly in the ledger as a process correction, and change how you
  write or dispatch future briefs accordingly. Treat this as durable
  learning, not a one-off apology.
- **Whether to spin up a small bounded follow-up task** (a "Xa" task, sibling
  to the task whose review produced the finding) versus folding a fix into
  the next dependent task's scope. Prefer a small bounded follow-up when
  the finding is self-contained and low-risk; fold it into a later task
  only when it's inseparable from work that task already owns.
- **Any action that is destructive, externally consequential, or requires
  the recorded human approval gates in `IMPLEMENTATION-PLAN.md`** (scope
  changes, release readiness, anything touching real credentials/data).
  Never let a subagent dispatch substitute for that approval.

## What not to delegate to a subagent

Branching, merging, pushing, and all `PROGRESS-LEDGER.md`/`TASK-BRIEF.md`
edits are orchestrator actions taken directly, not tasks to dispatch — they
require the accumulated context of the whole task loop (what's already
merged, what the ledger currently says, what decision was already made) that
a fresh subagent instance does not have and should not have to reconstruct.
