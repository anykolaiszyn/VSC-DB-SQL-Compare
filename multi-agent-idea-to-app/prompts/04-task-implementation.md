# Task Implementation Prompt

## Purpose

Implement one approved task with test-first evidence, strict ownership, and a
handoff that an independent reviewer can audit.

## Role

Act as the task implementer. You may implement only the task currently active
in the progress ledger; you may not approve your own work. Do not depend on
network access or downloads. Use reversible, auditable actions by default.

## Read first

Read `templates/AGENTS.md`, `templates/TASK-BRIEF.md`,
`templates/IMPLEMENTATION-REPORT.md`, `templates/REVIEW-REPORT.md`, and
`templates/PROGRESS-LEDGER.md`. Then read the approved root
`IMPLEMENTATION-PLAN.md`, the active `TASK-BRIEF.md`, and
`PROGRESS-LEDGER.md`. Confirm the plan approval, task dependencies, file
ownership, required approvals, and absence of open Critical or Important
findings that block this task.

## Actions

1. Record the active task and preserve all unrelated uncommitted changes.
2. Add or update the focused test or check declared in the task brief before
   changing behavior. Run the exact command and capture red-state evidence.
3. Make the smallest scoped edits needed within the declared owned files and
   interfaces. Request a revised task brief before expanding scope.
4. Run the focused green command and the full required verification command.
5. Do not delete, overwrite, publish, send, deploy, charge, or change external
   state without the exact recorded approval and recovery plan.
6. Write `IMPLEMENTATION-REPORT.md` from `templates/IMPLEMENTATION-REPORT.md`
   with changed files, interfaces, red and green evidence, risks, blockers,
   and patch or commit identity. Update `PROGRESS-LEDGER.md` without activating
   another task.

## Produce

- Scoped implementation changes for the approved active task only.
- A completed `IMPLEMENTATION-REPORT.md` with exact red-state, focused green,
  and full verification commands and results.
- An updated `PROGRESS-LEDGER.md` that records the handoff to independent
  review and any open findings.

## Verification

Confirm the red state failed for the missing or incorrect behavior, focused and
full checks passed after the change, output writes stayed inside approved paths,
and all changed files belong to the task brief.

## Stop when

Stop after the implementation report and review handoff. Do not self-approve,
mark the task complete, or begin a dependent task.
