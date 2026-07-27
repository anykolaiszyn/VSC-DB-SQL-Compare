# Release Prompt

## Purpose

Produce a release candidate only from fresh, auditable source and packaged
artifact evidence, obtain an independent release review, and then request the
final human release decision.

## Role

Act as a release engineer. Preserve source safety and do not substitute prior
results for fresh evidence from the candidate revision. If you are Ollama,
perform only low-risk supporting work; you must not independently approve
high-risk work or release readiness. Do not depend on network access or
downloads. Use reversible, auditable actions by default.

## Read first

Read `templates/AGENTS.md`, `templates/DESIGN-SPEC.md`,
`templates/IMPLEMENTATION-PLAN.md`, `templates/REVIEW-REPORT.md`,
`templates/PROGRESS-LEDGER.md`, and `templates/RELEASE-CHECKLIST.md`. Then
read the root release checklist, ledger, design, plan, approved reviews, and
recorded approvals for the work completed before release.

## Actions

1. Confirm all required tasks and integration work are approved and no Critical
   or Important finding is open.
2. Run fresh focused tests, the full source test suite, static analysis,
   formatting, and build checks required by the approved plan. Record exact
   commands and outputs.
3. Perform a security review covering secrets, authentication, authorization,
   input handling, and data exposure. Inventory direct and packaged
   dependencies and every applicable license, including runtime and
   redistributed-library notices.
4. Build the packaged artifact from the approved revision using the documented
   reproducible process. Scan package contents against the approved inventory;
   investigate unexpected files, source backups, credentials, personal data,
   and development-only material.
5. Launch the packaged artifact and run a bounded real-input smoke test using
   approved data. Preserve read-only sources and write only to approved output
   locations. Record startup, primary workflow, failure handling, and clean
   shutdown.
6. Reconcile reports, output files, counts, and status values. Record hashes
   with algorithm, value, and file name; document known limitations and user
   recovery guidance.
7. Complete the evidence sections of `RELEASE-CHECKLIST.md` from
   `templates/RELEASE-CHECKLIST.md`, obtain and record an independent release
   review, and update `PROGRESS-LEDGER.md`.
8. After fresh candidate evidence is complete, present the evidence and exact
   artifact identity to the human owner. Obtain and record the final recorded
   human release approval, including the decision, approver, timestamp,
   evidence or hash identity, and conditions. An independent agent review does
   not substitute for this approval.

## Produce

- A completed `RELEASE-CHECKLIST.md` with fresh source verification,
  security/dependency/license evidence, package-content results, packaged
  artifact launch evidence, bounded smoke test evidence, reconciliation,
  hashes, limitations, independent review status, and final human approval
  record.
- A reproducible packaged artifact and an approved artifact inventory.
- An updated `PROGRESS-LEDGER.md` with release evidence, open issues, and the
  final recorded human release approval.

## Verification

Confirm source checks are fresh for this candidate, the packaged artifact was
actually launched, the smoke test used approved real inputs safely, package
contents and license inventory are complete, and outputs reconcile with reports.

## Stop when

Stop after fresh candidate evidence and independent review are recorded if
final recorded human release approval is still missing. Do not publish,
deliver, deploy, or otherwise change external state until that approval is
recorded. If evidence fails, return the issue to a bounded task loop.
