// T-06: schema diff.
//
// compareSchemas(source, target, expectations?) compares two
// ColumnDefinition[] sets (per Idea Prompt.md section 2, "Layer 2:
// Structural Parity") across:
//   - column presence (missing-in-target / missing-in-source)
//   - column order (order-mismatch, informational)
//   - native type (informational only -- native type names legitimately
//     differ across platforms, e.g. INT vs NUMBER(38,0); this is not itself
//     a finding, it is surfaced via sourceType/targetType on other findings)
//   - normalized/canonical type, via T-05's mapNativeType + compareCanonicalTypes
//   - length / precision / scale
//   - nullability
//
// Each finding is a SchemaDifference (packages/shared/src/result.ts, refined
// by this task) carrying a Severity from DESIGN-SPEC.md's severity model
// (Pass/Informational/Warning/Failure/Error/Skipped).
//
// M-07 resolution (see IMPLEMENTATION-REPORT.md for full reasoning): T-05's
// compareCanonicalTypes downgrades same-category Timestamp/Timestamp and
// Time/Time pairs to "Review" even when the two native type strings are
// byte-for-byte IDENTICAL (e.g. DATETIME2 vs DATETIME2), which is a false
// positive -- two columns declared with the exact same native type are
// trivially compatible, nothing to review. This module special-cases that:
// if source.nativeType and target.nativeType are the same string, the type
// check short-circuits straight to "no finding" (Compatible) WITHOUT
// calling compareCanonicalTypes at all. Only when the native type strings
// differ does this module fall through to mapNativeType + compareCanonicalTypes,
// which preserves the original DATETIME/TIMESTAMP_NTZ -> Review example
// (different native strings, same Timestamp category) from T-05.
import type { ColumnDefinition, Severity } from "@paritylens/shared";
import type { SchemaDifference } from "@paritylens/shared";
import { compareCanonicalTypes, type TypeCompatibility } from "../type-mapping/type-mapping.js";

/**
 * Per-check severity overrides, keyed by `SchemaDifferenceKind`. Mirrors
 * Idea Prompt.md section 12's `expectations.schema.*` example
 * (`missing_target_column: fail`, `nullable_to_required: warning`, etc.).
 * Every key is optional; unspecified kinds fall back to this module's
 * documented default severity for that kind.
 */
export interface SchemaExpectations {
  /** Overrides the default Failure severity for a column present on the source but absent on the target. */
  missingTargetColumnSeverity?: Severity;
  /** Overrides the default Failure severity for a column present on the target but absent on the source. */
  missingSourceColumnSeverity?: Severity;
  /** Overrides the default severity for a nullable column becoming non-nullable on the target ("nullable_to_required" in the idea doc). */
  nullableToRequiredSeverity?: Severity;
  /** Overrides the default severity for a required (non-nullable) column becoming nullable on the target. */
  requiredToNullableSeverity?: Severity;
  /** Overrides the default Informational severity for a target string/binary length increase (safe, "increased_string_length: info" in the idea doc). */
  increasedLengthSeverity?: Severity;
  /** Overrides the default Failure severity for a target string/binary length decrease (lossy, "decreased_string_length: fail" in the idea doc). */
  decreasedLengthSeverity?: Severity;
  /** Overrides the default severity for a column-order difference. */
  orderMismatchSeverity?: Severity;
}

const DEFAULT_MISSING_SEVERITY: Severity = "Failure";
const DEFAULT_ORDER_SEVERITY: Severity = "Informational";
const DEFAULT_INCREASED_LENGTH_SEVERITY: Severity = "Informational";
const DEFAULT_DECREASED_LENGTH_SEVERITY: Severity = "Failure";
const DEFAULT_PRECISION_SEVERITY: Severity = "Warning";
const DEFAULT_SCALE_SEVERITY: Severity = "Warning";
const DEFAULT_NULLABLE_TO_REQUIRED_SEVERITY: Severity = "Warning";
const DEFAULT_REQUIRED_TO_NULLABLE_SEVERITY: Severity = "Informational";

/** Maps T-05's three-tier TypeCompatibility result onto the Severity union. */
const TYPE_COMPATIBILITY_SEVERITY: Record<TypeCompatibility, Severity> = {
  Compatible: "Pass",
  Review: "Warning",
  Risk: "Failure",
};

/**
 * Compares two `ColumnDefinition[]` sets (source and target) and returns a
 * `SchemaDifference[]` of every structural finding, per Idea Prompt.md
 * section 2 and DESIGN-SPEC.md acceptance criterion 1. Columns matching by
 * name (case-sensitive, matching connector-reported names exactly) that
 * have no differences produce no findings for that column.
 */
