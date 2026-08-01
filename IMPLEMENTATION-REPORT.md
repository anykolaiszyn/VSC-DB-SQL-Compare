# ParityLens — Implementation Report T-25

## Status and objective

- **Status:** BLOCKED (partial — all in-scope changes made and verified;
  a real `.vsix` was not produced because packaging fails on a manifest
  field outside this task's declared file ownership)
- **Objective:** Per `TASK-BRIEF.md`, "make a real, reproducible `.vsix`
  buildable and actually build one from the current approved `main`
  revision" by installing `@vscode/vsce`, resolving the `private: true`
  blocker, adding `.vscodeignore`/`README.md`/a packaging script, and
  producing and verifying a real `.vsix`.

## Why this is blocked, not complete

`TASK-BRIEF.md` item 2 anticipated exactly one blocker — `private: true`
in `packages/extension/package.json` — and pre-authorized exactly one
fix for it: removing that field (explicitly *not* authorizing any other
field edit: "do not touch any other field"). I made that fix. Running
`vsce package` afterward still fails, but on a **different** field:

```
 ERROR  Invalid extension "name": "@paritylens/extension" in package.json. Learn more: https://code.visualstudio.com/api/references/extension-manifest
```

This is not a warning with an override flag (I checked `vsce package
--help` in full — the only override-style flags are things like
`--allow-missing-repository`, `--allow-star-activation`,
`--allow-package-secrets`; none address manifest `name`/`publisher`
shape). Reading `@vscode/vsce`'s own source
(`node_modules/@vscode/vsce/out/validation.js`, function
`validateExtensionName`) confirms this is a hard, non-overridable
requirement:

```js
const nameRegex = /^[a-z0-9][a-z0-9\-]*$/i;
function validateExtensionName(name) {
    if (!name) { throw new Error(`Missing extension "name"...`); }
    if (!nameRegex.test(name)) {
        throw new Error(`Invalid extension "name": "${name}" in package.json. ...`);
    }
    return name;
}
```

VS Code extension manifest names cannot contain `@` or `/` — npm-scoped
package names (`@paritylens/extension`) are categorically incompatible
with the VS Code extension manifest format. There is also no `publisher`
field in `packages/extension/package.json` at all, which
`validatePublisher` in the same file will reject once `name` is fixed
(`Missing extension "publisher": "<ID>"...`) — a second, separate
blocker on the same file, also outside this task's ownership.

**A genuinely interesting additional finding, disclosed for accuracy:**
I also checked whether the installed `@vscode/vsce` (3.9.2) actually
checks `private: true` in the manifest at all. It does not — I searched
`node_modules/@vscode/vsce/out/*.js` for any reference to a manifest
`private` field and found none (the only `private` hit in the whole
package is in `secretLint.js`, an unrelated secretlint rule ID for
detecting private *keys* in source, not the package.json `private`
field). I confirmed this empirically too: with `private: true` restored
and the `name` field still `@paritylens/extension`, `vsce package`
produces the exact same `name` error above — `private` is never reached
because `name` validation runs first and fails first. So the brief's
premise that `private: true` is *the* blocker turned out to be
incomplete: it may have been true in an older `vsce`/legacy `vsce`
version (the brief itself notes `@vscode/vsce` is the modern replacement
for the deprecated `vsce` package name, and validation logic has
visibly changed between them), but in the currently-installable
`@vscode/vsce@^3.9.2`, the `name` field is the actual, first-encountered
blocker, and `private` is not checked at all by this version. I removed
`private: true` anyway per the brief's explicit instruction (item 2's
fallback path, (b)) since it is still semantically correct for this
package (it is intended to be distributed) and doing so is harmless —
but it did not by itself unblock packaging, and per my read of the
source it may never have been the operative blocker for this vsce
version.

