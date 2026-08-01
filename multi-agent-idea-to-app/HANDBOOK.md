# Multi-Agent Idea-to-App Handbook

This starter kit is a file-backed way to take a technical product idea through
design, implementation, validation, and release. It works with Codex, Claude
Code, Ollama, or another capable agent without making any provider the source
of truth.

## Why this works

Chat is useful for discussion, but it is unreliable as a project record: a
session can end, a model can be changed, a context window can fill, and an
interrupted task can leave partial work behind. Durable project artifacts make
the decisions, ownership, evidence, and next action visible to every agent and
to the human owner. The live `PROJECT-BRIEF.md`, `DESIGN-SPEC.md`,
`IMPLEMENTATION-PLAN.md`, reports, and `PROGRESS-LEDGER.md` are the project
record; a chat history is supporting context.

Copy the kit's control-file templates into the project root, then keep their
live versions current. Start from [PROJECT-BRIEF.md](templates/PROJECT-BRIEF.md),
[DESIGN-SPEC.md](templates/DESIGN-SPEC.md),
[IMPLEMENTATION-PLAN.md](templates/IMPLEMENTATION-PLAN.md), and
[PROGRESS-LEDGER.md](templates/PROGRESS-LEDGER.md). The project-specific
`AGENTS.md`, created from [the template](templates/AGENTS.md), tells agents
which rules apply. Use the prompts and templates as linked operating tools;
this handbook explains their relationship instead of copying their text.

## Lifecycle

Before any lifecycle phase — whether starting fresh or resuming an
existing project on a new machine or in a new IDE — use
[00-bootstrap-and-environment.md](prompts/00-bootstrap-and-environment.md)
to confirm the runtimes, package manager, and any project-specific local
configuration (including this kit's [Claude Code subagent
definitions](agents/README.md), if applicable) are actually present before
acting on project state. This is environment setup, not a lifecycle phase
itself; it produces no control-file content.

The lifecycle has eight phases. Each phase creates evidence that the next one
must read. Move forward only when the recorded gate is satisfied.

1. **Discovery.** Use [01-discovery.md](prompts/01-discovery.md) to inspect
   supplied inputs read-only, identify users and boundaries, record risks and
   success measures in the project brief, and update the ledger. Stop for
   written brief approval before design.
2. **Options and Design.** Use [02-design.md](prompts/02-design.md) to compare
   feasible approaches, choose one, define component and safety contracts, and
   record the decision in the design specification. Approval includes the
   recorded security, privacy, and licensing assumptions.
3. **Implementation Planning.** Use
   [03-implementation-plan.md](prompts/03-implementation-plan.md) to turn the
   approved design into dependency-ordered, owned tasks with checks and review
   gates. The human approves this written plan before implementation starts.
