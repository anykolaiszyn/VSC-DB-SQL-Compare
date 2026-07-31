// T-12: column mapping suggestion.
//
// suggestMappings(source, target) proposes, for each source column, zero or
// one best-candidate target column, per Idea Prompt.md section 3's
// "Automatic mapping suggestions" list. Only four of the strategies listed
// there are in scope for this task, in this preference order:
//   1. exact name match
//   2. case-insensitive name match
//   3. snake_case <-> camelCase equivalence
//   4. ordinal position (last-resort fallback)
//
// Deliberately out of scope (TASK-BRIEF.md "Prohibited changes"):
//   - prefix/suffix removal, common-abbreviation expansion (e.g.
//     cust_nm -> CUSTOMER_NAME) -- Idea Prompt.md section 14 excludes
//     "AI-generated mappings" from MVP scope, and the brief separately
//     calls out abbreviation matching as not simple/deterministic enough
//     to be safely automatic.
//   - data-type compatibility, profile similarity, value overlap, and any
//     AI-assisted semantic matching -- all listed in the idea doc as
//     *possible* future strategies, none chosen for this task.
//
// A `MappingSuggestion` only proposes -- per Idea Prompt.md section 3,
// "Users must be able to approve, reject, or manually edit every mapping."
// suggestMappings never mutates its inputs and never produces or touches a
// ParityDefinition/ColumnMappingEntry (T-08's user-authored/approved
// mapping shape); it is purely advisory output for a future approval UI
// (T-16, unscheduled).
import type { ColumnDefinition } from "@paritylens/shared";

/** Which of the four in-scope strategies produced a given suggestion, so a
 * caller/UI can show *why* a mapping was suggested (brief's Interfaces
 * table: "must report which strategy matched"). */
export type MappingStrategy = "exact" | "case-insensitive" | "snake-camel" | "ordinal";

/** One proposed source -> target column mapping. Advisory only -- never
 * auto-applied, distinct from T-08's user-authored `ColumnMappingEntry`. */
export interface MappingSuggestion {
  source: string;
  target: string;
  strategy: MappingStrategy;
}

/**
 * Converts a snake_case or camelCase identifier into a normalized form
 * (lowercase, no separators) so the two naming conventions can be compared
 * for equivalence, e.g. "order_amount" and "orderAmount" both normalize to
 * "orderamount".
 */
function toComparableForm(name: string): string {
  return name.replace(/[_-]+/g, "").toLowerCase();
}

/**
 * For each source column, finds the single best-candidate target column
 * using the four in-scope strategies in preference order. A target column
 * already claimed by an earlier (higher-preference) suggestion for a
 * different source column is not reused, so each target is suggested at
 * most once -- avoiding two source columns both being suggested against
 * the same target.
 *
 * Pure function: never mutates `source` or `target`.
 */
export function suggestMappings(source: ColumnDefinition[], target: ColumnDefinition[]): MappingSuggestion[] {
  const suggestions: MappingSuggestion[] = [];
  const claimedTargets = new Set<string>();

  for (const sourceColumn of source) {
    const candidate = findBestCandidate(sourceColumn, target, claimedTargets);
    if (candidate) {
      suggestions.push(candidate);
      claimedTargets.add(candidate.target);
    }
  }

  return suggestions;
}

function findBestCandidate(
  sourceColumn: ColumnDefinition,
  target: ColumnDefinition[],
  claimedTargets: ReadonlySet<string>
): MappingSuggestion | undefined {
  const availableTargets = target.filter((t) => !claimedTargets.has(t.name));

  // 1. Exact name match.
  const exact = availableTargets.find((t) => t.name === sourceColumn.name);
  if (exact) {
    return { source: sourceColumn.name, target: exact.name, strategy: "exact" };
  }

  // 2. Case-insensitive match.
  const sourceLower = sourceColumn.name.toLowerCase();
  const caseInsensitive = availableTargets.find((t) => t.name.toLowerCase() === sourceLower);
  if (caseInsensitive) {
    return { source: sourceColumn.name, target: caseInsensitive.name, strategy: "case-insensitive" };
  }

  // 3. snake_case <-> camelCase equivalence.
  const sourceComparable = toComparableForm(sourceColumn.name);
  const snakeCamel = availableTargets.find((t) => toComparableForm(t.name) === sourceComparable);
  if (snakeCamel) {
    return { source: sourceColumn.name, target: snakeCamel.name, strategy: "snake-camel" };
  }

  // 4. Ordinal position, last-resort fallback.
  const ordinal = availableTargets.find((t) => t.ordinalPosition === sourceColumn.ordinalPosition);
  if (ordinal) {
    return { source: sourceColumn.name, target: ordinal.name, strategy: "ordinal" };
  }

  return undefined;
}
