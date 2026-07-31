import * as vscode from "vscode";
import type { ComparisonResult, ComparisonSummary } from "@paritylens/shared";

/**
 * Phase-1 status bar summary (TASK-BRIEF.md T-11).
 *
 * Text format `Parity: {summary.passed} passed | {summary.warnings}
 * warnings | {summary.failed} failed`, matching `Idea Prompt.md`'s
 * "Status bar" worked example (`Parity: 18 passed | 2 warnings | 1
 * failed`) literally. Updates from a `ComparisonResult`'s `summary` field
 * only — no other field of `ComparisonResult` is read here.
 */

/** Formats a `ComparisonSummary` as the status bar's display text. */
export function formatParitySummary(summary: ComparisonSummary): string {
  return `Parity: ${summary.passed} passed | ${summary.warnings} warnings | ${summary.failed} failed`;
}

export interface ParityStatusBarItem {
  readonly item: vscode.StatusBarItem;
  /** Updates the underlying status bar item's text from a `ComparisonResult`'s `summary` field. */
  updateFromResult(result: ComparisonResult): void;
  readonly text: string;
  show(): void;
  dispose(): void;
}

/**
 * Creates a status bar item that displays the `Parity: N passed | N
 * warnings | N failed` summary. Wraps `vscode.window.createStatusBarItem`
 * so callers (activation code) get a small, test-friendly object rather
 * than needing to interact with the raw `vscode.StatusBarItem` API.
 */
export function createParityStatusBarItem(): ParityStatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);

  return {
    item,
    updateFromResult(result: ComparisonResult): void {
      item.text = formatParitySummary(result.summary);
    },
    get text(): string {
      return item.text;
    },
    show(): void {
      item.show();
    },
    dispose(): void {
      item.dispose();
    }
  };
}
