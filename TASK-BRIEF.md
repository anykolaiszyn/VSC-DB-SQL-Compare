# ParityLens — Task Brief T-08a (R-01 hardening follow-up)

## Objective

Harden `parseDefinition`'s credential-shaped-field blocklist (from T-08) by
adding the concrete missing names the T-08 independent review demonstrated
bypass detection: `auth`, `pass`, `db_pass`, `key`, `passphrase`. This closes
open finding **R-01** before T-09 begins resolving named connections into
real credentials, per the owner's decision recorded in `PROGRESS-LEDGER.md`
on 2026-07-27.

## Dependencies

- **Required completed tasks:** T-08 (Parity YAML definition schema/parser)
  — COMPLETE and APPROVED.
- **Required decisions or approvals:** Owner decision (2026-07-27, recorded
  via `AskUserQuestion`): harden the blocklist before starting T-09, rather
  than deferring to T-17/T-18/T-19.

## Files owned

- `packages/engine/src/orchestration/definition/**` (same files T-08 owned)

Do not touch any other package or file.

## Interfaces

| Direction | Interface | Contract | Producer or consumer |
| --- | --- | --- | --- |
| Consumed | `parseDefinition`'s existing credential-detection logic (T-08) | The current field-name blocklist and recursive-check mechanism in `packages/engine/src/orchestration/definition/definition.ts` | Same file, extending its existing constant/set of rejected field names |
| Produced | Extended credential-field blocklist | Adds at minimum: `auth`, `pass`, `db_pass`, `key`, `passphrase` (case- and separator-insensitive, consistent with T-08's existing matching behavior) to the existing rejected-field-name set. `parseDefinition` must still throw `InvalidDefinitionError` (or T-08's equivalent) for a document containing any of these fields, at any nesting depth, matching the existing detection mechanism's behavior for the original field names | Consumed by T-09 |

## Prohibited changes

- Do not change the detection *mechanism* (exact-field-name blocklist plus
  the `connection`-must-be-a-bare-string structural rule) — this task only
  extends the list of names, per the reviewer's specific recommendation. A
  broader value-pattern/entropy-based heuristic is out of scope and was
  explicitly characterized by the T-08 reviewer as a "legitimately larger,
  separately-scoped improvement," not required here.
- Do not modify any other part of `parseDefinition` or any other file.
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Test or check to add:** Five focused Vitest tests (or one parameterized
  test), each asserting that a YAML document containing one of the five new
  field names (`auth`, `pass`, `db_pass`, `key`, `passphrase`) — reproducing
  the exact adversarial cases the T-08 reviewer used — throws
  `InvalidDefinitionError`.
- **Command:** `npx vitest run packages/engine`
- **Expected failure reason:** These five field names are not yet in the
  blocklist, so the document parses successfully instead of throwing.
- **Captured output:** Exact command output and exit code, pasted into
  `IMPLEMENTATION-REPORT.md`.

## Green-state and full verification

- **Focused command:** `npx vitest run packages/engine`
- **Full command:** `npm run verify`
- **Expected evidence:** Focused command passes: all five new cases throw
  as required, and all existing T-08 tests (25 of them) still pass
  unchanged. Full command passes with exit code 0, no regression in the
  existing 274 tests.

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md` (project root)
- **Independent reviewer:** A separate Claude Code subagent instance, dispatched by the Lead Orchestrator, distinct from this task's implementer subagent. The reviewer should attempt a fresh adversarial pass for any further obviously-missing common credential field names before approving.
- **Review report location:** `REVIEW-REPORT.md` (project root)
- **Commit or patch checkpoint:** Branch `task/T-08a-credential-blocklist-hardening`
