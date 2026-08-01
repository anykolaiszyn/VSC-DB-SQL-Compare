# ParityLens — Task Brief T-24

## Objective

Found during the prompt-07 Release license inventory (2026-08-01): none of
the four `package.json` files in this repo (root, `packages/shared`,
`packages/engine`, `packages/extension`) declare a `license` field. Every
one of this project's ~100 transitive runtime dependencies is permissively
licensed (MIT/BSD-3-Clause/Apache-2.0/ISC/0BSD, confirmed via a full offline
scan of `node_modules` — no copyleft/restrictive license anywhere), but this
project's own code has never had an explicit license decision recorded
until now.

**Decision (owner confirmed directly when asked):** MIT, matching the
license family already used by every dependency this project pulls in and
consistent with the VS Code marketplace's most common extension license.

## Scope

- Add `"license": "MIT"` to all four `package.json` files: root
  (`package.json`), `packages/shared/package.json`,
  `packages/engine/package.json`, `packages/extension/package.json`.
- Add a `LICENSE` file at the repo root containing the standard MIT
  license text, with the copyright line naming the project owner
  (`alex.nykolaiszyn@gmail.com` — use "Alex Nykolaiszyn" or the ledger's
  recorded project-owner identity for the copyright holder name; if
  genuinely ambiguous, use the email's implied name and note the
  assumption in `IMPLEMENTATION-REPORT.md` rather than guessing silently)
  and the current year (2026).
- Do not add per-package `LICENSE` files inside `packages/*/` — a single
  root-level `LICENSE` file covering the whole repository is standard
  practice for an npm-workspaces monorepo where every package shares one
  license.

## Dependencies

- **Required completed tasks:** NONE.
- **Required decisions or approvals:** NONE beyond this brief — the
  license choice was already confirmed directly by the project owner.
- **Environment:** No WSL/Docker containers needed. This task adds no new
  npm dependency and requires no network access.

## Files owned

- `package.json` (root — `license` field only)
- `packages/shared/package.json` (`license` field only)
- `packages/engine/package.json` (`license` field only)
- `packages/extension/package.json` (`license` field only)
- `LICENSE` (new file, repo root)

Do not touch any other field in any `package.json`, and do not touch any
file under `packages/*/src/**`.

## Interfaces

None — this task adds metadata only, no code or interface changes.

## Prohibited changes

- Do not modify dependency versions, scripts, or any other `package.json`
  field beyond adding `"license": "MIT"`.
- Do not add license headers to individual source files — a root
  `LICENSE` file plus each `package.json`'s `license` field is sufficient
  and matches this project's existing lack of per-file header convention.
- Do not expand scope without a revised task brief and ledger decision.

## Red-state evidence

- **Check to add:** none in the traditional red/green test sense — this
  is a metadata-only change. The "red state" is the current absence: run
  `grep -n '"license"' package.json packages/*/package.json` and confirm
  it returns no matches before the change, and confirm no `LICENSE` file
  exists at the repo root (`ls LICENSE` fails) before the change. Capture
  both outputs verbatim in `IMPLEMENTATION-REPORT.md`.

## Green-state and full verification

- **Focused check:** `grep -n '"license"' package.json packages/*/package.json`
  returns exactly four matches, each `"license": "MIT"`; `cat LICENSE`
  shows a well-formed MIT license text with a copyright line.
- **Full command:** `npm run verify`
- **Expected evidence:** `npm run verify` exits 0 with the same test count
  as the current baseline (404 passed, 27 pre-existing skips, 431 total)
  — a metadata-only change should produce zero test-count change. `npm
  install` should run without error after the `package.json` edits
  (confirms valid JSON, no syntax break).

## Handoff

- **Implementation report location:** `IMPLEMENTATION-REPORT.md`
- **Independent reviewer:** `reviewer` subagent (separate instance from
  whichever `implementer` subagent does this task)
- **Review report location:** `REVIEW-REPORT.md`
- **Commit or patch checkpoint:** Branch `task/T-24-license-metadata`

**Note to reviewer:** confirm directly (don't trust the report) that (1)
all four `package.json` files are valid JSON after the edit and each
declares `"license": "MIT"`, (2) the root `LICENSE` file contains
genuine, unmodified standard MIT license text (compare against the
canonical MIT license wording — https://opensource.org/license/mit/ is
the reference text, though you should already know it, no network access
needed), (3) no file outside the five declared owned paths was touched,
and (4) `npm run verify`'s test count is unchanged from the pre-task
baseline.