4. **Task Loop.** For exactly one active task, create a bounded brief from
   [TASK-BRIEF.md](templates/TASK-BRIEF.md), use
   [04-task-implementation.md](prompts/04-task-implementation.md), capture a
   focused red state before the behavior change, make the smallest scoped edit,
   and capture focused and full green evidence in
   [IMPLEMENTATION-REPORT.md](templates/IMPLEMENTATION-REPORT.md). A different
   agent applies [05-task-review.md](prompts/05-task-review.md) and writes the
   [review report](templates/REVIEW-REPORT.md). Critical and Important findings
   return to a new bounded task loop; they cannot be self-approved away. A
   Critical or Important finding on the *same* task returns to that task's
   own loop (new red-state evidence reproducing the exact finding, on the
   same branch, followed by a fresh independent re-review). A finding that
   is self-contained, low-risk, and separable from the original task's
   remaining scope — most often a Minor finding an owner decides to close
   immediately rather than merely track — may instead become its own small
   bounded task, named as a lettered suffix of the task whose review
   produced it (e.g. `T-08a` following from a finding in `T-08`'s review),
   with its own `TASK-BRIEF.md` scoped only to that finding's resolution.
   Record either path explicitly in the ledger's task register and open
   findings table; do not fold an unrelated fix into a later, unrelated
   task's scope just because that task happens to touch nearby code. Once
   a task is independently approved, merging it into the trunk branch is
   not itself evidence that the trunk still works — install any
   dependencies the merge introduced and re-run the full verification
   command again on the merged trunk before marking the task complete in
   the ledger. A clean merge can still produce a broken trunk (a missed
   dependency, a conflict resolved the wrong way, a test that only passed
   in isolation); catching that immediately, one task at a time, is far
   cheaper than discovering it during Integration below.
5. **Integration.** Use [06-integration.md](prompts/06-integration.md) to
   reconcile approved tasks with their actual interfaces and test combined
   behavior. An integration defect is not a reason for an unowned broad fix:
   create an approved remediation task brief and review it independently.
6. **Real-World Validation.** Exercise the combined product with approved,
   representative inputs in safe output locations. Preserve read-only sources,
   record exact commands and observed counts, and reconcile output files with
   reports. This is stronger evidence than a synthetic test alone.
7. **Release.** Use [07-release.md](prompts/07-release.md) and the
   [release checklist](templates/RELEASE-CHECKLIST.md) to collect fresh source
   checks, deterministic packaging evidence, dependency and license inventory,
   package-content review, and a bounded packaged-app smoke test. An
   independent release review follows that evidence. Collect and record fresh
   candidate evidence before requesting final human release approval.
   Independent agent review does not substitute for final human release
   approval. Record the human decision, approver, timestamp, exact evidence or
   artifact hash identity, and any conditions in the release checklist.
8. **Handoff.** Use [08-handoff-and-resume.md](prompts/08-handoff-and-resume.md)
   whenever the owner, agent, tool, or session changes. Reconcile the working
   tree with the ledger, preserve uncommitted work, state the active task and
   blockers, and stop when authority or state is unclear. When the handoff
   also moves to a new machine or IDE, run
   [00-bootstrap-and-environment.md](prompts/00-bootstrap-and-environment.md)
   first — a clean ledger and working tree are not useful if the runtimes
   and dependencies needed to act on them are not yet present.

## Agent roles

Assign roles by risk and evidence needs, not by brand. One agent may serve
different roles at different points, but an implementation author cannot be
the Independent Reviewer of that same task.

| Role | Responsibility and routing |
| --- | --- |
| **Lead Orchestrator** | Maintains the lifecycle, ledger, task order, and approval requests. Routes work and preserves boundaries; it does not silently broaden scope. |
| **Architect** | Turns discovery evidence into options, contracts, non-goals, and a design recommendation. Use a capable Codex or Claude Code session for safety-sensitive, concurrent, or architectural decisions. |
| **Implementer** | Owns only the files and interfaces in an approved task brief, runs the red/green/full checks, and writes an implementation report. |
| **Independent Reviewer** | Is different from the Implementer, inspects the actual patch and surrounding context, reruns safe checks, and records Critical, Important, and Minor findings. It does not edit implementation-owned files. |
| **Local Supporting Agent** | Uses Ollama or another local model for bounded, low-risk drafting, fixture analysis, or review preparation on approved non-sensitive inputs. It may flag risks but must not independently approve high-risk work or release readiness. See [OLLAMA.md](adapters/OLLAMA.md). |
| **Release Reviewer** | Independently examines candidate evidence, package contents, licenses, real-input validation, and known limitations before the human release decision. Use a capable Codex or Claude Code reviewer for release integration. |

Use the adapter that matches the current surface:
[Codex](adapters/CODEX.md), [Claude Code](adapters/CLAUDE-CODE.md),
[Ollama](adapters/OLLAMA.md), or [a generic agent](adapters/GENERIC-AGENT.md).
For Claude Code specifically, [agents/](agents/) has ready-to-copy subagent
definitions for the Implementer and Reviewer roles above, plus a reference
protocol for the Lead Orchestrator role — see [agents/README.md](agents/README.md).
Adapters preserve the same control files and lifecycle; they do not grant
authority that the plan or human owner did not record.

## Human approval gates

The human owner approves decisions that alter what will be delivered or affect
people, systems, money, security, privacy, licensing, or release state. Record
the decision, conditions, date, and approver in the plan and ledger.

- Approve the project brief before design.
- Approve the written design, including security, privacy, and licensing
  assumptions, before planning.
- Approve the implementation plan before task work starts.
- Re-approve material scope or interface changes before implementation resumes.
- Approve destructive or externally consequential actions with an exact target
  and recovery plan before performing them.
- Approve release readiness only after fresh candidate evidence is complete.

The approval table in [IMPLEMENTATION-PLAN.md](templates/IMPLEMENTATION-PLAN.md)
is the durable place to record these gates.

## Quality gates

Quality is a chain of evidence, not a statement that a task "looks done."

- [ ] A task brief gives one owner, owned files, consumed and produced
  interfaces, excluded paths, and exact checks.
- [ ] The implementer has observed a focused failing check for the missing or
  incorrect behavior, then focused and full passing results after the change.
- [ ] The implementation report names commands, outputs, changed files,
  assumptions, and remaining risks.
- [ ] A different agent reviews the real diff and its context; all Critical and
  Important findings are resolved and re-reviewed.
- [ ] Parallel execution follows the execution-lane rule below; it never puts
  more than one active task in a single ledger.
- [ ] Integration checks actual component boundaries, not merely individual
  unit results.
- [ ] Real-input and release work protect read-only sources, constrain output
  paths, and reconcile reports, counts, and artifacts.

Every task gets the full brief/implement/review chain above — that is not
negotiable. What can scale with risk is how hard the review leans in: a
task with a real safety property to verify (a read-only guarantee, a
row-cap enforcement, an injection surface) warrants the reviewer's full
adversarial-probing effort regardless of how small the change looks; a
low-risk, easily-inspected task (pure data, a rename, a doc-only fix)
does not need the same depth of independent re-derivation to reach a
trustworthy APPROVED. Note the intended review depth in the task brief's
handoff section (see [agents/orchestrator.md](agents/orchestrator.md)
step 2) rather than leaving it for the reviewer to guess.

### Parallel execution lanes

Default is sequential: **one active task per execution lane**. A normal
project uses one lane and its `PROGRESS-LEDGER.md` therefore records exactly
one active task.

Parallelism is an explicit exception, not a way to place several active tasks
in a shared ledger. The human approves a parallel batch only when tasks are
independent and have non-overlapping ownership. Each approved task receives an
isolated worktree or branch and a scoped ledger with exactly one active task.
One named control-file coordinator alone reconciles child reports, approvals,
findings, and completed checkpoints into the parent ledger. The parent ledger
tracks the batch and coordinator; it does not represent child tasks as multiple
simultaneously active tasks.

## Cost controls

Treat agent time and context as planned resources. The ledger's cost notes
make trade-offs visible without requiring a particular pricing model.

- Send each agent only the task brief, applicable guidance, relevant interfaces,
  owned files, and needed test output; do not send the whole repository by
  default.
- Use local supporting agents for low-risk, well-bounded work; escalate
  architecture, unsafe I/O, security, concurrency, licensing, release
  integration, and final review to a capable reviewer and the human owner.
- Keep one active task per execution lane and preserve dependency order so
  expensive rework does not spread through parallel branches.
- Stop on an open Critical or Important finding, missing approval, unclear
  ownership, or failing evidence. A short pause is cheaper than speculative
  repairs.
- Prefer existing project tools and offline, reproducible checks. Do not treat
  a download, permission, or model response as evidence of correctness.

## Switching tools

A tool switch should feel like a controlled handoff, not a restart. The
outgoing agent updates the implementation or review report and the ledger with
the active task, patch or commit identity, commands run, observed results,
uncommitted changes, approvals, findings, and next owner. The incoming agent
reads the live `AGENTS.md`, relevant control files, and working tree before
editing.

For example, use Codex to examine filesystem containment or task integration,
ask Ollama to prepare non-sensitive fixture descriptions for an approved task,
then send the same task brief and resulting report to a separate Claude Code
reviewer. The reviewer verifies the patch independently; it never relies on
the previous model's claim. Follow the tool-specific resume wrapper in the
chosen adapter and the shared [handoff prompt](prompts/08-handoff-and-resume.md).

## Failure and recovery

Interruption, quota exhaustion, partial patches, and failed checks are normal
workflow states. They are not permission to discard work or skip a gate.

1. Stop safely; do not start another task or overwrite partial work.
2. Inspect the branch or worktree and preserve uncommitted changes.
3. Compare the working tree, reports, and ledger. Record any disagreement as a
   blocker for the named decision maker.
4. Re-run only safe checks needed to establish the present state.
5. Resume only the ledger's active task with its approved brief. If no task is
   active, authority is missing, or a Critical or Important finding remains
   open, request direction instead of selecting new work.
6. Capture the resumed evidence and return through independent review before
   advancing.

Use the [handoff prompt](prompts/08-handoff-and-resume.md) and
[implementation report template](templates/IMPLEMENTATION-REPORT.md) to make
the next session productive without trusting a lost chat transcript.
