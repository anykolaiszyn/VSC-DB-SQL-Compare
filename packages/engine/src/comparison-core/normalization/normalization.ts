// T-12: normalization rules.
//
// applyNormalization(value, rule) applies exactly the fields present on a
// NormalizationRule (packages/engine/src/orchestration/definition/definition.ts,
// T-08's owned type, consumed here read-only) to a single value, returning
// a new normalized value for comparison purposes only, per Idea Prompt.md
// section 4.
//
// Load-bearing constraint (TASK-BRIEF.md "Prohibited changes", quoting
// Idea Prompt.md section 4 verbatim): "These transformations should apply
// only in the comparison engine. They should never alter the underlying
// data." applyNormalization is a pure function: it never mutates its
// `value` or `rule` arguments (primitives are naturally immutable; object/
// array values are returned untouched, by reference, rather than being
// walked/normalized -- normalization here only meaningfully transforms
// strings and date-shaped strings) and never writes back to any connector,
// record, or persisted structure.
//
// numericTolerance is documented on NormalizationRule but is inherently a
// two-value comparison, not a single-value transform -- applyNormalization
// leaves a numeric value passed through it unchanged, and tolerance
// evaluation is exposed separately via valuesEqualWithinTolerance(a, b,
// tolerance), consumed by T-13 (volume parity) and T-14 (row-level
// parity) at comparison time.
import type { NormalizationRule } from "../../orchestration/definition/definition.js";

/**
 * Applies every rule field present on `rule` to `value`, in a fixed order
 * (null-equivalents check first, then string shaping, then date
 * truncation/timezone), and returns the normalized result. Never mutates
 * `value` or `rule`.
 *
 * - `nullEquivalents`: if `value` (coerced to a string) matches a listed
 *   sentinel, returns `null` immediately -- no further rule fields apply
 *   to an already-nulled value.
 * - `trim` / `caseSensitive: false` / `collapseWhitespace`: apply only to
 *   string values, in that order (trim, then case-fold, then collapse
 *   internal whitespace), matching Idea Prompt.md section 4's
 *   customer_name example (`trim`, `case_sensitive: false`,
 *   `collapse_whitespace: true` all combined).
 * - `timezone` / `truncateTo`: apply only to string values that parse as a
 *   valid date/timestamp (via `Date.parse`); non-date-shaped strings and
 *   non-string values pass through unaffected by these two fields.
 * - `numericTolerance`: intentionally NOT applied here -- see this file's
 *   header comment and `valuesEqualWithinTolerance` below.
 * - `null` and `undefined` values pass through unchanged regardless of
 *   rule (nothing to trim/case-fold/truncate).
 */
export function applyNormalization(value: unknown, rule: NormalizationRule): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  let result: unknown = value;

  if (rule.nullEquivalents && rule.nullEquivalents.length > 0) {
    if (typeof result === "string" && rule.nullEquivalents.includes(result)) {
      return null;
    }
  }

  if (typeof result === "string") {
    result = applyStringRules(result, rule);
    result = applyDateRules(result as string, rule);
  }

  return result;
}

/** Applies trim / caseSensitive:false / collapseWhitespace, in that order. */
function applyStringRules(value: string, rule: NormalizationRule): string {
  let result = value;

  if (rule.trim) {
    result = result.trim();
  }
  if (rule.caseSensitive === false) {
    result = result.toLowerCase();
  }
  if (rule.collapseWhitespace) {
    result = result.replace(/\s+/g, " ");
  }

  return result;
}

/**
 * Applies `timezone` conversion and `truncateTo` date truncation to a
 * string value, if it parses as a valid date/timestamp. Non-date-shaped
 * strings (e.g. "acme inc.") are returned unchanged -- Date.parse
 * returning NaN is the signal this rule pair does not apply.
 *
 * When `timezone` is present, the value is interpreted as a wall-clock
 * time in `timezone.source` and converted to the equivalent instant
 * expressed in `timezone.target`, per Idea Prompt.md section 4's
 * created_timestamp example. When only `truncateTo` is present (no
 * timezone), the value's own instant is truncated and re-serialized as
 * UTC ISO-8601, matching the section 4 "ignore fractional seconds"/
 * "ignore time component" normalization list.
 */
