# Ollama Adapter

Use an Ollama-hosted, code-capable local model only for low-risk supporting
work: bounded drafting, summarization, test-data analysis, straightforward
documentation, or review preparation on approved non-sensitive inputs. Do not change the lifecycle to accommodate a model's context window or output style.
Do not depend on network access or downloads. Use reversible, auditable actions
by default.

Ollama sessions consume the same file-backed project state as every other
adapter. `PROGRESS-LEDGER.md`, the approved `TASK-BRIEF.md`, and the relevant
`IMPLEMENTATION-REPORT.md` and `REVIEW-REPORT.md` remain authoritative; prompt
history and model output are supporting context only.

## Routing and escalation

Route architecture, unsafe I/O, concurrency, security, privacy, licensing,
destructive actions, external side effects, release integration, and final
release decisions to Codex or Claude Code and the recorded human approver.
An Ollama model must not independently approve high-risk work or final release
readiness. It may identify risks or draft findings, but an appropriately
capable independent reviewer must validate those findings and approvals.

Select a local model that is suitable for the language and task, but verify its
actual output against the task contract. Keep its context bundle deliberately
small: include only the applicable guidance, `TASK-BRIEF.md`, relevant control
file excerpts, owned source files, interfaces, and test output. Do not supply
secrets, personal data, credentials, or unrelated repository history.

## Command and prompt wrapper

Use a wrapper that explicitly names the readable paths, writable paths,
allowed commands, prohibited actions, and report destination. Restrict model
output to a patch for owned files or a structured report; a free-form answer
cannot silently change scope or authority.

```text
ROLE: low-risk supporting implementer or analyst
READ ONLY: [APPLICABLE AGENTS.md FILES], PROGRESS-LEDGER.md, TASK-BRIEF.md,
  IMPLEMENTATION-REPORT.md, REVIEW-REPORT.md,
  [RELEVANT SOURCE FILES], [RELEVANT TEST OUTPUT]
WRITE ONLY: [OWNED FILES] and [IMPLEMENTATION-REPORT.md OR REVIEW-REPORT.md]
ALLOWED COMMANDS: [EXACT READ-ONLY OR TEST COMMANDS]
PROHIBITED: network, external actions, destructive commands, scope changes,
  approvals, release decisions, and edits outside WRITE ONLY
TASK: [OBJECTIVE AND ACCEPTANCE CRITERIA]
RETURN: unified patch or report with files, commands, results, assumptions,
  risks, blockers, and escalation needs.
```

Capture the resulting patch or structured output in the shared
implementation/review report, including the model identifier, supplied context
summary, commands actually run, and human or capable-agent verification. The
ledger must record any escalation and open findings; a model's claim is not
verification evidence by itself.

## Resume procedure

Before resuming, inspect the worktree and preserve all uncommitted work. Re-read
the applicable live `AGENTS.md` files, approved `TASK-BRIEF.md`, relevant
implementation and review reports, and the active `PROGRESS-LEDGER.md`.
Reconcile repository state with the ledger before editing. Stop and record a
blocker if authority or ownership is unclear. Stop immediately when any Critical or Important finding remains open.

## Limits and handoff

Local models can omit constraints, hallucinate command output, or lose context
when the repository exceeds their context window. Split only independent,
low-risk work into bounded prompts; do not split an authorization or safety
decision. Require a capable Codex or Claude Code agent to review high-risk
changes and all release evidence.

Before handoff, write the same durable report contract used by all agents and
update `PROGRESS-LEDGER.md` without changing task state beyond the authority
granted in the approved task brief.
