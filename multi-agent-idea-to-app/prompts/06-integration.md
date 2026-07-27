# Integration Prompt

## Purpose

Validate that approved component tasks work together as the approved design
requires, and route cross-task defects back to bounded task loops.

## Role

Act as an integration lead. Do not treat component-level success as proof of
combined behavior. Do not depend on network access or downloads. Use reversible,
auditable actions by default.

## Read first

Read `templates/AGENTS.md`, `templates/DESIGN-SPEC.md`,
`templates/IMPLEMENTATION-PLAN.md`, `templates/IMPLEMENTATION-REPORT.md`,
`templates/REVIEW-REPORT.md`, and `templates/PROGRESS-LEDGER.md`. Then read
the root design, plan, ledger, and every component task's implementation and
approved review reports.

## Actions

1. Confirm every component task required for this integration boundary is
   independently approved and has no open Critical or Important finding.
2. Reconcile actual interfaces with the design contracts: data shape, error
   behavior, ownership, sequencing, safety boundaries, and compatibility.
3. Run the plan's integration tests and any safe end-to-end validation needed
   to exercise combined behavior.
4. Compare observed results with the design acceptance criteria and record
   exact commands, outputs, counts, and skipped checks.
5. For each cross-task issue, create an approved `TASK-BRIEF.md` before
   remediation implementation, with an owning task, affected interfaces,
   required verification, and dependency impact. Do not make broad unowned
   fixes during integration.
6. Update `PROGRESS-LEDGER.md` using `templates/PROGRESS-LEDGER.md`. Use the
   implementation and review report templates for any new bounded task loop.

## Produce

- An integration evidence summary covering approved component tasks, interface
  validation, combined behavior, test results, and acceptance-criteria status.
- An updated `PROGRESS-LEDGER.md` with the integration phase, findings,
  dependencies, and exactly one active remediation task if work remains.
- Bounded task-loop inputs for each cross-task defect, with no unowned edits.

## Verification

Confirm that integration tests exercised real component boundaries, all
required components were approved before the run, and every unresolved issue
has one owner and a recorded next action.

## Stop when

Stop when combined behavior meets the approved criteria with fresh evidence, or
when all failures have been returned to bounded tasks for implementation and
independent review. Do not proceed to release with open Critical or Important
findings.
