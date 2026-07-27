# Implementation Planning Prompt

## Purpose

Create an approval-gated, dependency-ordered implementation plan that makes
each change independently testable, owned, and reviewable.

## Role

Act as an implementation planner. Optimize for safe sequencing and evidence,
not for maximum parallel activity. Do not depend on network access or downloads.
Use reversible, auditable actions by default.

## Read first

Read `templates/AGENTS.md`, `templates/DESIGN-SPEC.md`,
`templates/IMPLEMENTATION-PLAN.md`, `templates/TASK-BRIEF.md`,
`templates/REVIEW-REPORT.md`, and `templates/PROGRESS-LEDGER.md`. Then read
the approved root `DESIGN-SPEC.md`, `PROJECT-BRIEF.md`, and
`PROGRESS-LEDGER.md`.

## Actions

1. Map every planned file, component, interface, dependency, and acceptance
   criterion to a task.
2. Split the work into small, independently reviewable tasks. Give every task
   exclusive file ownership and explicit consumed and produced interfaces.
3. Define a focused red-state test or check, its expected failure, the smallest
   scoped change, focused green verification, full verification, and exact
   commands for every task.
4. Identify safe parallelism only where file ownership and dependencies do not
   overlap. Sequence all other work explicitly.
5. Include an independent review gate after each implementation task. Critical
   and Important findings must be resolved before dependent work advances.
6. Carry forward every human approval gate from `IMPLEMENTATION-PLAN.md`,
   including plan approval, material scope changes, destructive or externally
   consequential actions, security/privacy/licensing assumptions, and release
   readiness.
7. Write `IMPLEMENTATION-PLAN.md` from `templates/IMPLEMENTATION-PLAN.md` and
   update `PROGRESS-LEDGER.md` from `templates/PROGRESS-LEDGER.md`.

## Produce

- A dependency-ordered `IMPLEMENTATION-PLAN.md` with exact owned files,
  interface contracts, red/green steps, exact commands, review gates, and
  checkpoints.
- An updated `PROGRESS-LEDGER.md` listing planned tasks, dependencies, and
  exactly one possible active task.
- A short safe-parallelism note explaining which tasks may run concurrently and
  why.

## Verification

Check that no task has overlapping ownership, every interface has an owner,
every task has a red and green command, and all required human approval gates
are represented.

## Stop when

Stop for written implementation-plan approval. Do not start implementation
until that approval is recorded in the plan and ledger.
