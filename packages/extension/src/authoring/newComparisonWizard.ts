// T-32: interactive collection flow for `paritylens.newComparison`,
// separate from the pure `buildComparisonYaml` builder (see that file's
// header comment for the pure-core / injected-glue split rationale).
//
// Every VS Code UI/filesystem touchpoint is injected via `NewComparisonWizardDeps`
// -- same injected-dependency pattern `runComparisonCommand`
// (`packages/extension/src/activation/activate.ts`, T-22) and
// `promptForProfileFields`/the three command handlers in
// `packages/extension/src/connections/connectionCommands.ts` (T-29) already
// use, so this flow is directly testable without `@vscode/test-electron`.
import { parseDefinition } from "@paritylens/engine";
import type { ConnectionProfileStore } from "../connections/connectionProfileStore";
import { buildComparisonYaml, type NewComparisonAnswers } from "./buildComparisonYaml";

/**
 * The three built-in fixture pair names available with no saved
 * `ConnectionProfile` required, per TASK-BRIEF.md Scope item 2: "plus the
 * existing fixture pair names as a fallback option, consistent with T-30's
 * fixture-fallback precedent". Hardcoded as literals rather than imported
 * from `packages/engine/fixtures/index.ts`'s `FIXTURE_SET_IDS`: that
 * module is not re-exported through `@paritylens/engine`'s public entry
 * point (`packages/engine/src/index.ts`, out of this task's ownership --
 * see TASK-BRIEF.md's "Prohibited changes", "Do not modify
 * `packages/engine/**`"), and `activate.ts`'s own `buildFixtureRegistry`/
 * `buildConnectorRegistry` already establish the identical
 * hardcoded-literal precedent for the one fixture pair they reference
 * ("sqlserver-customer"). Listing all three known fixture-set IDs here
 * (rather than just the one `activate.ts` currently wires up) reflects
 * what "the existing fixture pair names" in the brief's own wording refers
 * to -- the three named pairs documented in CLAUDE.md's Architecture
 * section -- without requiring an engine-layer change to expose them
 * formally.
 */
const FIXTURE_PAIR_NAMES: readonly string[] = ["sqlserver-customer", "snowflake-orders", "postgres-products"];

/** VS Code UI + filesystem dependencies this wizard needs, injected for
 * testability -- mirrors `ConnectionCommandDeps`
 * (`connections/connectionCommands.ts`) and `runComparisonCommand`'s
 * inline `deps` shape. */
export interface NewComparisonWizardDeps {
  showInputBox: (options: { prompt: string; value?: string }) => Promise<string | undefined>;
  showQuickPick: (items: string[], options: { placeHolder: string }) => Promise<string | undefined>;
  showInformationMessage: (message: string) => unknown;
  showErrorMessage: (message: string) => unknown;
  /** Read-only consumption only (`.list()`), per TASK-BRIEF.md's
   * "Interfaces consumed" -- never written to by this wizard. */
  connectionProfileStore: ConnectionProfileStore;
  /** Checks whether a file already exists at `path`, so an existing file
   * is never silently overwritten (TASK-BRIEF.md Scope item 5). */
  fileExists: (path: string) => Promise<boolean>;
  /** Writes the final scaffolded YAML text to `path`. */
  writeFile: (path: string, contents: string) => Promise<void>;
  /** Resolves the absolute target path to write to, given the user's
   * chosen file base name (e.g. joins it against the current workspace
   * folder). Injected rather than importing `vscode.workspace`/`path`
   * directly, keeping this module free of any implicit `vscode` API use
   * beyond what `deps` explicitly exposes. */
  resolveTargetPath: (fileName: string) => string;
}

/** Prompts for a single connection name via quick pick: saved
 * `ConnectionProfile` names (T-29) plus the fixture pair fallback names,
 * per TASK-BRIEF.md Scope item 2 -- "do not require a saved profile to
 * exist". Returns `undefined` if the user cancels. */
async function pickConnectionName(deps: NewComparisonWizardDeps, label: "source" | "target"): Promise<string | undefined> {
  const savedNames = deps.connectionProfileStore.list().map((profile) => profile.name);
  // De-duplicate in case a saved profile happens to share a name with a
  // fixture pair -- a plain Set preserves first-seen order, listing saved
  // profiles first since they're the more specific/intentional choice.
  const items = Array.from(new Set([...savedNames, ...FIXTURE_PAIR_NAMES]));
  return deps.showQuickPick(items, { placeHolder: `Select the ${label} connection` });
}

/** Prompts for one side's object name and optional `where` clause.
 * Returns `undefined` if the user cancels either prompt. An empty `where`
 * answer ("" -- the user pressed Enter on an empty input box rather than
 * Escape) is treated as "no where clause", matching
 * `buildComparisonYaml`'s own "omit when blank" handling. */
