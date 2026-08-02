# ParityLens — Independent Release Review Report

## Review independence statement

I am a separate agent instance from whoever authored `RELEASE-CHECKLIST.md`
and from every implementer/reviewer subagent across T-01–T-28. I have no
memory of writing any of this project's code or its release evidence. All
findings below come from commands I ran myself against the actual candidate
revision and from direct reading of the actual source, packaged artifact,
and control-file history — not from trusting the checklist's or ledger's
prose.

## Scope reviewed

- `RELEASE-CHECKLIST.md` (candidate: `main` @ `6480f8c76e08811953b1a93afdd80e7feeba78e8`,
  artifact `packages/extension/paritylens-0.0.1.vsix`)
- `PROGRESS-LEDGER.md` in full (task register T-01–T-28, all open findings,
  full decision log through the final 2026-08-02 entry)
- `DESIGN-SPEC.md`'s "Acceptance criteria" section (5 criteria)
- `packages/extension/.vscodeignore`, `packages/extension/package.json`,
  `packages/extension/README.md`, `.gitignore`
- `packages/engine/src/connector-sdk/safety/statement-safety.ts` (the
  security-relevant module underlying AC5 and the security-review claims)
- `REVIEW-REPORT.md` content for T-22, T-27, and T-28 as committed in git
  history (`b4ba981`, `13753a7b`, `adb59be`)
- Freshly built `.vsix` contents (unzipped and inspected directly)
- Full runtime dependency tree (`npm ls --omit=dev --all`) and each
  installed package's `package.json` `license` field, read directly from
  `node_modules`

## Verification performed (fresh, independent)

