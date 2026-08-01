import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/**
 * Writes `content` to `targetPath`, after validating the resolved path is
 * contained under `safeOutputRoot`, per `DESIGN-SPEC.md`'s "Write safety"
 * principle: "All engine writes (result store, exports, cached profiling
 * data) are contained under a configurable safe output root ... verified
 * before write." This is the thin, I/O-performing counterpart to the pure
 * `exportTo*` functions in `./exporters.ts` — those never touch the
 * filesystem; this is the only place in this module that does.
 *
 * Judgment call: containment is checked via `path.relative(root, target)`
 * on the fully resolved (absolute, `..`/symlink-segment-normalized —
 * `path.resolve` does not follow symlinks, but it does collapse `..` and
 * `.` segments) paths rather than a naive string-prefix check, so a
 * relative `targetPath` containing `../` segments that resolves outside
 * `safeOutputRoot` is caught (`path.relative` yields a path starting with
 * `..`), and so is an absolute `targetPath` outside the root entirely.
 * A resolved path equal to `safeOutputRoot` itself is also rejected (it is
 * a directory, not a writable file target).
 *
 * Throws (rejects) rather than silently writing outside the root or
 * silently clamping the path into the root, per the brief's Interfaces
 * table: "rejecting (throwing) if the resolved path would escape it."
 */
export async function writeExport(targetPath: string, content: string, safeOutputRoot: string): Promise<void> {
  const resolvedRoot = resolve(safeOutputRoot);
  const resolvedTarget = resolve(safeOutputRoot, targetPath);

  const rel = relative(resolvedRoot, resolvedTarget);
  const escapesRoot = rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);

  if (escapesRoot) {
    throw new Error(
      `Refusing to write export: resolved path "${resolvedTarget}" is not contained under the safe output root "${resolvedRoot}".`
    );
  }

  await mkdir(dirname(resolvedTarget), { recursive: true });
  await writeFile(resolvedTarget, content, "utf8");
}