async function promptForSide(
  deps: NewComparisonWizardDeps,
  label: "source" | "target"
): Promise<{ object: string; where?: string } | undefined> {
  const object = await deps.showInputBox({ prompt: `${label === "source" ? "Source" : "Target"} object name (e.g. dbo.Customer)` });
  if (object === undefined) {
    return undefined;
  }

  const where = await deps.showInputBox({ prompt: `${label === "source" ? "Source" : "Target"} WHERE clause (optional)` });
  if (where === undefined) {
    return undefined;
  }

  return where.trim() === "" ? { object } : { object, where };
}

/**
 * Runs the full interactive collection flow for `paritylens.newComparison`:
 * comparison name, source connection + object + optional where, target
 * connection + object + optional where, and key column(s) (comma-separated
 * in a single input box, split/trimmed into `NewComparisonAnswers.keys`).
 *
 * Returns `undefined` if the user cancels any single step (any injected
 * callback resolving `undefined`), aborting the whole flow without
 * proceeding to any later step -- per TASK-BRIEF.md Scope item 2:
 * "Returning `undefined` at any step (user cancelled) must abort the whole
 * flow without writing a file." This function itself never writes a file;
 * see `runNewComparisonCommand` below for the file-write + round-trip
 * validation step.
 */
export async function runNewComparisonWizard(deps: NewComparisonWizardDeps): Promise<NewComparisonAnswers | undefined> {
  const comparisonName = await deps.showInputBox({ prompt: "Comparison name" });
  if (comparisonName === undefined) {
    return undefined;
  }

  const sourceConnection = await pickConnectionName(deps, "source");
  if (sourceConnection === undefined) {
    return undefined;
  }
  const sourceSide = await promptForSide(deps, "source");
  if (sourceSide === undefined) {
    return undefined;
  }

  const targetConnection = await pickConnectionName(deps, "target");
  if (targetConnection === undefined) {
    return undefined;
  }
  const targetSide = await promptForSide(deps, "target");
  if (targetSide === undefined) {
    return undefined;
  }

  const keysInput = await deps.showInputBox({ prompt: "Key column(s), comma-separated (e.g. customer_id)" });
  if (keysInput === undefined) {
    return undefined;
  }
  const keys = keysInput
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
  if (keys.length === 0) {
    deps.showErrorMessage("ParityLens: at least one key column is required");
    return undefined;
  }

  return {
    comparisonName,
    sourceConnection,
    sourceObject: sourceSide.object,
    ...(sourceSide.where !== undefined ? { sourceWhere: sourceSide.where } : {}),
    targetConnection,
    targetObject: targetSide.object,
    ...(targetSide.where !== undefined ? { targetWhere: targetSide.where } : {}),
    keys
  };
}

/**
 * The `paritylens.newComparison` command handler, extracted as a directly
 * testable function -- same extraction pattern `runComparisonCommand`
 * (`activation/activate.ts`) already uses. Runs the wizard, then:
 *
 * 1. Prompts for a target file name (base name only; `deps.resolveTargetPath`
 *    resolves it to an absolute path).
 * 2. Checks `deps.fileExists` on the resolved path -- never silently
 *    overwrites an existing file (TASK-BRIEF.md Scope item 5). If a file
 *    already exists, this aborts cleanly with an error message rather than
 *    prompting for an alternative name/location (the brief's stated
 *    acceptable minimum: "aborting cleanly is an acceptable minimum").
 * 3. Builds the YAML via `buildComparisonYaml` and validates it round-trips
 *    through `parseDefinition` without throwing (TASK-BRIEF.md Scope item
 *    4) *before* writing -- if this throws, it is a bug in the scaffold
 *    builder itself (per the brief, "this is a bug in the scaffold
 *    builder, not a user-facing error path"), so it is intentionally not
 *    caught here the way `runComparisonCommand`'s outer try/catch handles
 *    user-facing errors; an `InvalidDefinitionError` at this point would
 *    indicate `buildComparisonYaml` itself produced invalid output.
 * 4. Writes the file and reports success.
 *
 * Returns the resolved file path on success, or `undefined` if the wizard
 * was cancelled or the target file already existed.
 */
export async function runNewComparisonCommand(deps: NewComparisonWizardDeps): Promise<string | undefined> {
  const answers = await runNewComparisonWizard(deps);
  if (answers === undefined) {
    return undefined;
  }

  const fileNameInput = await deps.showInputBox({
    prompt: "File name for the new comparison (e.g. customer-parity.paritylens)",
    value: `${answers.comparisonName}.paritylens`
  });
  if (fileNameInput === undefined) {
    return undefined;
  }

  const targetPath = deps.resolveTargetPath(fileNameInput);

  if (await deps.fileExists(targetPath)) {
    deps.showErrorMessage(`ParityLens: "${targetPath}" already exists — choose a different name and try again.`);
    return undefined;
  }

  const yamlText = buildComparisonYaml(answers);

  // Self-validation, not user-facing error handling -- see this function's
  // header comment. Deliberately left uncaught: a throw here means
  // `buildComparisonYaml` produced output `parseDefinition` rejects, which
  // is this scaffold's own bug, not a recoverable user mistake.
  parseDefinition(yamlText);

  await deps.writeFile(targetPath, yamlText);
  deps.showInformationMessage(`ParityLens: scaffolded new comparison at "${targetPath}"`);
  return targetPath;
}
