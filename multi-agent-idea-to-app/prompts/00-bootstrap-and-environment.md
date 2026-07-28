# Bootstrap and Environment Prompt

## Purpose

Get a working environment ready to run this project's actual tooling —
before Discovery, before resuming an in-progress project on a new machine
or in a new IDE, and before dispatching any Implementer/Reviewer subagent.
This is environment setup, not lifecycle work: it produces no control-file
content and makes no project decisions. Distinct from
[08-handoff-and-resume.md](08-handoff-and-resume.md), which reconciles
*project state* (the ledger, the working tree, uncommitted work); this
prompt reconciles *environment state* (runtimes, dependencies, local
config) so that project state can be acted on at all.

## Role

Act as a cautious environment setup assistant. Detect and report what is
present and what is missing; do not install, download, or modify global
machine state without asking first. Do not depend on network access being
available. Use reversible, auditable actions by default.

## Read first

Read `AGENTS.md` (or the project's equivalent operating contract) and
`PROGRESS-LEDGER.md`, if either already exists at the project root — they
may name specific tool versions, package managers, or environment
constraints that override this prompt's generic defaults. Read the
project's dependency manifest(s) (e.g. `package.json`, `pyproject.toml`,
`Cargo.toml` — whatever the project's stack uses) for any declared runtime
version constraint (e.g. an `engines` field).

## Actions

1. **Identify the project's stack** from its dependency manifest(s) and
   any build/lint/test configuration files present. Do not assume a stack;
   detect it from what is actually in the repository.
2. **Check for each required runtime and tool**, reporting present vs.
   missing vs. version-mismatched rather than assuming any of them exist:
   - The language runtime(s) the manifest declares or implies, at the
     version the manifest constrains (if any).
   - The package manager the project's lockfile implies (e.g. a
     `package-lock.json` implies npm, a `pnpm-lock.yaml` implies pnpm —
     do not default to a different package manager than the lockfile
     already committed to the repository names).
   - Any project-specific CLI or service the project's own documentation
     names as a dependency (a database engine, a container runtime, a
     platform SDK) — check what the project's own docs say is required
     before assuming a generic list.
3. **Check for dependency installation state**: does an install step need
   to run (e.g. no `node_modules/`, or a lockfile newer than what's
   installed)? Report this rather than assuming either a clean or an
   already-installed state.
4. **Check for any project-specific local configuration this kit's own
   process depends on** — for a Claude Code environment specifically,
   whether this project's [agents/](../agents/) subagent definitions
   (Implementer, Reviewer) are present in `~/.claude/agents/` or a
   project-local `.claude/agents/`. See [agents/README.md](../agents/README.md)
   for what "present" means and how to copy them in.
5. **Surface a concrete report**: what's present and matches, what's
   present but version-mismatched, what's entirely missing, and what a
   fresh install/setup command for each missing piece would be — but do
   not run any installation, download, or global-configuration command
   without asking first. This applies even to a command that looks
   obviously safe (e.g. `npm install` inside the project directory) —
   confirm before running it, since the person resuming this project may
   have a reason to want a different install strategy (a specific lockfile
   state, an offline cache, a version pin) that isn't visible from the
   repository alone.
6. Once the environment is confirmed ready (either everything was already
   present, or the user approved and you ran the needed setup steps), run
   the project's own full verification command (as named in
   `IMPLEMENTATION-PLAN.md`'s "Plan controls" section, or discoverable from
   the manifest's own scripts) to confirm the environment actually works,
   not just that the tools are installed.

## Produce

- A concrete environment status report: present/missing/mismatched for
  every runtime, package manager, and project-specific dependency
  identified in step 2–4.
- Either confirmation that the full verification command passed on this
  environment, or a specific, actionable list of what's still needed
  before it can.
- No control-file edits. This prompt does not touch `PROGRESS-LEDGER.md`,
  `TASK-BRIEF.md`, or any other lifecycle document — environment readiness
  is a precondition for the lifecycle, not a step within it.

## Verification

Confirm the full verification command was actually run (not merely that
tools appear installed) and its exact output and exit code are reported.

## Stop when

Stop after the environment status report and, if applicable, the full
verification command's result. If any setup step requires installing,
downloading, or modifying global machine state, stop and ask before doing
it — do not proceed on the assumption that resuming a project implies
consent to modify the environment. If the full verification command fails
for reasons unrelated to missing tooling (an actual code or test failure),
stop and report it rather than attempting a fix — that is lifecycle work
for [08-handoff-and-resume.md](08-handoff-and-resume.md) or the active
task's own loop, not this prompt's job.
