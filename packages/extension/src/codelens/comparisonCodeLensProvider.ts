// T-39: a vscode.CodeLensProvider for `.paritylens` files showing four
// inline actions above the document -- Run Profile, Run Schema Check, Run
// Full Comparison, Open Last Result -- per Idea Prompt.md section 6's
// sketch and TASK-BRIEF.md T-39's Scope item 1. A CodeLensProvider is a
// document-level feature (registered via
// vscode.languages.registerCodeLensProvider, wired in activate.ts), so it
// works whether the document is open via T-36's custom editor or as plain
// text -- it does not depend on which editor (if any) currently has the
// document open, only on the document's content/language selector match.
//
// Follows this codebase's established pure-core/injected-glue split (see
// activate.ts's runComparisonCommand/reopenRunCommand and
// parityTreeDataProvider.ts's ParityTreeDataProviderDeps): every dependency
// that touches the live vscode API or the filesystem beyond the
// TextDocument itself is injected via ComparisonCodeLensProviderDeps, so
// this class is testable under plain Vitest without @vscode/test-electron.
import * as vscode from "vscode";
import { parseDefinition, type ParityChecks } from "@paritylens/engine";
import type { RunSummary } from "../runHistory/runHistory.js";
import { RUN_COMPARISON_COMMAND_ID, REOPEN_RUN_COMMAND_ID } from "../activation/activate.js";

/**
 * Command ID a "no runs yet for this comparison" click invokes, for the
 * documented alternative TASK-BRIEF.md Scope item 1 explicitly allows
 * ("either not appear or invoke a command that shows a clear ... message —
 * your call, document it"). Judgment call made here: rather than omitting
 * the "Open Last Result" lens entirely when no run exists yet (which would
 * make the lens's *absence* the only signal, easy to miss/misread as "this
 * feature doesn't exist"), the lens always appears so its presence is a
 * predictable, discoverable affordance -- clicking it before any run exists
 * surfaces a clear message via this dedicated command instead of silently
 * doing nothing or throwing. Not added to package.json's
 * contributes.commands (matching REOPEN_RUN_COMMAND_ID's own precedent,
 * documented on that constant in activate.ts) -- a manifest entry is only
 * needed for command-palette visibility, not for
 * vscode.commands.registerCommand/executeCommand to work for a
 * CodeLens-triggered command.
 */
export const NO_RUNS_YET_COMMAND_ID = "paritylens.noRunsYetForComparison";

/**
 * Dependencies `ComparisonCodeLensProvider` needs beyond the `TextDocument`
 * `provideCodeLenses` is called with. Mirrors
 * `ParityTreeDataProviderDeps`'s injection pattern (`listRecentRuns`, in
 * particular, is the exact same T-31 function, bound to a concrete
 * `safeOutputRoot` by the caller in `activate.ts` -- this class never
 * resolves `safeOutputRoot` itself).
 */
export interface ComparisonCodeLensProviderDeps {
  /**
   * T-31's `listRecentRuns`, bound to a concrete `safeOutputRoot` by the
   * caller (mirrors `ParityTreeDataProviderDeps.listRecentRuns` exactly --
   * same function, same binding convention, not a reimplementation).
   */
  listRecentRuns: () => Promise<RunSummary[]>;
}

/**
 * Builds the four `CodeLens` instances for a successfully parsed
 * `.paritylens` document, per TASK-BRIEF.md T-39 Scope item 1. All four are
 * placed at line 0 (`new vscode.Range(0, 0, 0, 0)`) -- documented choice:
 * the design sketch (Idea Prompt.md section 6) shows the four actions as a
 * single row of inline actions "above" the file, and this project's YAML
 * definitions always start with a `version:`/`name:` header at or near line
 * 0, so anchoring every lens there keeps them together as one visual row
 * regardless of how the rest of the document is laid out (matching how VS
 * Code's own CodeLens rows collapse multiple same-line lenses into one
 * horizontal strip).
 *
 * "Run Profile"/"Run Schema Check" each pass a `checksOverride` argument
 * (position 2) to `paritylens.runComparison` alongside the document's own
 * `uri` (position 1) -- the in-memory-only override this task's
 * `runComparisonCommand` extension (`activate.ts`) applies before
 * `planQueries`/`runComparison`, never written back to the file. "Run Full
 * Comparison" passes only the `uri`, no override, so
 * `runComparisonCommand` uses the document's own parsed `checks` exactly as
 * written -- both paths route through the exact same command, and
 * therefore the exact same `planQueries`/confirmation-panel flow T-38
 * established; neither bypasses it.
 */