function applyDateRules(value: string, rule: NormalizationRule): string {
  if (!rule.timezone && !rule.truncateTo) {
    return value;
  }

  // Host-timezone independence: `Date.parse`/`new Date(string)` on a
  // date-time string with no explicit UTC/offset marker is specified by
  // ECMA-262 as "unspecified" and, in every current engine, resolves
  // against the *host's local timezone* -- never a fixed one. Relying on
  // that would make this function's output depend on the machine it runs
  // on, which is unacceptable for a comparison engine. Instead, this
  // module always parses the wall-clock components explicitly and treats
  // them as UTC via `Date.UTC`, so parsing itself is host-independent; any
  // actual timezone semantics come only from the explicit `rule.timezone`
  // field below, never from the runtime environment.
  const parsedMs = parseAsUtcWallClock(value);
  if (parsedMs === undefined) {
    return value;
  }

  let instantMs = parsedMs;
  if (rule.timezone) {
    // `parsedMs` currently represents the wall-clock reading taken
    // literally as UTC. Reinterpret it as a wall-clock time in
    // timezone.source instead: if timezone.source is behind UTC (e.g.
    // America/New_York, UTC-4 in summer), the same wall-clock reading is
    // a *later* UTC instant, so subtract the (negative) offset to add the
    // difference. timezone.target does not change the underlying instant
    // (an instant is timezone-independent); it only exists for a caller
    // that wants to render the result in that zone. This module returns
    // UTC ISO-8601, which is unambiguous and directly comparable
    // regardless of target zone, satisfying the "convert time zones"
    // normalization goal without depending on the caller's chosen display
    // zone.
    const offsetMs = getUtcOffsetMs(parsedMs, rule.timezone.source);
    instantMs = parsedMs - offsetMs;
  }

  let resultDate = new Date(instantMs);
  if (rule.truncateTo) {
    resultDate = truncateDate(resultDate, rule.truncateTo);
  }

  return resultDate.toISOString();
}

/**
 * Parses an ISO-8601-shaped date/date-time string, treating any wall-clock
 * component present as UTC regardless of the host machine's local
 * timezone (see `applyDateRules`'s header comment). Falls back to
 * `Date.parse` only for values that already carry an explicit UTC/offset
 * marker (trailing "Z" or "+hh:mm"/"-hh:mm"), where the host timezone
 * cannot affect the result. Returns `undefined` for non-date-shaped input.
 */
function parseAsUtcWallClock(value: string): number | undefined {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(value);
  if (!match) {
    // Not the plain "YYYY-MM-DD[THH:mm:ss.sss]" shape this function
    // targets -- fall back to Date.parse for anything else (e.g. a value
    // that already has an explicit "Z"/offset suffix elsewhere in its
    // format, or a genuinely non-date string, which yields NaN).
    const fallback = Date.parse(value);
    return Number.isNaN(fallback) ? undefined : fallback;
  }

  const [, year, month, day, hour, minute, second, fraction, offset] = match;
  if (offset) {
    // Explicit UTC/offset marker present: safe to defer to Date.parse,
    // which resolves an explicit offset identically regardless of host
    // timezone.
    const fallback = Date.parse(value);
    return Number.isNaN(fallback) ? undefined : fallback;
  }

  const ms = fraction ? Number(fraction.padEnd(3, "0").slice(0, 3)) : 0;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    hour ? Number(hour) : 0,
    minute ? Number(minute) : 0,
    second ? Number(second) : 0,
    ms
  );
}

