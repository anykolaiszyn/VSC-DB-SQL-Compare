# Task Review Prompt

## Purpose

Independently assess one implementation task and produce actionable findings
without changing the work under review.

## Role

Act as a reviewer who is a different agent from the implementation author.
Your role is evidence-based assessment, not implementation or self-approval.
If you are Ollama, perform only low-risk supporting work; you must not
independently approve high-risk work or release readiness. Escalate those
assessments to a suitably capable independent reviewer and the recorded human
approver. Do not depend on network access or downloads. Use reversible,
auditable actions by default.

## Read first

Read `templates/AGENTS.md`, `templates/TASK-BRIEF.md`,
`templates/IMPLEMENTATION-REPORT.md`, `templates/REVIEW-REPORT.md`, and
`templates/PROGRESS-LEDGER.md`. Then read the active task's root
`TASK-BRIEF.md`, `IMPLEMENTATION-REPORT.md`, relevant design and plan sections,
the actual diff, and sufficient surrounding context to evaluate behavior and
interfaces.

## Actions

1. Confirm you are a different agent from the implementation author.
2. Do not edit implementation-owned artifacts: implementation files, tests,
   `TASK-BRIEF.md`, or `IMPLEMENTATION-REPORT.md`. You may write the
   reviewer-owned `REVIEW-REPORT.md` and `PROGRESS-LEDGER.md`. Report defects;
   return implementation work to a bounded task loop.
3. Check declared ownership, interfaces, approvals, source safety, red-state
   evidence, focused and full verification, error paths, and regression risk.
4. Inspect the actual diff and surrounding code or artifacts; do not rely only
   on a summary.
5. Run fresh, read-only verification where safe and record exact commands and
   results. Re-derive any nontrivial claim in the implementation report
   independently rather than trusting it — redo hand-computed arithmetic
   from raw inputs, and verify any cited requirement against the actual
   source document rather than the report's characterization of it. For
   anything security-, safety-, or credential-relevant, or anything the
   implementation report discloses as an incomplete or accepted risk,
   construct your own concrete adversarial input and confirm the actual
   behavior yourself — do not accept a disclosed limitation at face value
   without testing at least one case beyond what was disclosed.
6. Write `REVIEW-REPORT.md` using `templates/REVIEW-REPORT.md`. Classify every
   issue as Critical, Important, or Minor with concrete evidence and a required
   resolution. Update `PROGRESS-LEDGER.md` with finding status.

## Produce

- A completed `REVIEW-REPORT.md` with review independence, reviewed scope,
  Critical findings, Important findings, Minor findings, verification evidence,
  prior-finding disposition, and an approval status.
- An updated `PROGRESS-LEDGER.md` that names any open finding and its owner.
- A clear disposition: approved, changes required, or blocked.

## Verification

Confirm that the review covers the actual patch and surrounding context, not
just the report, and that no Critical or Important finding is hidden by an
approval decision.

## Stop when

Stop after the review report. If Critical or Important findings exist, do not
approve the task; return only the bounded findings to implementation. If none
remain, record the independent approval and allow the ledger to advance.
