# Claude Code Subagent Definitions

Ready-to-use [Claude Code subagent](https://docs.anthropic.com/en/docs/claude-code/sub-agents)
definitions for the three roles in the kit's Task Loop phase
(`HANDBOOK.md`'s "Agent roles" table): `implementer`, `reviewer`, and
`orchestrator`. These are Claude-Code-specific — the
[adapters](../adapters/) directory covers the same three roles narratively
for other tools (Codex, Ollama, a generic agent); these files are the
literal, loadable agent definitions for Claude Code.

## What's here

- **`implementer.md`** and **`reviewer.md`** — real dispatchable subagents.
  Each reads `TASK-BRIEF.md`/`IMPLEMENTATION-REPORT.md` as authoritative,
  follows the kit's test-first evidence chain, and never self-approves.
- **`orchestrator.md`** — a reference protocol, not a dispatchable
  subagent. It has no `model` field and is not meant to be spawned through
  Claude Code's Agent/Task tool; instead, whoever is driving the session
  (human or top-level agent) reads it and follows it directly. The
  orchestrator makes approval-adjacent judgment calls (scope-creep vs.
  acceptable, blocking vs. tracked-debt) that should stay with the entity
  holding the full conversation context, not get delegated to a subagent
  that starts cold on every dispatch.

## How to activate the two dispatchable agents

Claude Code discovers subagents from `~/.claude/agents/` (user-global) or
a project's own `.claude/agents/` (project-local) — not from arbitrary
paths inside a vendored kit. Copy or symlink the two dispatchable files
into wherever you want them available:

```bash
# User-global (available in every project on this machine)
cp implementer.md reviewer.md ~/.claude/agents/

# Project-local (available only in this repo, version-controlled with it)
mkdir -p .claude/agents
cp multi-agent-idea-to-app/agents/implementer.md multi-agent-idea-to-app/agents/reviewer.md .claude/agents/
```

Once copied, dispatch them via the Agent tool with `subagent_type:
"implementer"` or `subagent_type: "reviewer"` — see `orchestrator.md`
step 4/5 for the expected dispatch pattern (task-specific pointers only,
never a restated/paraphrased copy of the brief).

These files are plain Markdown with YAML frontmatter (`name`,
`description`, optional `model`) and no Claude-Code-internal magic beyond
that — adapting them for a different tool's subagent mechanism should be
straightforward if that tool supports a similar concept.
