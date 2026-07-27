# Worked Example: Local Receipt Organizer

This is a fictional artifact trail, not a claim that executable code or a shipping application was produced. It shows how a small desktop-utility idea could be controlled from discovery through handoff.

## Initial idea

> "I want a local desktop utility that groups my receipt image and PDF files by
> purchase month, keeps originals unchanged, and produces a searchable CSV. It
> must work offline and never move or overwrite a receipt without asking."

The Lead Orchestrator copies the templates into the new project and records
the idea in `PROJECT-BRIEF.md`. It starts `prompts/01-discovery.md` with the
source folder read-only and `work/receipt-organizer-output` as the only
approved write root.

## Discovery evidence and constraints

The discovery record inventories 36 mixed PDF/JPEG/PNG receipts from a supplied
sample folder. It notes that file names are inconsistent, dates may be absent,
the user's original folder is read-only, and OCR is outside the first delivery.
Success is defined as: produce an auditable CSV and collision-safe copies under
the output root; report skipped files; leave the source snapshot unchanged.

The project brief excludes cloud synchronization, automatic deletion, financial
advice, and extraction from password-protected files. The human approves this
brief before design.

## Options considered

| Option | Benefits | Costs or risks | Decision |
| --- | --- | --- | --- |
| Copy every file into a month folder inferred from its modified time | Fast and simple | Can misclassify; risks collisions without planning | Not selected |
| Build a local index, preview a proposed plan, then copy on approval | Auditable, reversible source handling; clear collision behavior | Requires a planning stage | Selected |
| Upload receipts to an online OCR service | Could infer dates from content | Violates offline and privacy constraints | Not selected |

## Approved design

The approved `DESIGN-SPEC.md` defines a local scan component, a planner, a
copy executor, and a CSV/report writer. The scanner reads only allowed file
types; the planner derives a proposed month from reliable file metadata and
marks uncertain files for review; the executor writes only below the approved
output root using a generated collision-safe name. The report reconciles every
input as copied, skipped, or needing review.

The human records approval of the offline design, source-read-only boundary,
output containment rule, and the absence of third-party OCR or network access.

## Three-task implementation plan

| Task | Owner and scope | Required evidence | Review gate |
| --- | --- | --- | --- |
| R-1: Fixture catalog | Ollama Local Supporting Agent owns approved non-sensitive sample fixture descriptions and expected classification cases only | A focused fixture-reader check first fails, then passes; a report records supplied context and limits | Capable reviewer validates the fixture artifact before it is used |
| R-2: Safe output planner | Codex Implementer owns the local filesystem planning and containment interface | Focused collision and parent-containment checks, then full suite | Separate reviewer inspects all overwrite and path-handling behavior |
| R-3: CSV reconciliation | Claude Code Implementer owns the report schema and reconciliation behavior | Focused counter mismatch check, then integration check | Separate reviewer verifies report and output contracts |

The team chooses default sequential execution: R-1, then R-2, then R-3. Each
row becomes an approved `TASK-BRIEF.md` when active. The parent
`PROGRESS-LEDGER.md` records exactly one active task and never lists these three
tasks as simultaneously active. Ollama receives fixture-only low-risk work and
only the approved fixture task plus its small context bundle; it is not asked
to decide filesystem safety or release readiness.

If a later batch needs approved parallel work, each independent task receives
an isolated worktree or branch and a scoped ledger with one active task per
execution lane. The named control-file coordinator alone reconciles child
reports into the parent ledger; it does not mark multiple child tasks active in
that shared record.

## Task brief and implementation loop

For R-2, the Task brief says that Codex may edit only the output-planner module,
its focused tests, and its implementation report. It consumes the selected
design's output-root contract and produces a planned destination plus an
explicit conflict status. It forbids writing to the receipt source folder and
requires a red-state test for a destination that would escape the output root.

Codex records the failing focused check, makes a scoped planner change, reruns
the focused and full checks, and writes an implementation report. It hands the
patch, commands, observed results, and open-risk statement to a different
agent through `prompts/05-task-review.md`; it does not declare itself approved.

## Independent review and regression loop

The Independent Reviewer reads the real R-2 patch and finds an Important issue:
a same-name destination would be opened with overwrite behavior instead of
being given a collision-safe suffix. The reviewer records the finding in
`REVIEW-REPORT.md` and the ledger, marks R-2 changes required, and does not
edit the implementation-owned files.

The Lead Orchestrator creates a new bounded regression task brief. Its focused
test first demonstrates the unsafe overwrite path; the R-2 implementer changes
only the planner behavior required to return a unique destination. The updated
implementation report includes red and green commands. The same Independent
Reviewer rechecks the correction, reruns the focused and full verification,
confirms the source folder remains outside the write set, and records the
Important finding resolved. Only then is R-2 independently approved.

## Integration and bounded real-input validation

After R-1, R-2, and R-3 have independent approvals, the integration lead
compares their input and status contracts. A bounded real-input validation uses
the 36 approved sample receipts, writes only below
`work/receipt-organizer-output`, and snapshots the source tree before and
after. The evidence records 30 planned-and-copied files, 4 uncertain files in a
review queue, and 2 skipped unsupported files; the CSV contains the same 36
statuses. This fictional result is an example of reconciliation evidence, not
a report from an executable program.

## Release evidence

The Release Reviewer starts from the approved revision and collects fresh
focused/full test results, deterministic package output and hash, package file
inventory, dependency and license inventory, and a smoke-test record for
startup, one safe planning-and-copy workflow, a malformed-file path, and clean
shutdown. The checklist confirms that no source receipts, source backups,
secrets, or unexpected development files are included in the package.

The reviewer verifies the candidate's reported 30/4/2 counters against the
bounded output and CSV, documents the known limitation that uncertain dates
need human review, and records an approval recommendation. The human owner
then records final release approval; no agent's recommendation substitutes for
that decision.

## Handoff

The final `PROGRESS-LEDGER.md` identifies the release evidence location,
approved artifact identity, completed tasks, resolved overwrite finding,
source-immutability snapshot, known limitation, and next support owner. If a
later session is interrupted, its successor follows
`prompts/08-handoff-and-resume.md`: inspect the working tree first, preserve
uncommitted work, reconcile the ledger and reports, and resume only the active
approved task. This artifact trail enables the successor to continue safely
without assuming that a previous chat or model response is complete.
