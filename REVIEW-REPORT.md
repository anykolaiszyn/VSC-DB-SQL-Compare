# ParityLens — Review Report T-25

## Review independence statement

This review was performed by a separate agent instance from whichever
implementer session(s) produced `task/T-25-extension-packaging` (tip
`f5e7b99`, based on `main` at `bd6daa3`). I did not trust
`IMPLEMENTATION-REPORT.md`'s claims — every factual claim checked below
(file contents, `.vsix` contents, hashes, verification counts) was
independently re-derived from the actual repository state and my own
freshly-produced artifact, not copied from the report.

## Scope reviewed

- `TASK-BRIEF.md` (including its round-1-triggered Amendment) as sole
  authority.
- `IMPLEMENTATION-REPORT.md` — treated as a claim set to verify, not a
  source of truth.
- Full diff `bd6daa3..f5e7b99` (both round 1, commit `ac44c22`, and round
  2, commit `f5e7b99`, plus the amendment commit `c726227`).
- Actual current contents of every changed file.
- A freshly, independently produced `.vsix`, unzipped and inspected
  directly.

## Verification performed (my own commands and results)

1. **`name`/`publisher`/`private` fields** — read directly:
   - `packages/extension/package.json`: `"name": "paritylens"`,
     `"publisher": "parity-lens-dev"` — exact match to the Amendment's
     specified values. No other field changed by this edit (confirmed via
     `git diff c726227 f5e7b99 -- packages/extension/package.json`, which
     shows only the `name`/`publisher` addition and the `scripts.package`
     value change).
   - `packages/shared/package.json`: `"private": true` present, unchanged.
   - `packages/engine/package.json`: `"private": true` present, unchanged.

