# ParityLens — Implementation Report T-24

## Status and objective

- **Status:** COMPLETE (implementation only — not reviewed or approved)
- **Objective:** Per `TASK-BRIEF.md`, add `"license": "MIT"` to all four
  `package.json` files in the repo (root, `packages/shared`,
  `packages/engine`, `packages/extension`) and add a root-level `LICENSE`
  file with standard MIT license text, naming the project owner as
  copyright holder and 2026 as the year. This is a metadata-only change
  found during the prompt-07 Release license inventory; the license
  choice (MIT) was owner-confirmed directly and required no further
  decision.

## Changed files

| File | Change | Reason |
| --- | --- | --- |
| `package.json` | Added `"license": "MIT"` after `description` | Brief scope: root package.json |
| `packages/shared/package.json` | Added `"license": "MIT"` after `description` | Brief scope: shared package.json |
| `packages/engine/package.json` | Added `"license": "MIT"` after `description` | Brief scope: engine package.json |
| `packages/extension/package.json` | Added `"license": "MIT"` after `description` | Brief scope: extension package.json |
| `LICENSE` (new) | Standard, unmodified MIT license text; copyright line `Copyright (c) 2026 Alex Nykolaiszyn` | Brief scope: new root LICENSE file |
| `package-lock.json` | `license: "MIT"` mirrored into the four corresponding workspace entries | **Not in declared ownership — see "Out-of-scope edit" below.** Mechanical, unavoidable side effect of running `npm install` (required by brief step 4) after the package.json edits |

## Out-of-scope edit — flagged explicitly

