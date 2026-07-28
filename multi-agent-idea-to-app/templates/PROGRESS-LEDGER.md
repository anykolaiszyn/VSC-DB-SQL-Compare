# [PROJECT NAME] — Progress Ledger

## Current lifecycle state

- **Phase:** [DISCOVERY/DESIGN/PLANNING/IMPLEMENTATION/REVIEW/RELEASE/HANDOFF]
- **Exactly one task may be active:** [TASK ID OR NONE]
- **Last updated:** [DATE AND OWNER]
- **Current decision maker:** [NAME OR ROLE]

## Task register

| Task ID | Objective | Dependencies | Agent or tool | Files owned | Status | Review state | Latest verification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [TASK ID] | [OBJECTIVE] | [TASK IDS OR NONE] | [AGENT OR TOOL] | [PATHS] | [NOT STARTED/ACTIVE/PAUSED/COMPLETE/BLOCKED] | [NOT REQUESTED/IN REVIEW/APPROVED/CHANGES REQUIRED] | [COMMAND, DATE, AND RESULT] |

## Open findings

| ID | Severity | Source task or review | Owner | Required resolution | Status |
| --- | --- | --- | --- | --- | --- |
| [ID OR NONE] | [CRITICAL/IMPORTANT/MINOR] | [SOURCE] | [OWNER] | [ACTION] | [OPEN/RESOLVED/OPEN (ACCEPTED, NON-BLOCKING; TRACKED FOR TASK ID)] |

A Critical or Important finding is always OPEN or RESOLVED — never
accepted as non-blocking; those severities gate task completion by
definition. A Minor finding may legitimately stay open long-term as
accepted, non-blocking debt: record it as `OPEN (accepted, non-blocking;
tracked for [TASK ID])` with the specific future task that owns
addressing it, rather than leaving it open with no owner or silently
dropping it from the table once its originating task is complete.

## Blockers and dependencies

| Item | Blocking effect | Owner | Needed action | Date recorded |
| --- | --- | --- | --- | --- |
| [BLOCKER OR DEPENDENCY] | [EFFECT] | [OWNER] | [ACTION] | [DATE] |

## Decisions and approvals

| Date | Decision | Rationale | Approver | Affected tasks |
| --- | --- | --- | --- | --- |
| [DATE] | [DECISION] | [RATIONALE] | [NAME OR ROLE] | [TASK IDS] |

## Cost notes

| Date | Activity | Time or spend | Value or trade-off | Owner |
| --- | --- | --- | --- | --- |
| [DATE] | [ACTIVITY] | [AMOUNT] | [NOTE] | [OWNER] |
