import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ComparisonResult, ComparisonStatus } from "@paritylens/shared";
import { writeExport } from "../export/writeExport";

/**
 * The Result Store record shape named in `DESIGN-SPEC.md`'s Architecture
 * table. Kept minimal per `TASK-BRIEF.md` T-31 scope §1: an `id` (the
 * filename-derived identifier `loadRun` accepts back), the run's `name`
 * (the comparison name, for display without needing to load the full
 * result), a `timestamp` (ISO 8601, for "most recent first" ordering and
 * display), and the full `ComparisonResult` payload. No fields beyond what
 * `listRecentRuns`/`loadRun`'s own stated purpose needs are added.
 *
 * `status` (T-47, resolving finding T-34-01): an **optional**
 * `ComparisonStatus` mirroring `result.status`, populated by `persistRun`
 * so `listRecentRuns`/`RunSummary` consumers (the "Recent Runs" tree view)
 * can key an outcome-colored icon off it without reading the full
 * `ComparisonResult` body for every listed run (see `RunSummary`'s own
 * doc comment for why that would be wasteful). It must stay optional so
 * on-disk records written before this change — which have no `status`
 * key at all — continue to parse and list successfully via
 * `listRecentRuns`, with `status` simply `undefined` for those records.
 */
export interface RunRecord {
  id: string;
  name: string;
  timestamp: string;
  status?: ComparisonStatus;
  result: ComparisonResult;
}

/**
 * Lighter summary type `listRecentRuns` actually returns. `TASK-BRIEF.md`
 * §3 explicitly invites this judgment call: "a lighter summary type if
 * reading full ComparisonResult bodies for every listed run is wasteful —
 * your call, document it." Reading and JSON-parsing every persisted run's
 * full body (which can include large row-level difference arrays) just to
 * render a "Recent Runs" list of names/timestamps is wasteful — a future
 * consumer (T-33's tree view) needs the full `ComparisonResult` only for
 * the run the user actually opens, which is exactly what `loadRun` is for.
 * `RunSummary` omits `result` for that reason; `RunRecord` (with `result`)
 * is still what gets serialized to disk and what `loadRun` returns.
 */
export type RunSummary = Omit<RunRecord, "result">;

const RECORD_EXTENSION = ".json";

/**
 * Sanitizes a comparison name for safe embedding in a filename: replaces
 * any character that is not alphanumeric, `-`, or `_` with `_`, so path
 * separators (`/`, `\`), `..` sequences, and other filesystem-unsafe
 * characters can never influence the resulting path. An empty result (e.g.
 * a name that was entirely unsafe characters) falls back to "run" so the
 * filename is never degenerate.
 */
function sanitizeName(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return sanitized.length > 0 ? sanitized : "run";
}

/**
 * Builds a sortable, collision-resistant filename stem embedding an ISO
 * timestamp (colons/periods replaced since they are unsafe/awkward in
 * filenames on some platforms) and the sanitized comparison name, per
 * `TASK-BRIEF.md` §2. A random suffix is appended as well.
 *
 * Judgment call: timestamp (millisecond resolution) + name is the
 * brief's suggested collision-avoidance strategy ("A timestamp with
 * sufficient resolution (plus the name) is sufficient; if a collision is
 * still possible in principle ... document the judgment call rather than
 * over-engineering a lock/retry scheme"). This implementation goes one
 * step further and also appends a short random suffix, because two runs
 * of the *same* comparison started programmatically (e.g. a future
 * batch/automation feature) could plausibly land in the same millisecond
 * on a fast machine — the random suffix removes that residual collision
 * risk cheaply without a lock/retry scheme. This is documented here as
 * the deliberate judgment call it is, not silently added.
 */
function buildIdStem(name: string, timestamp: Date): string {
  const isoStamp = timestamp.toISOString().replace(/[:.]/g, "-");
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  return `${isoStamp}_${sanitizeName(name)}_${randomSuffix}`;
}

/**
 * Resolves a caller-supplied `id` to the on-disk record path, guarding
 * against path-traversal exactly the way `writeExport` guards write
 * targets (see that module's doc comment) — reused here for `loadRun`'s
 * read path per `TASK-BRIEF.md` §5: "do not accept a caller-supplied
 * id/filename that could escape the root without the same rejection
 * writeExport already gives persistRun." This mirrors (does not
 * reimplement with different logic) `writeExport`'s own containment
 * check: resolve against the root, then verify via `path.relative` that
 * the result doesn't escape.
 */