function buildLensesForValidDocument(uri: vscode.Uri, lastRun: RunSummary | undefined): vscode.CodeLens[] {
  const range = new vscode.Range(0, 0, 0, 0);

  const runProfileOverride: ParityChecks = { schema: { enabled: false }, profile: { enabled: true } };
  const runSchemaOverride: ParityChecks = { schema: { enabled: true }, profile: { enabled: false } };

  const runProfileLens = new vscode.CodeLens(range, {
    title: "Run Profile",
    command: RUN_COMPARISON_COMMAND_ID,
    arguments: [uri, runProfileOverride]
  });

  const runSchemaLens = new vscode.CodeLens(range, {
    title: "Run Schema Check",
    command: RUN_COMPARISON_COMMAND_ID,
    arguments: [uri, runSchemaOverride]
  });

  const runFullLens = new vscode.CodeLens(range, {
    title: "Run Full Comparison",
    command: RUN_COMPARISON_COMMAND_ID,
    arguments: [uri]
  });

  const openLastResultLens =
    lastRun !== undefined
      ? new vscode.CodeLens(range, {
          title: "Open Last Result",
          command: REOPEN_RUN_COMMAND_ID,
          arguments: [lastRun.id]
        })
      : new vscode.CodeLens(range, {
          title: "Open Last Result",
          command: NO_RUNS_YET_COMMAND_ID,
          arguments: []
        });

  return [runProfileLens, runSchemaLens, runFullLens, openLastResultLens];
}

/**
 * Finds the most recently persisted run matching `comparisonName`, per
 * TASK-BRIEF.md T-39 Scope item 1's "Open Last Result" lookup: "filtering
 * by `name` and taking the most recent `timestamp` (same lookup-by-name
 * pattern T-33's tree view already uses — do not reimplement differently)."
 * `listRecentRuns` (T-31) already returns its `RunSummary[]` sorted most-
 * recent-first (see that function's own doc comment -- this function does
 * no re-sorting of its own), so filtering by `name` and taking the first
 * match is sufficient and exactly matches that ordering contract.
 */
function findMostRecentRunForComparison(runs: readonly RunSummary[], comparisonName: string): RunSummary | undefined {
  return runs.find((run) => run.name === comparisonName);
}

/**
 * `vscode.CodeLensProvider` implementation registered for `.paritylens`
 * files (see `activate.ts`'s `registerComparisonCodeLensProvider`).
 */
export class ComparisonCodeLensProvider implements vscode.CodeLensProvider {
  constructor(private readonly deps: ComparisonCodeLensProviderDeps) {}

  /**
   * Reads the document text and attempts `parseDefinition` (T-08). If
   * parsing fails (malformed YAML, missing required fields), returns an
   * empty array -- no lenses that would crash on click, and this method
   * itself never throws (VS Code calls `provideCodeLenses` on every
   * keystroke-adjacent document change; throwing repeatedly would be
   * disruptive, per TASK-BRIEF.md Scope item 1's explicit instruction).
   * `parseDefinition` throws `InvalidDefinitionError` for the "missing
   * required fields"/"malformed structure" cases and a YAML-library parse
   * error for genuinely malformed YAML syntax -- both are caught by the
   * same broad `catch` here, since either one means "not a valid parity
   * definition right now," and this method's contract is the same either
   * way: no lenses.
   */
  async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
    // `token` is part of vscode.CodeLensProvider's interface contract but
    // unused here (no cancellation-sensitive work happens before the
    // parseDefinition/listRecentRuns calls below complete) -- named and
    // no-op'd rather than prefixed `_token`, matching this codebase's own
    // established convention (see comparisonEditorProvider.ts's
    // `resolveCustomTextEditor`'s identical `void token;` comment).
    void token;

    let definitionName: string;
    try {
      const definition = parseDefinition(document.getText());
      definitionName = definition.name;
    } catch {
      return [];
    }

    // T-51 item 4: listRecentRuns (T-31) reads persisted extension-storage
    // state and can reject (e.g. corrupted run-history state) independently
    // of whether the document itself is a perfectly valid parity
    // definition. This method's contract is "never throws" (see the doc
    // comment above), so a rejection here must not propagate out of
    // provideCodeLenses. Falling back to buildLensesForValidDocument(...,
    // undefined) renders the four lenses as if no prior run exists --
    // matching "Open Last Result"'s own pre-existing no-runs-yet fallback
    // for the normal case -- rather than returning [], which would
    // needlessly suppress "Run Profile"/"Run Schema Check"/"Run Full
    // Comparison" for an otherwise-valid, parseable document just because
    // run-history lookup failed.
    try {
      const runs = await this.deps.listRecentRuns();
      const lastRun = findMostRecentRunForComparison(runs, definitionName);
      return buildLensesForValidDocument(document.uri, lastRun);
    } catch (err) {
      console.error("[ComparisonCodeLensProvider] listRecentRuns failed; falling back to no-prior-run lenses:", err);
      return buildLensesForValidDocument(document.uri, undefined);
    }
  }
}