export function compareSchemas(
  source: ColumnDefinition[],
  target: ColumnDefinition[],
  expectations?: SchemaExpectations
): SchemaDifference[] {
  const findings: SchemaDifference[] = [];

  const targetByName = new Map(target.map((c) => [c.name, c]));
  const sourceByName = new Map(source.map((c) => [c.name, c]));

  for (const sourceColumn of source) {
    const targetColumn = targetByName.get(sourceColumn.name);

    if (!targetColumn) {
      findings.push({
        columnName: sourceColumn.name,
        kind: "missing-in-target",
        severity: expectations?.missingTargetColumnSeverity ?? DEFAULT_MISSING_SEVERITY,
        message: `Column "${sourceColumn.name}" is present on the source but missing on the target.`,
        sourceType: sourceColumn.nativeType,
      });
      continue;
    }

    findings.push(...compareColumnPair(sourceColumn, targetColumn, expectations));
  }

  for (const targetColumn of target) {
    if (!sourceByName.has(targetColumn.name)) {
      findings.push({
        columnName: targetColumn.name,
        kind: "missing-in-source",
        severity: expectations?.missingSourceColumnSeverity ?? DEFAULT_MISSING_SEVERITY,
        message: `Column "${targetColumn.name}" is present on the target but missing on the source.`,
        targetType: targetColumn.nativeType,
      });
    }
  }

  findings.push(...compareColumnOrder(source, target, expectations));

  return findings;
}

/** Compares one matched source/target column pair across type, length, precision, scale, and nullability. */
function compareColumnPair(
  sourceColumn: ColumnDefinition,
  targetColumn: ColumnDefinition,
  expectations?: SchemaExpectations
): SchemaDifference[] {
  const findings: SchemaDifference[] = [];

  const typeFinding = compareType(sourceColumn, targetColumn);
  if (typeFinding) {
    findings.push(typeFinding);
  }

  const lengthFinding = compareLength(sourceColumn, targetColumn, expectations);
  if (lengthFinding) {
    findings.push(lengthFinding);
  }

  const precisionFinding = comparePrecision(sourceColumn, targetColumn, expectations);
  if (precisionFinding) {
    findings.push(precisionFinding);
  }

  const scaleFinding = compareScale(sourceColumn, targetColumn, expectations);
  if (scaleFinding) {
    findings.push(scaleFinding);
  }

  const nullabilityFinding = compareNullability(sourceColumn, targetColumn, expectations);
  if (nullabilityFinding) {
    findings.push(nullabilityFinding);
  }

  return findings;
}

/**
 * Compares native + normalized type for one column pair.
 *
 * M-07 resolution: identical native-type strings short-circuit straight to
 * "no finding" without calling compareCanonicalTypes -- see this file's
 * header comment for the full reasoning. Only when the native type strings
 * differ does this fall through to mapNativeType/compareCanonicalTypes's
 * category-level classification.
 */
function compareType(source: ColumnDefinition, target: ColumnDefinition): SchemaDifference | undefined {
  if (source.nativeType === target.nativeType) {
    // Identical native type strings on both sides: trivially compatible.
    // Deliberately bypasses compareCanonicalTypes so that its
    // same-category-but-downgraded-to-Review handling for Timestamp/Timestamp
    // and Time/Time (see type-mapping.ts) does not spuriously flag two
    // columns declared with the exact same type (e.g. DATETIME2/DATETIME2).
    return undefined;
  }

  const compatibility = compareCanonicalTypes(source.canonicalType, target.canonicalType);
  if (compatibility === "Compatible") {
    return undefined;
  }

  return {
    columnName: source.name,
    kind: "type-mismatch",
    severity: TYPE_COMPATIBILITY_SEVERITY[compatibility],
    message:
      `Column "${source.name}": native type "${source.nativeType}" (${source.canonicalType}) vs ` +
      `"${target.nativeType}" (${target.canonicalType}) is ${compatibility}.`,
    sourceType: source.nativeType,
    targetType: target.nativeType,
  };
}

