# [PROJECT NAME] — Operating Contract

## Mission

Deliver [DELIVERABLE] for [INTENDED USERS]. The completed result satisfies the
approved design, preserves the stated safety boundaries, and can be verified
from recorded evidence.

## Source of truth

These files are authoritative project state and must be read before work. Chat
history is supporting context, not an authority that can replace or override a
recorded decision:

- `PROJECT-BRIEF.md` — intent, constraints, approvals, and success measures.
- `DESIGN-SPEC.md` — approved scope, technical decision, and acceptance criteria.
- `IMPLEMENTATION-PLAN.md` — dependency order, interfaces, ownership, and gates.
- `PROGRESS-LEDGER.md` — current lifecycle state, active task, decisions, and blockers.
- `TASK-BRIEF.md`, `IMPLEMENTATION-REPORT.md`, and `REVIEW-REPORT.md` — task evidence.
- `RELEASE-CHECKLIST.md` — release evidence and final approval.

When two control files disagree, stop work, record the conflict in the ledger,
and obtain [DECISION MAKER]'s written decision before changing scope.

## Agent roles and authority

- Codex, Claude Code, Ollama, and generic agents must follow this operating
  contract and record decisions in the authoritative files above.
- Ollama is limited to low-risk supporting work, such as local drafting,
  summarization, and bounded analysis of approved non-sensitive inputs.
- Ollama must not independently approve high-risk work or release readiness.
- No agent may substitute its own approval for the human approval gates in the
  implementation plan or release checklist.

## Safety boundaries

- Treat [SOURCE SYSTEMS OR DATA] as read-only unless a recorded approval says otherwise.
- Do not delete, overwrite, move, publish, send, deploy, charge, or contact external parties without the approval recorded in `PROJECT-BRIEF.md`.
- Keep secrets, personal data, production credentials, and unapproved customer data out of logs, reports, tests, and generated artifacts.
- Use isolated output paths under [SAFE OUTPUT ROOT]; verify containment before writing.
- Preserve unrelated changes. Never use destructive repository commands unless [DECISION MAKER] explicitly authorizes the exact target and recovery plan.

## Verification

- Add or update a focused automated test before changing behavior; record the failing red-state command and output in the task brief.
- Run the focused test after the change, then the full required verification listed in the plan.
- Record exact commands, exit status, relevant counts, and any skipped checks in the implementation report and ledger.
- Do not claim a task, review, or release is complete without fresh evidence from the appropriate command or inspection.
- A task must not be marked complete while Critical or Important findings remain open.
- Collect and record fresh candidate evidence before requesting final human release approval.
- Independent agent review does not substitute for final human release approval.

## Ownership and parallel work

- A task may modify only its declared files and interfaces. Request a revised task brief before expanding ownership.
- Run parallel tasks only when their owned files and dependencies do not overlap. Each worker must read the ledger before editing and re-read it before handoff.
- Preserve changes from other workers. Resolve conflicts by updating the plan and ledger rather than silently replacing another task's work.
- Every implementation task receives an independent review by a reviewer who did not author the task's change.

## Handoff contract

Every handoff report includes:

- task identifier, objective, and lifecycle status;
- files changed and interfaces produced or consumed;
- red-state and green-state commands with concise output;
- assumptions, risks, blockers, and open findings;
- patch or commit identity; and
- recommended next action and required owner.

Use the exact templates named in the source-of-truth list so later tools can
read project state consistently.
