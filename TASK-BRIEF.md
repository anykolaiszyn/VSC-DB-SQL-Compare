# ParityLens — Task Brief T-31

## Objective

Implement the Result Store component named in `DESIGN-SPEC.md`'s
Architecture table: persist each `ComparisonResult` produced by a run as an
immutable JSON record under a safe output root, reusing T-16's existing
safe-output-root containment pattern (`packages/extension/src/export/writeExport.ts`)
rather than reimplementing path-traversal checks. Provide a small read API
(`listRecentRuns`, `loadRun`) that a future tree-view/status-bar task (T-33)
and a future "Open Last Result" command can consume, per
`IMPLEMENTATION-PLAN.md`'s T-31 row.

## Scope

1. Create `packages/extension/src/runHistory/` with a `RunRecord` shape
   (at minimum: an `id`, the run's `name`, a `timestamp`, and the full
   `ComparisonResult` payload — keep it minimal, do not invent fields not
   needed by `listRecentRuns`/`loadRun`'s own stated purpose).
2. Implement `persistRun(result: ComparisonResult, safeOutputRoot: string): Promise<string>`:
   - Builds a filename embedding a timestamp and the comparison's `name`
     (sanitized so it can't be used to escape the safe output root or
     collide — e.g. strip/replace path-separator and other filesystem-unsafe
     characters).
   - Serializes the full record as JSON and writes it via `writeExport`
     (import and call it directly — do not copy or re-derive its
     containment-checking logic).
   - Returns the identifier (path or derived id) `loadRun` can use to read
     the same record back.
   - Each call must produce a distinct file — never overwrite a prior run's
     record (immutability). A timestamp with sufficient resolution (plus the
     name) is sufficient; if a collision is still possible in principle
     (e.g. two runs same millisecond), document the judgment call rather
     than over-engineering a lock/retry scheme.
3. Implement `listRecentRuns(safeOutputRoot: string): Promise<RunRecord[]>`
   (or a lighter summary type if reading full `ComparisonResult` bodies for
   every listed run is wasteful — your call, document it) that lists what
   `persistRun` has written, most recent first.
4. Implement `loadRun(id: string, safeOutputRoot: string): Promise<ComparisonResult>`
   that reads a specific record back, expecting a byte-for-byte-equivalent
   (after JSON round-trip) `ComparisonResult` to what was persisted.
5. Reuse (import) `writeExport`'s safe-output-root containment behavior for
   any path derived from caller input (e.g. an `id` passed to `loadRun`) —
   do not accept a caller-supplied `id`/filename that could escape the root
   without the same rejection `writeExport` already gives `persistRun`.

## Dependencies

T-09/T-15 (COMPLETE, APPROVED — `ComparisonResult` shape and the full
Phase 1+2 planner producing it). T-16 (COMPLETE, APPROVED — `writeExport`,
the safe-output-root containment logic being reused).

## Files owned

- `packages/extension/src/runHistory/**` (new — implementation and tests)

## Interfaces consumed

- `ComparisonResult` (`@paritylens/shared`, via `packages/shared/src/result.ts`)
  — read-only consumption.
- `writeExport(targetPath, content, safeOutputRoot)`
  (`packages/extension/src/export/writeExport.ts`) — read-only consumption,
  do not modify or duplicate its containment logic.

## Interfaces produced

- `RunRecord` type.
- `persistRun(result, safeOutputRoot): Promise<string>`.
- `listRecentRuns(safeOutputRoot): Promise<RunRecord[]>`.
- `loadRun(id, safeOutputRoot): Promise<ComparisonResult>`.

## Prohibited changes

- Do not modify `packages/extension/src/export/**` (T-16's owned files) —
  read-only consumption of `writeExport` only.
- Do not modify `packages/engine/**` or `packages/shared/**`.
- Do not wire this into `activate.ts`, the tree view, or the status bar —
  that is T-33's explicit scope. T-31 is the storage/read API only.
- Do not reimplement or subtly diverge from `writeExport`'s path-containment
  check — import and call it.

## Red-state evidence required

A test persisting a `ComparisonResult` via `persistRun` and reading it back
via `loadRun`, expecting a byte-for-byte-equivalent object — fails today
(module does not exist).

## Green-state verification required

The test above passes. Additionally: a second test confirms a `loadRun`
call constructed to resolve outside the safe output root is rejected,
exercising the exact same containment behavior `writeExport`'s own tests
already verify (reused, not reimplemented). A third test confirms two runs
persisted in quick succession (e.g. same `name`) each produce a distinct
record — `listRecentRuns` returns both, and neither overwrote the other.
`npm run verify` passes in full.

## Handoff

Note to reviewer: please adversarially confirm (1) records are genuinely
immutable — no code path in `persistRun`/`listRecentRuns`/`loadRun` can
cause one run's stored JSON to be overwritten by another, per
`DESIGN-SPEC.md`'s "Results are immutable per run" requirement, and (2) the
safe-output-root reuse is genuine — `writeExport` is actually imported and
called (check the import), not reimplemented nearby with subtly different
escape-path logic, and that `loadRun`'s id-to-path resolution is equally
protected against a crafted `id` escaping the root.
