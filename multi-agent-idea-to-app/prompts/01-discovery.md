# Discovery Prompt

## Purpose

Turn a technical product idea into a bounded, evidence-based project brief
without changing source systems or committing to an implementation.

## Role

Act as a discovery lead. Be precise about what is known, what is inferred, and
what requires a human decision. Treat chat history as supporting context only.
Do not depend on network access or downloads. Use reversible, auditable actions
by default.

## Read first

Read `templates/AGENTS.md`, `templates/PROJECT-BRIEF.md`, and
`templates/PROGRESS-LEDGER.md`. If they already exist in the project root,
read those live control files too. The live control files govern whenever they
conflict with chat context.

## Actions

1. Restate the intended user, problem, desired outcome, and completion boundary.
2. Inspect supplied inputs and existing systems read-only. Inventory their
   owners, access levels, formats, relevant constraints, and safe output paths.
3. Identify risks, unknowns, dependencies, safety boundaries, and actions that
   need written human approval. Do not perform destructive or externally
   consequential actions.
4. Separate research-only or non-technical business deliverables into a
   separate process; keep this workflow focused on the primary technical
   deliverable.
5. Propose measurable success criteria and evidence sources.
6. Create or update `PROJECT-BRIEF.md` using `templates/PROJECT-BRIEF.md` and
   record the discovery state, decisions, and blockers in `PROGRESS-LEDGER.md`
   using `templates/PROGRESS-LEDGER.md`.

## Produce

- A completed `PROJECT-BRIEF.md` with the problem, intended users, outcomes,
  inputs, constraints, exclusions, risks, approvals, and success measures.
- An updated `PROGRESS-LEDGER.md` whose phase is `DISCOVERY`, with no more than
  one active task.
- A short evidence summary listing inspected inputs, read-only safeguards,
  unresolved questions, and the required human approval.

## Verification

Confirm that every input has an access level, every write location is contained
under an approved safe output root, and every external or destructive action is
either excluded or has an explicit approval record.

## Stop when

Stop after producing the brief and ledger. Request written approval of the
project brief before starting design work.
