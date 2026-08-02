# ParityLens — Release Checklist

## Release identity

- **Version or artifact:** `paritylens-0.0.1.vsix` — "engine + fixture-demo
  command" milestone. All T-01–T-28 tasks complete (T-18 Snowflake
  connector deliberately deferred, no local-container equivalent
  available; every other task in the original `IMPLEMENTATION-PLAN.md`
  plus T-22 through T-28 integration/release remediation is
  COMPLETE/APPROVED). Full comparison engine (schema/profile/volume/
  row-level/hash/sampling) is functional against SQL Server and
  PostgreSQL connectors; the extension host ships one working command
  (`paritylens.runComparison`) against fixture-backed data only — real
  connection-profile management, comparison-authoring UI, and run-history
  persistence are explicitly out of scope for this milestone (see decision
  log entry below; scoped as a deliberate next phase, not part of this
  release).
- **Candidate location:** `main` at commit `6480f8c76e08811953b1a93afdd80e7feeba78e8`.
  Artifact built at `packages/extension/paritylens-0.0.1.vsix` (not
  committed to git, per this project's established build-artifact
  convention — `.gitignore`'d, rebuildable via `npm run package` inside
  `packages/extension`).
- **Release owner:** alex.nykolaiszyn@gmail.com

## Fresh verification

- [x] Focused tests completed with recorded commands and results. Every
  task's own focused-test evidence is recorded in its
  `IMPLEMENTATION-REPORT.md`/`REVIEW-REPORT.md` and summarized in
  `PROGRESS-LEDGER.md`'s task register (T-01 through T-28).