**Per my operating instructions, I am required to stop and flag this
rather than self-authorize an ownership expansion.** Fixing `name`
(e.g. to `paritylens-extension` or similar) and adding a `publisher`
field are both edits to `packages/extension/package.json` fields the
brief did not list as owned ("`private` field removal only, plus a new
`scripts.package` entry — do not touch any other field") and did not
anticipate needing. I did not make these edits. A revised task brief
(or an amendment to this one) authorizing the `name`/`publisher` edits
is needed before a real `.vsix` can be produced.

**No `.vsix` was produced.** Item 6 of the brief (record file name,
size, SHA-256 hash) and the unzip-and-inspect content verification
therefore could not be completed — there is no artifact to inspect. This
is disclosed here rather than fabricated.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `package.json` (root) | Added `"@vscode/vsce": "^3.9.2"` to `devDependencies` | Brief item 1 — owner-approved one-time network install |
| `package-lock.json` | Regenerated by `npm install --save-dev @vscode/vsce` | Lockfile side-effect of the above, not hand-edited |
| `packages/extension/package.json` | Removed `"private": true`; added `"package": "vsce package"` under `scripts` | Brief item 2 fallback (b) — package is intended to be distributed, and `private` was not semantically accurate for it; brief item 5 — packaging script |
| `packages/extension/.vscodeignore` (new) | Excludes `src/**`, `**/*.test.ts`, `**/*.test.js`, `**/*.test.js.map`, `tsconfig.json`, `tsconfig.tsbuildinfo`, `**/*.tsbuildinfo`, `node_modules/@types/**`, `**/*.map`, `.gitignore`, and itself | Brief item 3 |
| `packages/extension/README.md` (new) | Short factual description: what ParityLens is, current state (Data Parity tree view, `paritylens.runComparison` command, fixture-backed comparisons only), VS Code engine requirement | Brief item 4 |
| `.gitignore` (root) | Added `*.vsix` | Brief item 6 — do not commit built binary artifacts |

No file outside this list was changed. No file under `packages/*/src/**`
was touched. `packages/shared/package.json` and
`packages/engine/package.json` were not touched — both retain
`"private": true` unchanged (verified below).

## Behavior and interfaces

- **Behavior delivered:** `@vscode/vsce` is installed and runnable
  (`npx --no-install @vscode/vsce --version` → `3.9.2`). The
  `private: true` blocker the brief anticipated is resolved.
  `packages/extension/README.md` and `.vscodeignore` exist and are
  correctly scoped. `npm run package` (from `packages/extension/`) is
  wired up but currently fails — this is disclosed above, not hidden.
- **Interfaces consumed:** None new (per brief — build/packaging tooling
  only).
- **Interfaces produced:** None new. No `.vsix` was produced (blocked).

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Baseline (pre-change) | `npm run verify` | Exit 0. 404 passed, 27 skipped, 431 total | Captured in this session before any edit |
| Red state — vsce not installed | `npx --no-install @vscode/vsce --version` | Failed before install (package absent); confirmed installed afterward → `3.9.2` | This session |
| Red state — packaging with original manifest (`private: true`, scoped `name`, no `.vscodeignore`) | `cd packages/extension && npx --no-install @vscode/vsce package` | Exit 1: `ERROR  Invalid extension "name": "@paritylens/extension" in package.json. Learn more: https://code.visualstudio.com/api/references/extension-manifest` | This session, captured verbatim above |
| Confirmation that `private:true` is not the operative blocker | Restored `private: true` temporarily with `name` still `@paritylens/extension`, ran `vsce package` again | Exit 1, identical `name` error — `private` never reached | This session; `private: true` was then re-removed to restore the intended in-scope state |
| Focused check (packaging) | `cd packages/extension && npx --no-install @vscode/vsce package` (after `private` removal, `.vscodeignore` and `README.md` added) | Exit 1, same `name` error — **cannot proceed further within this task's file ownership** | This session |
| Full verification | `npm run verify` | Exit 0. **404 passed, 27 skipped, 431 total** — unchanged from baseline | This session, tail of output: `Test Files  22 passed \| 2 skipped (24)` / `Tests  404 passed \| 27 skipped (431)` |

No `.vsix` file exists anywhere in the working tree — there is nothing
to hash or unzip. This is stated plainly rather than worked around.

## Assumptions and risks

- **Assumptions:** None beyond what's stated above. I did not guess at a
  `name`/`publisher` value and apply it — that would be exactly the kind
  of silent ownership expansion my instructions prohibit.
- **Risks or limitations:**
  - The extension cannot currently be packaged into a `.vsix` at all,
    regardless of this task's changes, because of the `name` field
    format and the missing `publisher` field. This is a pre-existing
    condition of `packages/extension/package.json` that predates this
    task; T-25 did not introduce it, but T-25 also could not resolve it
    within its declared ownership.
  - The brief's premise ("vsce package refuses a private: true manifest
    by default") does not hold for the currently-installable
    `@vscode/vsce@3.9.2` — see the detailed finding above. If a future
    task revisits this, the `name`/`publisher` blocker should be treated
    as the actual gate, not `private`.
  - The "missing repository field" warning mentioned in the brief's
    Dependencies section was never reached in my testing (packaging
    fails before that stage), so I cannot confirm or deny it
    independently of the `name`/`publisher` blocker being resolved
    first.
- **Blockers:** `packages/extension/package.json`'s `name` field
  (`@paritylens/extension`, npm-scoped, invalid per VS Code's extension
  manifest `nameRegex`) and missing `publisher` field. Both are outside
  this task's file ownership ("do not touch any other field"). **A
  revised `TASK-BRIEF.md` (or explicit ledger-recorded scope amendment)
  authorizing edits to `name` and adding `publisher` in
  `packages/extension/package.json` is required before a real `.vsix`
  can be produced.**

## Patch or commit identity

- **Branch:** `task/T-25-extension-packaging`
- **Commit:** created immediately after this report (see commit history
  on this branch) so the report itself is included in the commit.

## Recommended next step

This task should go to independent review as BLOCKED, not COMPLETE. The
in-scope work (vsce install, `.gitignore`, `.vscodeignore`, `README.md`,
`private` removal, `scripts.package`) should be reviewed on its own
merits, and the reviewer should independently confirm the `name`/
`publisher` blocker is real (re-run `vsce package` themselves, read
`validation.js` themselves) before the orchestrator decides whether to:
(a) issue a revised task brief authorizing the `name`/`publisher` edit
as a narrow follow-up (likely the fastest path — e.g.
`"name": "paritylens"` or `"name": "extension"` plus a `publisher` ID
decision, which is a product/ownership decision, not an implementation
one), or (b) route it as a separate tracked task. I am not recommending
self-approval or claiming this task complete in any sense beyond the
in-scope, verified changes described above.