2. **Independent `.vsix` build.** Ran `npm run typecheck` (clean, exit 0,
   no output) then `npm run package` from `packages/extension/` myself
   (`vsce package --no-dependencies`, resolved from the actual
   `scripts.package` entry, not assumed). Produced my own
   `paritylens-0.0.1.vsix`, 23,306 bytes — byte-size-identical to the
   report's claimed 23,306 bytes.

   Unzipped it myself (copied to `.zip`, extracted, recursive listing).
   Contents: `[Content_Types].xml`, `extension.vsixmanifest`,
   `extension/package.json`, `extension/readme.md`, and 16 files under
   `extension/dist/**` (`.js`/`.d.ts` pairs for `index`, `activation`,
   `export` (x2), `secrets`, `statusbar`, `views`, `webview` — 18 payload
   files total, matching the report's listing exactly, file-for-file).

   Directly probed the specific risk the `--no-dependencies` judgment
   call was meant to close:
   - `find extracted -iname "*.test.*"` → empty. No test files of any
     kind.
   - `find extracted -iname "node_modules" -o -iname "@types"` → empty.
   - `find extracted -iname ".git*"` → empty. No `.git/` leakage.
   - `find extracted -path "*src*"` → empty. No `src/**` leakage.
   - Inspected `extension/package.json` inside the archive directly:
     correct `name`/`publisher` values present in the packaged manifest,
     not just the source file.
   - Inspected `extension.vsixmanifest`: `Identity ... Id="paritylens"
     ... Publisher="parity-lens-dev"` — confirms the fix actually reached
     the packaged output, not just the source `package.json`.

   **Adversarial re-creation of the disclosed risk, to confirm it was
   real and not overstated:** ran `vsce package` (no flags, the
   pre-judgment-call command) myself from `packages/extension/`. Result:
   `vsce ls --tree` and the package summary showed the walk climbing to
   the repo root and pulling in **8946 files / 224.13 MB** under
   `extension/../../`, including sibling `engine/` (188 files) and
   `shared/` (28 files) trees. I specifically grepped the tree output for
   `.git` and confirmed `.git/`, `.git/.github/`, `.gitattributes`, etc.
   were present in the unflagged walk. This independently reproduces and
   confirms the exact leak the report describes — I did not just accept
   the disclosure, I broke it myself first, then confirmed
   `--no-dependencies` closes it (re-ran `npm run package` afterward,
   confirmed the clean 20-file/23,306-byte result was restored).

3. **SHA-256 hash comparison.**
   - My independently produced `.vsix`:
     `ca2ec7392c28e7ca23a390aff57a4474c0c84d7a1a63e3b11d8df2fff95aba08`
   - Report's claimed hash:
     `c509fa01ee8e3bb4d11747fe537b113ee55a27674be4374cf6261261dd977c1`
     (64 hex chars — recounted with `wc -c` to guard against a
     transcription misread on my part; confirmed 64, not a defect in the
     report's string itself)
   - **These do not match.** Investigated before concluding anything is
     wrong, per instructions: `.vsix` is a ZIP container, and
     `unzip -v` shows each entry carries a per-file last-modified
     timestamp taken from filesystem mtimes at build time (my build's
     entries show `2026-08-01 18:41`; `extension/package.json` shows
     `18:36`, an earlier edit time preserved from source). Two builds run
     at different wall-clock times — mine vs. the implementer's — will
     produce different DEFLATE stream bytes purely from these embedded
     timestamps even with byte-identical logical file contents. File
     sizes, uncompressed lengths, file count, and every logical content
     check above matched exactly. This is the exact non-blocking,
     disclosable-not-defect scenario the dispatch instructions
     anticipated. **Finding recorded below as Minor** — full
     byte-for-byte reproducibility was never actually achieved or claimed
     as achieved by the report (the report presents its hash as *this
     build's* hash, not as a reproducibility guarantee across independent
     builds), but it's worth noting explicitly since "SHA-256 hash"
     language can imply stronger reproducibility than a `vsce`-packaged
     `.vsix` actually offers.

4. **`.vsix` not committed to git.** `git status --short` on the branch
   tip shows no untracked/modified entry for the `.vsix` despite it
   existing in the working tree at `packages/extension/`. Confirmed via
   `git check-ignore -v packages/extension/paritylens-0.0.1.vsix` →
   matched by `.gitignore:9:*.vsix`. Correct.

5. **Fresh `npm run verify`.** Ran it myself on the branch tip:
   `tsc -b --force` clean, `eslint .` clean, `vitest run` →
   **22 test files passed, 2 skipped (24); 404 tests passed, 27 skipped
   (431 total)**, exit 0. Matches the report's claimed baseline exactly
   and matches `TASK-BRIEF.md`'s expected evidence (404/27/431).

6. **Judgment call assessment** (`--no-dependencies` flag,
   `.vscodeignore` `.test.d.ts`/`.test.d.ts.map` additions):
   - Both edits land inside files already declared as owned by this task
     (`packages/extension/package.json`'s `scripts.package` field;
     `packages/extension/.vscodeignore`) — no new file ownership was
     claimed.
   - Both are reactive fixes to problems that only became visible once
     the Amendment's `name`/`publisher` fix let packaging proceed far
     enough to hit them — they could not have been anticipated or
     specified at Amendment-authoring time, unlike the `name`/`publisher`
     values which were fully specifiable in advance.
   - Both were independently reproduced by me as real (see items 2 and
     3's adversarial checks above) — neither is a hypothetical or
     overstated risk.
   - Both are the kind of "minimal mechanically-forced consequence of
     authorized work" the dispatch instructions describe as acceptable,
     not genuine scope expansion: fixing "produce a correct package" one
     token/two lines at a time inside files whose purpose is exactly
     "control what's in the package" is squarely within the brief's own
     item 2/item 3 intent ("the packaged `.vsix` should contain only
     `dist/**`'s compiled output... not source/test files";
     "`--no-dependencies`/an equivalent documented `vsce` flag if one
     exists for this exact case" is literally named in the brief's text,
     just originally anticipated for a different, superseded blocker).
   - Both were disclosed prominently and separately rather than folded in
     silently, as the brief's process expects.
   - **Assessment: both judgment calls were reasonable and appropriately
     disclosed. Not scope creep.**

## Disposition of prior findings

No open finding from a prior review round names T-25 as its resolution
target (checked `PROGRESS-LEDGER.md`'s task register and integration
evidence section — the open items referenced there, T-20-02/T-20-04, are
unrelated to packaging). This task originates from a fresh Release-phase
gap (Release step 4), not a remediation of a prior finding, so there is
no prior-finding reproduction obligation for this review beyond
re-verifying the task's own round-1-to-round-2 blocker resolution, which
is covered in items 1–3 above.

## Findings

### Critical

None.

### Important

None.

### Minor

| ID | Finding | Evidence | Suggested resolution |
| --- | --- | --- | --- |
| T-25-01 | The report's claimed SHA-256 hash is not byte-reproducible across independent builds, because `vsce`'s ZIP output embeds per-file mtimes that vary by build wall-clock time. This is disclosed nowhere in the report or brief as a caveat on the hash's meaning — a future reader could reasonably (and incorrectly) treat "record its SHA-256 hash" as implying the hash is a stable fingerprint of the source revision, when it is only a fingerprint of that one specific build. | My independent rebuild from the same source (`f5e7b99`) produced `ca2ec7392c28e7ca23a390aff57a4474c0c84d7a1a63e3b11d8df2fff95aba08`, differing from the report's claimed `c509fa01ee8e3bb4d11747fe537b113ee55a27674be4374cf6261261dd977c1`, while file count, file names, and uncompressed sizes matched exactly; `unzip -v` shows per-entry timestamps differing between builds (e.g. `2026-08-01 18:41` in my build). | No code change needed. Suggest a one-line addendum to `IMPLEMENTATION-REPORT.md` or a note for any future packaging documentation clarifying that the recorded hash identifies that specific build artifact, not a reproducible-from-source fingerprint — future consumers verifying integrity should compare file contents/listing, not expect hash equality across independent rebuilds of identical source. Non-blocking; does not affect approval. |
| T-25-02 | The packaged `extension/package.json` still carries `"types": "src/index.ts"`, a dev-time pointer into the now-excluded `src/**` tree. Harmless at runtime (VS Code doesn't consult `types` when loading an extension) but is a small metadata inconsistency inside an otherwise-clean shipped manifest. | Confirmed by direct inspection of the unzipped `extension/package.json` inside my independently built `.vsix`. | Not this task's scope to fix (the brief's Amendment authorized only `name`/`publisher`/`scripts.package`, and this field predates T-25). Flagging for a future packaging-polish task; no action required now. |

## Scope and ownership check

`git diff c726227 f5e7b99` (round 2) touches exactly
`packages/extension/package.json`, `packages/extension/.vscodeignore`,
`packages/extension/README.md`, and `IMPLEMENTATION-REPORT.md` — all
within declared or amendment-authorized ownership. `git diff bd6daa3
ac44c22` (round 1) touches `.gitignore`, `package.json` (root),
`package-lock.json`, `packages/extension/package.json`,
`packages/extension/.vscodeignore`, `packages/extension/README.md`,
`IMPLEMENTATION-REPORT.md` — all within the brief's original "Files
owned" list. No file under `packages/*/src/**` was touched in either
round (confirmed via `git diff --stat` across the full range). No
unauthorized scope expansion found.

## Final approval status

**APPROVED**

Both round-1's correct stop-and-flag and round-2's Amendment-driven fix
plus its two disclosed judgment calls hold up under independent,
adversarial verification: the `name`/`publisher` fields match the
Amendment exactly, `private: true` remains untouched on `shared`/`engine`,
a freshly and independently rebuilt `.vsix` matches the report's claimed
size and content listing exactly (including confirmed absence of
`src/**`, `*.test.*`, `node_modules/@types/**`, and `.git/` — the last of
which I reproduced as a real leak myself before confirming the fix closes
it), the `.vsix` is correctly git-ignored, and `npm run verify` reproduces
the exact claimed 404/27/431 baseline. The one hash mismatch was
investigated rather than assumed to be a defect, and traced to a
well-understood, non-blocking cause (ZIP per-entry timestamps) rather
than any content or process discrepancy. Both disclosed judgment calls
are reasonable, adequately disclosed, and independently confirmed
necessary. Two Minor findings recorded for future-task follow-up; neither
blocks approval.
