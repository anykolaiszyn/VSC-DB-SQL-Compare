# Handoff and Resume Prompt

## Purpose

Allow a new agent to safely resume an interrupted project without discarding
uncommitted work, duplicating completed work, or bypassing recorded approvals.

## Role

Act as a cautious successor. Recorded project control files govern; chat
history is supporting context only. Do not depend on network access or downloads.
Use reversible, auditable actions by default.

## Read first

Read `templates/AGENTS.md`, `templates/PROJECT-BRIEF.md`,
`templates/DESIGN-SPEC.md`, `templates/IMPLEMENTATION-PLAN.md`,
`templates/TASK-BRIEF.md`, `templates/IMPLEMENTATION-REPORT.md`,
`templates/REVIEW-REPORT.md`, `templates/PROGRESS-LEDGER.md`, and
`templates/RELEASE-CHECKLIST.md`. Then read all corresponding project-root
control files and inspect the working tree, branch or workspace identity,
uncommitted changes, recent reports, open findings, and latest verification.

## Actions

1. Treat existing uncommitted changes as work to preserve. Do not reset,
   discard, overwrite, or silently reformat unrelated work.
2. Reconcile the ledger with the working tree and reports. If they disagree,
   record the conflict and request the recorded decision maker's written
   direction before changing scope or state.
3. Resume only the task identified as active in `PROGRESS-LEDGER.md`. If no
   task is active, stop and request direction; do not choose a new task.
4. Re-read the active task brief, its dependencies, ownership, approvals,
   reports, review status, open findings, and latest evidence before editing.
5. Run only safe, relevant verification needed to establish the present state.
   Preserve read-only sources and do not perform external or destructive
   actions without the recorded approval and recovery plan.
6. Write a structured final handoff using the implementation-report and
   review-report conventions: lifecycle state, active task, files and
   interfaces, verification, uncommitted work, approvals, risks, blockers,
   findings, and the next required owner.

## Produce

- An updated `PROGRESS-LEDGER.md` that accurately records the active task,
  current verification, blockers, approvals, and open findings.
- A structured handoff summary identifying preserved uncommitted changes,
  exact resume point, evidence, and next action.
- If resuming implementation, only the active task's permitted changes and an
  updated `IMPLEMENTATION-REPORT.md`; otherwise, no production edits.

## Verification

Confirm the working tree was inspected before edits, only one ledger task is
active, no uncommitted work was discarded, and every resumed action is within
the active task's ownership and recorded approvals.

## Stop when

Stop after safely handing off or resuming the ledger's active task to its next
checkpoint. Stop immediately for a control-file conflict, missing approval,
open blocking finding, or unclear active task and request written direction.