function resolveRecordPath(id: string, safeOutputRoot: string): string {
  const resolvedRoot = resolve(safeOutputRoot);
  const targetPath = id.endsWith(RECORD_EXTENSION) ? id : `${id}${RECORD_EXTENSION}`;
  const resolvedTarget = resolve(safeOutputRoot, targetPath);

  const rel = relative(resolvedRoot, resolvedTarget);
  const escapesRoot = rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);

  if (escapesRoot) {
    throw new Error(
      `Refusing to load run: resolved path "${resolvedTarget}" is not contained under the safe output root "${resolvedRoot}".`
    );
  }

  return resolvedTarget;
}

/**
 * Persists `result` as an immutable JSON `RunRecord` under
 * `safeOutputRoot`, via `writeExport` (imported and called directly, per
 * `TASK-BRIEF.md` §5 — `writeExport`'s own containment check is what
 * protects this write; it is not re-derived here). Returns the record's
 * `id`, which `loadRun`/`listRecentRuns` use to address it again.
 *
 * Immutability: `buildIdStem` embeds millisecond-resolution time plus a
 * random suffix in the filename, so two calls — even for runs of the same
 * comparison `name` started back-to-back — produce distinct filenames and
 * therefore distinct files; no call ever targets a path a prior call could
 * have written, so no run's record can be overwritten by another.
 */
export async function persistRun(result: ComparisonResult, safeOutputRoot: string): Promise<string> {
  const timestamp = new Date();
  const id = buildIdStem(result.comparison, timestamp);
  const record: RunRecord = {
    id,
    name: result.comparison,
    timestamp: timestamp.toISOString(),
    status: result.status,
    result
  };

  const targetPath = `${id}${RECORD_EXTENSION}`;
  await writeExport(targetPath, JSON.stringify(record), safeOutputRoot);

  return id;
}

/**
 * Reads a specific persisted `RunRecord` back and returns its
 * `ComparisonResult` payload, per `TASK-BRIEF.md` §4. `id` is resolved
 * through the same containment check `writeExport` applies to write
 * targets (see `resolveRecordPath`), so a crafted `id` cannot escape
 * `safeOutputRoot`.
 */
export async function loadRun(id: string, safeOutputRoot: string): Promise<ComparisonResult> {
  const recordPath = resolveRecordPath(id, safeOutputRoot);
  const contents = await readFile(recordPath, "utf8");
  const record = JSON.parse(contents) as RunRecord;
  return record.result;
}

/**
 * Lists the runs `persistRun` has written under `safeOutputRoot`, most
 * recent first, per `TASK-BRIEF.md` §3. Returns `RunSummary` (id/name/
 * timestamp only, not the full `ComparisonResult` body) — see
 * `RunSummary`'s doc comment for why reading every full record body here
 * would be wasteful for a listing operation. Non-record files (anything
 * not ending in `.json`, and any `.json` file that fails to parse as a
 * `RunRecord`) are silently skipped rather than throwing, since this
 * directory is expected to be dedicated to run records but a partially
 * written or foreign file should not break the whole listing.
 */
export async function listRecentRuns(safeOutputRoot: string): Promise<RunSummary[]> {
  const resolvedRoot = resolve(safeOutputRoot);

  let entries: string[];
  try {
    entries = await readdir(resolvedRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const summaries: RunSummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(RECORD_EXTENSION)) {
      continue;
    }
    try {
      const contents = await readFile(resolve(resolvedRoot, entry), "utf8");
      const record = JSON.parse(contents) as RunRecord;
      if (typeof record.id === "string" && typeof record.name === "string" && typeof record.timestamp === "string") {
        // `status` is additive/optional (T-47): pre-existing records
        // written before this change have no `status` key at all, and
        // must continue to parse and list successfully with `status`
        // simply `undefined` rather than being treated as malformed. The
        // conditional spread (rather than `status: record.status`) is
        // required by this project's `exactOptionalPropertyTypes: true`
        // setting, under which an optional property must be omitted
        // entirely rather than explicitly assigned `undefined`.
        summaries.push({
          id: record.id,
          name: record.name,
          timestamp: record.timestamp,
          ...(record.status !== undefined ? { status: record.status } : {})
        });
      }
    } catch {
      // Skip unreadable/malformed entries; see doc comment above.
      continue;
    }
  }

  summaries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return summaries;
}
