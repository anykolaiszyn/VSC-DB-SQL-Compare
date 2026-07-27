# Claude Code Adapter

Use this adapter to run the shared lifecycle through Claude Code. The shared
control files define the project; a Claude Code conversation is supporting
context. Do not change the lifecycle to suit a session or local convention.
Do not depend on network access or downloads. Use reversible, auditable actions
by default.

For environment setup and current product behavior, consult official
[Claude Code documentation](https://docs.anthropic.com/en/docs/claude-code/overview).
This adapter deliberately avoids relying on optional or unstable product
features.

## Authoritative project state

Start in the repository and read its repository guidance file and any
applicable nested guidance, then read `PROGRESS-LEDGER.md`, the approved
`TASK-BRIEF.md`, and the active task's `IMPLEMENTATION-REPORT.md` and
`REVIEW-REPORT.md`. These shared files remain authoritative. A prompt may
repeat constraints for clarity, but may not change recorded scope, approvals,
ownership, lifecycle state, or review findings.

Before editing, inspect the current branch and working tree. Preserve existing
uncommitted changes. If repository state conflicts with the ledger or reports,
record the conflict and request the recorded decision maker's direction rather
than selecting an interpretation silently.

## Bounded sessions and isolation

Use one bounded implementer prompt per approved task. State the task ID,
objective, files owned, interfaces, prohibited changes, exact verification,
and implementation-report destination. Assign overlapping files only
sequentially. For independent concurrent changes, use separate branches or
worktrees and name the owner in the ledger.

Use a separate Claude Code session for review. The reviewer checks the actual
patch and surrounding context, performs safe fresh verification, and writes
the structured `REVIEW-REPORT.md`; it does not edit implementation-owned
files or approve its own work. Escalate architecture, security, unsafe I/O,
licensing, release integration, and other high-risk decisions to the capable
independent reviewer named by the plan and to the recorded human approver.

## Handoff contract

Every task ends in the same durable state: a completed implementation or
review report and an accurate `PROGRESS-LEDGER.md`. Include files and
interfaces, exact red/green/full commands and results, risks, blockers, open
findings, and a patch or commit identity. Do not treat a chat transcript as
the report or as approval.

## Kickoff example

```text
Read the repository guidance, PROGRESS-LEDGER.md, approved TASK-BRIEF.md, and
the active task reports. Implement only [TASK ID] with ownership of [FILES].
Do not alter [PROHIBITED PATHS OR SYSTEMS]. Add and run the declared red-state
test before implementation, make the smallest scoped patch, and run [FOCUSED
COMMAND] and [FULL COMMAND]. Preserve unrelated work. Write
[IMPLEMENTATION-REPORT PATH], update PROGRESS-LEDGER.md for independent
review, and stop without self-approval.
```

## Resume procedure

```text
Resume only the active task from PROGRESS-LEDGER.md. Treat TASK-BRIEF.md,
IMPLEMENTATION-REPORT.md, and REVIEW-REPORT.md as authoritative. Inspect the
working tree before editing and preserve uncommitted work. Reconcile any
conflict with the ledger, re-run safe relevant verification, and stop for
unclear scope, approval, or ownership. Stop immediately when any Critical or Important finding remains open.
```