- [x] Full test suite completed with recorded commands and results.
  `npm run verify` (typecheck + lint + test), re-run fresh at this
  checklist's own candidate revision: **exit 0, 408 passed, 27 skipped
  (435 total), 2026-08-02.** The 27 skips are the pre-existing,
  documented SQL Server/PostgreSQL live-container integration suites
  (require Docker containers not provisioned in this environment —
  `CLAUDE.md`'s Environment section; both connectors were independently
  verified against real containers inside WSL during T-17/T-19's own
  task cycles, per the ledger's task register).
- [x] Static analysis, formatting, and build checks completed where
  applicable. `npm run verify` includes `eslint .` (static analysis) and
  `tsc -b --force` (build/typecheck across all three workspace
  packages). No separate formatting tool is configured in this project
  (no Prettier config exists anywhere; ESLint alone has been this
  project's static-analysis tool since T-01) — this is a pre-existing
  project characteristic, not a release-phase gap.
- [ ] A deterministic source-tree output is recorded and reproducible
  from the approved revision. **N/A for this project's artifact type** —
  this template item is written for the kit's general file-based-artifact
  case; a VS Code extension's actual reproducible-build unit is the
  `.vsix` package (covered separately below), not a bare source-tree
  snapshot.
- [ ] A deterministic ZIP output is recorded and reproducible from the
  approved source-tree output. **Not fully deterministic, disclosed as a
  known limitation (T-25-01):** the `.vsix` (itself a ZIP archive) is
  reproducible in *content* — rebuilding from the same commit produces
  byte-identical file contents, names, and sizes (independently confirmed
  twice, by T-25's and T-27's reviewers, each rebuilding from source and
  diffing against the original) — but not byte-identical as a compressed
  archive, since `@vscode/vsce`'s ZIP writer embeds per-file build
  wall-clock timestamps. The SHA-256 hash recorded below therefore
  identifies this specific build artifact, not a source-derived
  fingerprint reproducible by hash alone; content-listing comparison is
  the correct verification method for this artifact type, not hash
  equality across independent rebuilds.
- [ ] The release handbook is generated or updated from the approved
  source-tree output. **N/A** — this project has no separate "release
  handbook" artifact; `packages/extension/README.md` (added in T-25) is
  the extension's own user-facing documentation and is current as of
  this candidate revision.
- [x] Offline validation and offline packaging use standard-library-only
  tooling without network access. Confirmed: `npm run verify` and
  `npm run package` (bundling + `vsce package --no-dependencies`) both
  ran fully offline for this checklist's evidence-gathering. The two
  disclosed, owner-approved exceptions to this project's offline-by-default
  posture — installing `@vscode/vsce` (T-25) and `esbuild` (T-27) as new
  devDependencies — were one-time network actions during their own task
  cycles, already recorded in the decision log at the time, not repeated
  here.

## Security, dependencies, and licenses

- [x] Security review covers secrets, authentication, authorization,
  input handling, and data exposure. Completed during Release step 3
  (2026-08-01, see decision log): `npm audit` findings investigated and
  the one exploitable-in-principle critical advisory fixed (T-23,
  `vitest` bumped past `GHSA-5xrq-8626-4rwp` — confirmed non-exploitable
  in this project's actual usage regardless, since the vulnerable Vitest
  UI server is never invoked, but fixed as hygiene). Remaining `npm audit`
  finding (`brace-expansion`, high, transitive via ESLint) is
  dev-tooling-only, never shipped, tracked as M-01, non-blocking. No
  authentication/authorization surface exists in this milestone (no real
  connection-profile management ships yet — see Release identity above);
  input handling for the one shipped command (`paritylens.runComparison`)
  was adversarially probed across three independent task reviews (T-22,
  T-27, T-28) with malformed YAML, unregistered connections, and
  injection-shaped `column_mapping`/parameter values, all producing safe,
  non-crashing error handling. Data exposure: the shipped `.vsix` was
  directly scanned (this checklist, below) for credential-shaped strings
  and personal data — none found.
- [x] Dependency inventory identifies direct and packaged dependencies
  with versions. Completed during Release step 3 (2026-08-01, full
  decision-log entry): 4 direct runtime dependencies
  (`@duckdb/node-api@1.5.5-r.2`, `mssql@12.7.0`, `pg@8.22.0`,
  `yaml@2.9.0`), ~100 transitive runtime dependencies in the full tree
  (`npm ls --omit=dev --all`), dominated by the Azure Identity SDK chain
  pulled in via `tedious` (SQL Server driver).
- [x] License inventory covers application code, runtime components, and
  redistributed libraries. Application code: MIT (T-24, `LICENSE` at repo
  root, `license` field in all four `package.json` files). Runtime
  components: 100% of the ~100-package transitive dependency tree scanned
  offline (Release step 3) — entirely permissive (MIT/BSD-3-Clause/
  Apache-2.0/ISC/0BSD), zero copyleft/restrictive licenses found.
  Redistributed libraries specifically bundled into the shipped artifact
  (DuckDB's native per-platform binary bindings, `detect-libc`): each
  carries its own `LICENSE` file, confirmed present inside the packaged
  `.vsix` (see package-contents listing below) — all MIT.
- [x] Package contains no unapproved secrets, personal data, source
  backups, or development-only credentials. Directly scanned the shipped
  `.vsix`'s unzipped contents (this checklist, 2026-08-02): no `.env`
  files, no credential-shaped string literals (`password`/`api_key`/
  `secret` patterns) in the bundled JS, no source-control metadata
  (`.git/`), no test files, no `node_modules/@types/**` dev-only
  packages. Full content listing recorded below.

## Package contents and real-input validation

- [x] Package contents match the approved artifact inventory; unexpected
  files are investigated. Unzipped `paritylens-0.0.1.vsix` (built fresh
  at this checklist's candidate revision) and confirmed the complete
  file listing:
  ```
  extension.vsixmanifest, [Content_Types].xml
  extension/package.json
  extension/readme.md
  extension/media/icon.svg
  extension/dist-bundle/extension.js
  extension/native/node_modules/@duckdb/node-bindings/{duckdb.js,LICENSE,package.json}
  extension/native/node_modules/@duckdb/node-bindings-win32-x64/{duckdb.dll,duckdb.node,LICENSE,package.json}
  extension/native/node_modules/detect-libc/{lib/*.js,LICENSE,package.json}
  ```
  19 files, 13.02 MB total (dominated by `duckdb.dll`, 35.02 MB
  uncompressed / DuckDB's native engine binary for win32-x64, the
  platform this artifact was built on — per T-27's disclosed limitation,
  this build ships only the current platform's native binding, not every
  platform's; a cross-platform release would need per-platform builds, a
  future task if multi-platform distribution is wanted). No source files
  (`src/**`), no test files, no `.map` sourcemaps, no dev-only
  `@types/**` packages — matches `.vscodeignore`'s intended exclusions
  exactly, independently confirmed by both T-27's and T-28's reviewers
  rebuilding and inspecting this same artifact shape.
- [x] Real-input validation uses approved data and preserves read-only
  source systems. All real-input validation for this milestone used the
  DuckDB-backed `FixtureConnector` exclusively (per T-22's explicit,
  disclosed scope boundary — no real, non-fixture database connection is
  reachable through the shipped `paritylens.runComparison` command in
  this milestone). No live, external, or production system was touched
  at any point in this release cycle.
- [x] Source immutability evidence compares approved source snapshots
  before and after validation. `git status` confirmed a clean working
  tree immediately before and after every live smoke-test run performed
  during Release step 5 (T-26/T-27/T-28's reconciliation commits, plus
  this checklist's own final verification pass) — no source file was
  modified by any validation or smoke-test action itself.
- [x] Packaged application smoke test records startup, primary workflow,
  failure handling, and clean shutdown. Recorded in full in
  `PROGRESS-LEDGER.md`'s decision log (2026-08-01/2026-08-02, Release
  step 5, three rounds):
  - **Startup:** confirmed clean (no errors) in a sandboxed VS Code
    profile after T-26's icon fix — the activity-bar container registers
    and the Data Parity icon renders correctly.
  - **Primary workflow:** the owner directly ran `paritylens.runComparison`
    against a real `.paritylens` definition targeting the
    `sqlserver-customer` fixture pair's deliberate schema/row-level
    mismatches. After T-27's bundling fix and T-28's row-level
    key-mapping fix, this produced a complete, correct results webview:
    9 schema differences, 7 row-level differences (3 differing, 1
    missing-from-target, 1 duplicate-in-target ×2, 1 missing-from-source)
    — matching the fixture's own documented facts exactly, with real key
    values (not the pre-T-28 `undefined` defect).
  - **Failure handling:** exercised both by the fixture's own
    deliberate mismatches (a correct `failed` overall status is itself
    exercised failure-path rendering) and, at the task-review level
    (T-22, T-27, T-28), by adversarial probes — malformed YAML,
    unregistered connections, injection-shaped parameters — all
    producing clean, non-crashing error messages.
  - **Clean shutdown:** the sandboxed VS Code window closed normally
    after each smoke-test round with no reported errors.
  - **Three real defects were found and fixed during this smoke test**
    (T-26 missing activity-bar icon, T-27 non-functional packaged
    extension due to missing bundled dependencies, T-28 undefined
    row-level key values under a non-identity column mapping) — none of
    which any of the 408 automated tests existing before this smoke test
    would have caught, direct evidence for why this checklist item
    requires a real, human-driven extension-host launch rather than
    accepting automated test results alone as sufficient.

## Reconciliation and artifact evidence

- [x] Reports reconcile with produced outputs, counts, and status
  values. `npm run verify`'s test count (408 passed / 27 skipped / 435
  total) matches exactly between this checklist's own fresh run and
  T-28's reconciliation commit (the most recent prior full-suite run) —
  no drift. Every task's `IMPLEMENTATION-REPORT.md`/`REVIEW-REPORT.md`
  count claims were independently re-derived by that task's own reviewer
  before being recorded in `PROGRESS-LEDGER.md`, per this project's
  established review discipline.
- [x] Artifact hashes are recorded with algorithm, value, and file name.
  - **File:** `paritylens-0.0.1.vsix`
  - **Algorithm:** SHA-256
  - **Value:** `90903419CD4941CBDC6ABBB9F716865ECB646B2DF338687BAD15E60682D539D`
  - **Built from:** `main` commit `6480f8c76e08811953b1a93afdd80e7feeba78e8`, 2026-08-02
  - **Caveat (see "Fresh verification" above):** this hash identifies
    this specific build; independent rebuilds from the same source
    produce content-identical but hash-different artifacts due to
    embedded build timestamps (T-25-01). Verify integrity by content
    listing (above), not by expecting hash equality across rebuilds.
- [x] Known limitations and user-facing recovery guidance are documented.
  **Known limitations** (all previously disclosed in their originating
  task's review, consolidated here):
  1. **Fixture-only data** — `paritylens.runComparison` runs exclusively
     against built-in `FixtureConnector` data (the `sqlserver-customer`
     pair). No real SQL Server/Snowflake/PostgreSQL connection can be
     configured or used through the extension in this milestone, even
     though the underlying connector code (T-17/T-19) is real,
     live-container-tested, and functional — there is simply no UI or
     command yet to configure a real connection profile. A clear
     in-product notice (`showInformationMessage`) discloses this on
     every invocation.
  2. **No connection management, comparison-authoring UI, or run
     history** — the Connections/Comparisons/Recent Runs tree view is an
     intentional, documented empty-state shell (T-10); none of the three
     sections list real data. Scoped as a deliberate next phase, not
     part of this release (see decision log).
  3. **Single-platform artifact** — this `.vsix` bundles the DuckDB
     native binding for win32-x64 only; it will not activate correctly
     on macOS or Linux without a separate per-platform build (T-27's
     disclosed scope boundary).
  3a. **T-18 (Snowflake connector) deferred — `DESIGN-SPEC.md` Acceptance
     Criterion 5 not fully satisfied.** AC5 requires mutating-statement
     rejection "across all three connector implementations and the
     fixture connector." Only SQL Server (T-17) and PostgreSQL (T-19) are
     implemented and independently verified against this criterion;
     Snowflake was never built (owner's explicit, recorded decision — no
     trial account available, no other task depended on it). This is a
     genuine, disclosed gap against the design's literal acceptance
     criteria, not a defect in what was built (per T-RELEASE-01, flagged
     by independent release review).
  4. **Row-level `keyValues` config-error edge case (T-28-01)** — a
     `column_mapping` entry pointing at a target column name that
     doesn't actually exist in the target's real columns produces the
     same `[undefined]`-key-values symptom T-28 fixed, but from a
     different (configuration-error) root cause; not distinguished from
     a genuine data issue in the current UI.
  5. **`npm run package` immediately before `npm run verify` in the same
     working tree produces a false lint failure** (T-27-01) on the
     generated `dist-bundle/` output, since it isn't yet in
     `eslint.config.mjs`'s ignore list — a build-tooling ordering
     hazard, not a defect in the shipped extension itself. Run
     `rm -rf packages/extension/dist-bundle` (or an equivalent clean)
     before `npm run verify` if you've just run `npm run package`.
  **User-facing recovery guidance:** `packages/extension/README.md`
  documents the fixture-only limitation plainly. For the packaging
  ordering hazard, this checklist item itself is the recorded guidance
  until a future bounded task closes T-27-01.

## Independent release review

- **Independent reviewer:** Claude Code Independent Reviewer subagent (Sonnet
  5), a separate agent instance from every implementer/reviewer subagent
  across T-01–T-28 and from whoever authored this checklist. Performed fresh,
  independent re-derivation of every material claim (see review report),
  not a re-statement of this checklist's own prose.
- **Review report:** `RELEASE-REVIEW-REPORT.md` (repo root)
- **Approval decision:** APPROVED
- **Approval date:** 2026-08-02
- **Release notes or conditions:** 0 Critical, 0 Important, 1 Minor
  (T-RELEASE-01, non-blocking: `DESIGN-SPEC.md` Acceptance Criterion 5
  literally requires mutating-statement rejection "across all three
  connector implementations," but Snowflake (T-18) was deferred and never
  implemented — the deferral itself was an explicit, recorded, informed
  owner decision, and SQL Server/PostgreSQL both independently pass this
  check, but the checklist's "Known limitations" section does not
  explicitly name AC5 by number when disclosing the Snowflake gap;
  recommend a small future edit connecting the two explicitly). Fresh
  verification independently reproduced test counts (408/27/435, exit 0),
  rebuilt the `.vsix` byte-for-byte content-identical to the recorded
  listing (19 files, 13.02 MB; SHA-256 differs due to the already-disclosed
  T-25-01 build-timestamp variance, confirmed genuinely content-identical
  rather than merely asserted), independently re-scanned for secrets/PII
  (none found), independently re-derived the offline license inventory
  (100 installed packages, 100% permissive), and adversarially re-probed
  `assertReadOnlyStatement` (6/8 hand-built bypass attempts correctly
  blocked; the two that succeeded are the already-disclosed M-05/M-06
  gaps, confirmed genuinely real, no new bypass found). No regression
  found against any prior open finding. See `RELEASE-REVIEW-REPORT.md` for
  full verification detail.

## Final human release approval

Complete this record only after all fresh candidate evidence and the independent
release review above are recorded.

- **Decision:** [PENDING — awaiting independent release review, then owner decision]
- **Approver:** [PENDING]
- **Timestamp:** [PENDING]
- **Evidence or hash identity:** `paritylens-0.0.1.vsix`, SHA-256
  `90903419CD4941CBDC6ABBB9F716865ECB646B2DF338687BAD15E60682D539D`, built
  from `main` commit `6480f8c76e08811953b1a93afdd80e7feeba78e8`
- **Conditions:** [PENDING]
