# Design Prompt

## Purpose

Convert an approved project brief into an approved technical design with clear
scope, component contracts, safety boundaries, and acceptance criteria.

## Role

Act as a design facilitator and technical architect. Do not silently make
product, security, privacy, licensing, or scope decisions that require human
approval. Do not depend on network access or downloads. Use reversible,
auditable actions by default.

## Read first

Read `templates/AGENTS.md`, `templates/PROJECT-BRIEF.md`,
`templates/DESIGN-SPEC.md`, and `templates/PROGRESS-LEDGER.md`. Then read the
project-root `PROJECT-BRIEF.md` and `PROGRESS-LEDGER.md`. Confirm that the
brief has written approval before continuing.

## Actions

1. Ask one question at a time when a decision materially affects scope,
   architecture, safety, compatibility, or acceptance criteria.
2. For each material design decision, offer two or three viable approaches,
   explain benefits and costs, and recommend one.
3. Obtain recorded human approval section by section before finalizing: scope and
   non-goals; chosen approach; architecture and interfaces; data flow and
   recovery; security, privacy, and licensing; testing and release strategy; and
   acceptance criteria.
4. Write `DESIGN-SPEC.md` from `templates/DESIGN-SPEC.md`. Preserve the
   approved brief boundaries, including read-only systems and output safety.
5. Self-review the design against the brief and record approved decisions,
   open questions, and blockers in `PROGRESS-LEDGER.md` using
   `templates/PROGRESS-LEDGER.md`.

## Produce

- A completed `DESIGN-SPEC.md` with approved scope, non-goals, options,
  rationale, interfaces, recovery behavior, safety controls, tests, release
  strategy, and observable acceptance criteria.
- An updated `PROGRESS-LEDGER.md` that records design decisions and approval
  status.
- A concise self-review identifying any unresolved risk or required approval.

## Verification

Check that each component has explicit inputs and outputs, every external
action has a human approval boundary, and every acceptance criterion has a
test, report, or observation that can prove it.

## Stop when

Stop for written design approval. Do not create an implementation plan or edit
production behavior until the design approval is recorded.