| # | Check | Command / method | Result |
| --- | --- | --- | --- |
| 1 | Candidate commit identity | `git log -1`, `git cat-file -t 6480f8c7...`, `git merge-base --is-ancestor`, `git diff 6480f8c7...HEAD --stat` | `6480f8c76e08811953b1a93afdd80e7feeba78e8` exists and is an ancestor of `HEAD` (`8196d5d8`); the only diff between the candidate and `HEAD` is `RELEASE-CHECKLIST.md` itself (276 insertions, the checklist-authoring commit) — no code changed after the candidate commit. Working tree clean before and after all verification. |
| 2 | Full verification suite | `npm run verify` (typecheck + lint + test) | First run failed lint (221 problems) due to a stale `packages/extension/dist-bundle/` left on disk from a prior local build session — this is a **live, reproduced confirmation of the disclosed T-27-01 hazard** (dist-bundle isn't in `eslint.config.mjs`'s ignore list). After `rm -rf packages/extension/dist-bundle` and re-running: **exit 0, 408 passed, 27 skipped, 435 total** — matches the checklist's claim exactly. |
| 3 | Rebuild `.vsix` | `npm run package` inside `packages/extension` (after clearing stale `dist-bundle`) | Succeeded: **19 files, 13.02 MB** — matches the checklist's claimed count and size exactly. File listing (paths) matches the checklist's claimed listing exactly, including `native/node_modules/@duckdb/node-bindings-win32-x64/{duckdb.dll,duckdb.node,LICENSE,package.json}` and `detect-libc`'s files. |
| 4 | SHA-256 of freshly rebuilt artifact | `sha256sum paritylens-0.0.1.vsix` | `7b0cc7a1f3da35addc15ed558f601e8e686dc256c4de348bdcc68cb5378faf71` — **differs** from the checklist's recorded `90903419CD4941CBDC6ABBB9F716865ECB646B2DF338687BAD15E60682D539D`. This is exactly what the disclosed T-25-01 caveat predicts (per-file build-timestamp embedding in `vsce`'s ZIP writer breaks hash reproducibility across rebuilds). Independently confirmed the caveat is genuinely true, not merely asserted: unzipped both my rebuild and cross-checked file count/names/sizes against the checklist's own recorded listing — **content-identical** (same 19 paths, same sizes down to the byte for every file I could compare, including `duckdb.dll` at 36,724,520 bytes). The claim that "content listing, not hash equality, is the correct verification method" is verified true, not just plausible. |
| 5 | Secrets/credentials/personal-data scan of unzipped `.vsix` | `grep -riE` for password/secret/api_key/token/private-key/connection-string patterns across all 19 files; separate email/Windows-path/`.env` scan | No leaked credentials. The only "secret"-shaped string hits are (a) `definition.ts`'s own credential-field-name **blocklist** (the security control itself, listing names it rejects) and (b) `SecretStore`'s wrapper around VS Code's `SecretStorage` API — both expected, both source code not data. Three email addresses found are `detect-libc`'s own upstream npm package-metadata contributors (standard, expected third-party package.json content), not this project's data. No `.env`, no `.git/`, no Windows/home paths, no connection strings, no PEM/private-key markers. |
| 6 | Package-contents completeness | `find` for `*.ts`, `*.map`, `src/*`, `*.test.*` inside unzipped contents | Zero matches for all four patterns — confirms "no src/**, no test files, no .map files" claim. |
| 7 | Dependency count | `npm ls --omit=dev --all --json`, walked programmatically | 102 unique declared package names, 100 actually present in `node_modules` on this platform (the 6 "missing" are optional per-platform DuckDB native bindings for other OS/arch combos, plus optional `pg-native`, all correctly never installed on win32-x64 and correctly excluded from the checklist's scanned-and-licensed count). Matches the ledger's "~100 transitive dependencies" claim. |
| 8 | Independent offline license scan | Node script reading `node_modules/<pkg>/package.json`'s `license` field directly for all 100 installed packages — no network tool used, matching the described Release-step-3 methodology | 100% permissive: MIT (82), ISC (5), BSD-3-Clause (4), Apache-2.0 (2), 0BSD (1). Zero copyleft/restrictive licenses. Matches the checklist's claim exactly. |
| 9 | Direct dependency versions/licenses | Read `node_modules/{mssql,pg,@duckdb/node-api,yaml}/package.json` directly | `mssql@12.7.0` MIT, `pg@8.22.0` MIT, `@duckdb/node-api@1.5.5-r.2` MIT, `yaml@2.9.0` ISC — matches the checklist's claim exactly. |
| 10 | Redistributed-library LICENSE files inside the `.vsix` | Read `native/node_modules/@duckdb/node-bindings-win32-x64/LICENSE` directly | Valid, complete MIT text (Stichting DuckDB Foundation copyright). Present and correct. |
| 11 | Own-code license | Read root `LICENSE`, all 4 `package.json` `license` fields | `LICENSE` = standard MIT text, "Copyright (c) 2026 Alex Nykolaiszyn". All four `package.json` files declare `"license": "MIT"`. Matches T-24's claimed work. |
| 12 | `npm audit` (M-01 disposition) | `npm audit` | Exactly one finding: `brace-expansion <1.1.17`, high, transitive via ESLint (`@eslint/config-array`, `@eslint/eslintrc`, `eslint` itself) — dev-tooling-only, matches M-01's ledger entry exactly. Confirmed `vitest` resolves to `3.2.7` (`^3.2.6` in `package.json`), consistent with T-23's GHSA-5xrq-8626-4rwp fix. |
| 13 | Security-review adversarial-probing claim (T-22/T-27/T-28) | Read the actual committed `REVIEW-REPORT.md` content at each task's review commit (`b4ba981`, `13753a7b`, `adb59be`) | Confirmed genuine, not overclaimed: T-22's reviewer probed malformed YAML (own construction, not reused), an empty `{}` document, and a credential-injection-shaped `password: hunter2` field nested under `source` — all cleanly rejected via `showErrorMessage`, no throw escaped. T-27's reviewer built two independent from-scratch Node harnesses, one of which genuinely invoked `paritylens.runComparison` end-to-end through the real bundle. T-28's reviewer ran a composite-key adversarial probe and a `column_mapping` pointing at a nonexistent target column, correctly documenting the resulting `[undefined]` symptom as T-28-01 (accepted Minor). |
| 14 | My own adversarial probe of `assertReadOnlyStatement` | Compiled `dist/src/connector-sdk/safety/statement-safety.js`, called directly with 8 hand-constructed cases (block-comment smuggling, nested-CTE mutation, NBSP-obscured keyword, mixed case, tab whitespace, semicolon-inside-string-literal, plus the two already-disclosed gaps) | 6 of 8 correctly blocked (`MutatingStatementError` thrown). The two disclosed, known gaps — SQL Server `GO` batch separator (M-05) and PostgreSQL `$$`-dollar-quoting (M-06) — genuinely did bypass the scanner exactly as documented, confirming the disclosure is honest and not softened. No *new*, previously undisclosed bypass found. |
| 15 | Reproducibility-caveat and scope-framing honesty | Cross-read `RELEASE-CHECKLIST.md`'s Release-identity/Known-limitations sections against `PROGRESS-LEDGER.md`'s full T-01–T-28 history and `packages/extension/README.md` | Scope framing ("engine + fixture-demo command," no real connection management/comparison-authoring UI/run history) is stated plainly and repeatedly (checklist, ledger, and the shipped README a real user would open) — not something a reader could plausibly mistake for a self-service product. |
| 16 | Scratch/probe cleanup | `git status --porcelain` before finishing | Clean — no residue from any probe file, unzip directory, or dependency-tree JSON I created during this review (all created under the session scratchpad, never inside the repo). |

## Findings

### Critical

NONE.

### Important

NONE.

### Minor

| ID | Description | Evidence | Disposition |
| --- | --- | --- | --- |
| T-RELEASE-01 | `DESIGN-SPEC.md`'s Acceptance Criteria #5 literally requires mutating-statement rejection "across all three connector implementations" (SQL Server, Snowflake, PostgreSQL) plus the fixture connector. T-18 (Snowflake) was deferred and never implemented, so AC5 is not fully satisfiable as literally written for this release. The underlying facts (T-18 deferred, no Snowflake connector exists) are disclosed clearly in the checklist's "Release identity" section and in "Known limitations" item 1/3, and the deferral itself was an explicit, recorded owner decision (2026-08-01 ledger entry) with sound rationale (no local-container equivalent, no task/connector-layer dependency on Snowflake specifically). But the checklist's "Known limitations" section does not explicitly connect this to AC5 by name — a reader checking the release strictly against `DESIGN-SPEC.md`'s numbered acceptance criteria would have to make that connection themselves. | `DESIGN-SPEC.md` line 175-178 (AC5 text); `RELEASE-CHECKLIST.md` "Release identity" and "Known limitations" §1 §3; `PROGRESS-LEDGER.md` 2026-08-01 T-18-deferral decision-log entry | Non-blocking. The deferral was an explicit, informed, recorded owner decision made with full knowledge of AC5's scope, not an oversight — this is a documentation-completeness nit, not a hidden gap. Recommend a future small edit to `RELEASE-CHECKLIST.md`'s "Known limitations" explicitly naming "AC5 (DESIGN-SPEC.md) is partially unmet: SQL Server and PostgreSQL connectors both independently pass this check; Snowflake's is not implemented" so the connection to the approved acceptance criteria is explicit rather than requiring cross-referencing. |

## Disposition of prior open findings relevant to this release

No prior finding was specifically routed to this release-review step for
resolution (release review is a synthesis gate, not a task with its own
brief-assigned findings to close). All findings open in `PROGRESS-LEDGER.md`
at the time of this review (M-01, M-04, M-08, T-12-01, T-13-01, T-14-03,
R-03, T-16b-01, T-16b-02, T-20-02, T-20-03, T-20-04, T-21-01, T-21-02, X-01,
T-22-01, T-25-01, T-25-02, T-26-01, T-26-02, T-26-03, T-27-01, T-28-01) are
Minor or non-blocking-Important, already explicitly accepted as non-blocking
debt at their own task's reconciliation — I independently re-confirmed the
two most release-relevant ones directly rather than trusting the ledger's
characterization:

- **T-27-01** (stale `dist-bundle/` breaks lint if `npm run package` runs
  immediately before `npm run verify`): reproduced live, unprompted, during
  my own first verification attempt (see Verification #2 above) — genuinely
  real, exactly as disclosed, and the documented workaround (`rm -rf
  dist-bundle` first) genuinely resolves it.
- **T-25-01** (hash not reproducible across rebuilds, content-identical
  instead): reproduced live during my own rebuild (see Verification #4
  above) — genuinely true, not merely asserted.

No regression against any prior finding was found.

## Approval decision

**APPROVED**

## Rationale

- Fresh, independent re-verification matched every material claim in
  `RELEASE-CHECKLIST.md`: test counts (408/27/435, exit 0), package contents
  (19 files, 13.02 MB, exact path listing), dependency/license inventory
  (100 packages, 100% permissive), security-scan result (no secrets/PII
  found), and both disclosed reproducibility caveats (T-25-01 hash
  variance, T-27-01 lint-ordering hazard) were reproduced as genuinely true,
  not merely repeated from the report.
- No Critical or Important finding is open anywhere in the project, and my
  own adversarial probing (statement-safety bypass attempts, secret/PII
  scanning, dependency-tree gap-hunting) surfaced nothing new at that
  severity.
- The one new finding I am recording (T-RELEASE-01) is a documentation-
  completeness nit against an already fully-disclosed, owner-approved scope
  decision (T-18/Snowflake deferral) — it does not represent an undisclosed
  defect or an overclaimed capability, and does not block release.
- The "engine + fixture-demo command" scope framing is stated clearly and
  consistently everywhere a reader would look (release identity, known
  limitations, and the actual shipped README), satisfying the specific
  concern about a reader mistaking this for a self-service product.
