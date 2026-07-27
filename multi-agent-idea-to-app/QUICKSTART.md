# Multi-Agent Idea-to-App Quickstart

Use this kit when you want a technical product idea to become a reviewed,
validated release candidate with durable evidence.

1. **Copy the templates** from `templates/` into your new project's root and
   keep the prompts and adapters available beside them.
2. Fill `PROJECT-BRIEF.md` from [the project-brief template](templates/PROJECT-BRIEF.md):
   describe the user problem, inputs, safe output locations, constraints,
   exclusions, risks, and success evidence.
3. **Start with discovery** by giving
   [the discovery prompt](prompts/01-discovery.md) and the live control files
   to your chosen agent. It inspects inputs safely and records the brief and
   ledger state.
4. **Approve the written design** after the options, chosen architecture,
   safety assumptions, and acceptance criteria are recorded in
   `DESIGN-SPEC.md`.
5. Approve the dependency-ordered `IMPLEMENTATION-PLAN.md`, including task
   ownership, red/green/full checks, review gates, and approval boundaries.
6. Run one task at a time by default: implementation captures red/green
   evidence and a report; a different agent reviews the actual patch. For an
   approved parallel batch, give each independent task an isolated worktree or
   branch and a scoped ledger with one active task per execution lane; one named
   control-file coordinator alone reconciles child reports into the parent
   ledger. Resolve and re-review every Critical or Important finding.
7. Integrate approved tasks, validate with safe representative inputs, and
   collect fresh packaging, license, package-content, smoke-test, and
   reconciliation evidence in `RELEASE-CHECKLIST.md`.
8. **Do not release** until that evidence is complete, an independent release
   review is recorded, and the human owner has given final recorded approval.

## Codex-first kickoff

Open the project in Codex, copy [the Codex adapter](adapters/CODEX.md) into the
task context, then use this concise kickoff:

```text
Read every applicable AGENTS.md, then read PROJECT-BRIEF.md and
PROGRESS-LEDGER.md. Run prompts/01-discovery.md exactly. Inspect supplied
inputs read-only, write the completed brief and ledger, list required human
approvals, and stop for written brief approval. Do not begin design or edit
unapproved source files.
```

## Cross-tool handoff

After a Codex implementer completes its report, send a different agent the
live `AGENTS.md`, approved `TASK-BRIEF.md`, implementation report, current
ledger, and actual patch. Use [the Claude Code adapter](adapters/CLAUDE-CODE.md)
or [generic adapter](adapters/GENERIC-AGENT.md) with the task-review prompt.
The reviewer writes only its review report and ledger update; it must not
self-approve or edit the implementation-owned files.

For the full process, controls, recovery rules, and provider routing, read the
[handbook](HANDBOOK.md). See a complete fictional record in
[the worked example](examples/idea-to-app-example.md).
