# [PROJECT NAME] — Implementation Plan

## Plan controls

- **Approved design:** [PATH OR REFERENCE]
- **Plan owner:** [NAME OR ROLE]
- **Full verification command:** [COMMAND]
- **Branch or workspace policy:** [ISOLATION RULE]

## Human approval gates

| Trigger | Approval required before | Human approver | Approval record |
| --- | --- | --- | --- |
| Implementation plan approval | Starting implementation work | [NAME OR ROLE] | [DATE, DECISION, AND REFERENCE] |
| Material scope changes | Changing approved deliverables, interfaces, constraints, or acceptance criteria | [NAME OR ROLE] | [DATE, DECISION, AND REFERENCE] |
| Destructive or externally consequential actions | Deleting, overwriting, publishing, sending, deploying, charging, or changing external state | [NAME OR ROLE] | [DATE, DECISION, TARGET, AND RECOVERY PLAN] |
| Security, privacy, or licensing assumptions | Changing a recorded data, security, privacy, dependency, or license assumption | [NAME OR ROLE] | [DATE, DECISION, AND UPDATED RISK RECORD] |
| Release readiness | Publishing or delivering a release candidate | [NAME OR ROLE] | [DATE, DECISION, AND RELEASE-CHECKLIST REFERENCE] |

## Dependency-ordered tasks

| ID | Depends on | Objective | Files owned | Interfaces consumed | Interfaces produced | Focused red/green verification | Review gate | Commit or patch checkpoint |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [TASK ID] | [TASK IDS OR NONE] | [OBJECTIVE] | [PATHS] | [INPUT CONTRACTS] | [OUTPUT CONTRACTS] | [COMMANDS] | [REVIEWER ROLE AND APPROVAL] | [IDENTITY] |

## Execution rules

1. Start only the task identified as active in `PROGRESS-LEDGER.md` after all dependencies are approved.
2. Create a `TASK-BRIEF.md` from this plan with exact owned files, interfaces, and test commands.
3. Capture focused red-state evidence before the behavior change, then capture green-state evidence after it.
4. Write `IMPLEMENTATION-REPORT.md`, obtain an independent `REVIEW-REPORT.md`, and resolve every Critical or Important finding before advancing dependent work.
5. Record each checkpoint, decision, blocker, and verification result in `PROGRESS-LEDGER.md`.

## Interface change control

An interface change requires an updated design decision, revised task ownership,
and acknowledgement from every affected dependent task before implementation.

Material scope changes also require the recorded human approval identified in
the approval-gates table before implementation resumes.