function compareLength(
  source: ColumnDefinition,
  target: ColumnDefinition,
  expectations?: SchemaExpectations
): SchemaDifference | undefined {
  if (source.length === undefined && target.length === undefined) {
    return undefined;
  }
  if (source.length === target.length) {
    return undefined;
  }

  const increased = (target.length ?? 0) > (source.length ?? 0);
  const severity = increased
    ? expectations?.increasedLengthSeverity ?? DEFAULT_INCREASED_LENGTH_SEVERITY
    : expectations?.decreasedLengthSeverity ?? DEFAULT_DECREASED_LENGTH_SEVERITY;

  return {
    columnName: source.name,
    kind: "length-mismatch",
    severity,
    message: `Column "${source.name}": length ${formatValue(source.length)} (source) vs ${formatValue(target.length)} (target).`,
    sourceType: source.nativeType,
    targetType: target.nativeType,
  };
}

function comparePrecision(
  source: ColumnDefinition,
  target: ColumnDefinition,
  expectations?: SchemaExpectations
): SchemaDifference | undefined {
  void expectations;
  if (source.precision === undefined && target.precision === undefined) {
    return undefined;
  }
  if (source.precision === target.precision) {
    return undefined;
  }

  return {
    columnName: source.name,
    kind: "precision-mismatch",
    severity: DEFAULT_PRECISION_SEVERITY,
    message: `Column "${source.name}": precision ${formatValue(source.precision)} (source) vs ${formatValue(target.precision)} (target).`,
    sourceType: source.nativeType,
    targetType: target.nativeType,
  };
}

function compareScale(
  source: ColumnDefinition,
  target: ColumnDefinition,
  expectations?: SchemaExpectations
): SchemaDifference | undefined {
  void expectations;
  if (source.scale === undefined && target.scale === undefined) {
    return undefined;
  }
  if (source.scale === target.scale) {
    return undefined;
  }

  return {
    columnName: source.name,
    kind: "scale-mismatch",
    severity: DEFAULT_SCALE_SEVERITY,
    message: `Column "${source.name}": scale ${formatValue(source.scale)} (source) vs ${formatValue(target.scale)} (target).`,
    sourceType: source.nativeType,
    targetType: target.nativeType,
  };
}

function compareNullability(
  source: ColumnDefinition,
  target: ColumnDefinition,
  expectations?: SchemaExpectations
): SchemaDifference | undefined {
  if (source.nullable === target.nullable) {
    return undefined;
  }

  // nullable_to_required: source allowed NULL, target does not (a narrowing
  // change that can break existing NULL-containing data on migration).
  const nullableToRequired = source.nullable && !target.nullable;
  const severity = nullableToRequired
    ? expectations?.nullableToRequiredSeverity ?? DEFAULT_NULLABLE_TO_REQUIRED_SEVERITY
    : expectations?.requiredToNullableSeverity ?? DEFAULT_REQUIRED_TO_NULLABLE_SEVERITY;

  return {
    columnName: source.name,
    kind: "nullability-mismatch",
    severity,
    message: `Column "${source.name}": nullable=${source.nullable} (source) vs nullable=${target.nullable} (target).`,
    sourceType: source.nativeType,
    targetType: target.nativeType,
  };
}

/**
 * Compares column order for columns present on both sides. Only columns
 * that exist in both schemas participate (a missing column on either side
 * is already reported by missing-in-target/missing-in-source and does not
 * also produce an order-mismatch finding). Order is compared by relative
 * position among the common columns, not raw ordinalPosition, so that a
 * dropped/added column elsewhere does not spuriously shift every later
 * column's ordinalPosition into a false order-mismatch.
 */
function compareColumnOrder(
  source: ColumnDefinition[],
  target: ColumnDefinition[],
  expectations?: SchemaExpectations
): SchemaDifference[] {
  const targetNames = new Set(target.map((c) => c.name));
  const sourceNames = new Set(source.map((c) => c.name));

  const commonSourceOrder = source.filter((c) => targetNames.has(c.name)).map((c) => c.name);
  const commonTargetOrder = target.filter((c) => sourceNames.has(c.name)).map((c) => c.name);

  const findings: SchemaDifference[] = [];
  const severity = expectations?.orderMismatchSeverity ?? DEFAULT_ORDER_SEVERITY;

  for (let i = 0; i < commonSourceOrder.length; i += 1) {
    const name = commonSourceOrder[i];
    if (name !== undefined && commonTargetOrder[i] !== name) {
      findings.push({
        columnName: name,
        kind: "order-mismatch",
        severity,
        message:
          `Column "${name}": relative position ${i + 1} among common columns on the source ` +
          `does not match its relative position on the target.`,
      });
    }
  }

  return findings;
}

function formatValue(value: number | undefined): string {
  return value === undefined ? "(none)" : String(value);
}
