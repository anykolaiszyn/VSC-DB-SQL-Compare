# Generic Agent Adapter

Use this adapter for an agent tool not covered by a provider-specific guide.
It defines the minimum interoperability contract for the shared starter-kit
lifecycle. Do not change the lifecycle to fit the tool.
Do not depend on network access or downloads. Use reversible, auditable actions
by default.

## Minimum capability contract

The agent must be able to:

- read a bounded context bundle containing applicable project guidance,
  `PROGRESS-LEDGER.md`, the approved `TASK-BRIEF.md`, and the relevant
  `IMPLEMENTATION-REPORT.md` and `REVIEW-REPORT.md`;
- produce a reviewable patch or edit only declared owned files;
- execute the declared tests or report precisely which commands it could not
  execute and why; and
- write the structured task report required by the shared template.

If the agent cannot meet one of these requirements, use it only for clearly
labelled non-authoritative assistance and assign execution, verification, and
handoff to a compatible agent.

## Invocation contract

Every task prompt supplies the task identifier, objective, dependencies,
approvals, files owned, interfaces consumed and produced, prohibited changes,
safe command allowlist, exact verification commands, and report destination.
State whether the agent is the implementer or the independent reviewer.

The prompt must say that the shared control files are authoritative and that
chat context is supporting context. The agent cannot silently change scope,
ownership, authority, lifecycle state, approvals, or acceptance criteria. It
must stop and report a blocker when those instructions conflict or are missing.

## Isolation, evidence, and handoff

Use a separate workspace, branch, or worktree for simultaneous changes with
non-overlapping ownership. Preserve unrelated work. An implementer writes the
implementation report; an independent reviewer examines the actual patch,
writes the review report, and never approves its own implementation.

The handoff must update `PROGRESS-LEDGER.md` and record files changed,
interfaces, exact red-state and green-state commands and results, full
verification, assumptions, risks, blockers, open findings, and patch or commit
identity. A conversational success statement is not a handoff or approval.

## Resume procedure

Before resuming, inspect the worktree and preserve all uncommitted work. Re-read
the applicable live `AGENTS.md` files, approved `TASK-BRIEF.md`, relevant
implementation and review reports, and the active `PROGRESS-LEDGER.md`.
Reconcile repository state with the ledger before editing. Stop and report a
blocker if authority or ownership is unclear. Stop immediately when any Critical or Important finding remains open.

## Portable prompt

```text
Read [APPLICABLE AGENTS.md FILES], PROGRESS-LEDGER.md, approved TASK-BRIEF.md, and relevant
IMPLEMENTATION-REPORT.md and REVIEW-REPORT.md. You are the [IMPLEMENTER OR
INDEPENDENT REVIEWER] for [TASK ID]. You may read [CONTEXT PATHS], write only
[OWNED PATHS], and run only [COMMANDS]. Do not change scope, authority,
approvals, lifecycle state, or files outside ownership. Produce [PATCH OR
STRUCTURED REPORT], include exact verification results and blockers, update
PROGRESS-LEDGER.md only as authorized, and stop for any conflict or missing
approval.
```
