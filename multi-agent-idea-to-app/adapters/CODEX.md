# Codex Adapter

Use this adapter when Codex is the implementation, architecture, safety, or
independent-review agent. It adapts the shared starter-kit lifecycle to Codex;
it does not replace it. Do not change the lifecycle to fit a chat or thread.
Do not depend on network access or downloads. Use reversible, auditable actions
by default.

For Codex-specific capabilities and current setup, use only the official
[Codex documentation](https://developers.openai.com/codex/). This adapter
does not assume a particular Codex surface, tool list, or permission setting.

## Authoritative project state

Open the repository folder in Codex and read the root `AGENTS.md` plus every
applicable nested `AGENTS.md` before planning or editing. Read the current
`PROGRESS-LEDGER.md`, the approved `TASK-BRIEF.md`, and the prior
`IMPLEMENTATION-REPORT.md` and `REVIEW-REPORT.md` for the active task. Those
files remain authoritative: thread context is useful evidence, but cannot
override recorded decisions, scope, approvals, ownership, or findings.

Before a resumed task, inspect the working tree and reconcile it with the
ledger. Preserve uncommitted work. If the ledger and repository disagree, stop,
record the conflict in the ledger, and obtain the recorded decision maker's
direction.

## Task execution and isolation

Give each Codex task a bounded prompt that includes the task identifier,
objective, owned files, consumed and produced interfaces, required checks,
prohibited actions, and report path. For concurrent repository changes, assign
non-overlapping ownership and isolated branches or worktrees. Do not place
unrelated tasks in one worktree merely because they share a chat.

Use separate Codex agents or sessions for an implementer and a fresh reviewer.
The reviewer reads the actual diff and evidence, writes only reviewer-owned
artifacts, and must not approve its own implementation. Use Codex for
architecture, unsafe I/O, concurrency, security, release integration, and
final review when the recorded plan calls for capable review.

Keep permission prompts and approval boundaries explicit. A Codex permission
to run a command does not grant product authority: actions that are destructive,
external, security-sensitive, privacy-sensitive, licensing-sensitive, or
release-affecting still require the recorded human approval and recovery plan.

## Handoff contract

At handoff, write the structured implementation or review report using the
shared template, include exact red/green/full verification commands and
results, and update `PROGRESS-LEDGER.md` without activating another task.
Record open Critical or Important findings in the ledger. A successful chat
response alone is never a task handoff.

## Kickoff example

```text
Open this repository and read every applicable AGENTS.md. Read the approved
TASK-BRIEF.md, PROGRESS-LEDGER.md, and relevant IMPLEMENTATION-REPORT.md and
REVIEW-REPORT.md. Implement only task [ID]. You own [FILES] and must not alter
[PROHIBITED PATHS OR SYSTEMS]. First add and run the focused red-state check;
then make the smallest scoped change; then run [FOCUSED COMMAND] and [FULL
COMMAND]. Preserve unrelated work. Write [IMPLEMENTATION-REPORT PATH] and
update PROGRESS-LEDGER.md for independent review. Stop without self-approval.
```

## Resume procedure

```text
Resume only the active task in PROGRESS-LEDGER.md. Treat control files as
authoritative and chat history as supporting context. Inspect the working tree
before editing, preserve all uncommitted work, re-read TASK-BRIEF.md and prior
reports, and reconcile any disagreement with the ledger. Run safe verification
needed to establish the current state. If authority, ownership, or approval is
unclear, stop and record the blocker. Stop immediately when any Critical or Important finding remains open.
```