`package-lock.json` is not listed under "Files owned" in `TASK-BRIEF.md`.
Running `npm install` (which the brief explicitly requires in its
Green-state section — "`npm install` should run without error after the
`package.json` edits") caused npm to mirror each workspace's new
`"license": "MIT"` field into `package-lock.json`'s corresponding
`packages.*` entries (root, `packages/engine`, `packages/extension`,
`packages/shared`). This is npm's standard lockfile-sync behavior, not an
independent decision on my part — there is no way to run `npm install`
after the package.json edits without npm making this exact update. The
diff is purely four one-line `"license": "MIT"` additions mirroring the
package.json changes; no dependency version or resolution changed. Per
the implementer protocol ("if satisfying the brief mechanically forces a
small edit outside the literal file list, make the minimal such edit,
and call it out explicitly and separately") I kept this change rather
than reverting it (reverting would leave the lockfile inconsistent with
the package.json files it mirrors) and am flagging it here for reviewer
judgment.

Full diff of that file:

```diff
--- a/package-lock.json
+++ b/package-lock.json
@@ -7,6 +7,7 @@
     "": {
       "name": "paritylens",
       "version": "0.0.1",
+      "license": "MIT",
       "workspaces": [
         "packages/*"
       ],
@@ -4280,6 +4281,7 @@
     "packages/engine": {
       "name": "@paritylens/engine",
       "version": "0.0.1",
+      "license": "MIT",
       "dependencies": {
         "@duckdb/node-api": "^1.5.5-r.2",
         "@paritylens/shared": "*",
@@ -4295,6 +4297,7 @@
     "packages/extension": {
       "name": "@paritylens/extension",
       "version": "0.0.1",
+      "license": "MIT",
       "dependencies": {
         "@paritylens/engine": "*",
         "@paritylens/shared": "*"
@@ -4309,7 +4312,8 @@
     },
     "packages/shared": {
       "name": "@paritylens/shared",
-      "version": "0.0.1"
+      "version": "0.0.1",
+      "license": "MIT"
     }
   }
 }
```

## Behavior and interfaces

- **Behavior delivered:** Every package.json in the repo now declares an
  explicit `"license": "MIT"` field. A root `LICENSE` file exists with
  standard, unmodified MIT license text.
- **Interfaces consumed:** None — no code interfaces were read or
  depended on. This is a pure metadata change.
- **Interfaces produced:** None — no code interfaces were added or
  changed.

## Assumptions and risks

- **Assumptions:**
  - Copyright holder name: the brief instructs using "Alex Nykolaiszyn"
    (derived from the owner's email `alex.nykolaiszyn@gmail.com`) if
    genuinely ambiguous, and to note the assumption rather than guess
    silently. I used **"Alex Nykolaiszyn"** verbatim as the copyright
    holder name in `LICENSE`. This is not a silent guess distinct from
    the brief's own suggested fallback — it is exactly the fallback the
    brief specifies — but flagging it here per the brief's own
    instruction to note it.
  - Copyright year: used **2026** per the brief's explicit instruction
    ("the current year (2026)").
- **Risks or limitations:**
  - `package-lock.json` was touched as a mechanical side effect of the
    required `npm install` step — see "Out-of-scope edit" section above.
    This is the one known limitation/deviation from a strictly literal
    reading of "Files owned"; I judged it unavoidable and disclosed it
    rather than silently reverting or silently keeping it.
  - No other risks identified. This is a metadata-only change with no
    code or interface impact.
- **Blockers:** None.

## Verification evidence

| Check | Exact command | Result | Evidence location |
| --- | --- | --- | --- |
| Red state (before) | `grep -n '"license"' package.json packages/*/package.json` | Exit 1, no matches (no `"license"` field anywhere) | Captured below |
| Red state (before) | `ls LICENSE` | Exit 2, `ls: cannot access 'LICENSE': No such file or directory` | Captured below |
| Baseline full verification (before any edit) | `npm run verify` | Exit 0 — `Test Files 22 passed \| 2 skipped (24)`, `Tests 404 passed \| 27 skipped (431)` | Captured below |
| Focused green state (after) | `grep -n '"license"' package.json packages/*/package.json` | Exit 0, exactly 4 matches, all `"license": "MIT"` | Captured below |
| Focused green state (after) | `cat LICENSE` | Well-formed, unmodified standard MIT text with copyright line | Captured below |
| `npm install` (after edits) | `npm install` | Exit 0, `added 55 packages, and audited 316 packages` — confirms valid JSON, no syntax break | Captured below |
| Full verification (after edits) | `npm run verify` | Exit 0 — `Test Files 22 passed \| 2 skipped (24)`, `Tests 404 passed \| 27 skipped (431)` — identical to baseline | Captured below |

### Red-state evidence (verbatim)

```
$ grep -n '"license"' package.json packages/*/package.json
(no output)
exit: 1

$ ls LICENSE
ls: cannot access 'LICENSE': No such file or directory
exit: 2
```

### Baseline `npm run verify` (before edits, on branch `task/T-24-license-metadata` immediately after creation, before any file changed)

```
> paritylens@0.0.1 verify
> npm run typecheck && npm run lint && npm run test

> paritylens@0.0.1 typecheck
> tsc -b --force

> paritylens@0.0.1 lint
> eslint .

> paritylens@0.0.1 test
> vitest run
...
 Test Files  22 passed | 2 skipped (24)
      Tests  404 passed | 27 skipped (431)
   Start at  17:31:56
   Duration  2.47s
```
Exit code: 0

### Green-state evidence (verbatim, after edits)

```
$ grep -n '"license"' package.json packages/*/package.json
package.json:6:  "license": "MIT",
packages/engine/package.json:6:  "license": "MIT",
packages/extension/package.json:6:  "license": "MIT",
packages/shared/package.json:6:  "license": "MIT",
```

```
$ cat LICENSE
MIT License

Copyright (c) 2026 Alex Nykolaiszyn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### `npm install` (verbatim, after edits)

```
added 55 packages, and audited 316 packages in 1s

67 packages are looking for funding
  run `npm fund` for details

1 high severity vulnerability

To address all issues, run:
  npm audit fix

Run `npm audit` for details.
```
Exit code: 0. Note: the "1 high severity vulnerability" audit warning is
pre-existing transitive-dependency noise, unrelated to this task's
license-metadata change, and out of scope per the brief ("Do not modify
dependency versions").

### Full `npm run verify` (verbatim, after edits)

```
> paritylens@0.0.1 verify
> npm run typecheck && npm run lint && npm run test

> paritylens@0.0.1 typecheck
> tsc -b --force

> paritylens@0.0.1 lint
> eslint .

> paritylens@0.0.1 test
> vitest run
...
 Test Files  22 passed | 2 skipped (24)
      Tests  404 passed | 27 skipped (431)
   Start at  17:32:31
   Duration  2.50s
```
Exit code: 0. Test count identical to baseline (404 passed, 27 skipped,
431 total) — confirms zero test-count change from this metadata-only
edit, matching the brief's expected evidence exactly.

## Patch or commit identity

- **Commit:** `d5e483bf7cc331763bb545cfa60badac82a5027a` — "T-24: add MIT
  license metadata to all packages and root LICENSE file"
- **Branch:** `task/T-24-license-metadata` (created from `main`)

## Recommended next step

Hand off to an independent `reviewer` subagent instance (per the brief's
Handoff section) to write `REVIEW-REPORT.md`. The reviewer should, per
the brief's own note-to-reviewer: (1) independently confirm all four
package.json files are valid JSON and each declares `"license": "MIT"`;
(2) independently compare `LICENSE`'s text against canonical MIT wording;
(3) confirm no file outside the five declared owned paths was touched —
**with the one disclosed exception of `package-lock.json`**, which I
flag above as a mechanical, unavoidable consequence of the brief's own
required `npm install` step, for the reviewer to explicitly judge
acceptable or not; and (4) independently re-run `npm run verify` and
confirm the test count is unchanged. I am not authorized to and have not
self-approved this task.