/**
 * Returns the UTC offset (in milliseconds, positive = ahead of UTC) that
 * `timeZone` observes for the calendar date/time represented by
 * `instantMs` (already parsed host-timezone-independently -- see
 * `parseAsUtcWallClock`), computed via Intl.DateTimeFormat (no new
 * dependency -- Node's built-in ICU data covers IANA timezone names
 * including DST rules).
 */
function getUtcOffsetMs(instantMs: number, timeZone: string): number {
  const asUtc = new Date(instantMs);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
  });
  const parts = formatter.formatToParts(asUtc);
  const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
  const match = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(offsetPart);
  if (!match) {
    return 0;
  }
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] ?? "0");
  const minutes = Number(match[3] ?? "0");
  return sign * (hours * 60 + minutes) * 60 * 1000;
}

const TRUNCATION_UNITS = ["year", "month", "day", "hour", "minute", "second"] as const;
type TruncationUnit = (typeof TRUNCATION_UNITS)[number];

/** Zeroes out every date component finer-grained than `unit`, e.g.
 * truncateTo "second" drops milliseconds; truncateTo "day" also zeroes
 * hour/minute/second (Idea Prompt.md's "ignore time component"). Returns a
 * new Date; never mutates the input. Unrecognized units are a no-op. */
function truncateDate(date: Date, unit: string): Date {
  if (!isTruncationUnit(unit)) {
    return date;
  }

  const result = new Date(date.getTime());
  const unitIndex = TRUNCATION_UNITS.indexOf(unit);

  if (unitIndex < TRUNCATION_UNITS.indexOf("second")) result.setUTCSeconds(0);
  result.setUTCMilliseconds(0);
  if (unitIndex < TRUNCATION_UNITS.indexOf("minute")) result.setUTCMinutes(0);
  if (unitIndex < TRUNCATION_UNITS.indexOf("hour")) result.setUTCHours(0);
  if (unitIndex < TRUNCATION_UNITS.indexOf("day")) result.setUTCDate(1);
  if (unitIndex < TRUNCATION_UNITS.indexOf("month")) result.setUTCMonth(0);

  return result;
}

function isTruncationUnit(unit: string): unit is TruncationUnit {
  return (TRUNCATION_UNITS as readonly string[]).includes(unit);
}

/**
 * Evaluates whether two values are equal within a configured numeric
 * tolerance, per Idea Prompt.md section 4's order_amount example
 * (`numeric_tolerance: {absolute: 0.01}`). Tolerance is inherently a
 * two-value comparison rather than a single-value transform, so it is
 * exposed separately from `applyNormalization` rather than folded into it
 * -- see this file's header comment.
 *
 * - If both `absolute` and `percentage` are configured, either satisfying
 *   its threshold is sufficient (an "or" combination), matching how the
 *   idea doc lists them as independent, combinable tolerance modes.
 * - If neither is configured (`tolerance` is undefined or an empty
 *   object), falls back to strict equality.
 * - Non-numeric inputs (after excluding the null/null case) are never
 *   considered equal via tolerance -- only exact (`===`) equality applies,
 *   since a tolerance comparison is meaningless for non-numeric values.
 */
export function valuesEqualWithinTolerance(
  a: unknown,
  b: unknown,
  tolerance: { absolute?: number; percentage?: number } | undefined
): boolean {
  if (a === b) {
    return true;
  }

  if (typeof a !== "number" || typeof b !== "number" || Number.isNaN(a) || Number.isNaN(b)) {
    return false;
  }

  if (!tolerance || (tolerance.absolute === undefined && tolerance.percentage === undefined)) {
    return a === b;
  }

  const diff = Math.abs(a - b);

  if (tolerance.absolute !== undefined && diff <= tolerance.absolute) {
    return true;
  }

  if (tolerance.percentage !== undefined) {
    const base = Math.max(Math.abs(a), Math.abs(b));
    if (base === 0) {
      return diff === 0;
    }
    const percentDiff = (diff / base) * 100;
    if (percentDiff <= tolerance.percentage) {
      return true;
    }
  }

  return false;
}
