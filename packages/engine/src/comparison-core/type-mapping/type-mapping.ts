// T-05: canonical type-mapping layer.
//
// Two primitives, per TASK-BRIEF.md T-05:
//
//   mapNativeType(nativeType, platform): CanonicalTypeCategory
//     Parses a platform-native type string (e.g. "NUMBER(38,0)",
//     "VARCHAR(255)", "MONEY") and returns the single canonical category
//     (Idea Prompt.md section 2's 15-value enum, defined in
//     packages/shared/src/types.ts) it belongs to. Never throws on an
//     unrecognized type string -- falls back to "Unknown" (documented
//     contract, exercised by a dedicated test case).
//
//   compareCanonicalTypes(source, target): 'Compatible' | 'Review' | 'Risk'
//     Classifies a *pair* of canonical categories per Idea Prompt.md section
//     2's worked example. Same category is (almost) always Compatible;
//     numerically-adjacent-but-different categories that can silently lose
//     precision or change behavior are Risk; semantically-related categories
//     that need a human to confirm intent are Review. See the compatibility
//     matrix and reasoning below.
import type { CanonicalTypeCategory } from "@paritylens/shared";
import type { SqlDialect } from "../../connector-sdk/safety/statement-safety.js";

export type TypeCompatibility = "Compatible" | "Review" | "Risk";

/**
 * Maps a platform-native type string to exactly one canonical type
 * category. `platform` is accepted for interface completeness (per
 * TASK-BRIEF.md's produced-interface signature) and because a handful of
 * type names are ambiguous across platforms in principle (e.g. a
 * hypothetical bare "NUMBER" without precision/scale means different things
 * on different platforms) -- but in this MVP mapping table every native
 * type name recognized below has the same canonical meaning on every
 * platform that uses it, so parsing does not currently branch on
 * `platform`. It is kept as a parameter (rather than dropped) so a future
 * platform-specific exception can be added without an interface-breaking
 * change, and so callers are documented as required to supply it.
 *
 * Never throws: any input that does not match a recognized pattern falls
 * through to "Unknown". This is a deliberate fallback contract, not a gap --
 * schema diff (T-06) and profiling (T-07) must be able to process a column
 * of a type this mapping table does not yet know about without crashing the
 * whole comparison run.
 */
export function mapNativeType(nativeType: string, platform: SqlDialect): CanonicalTypeCategory {
  void platform; // reserved for future platform-specific disambiguation; see doc comment above.

  const normalized = nativeType.trim().toUpperCase();

  // --- NUMBER(p,s): scale-dependent (Snowflake) -----------------------------
  // Snowflake's NUMBER is its single generic numeric type: scale 0 (or
  // unspecified) is used for integer values; scale > 0 is a fractional
  // decimal value. This must be checked before the generic integer/decimal
  // name matches below since NUMBER itself does not otherwise indicate
  // integer-ness by name alone. Standard SQL DECIMAL/NUMERIC are handled
  // separately below: unlike Snowflake's NUMBER, a bare DECIMAL/NUMERIC (no
  // scale given) or DECIMAL(p,0) is still a decimal-family type by
  // declaration on SQL Server/PostgreSQL, not reinterpreted as Integer.
  const numberMatch = /^NUMBER\s*\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)$/.exec(normalized);
  if (numberMatch) {
    const scale = numberMatch[2] !== undefined ? Number(numberMatch[2]) : 0;
    return scale > 0 ? "Decimal" : "Integer";
  }

  // --- Integer variants -----------------------------------------------------
  if (/^(TINYINT|SMALLINT|INT|INTEGER|BIGINT|MEDIUMINT|INT2|INT4|INT8|SERIAL|BIGSERIAL|SMALLSERIAL|NUMBER)$/.test(normalized)) {
    return "Integer";
  }

  // --- Decimal / fixed-point variants ---------------------------------------
  // MONEY/SMALLMONEY (SQL Server) are fixed-point currency types -- exact,
  // not binary floating point -- so they belong with Decimal/Numeric, not
  // FloatingPoint. This is what makes MONEY vs FLOAT a meaningful Risk
  // classification below (exact fixed-point vs inexact binary float).
  // Standard SQL DECIMAL/NUMERIC (bare, or with any declared precision/scale
  // including scale 0) are always Decimal by declaration -- unlike
  // Snowflake's NUMBER (handled above), they are not reinterpreted as
  // Integer just because the scale is 0.
  if (/^(DECIMAL|NUMERIC)(\(\s*\d+\s*(,\s*\d+\s*)?\))?$/.test(normalized) || /^(MONEY|SMALLMONEY)$/.test(normalized)) {
    return "Decimal";
  }

  // --- Floating-point variants -----------------------------------------------
  if (/^(FLOAT|FLOAT4|FLOAT8|REAL|DOUBLE|DOUBLE PRECISION|DOUBLE\s+PRECISION)$/.test(normalized)) {
    return "FloatingPoint";
  }

  // --- Boolean variants --------------------------------------------------
  // SQL Server's BIT is used as its boolean type in practice (0/1), so it
  // is treated as canonical Boolean rather than Integer, matching the idea
  // doc's own worked example (IsActive BIT / IS_ACTIVE BOOLEAN -> Compatible).
  if (/^(BIT|BOOLEAN|BOOL)$/.test(normalized)) {
    return "Boolean";
  }

  // --- String variants -----------------------------------------------------
  if (/^(N?VARCHAR|N?CHAR|CHARACTER(\s+VARYING)?|TEXT|STRING|CLOB|BPCHAR)(\(\d+\))?$/.test(normalized)) {
    return "String";
  }

  // --- Binary variants -----------------------------------------------------
  // "(MAX)" is accepted alongside numeric-length modifiers to match SQL
  // Server's VARBINARY(MAX)/VARCHAR(MAX) unbounded-length syntax.
  if (/^(BINARY|VARBINARY|BYTEA|BLOB|IMAGE|RAW)(\((\d+|MAX)\))?$/.test(normalized)) {
    return "Binary";
  }

  // --- JSON / semi-structured -----------------------------------------------
  if (/^(JSON|JSONB|VARIANT)$/.test(normalized)) {
    return "JSON";
  }

  // --- Array -----------------------------------------------------------------
  if (normalized === "ARRAY" || /\[\]$/.test(normalized)) {
    return "Array";
  }

  // --- Object / struct-like ----------------------------------------------
  if (/^(OBJECT|STRUCT|RECORD)$/.test(normalized) || normalized.startsWith("STRUCT(")) {
    return "Object";
  }

  // --- Geospatial ------------------------------------------------------------
  if (/^(GEOGRAPHY|GEOMETRY|GEOMETRYCOLLECTION|POINT|POLYGON|LINESTRING)$/.test(normalized)) {
    return "Geospatial";
  }

  // --- Date / Time / Timestamp / TimestampWithTimezone -----------------------
  // Order matters: timezone-aware variants must be checked before the plain
  // TIMESTAMP/DATETIME patterns, since e.g. "TIMESTAMPTZ" and
  // "TIMESTAMP WITH TIME ZONE" both start with "TIMESTAMP".
  if (/^(TIMESTAMPTZ|TIMESTAMP_TZ|TIMESTAMP\s+WITH\s+TIME\s+ZONE|TIMESTAMP\(\d+\)\s+WITH\s+TIME\s+ZONE|DATETIMEOFFSET)$/.test(normalized)) {
    return "TimestampWithTimezone";
  }
  if (normalized === "DATE") {
    return "Date";
  }
  if (/^TIME(\(\d+\))?$/.test(normalized)) {
    return "Time";
  }
  if (
    /^(TIMESTAMP|TIMESTAMP_NTZ|TIMESTAMPNTZ|TIMESTAMP\s+WITHOUT\s+TIME\s+ZONE|DATETIME|DATETIME2|SMALLDATETIME)(\(\d+\))?$/.test(
      normalized
    )
  ) {
    return "Timestamp";
  }

  // Documented fallback: never throw on an unrecognized native type.
  return "Unknown";
}

/**
 * Classifies the compatibility of a source/target canonical type pair, per
 * Idea Prompt.md section 2's three-tier model (Compatible / Review / Risk).
 *
 * Compatibility matrix and reasoning:
 *
 * 1. Identical categories -> Compatible, with two documented exceptions
 *    (Timestamp/Timestamp and Time/Time are downgraded to Review -- see
 *    below). Same canonical category ordinarily means "same kind of value,
 *    safe to compare after normalization" (e.g. VARCHAR(100)/VARCHAR(255):
 *    both String, differing only in a length that is compatible so long as
 *    target length >= source length in the true migration direction, which
 *    this pairwise category comparison intentionally does not evaluate --
 *    length/precision-aware severity is T-06 schema-diff's job, not this
 *    primitive's).
 *
 * 2. Timestamp vs Timestamp -> Review, not Compatible. This looks
 *    counterintuitive (same category) but is required to reproduce the
 *    idea doc's own worked example verbatim: DATETIME (SQL Server, always
 *    naive/local, no explicit timezone semantics) vs TIMESTAMP_NTZ
 *    (Snowflake's explicitly-naive "no time zone" type) both map to the
 *    same `Timestamp` canonical category, yet the idea doc classifies that
 *    exact pair as Review, not Compatible. The underlying reasoning
 *    (confirmed against the idea doc's framing in section 17 -- "DATETIME2
 *    and TIMESTAMP_NTZ may be compatible" is stated as a *may*, not an
 *    absolute) is that naive timestamp types carry an implicit timezone
 *    assumption baked into the source system's operational timezone; two
 *    different platforms' "naive timestamp" types are not guaranteed to
 *    share that assumption, so a human needs to confirm the migration's timezone
 *    handling even though both sides are structurally the same category.
 *    Time/Time is downgraded for the same reason (an implicit-timezone
 *    variant of the same ambiguity), for consistency.
 *
 * 3. Decimal vs FloatingPoint (either direction) -> Risk. Reproduces the
 *    idea doc's CreditLimit MONEY / CREDIT_LIMIT FLOAT -> Risk example.
 *    Decimal/Numeric/Money types are exact fixed-point representations;
 *    FloatingPoint types (FLOAT/REAL/DOUBLE) are inexact binary
 *    approximations. Moving a monetary or otherwise precision-sensitive
 *    value from exact to binary-float representation (or vice versa) can
 *    silently change its value -- this is a real risk, not just a
 *    cosmetic type-name difference, so it is classified Risk rather than
 *    Review.
 *
 * 4. Integer vs Decimal -> Review. An integer value promoted to a decimal
 *    (or a decimal narrowed to an integer) does not silently lose
 *    precision in the safe direction (int -> decimal is always exact) but
 *    can in the other direction (decimal -> int truncates any fractional
 *    part) -- direction is not known from the category pair alone, so this
 *    is flagged for a human to check rather than auto-passed or
 *    auto-failed.
 *
 * 5. Integer vs FloatingPoint -> Risk. Large integers (beyond 2^53) cannot
 *    be represented exactly as IEEE-754 double-precision floats, so this
 *    pairing carries a genuine silent-precision-loss risk for exactly the
 *    same reason as Decimal vs FloatingPoint, and is classified
 *    consistently with it.
 *
 * 6. Date vs Timestamp, Date vs TimestampWithTimezone, Time vs Timestamp ->
 *    Review. Structurally related (a Date is a Timestamp with the
 *    time-of-day component dropped) but not a safe drop-in substitution
 *    without confirming whether the missing/added time component,
 *    truncation, or timezone-normalization behavior is intended --
 *    consistent with Idea Prompt.md section 4's explicit
 *    "ignore time component" / "treat midnight timestamps as dates"
 *    normalization rules, which exist precisely because this pairing needs
 *    configuration, not blind pass/fail.
 *
 * 7. Timestamp vs TimestampWithTimezone -> Review. Reproduces the idea
 *    doc's own framing (section 17: "DATETIME2 and TIMESTAMP_NTZ may be
 *    compatible") -- adding or dropping timezone awareness during a
 *    migration is exactly the kind of decision that needs a human's
 *    documented timezone assumption (Idea Prompt.md section 4's
 *    "timezone: source / target" normalization rule), not a silent pass.
 *
 * 8. String vs Binary -> Risk. Different underlying byte representations
 *    and encodings; a naive comparison across these categories is
 *    essentially never correct without an explicit conversion rule, and
 *    unlike the Decimal/FloatingPoint or Integer/FloatingPoint cases this
 *    is closer to "wrong to compare directly" than "understand the
 *    precision tradeoff", so Risk (not Review) is the more honest signal.
 *
 * 9. JSON/Array/Object cross-pairs (including vs String) -> Review.
 *    Semi-structured types are frequently represented as JSON-encoded
 *    strings on one platform and native JSON/VARIANT/ARRAY/OBJECT types on
 *    another (this is common and often intentional in real migrations,
 *    e.g. SQL Server storing JSON as NVARCHAR vs Snowflake's native
 *    VARIANT), so this is flagged for human confirmation rather than
 *    treated as an automatic Risk.
 *
 * 10. Geospatial vs anything else (including Geospatial vs Geospatial when
 *     platforms differ in WKT/WKB/native representation) -> Review, since
 *     geospatial encoding compatibility cannot be determined from the
 *     canonical category alone.
 *
 * 11. Unknown paired with anything (including Unknown vs Unknown) -> Review.
 *     An unrecognized type on either side means this primitive cannot make
 *     an informed judgment; defaulting to a silent Compatible would hide a
 *     real gap, and defaulting to Risk would falsely alarm on types that
 *     may well be fine (e.g. two unrecognized-but-actually-matching
 *     platform-specific aliases) -- Review correctly routes to a human.
 *
 * 12. Every other cross-category pair not named above (e.g. String vs
 *     Integer, Boolean vs Integer, Date vs Boolean) -> Risk. These are
 *     categories with no meaningful overlap in value space; comparing them
 *     directly is very likely a mapping error or a genuine incompatibility,
 *     so the stricter signal is the safer default.
 */
export function compareCanonicalTypes(
  source: CanonicalTypeCategory,
  target: CanonicalTypeCategory
): TypeCompatibility {
  if (source === "Unknown" || target === "Unknown") {
    return "Review";
  }

  if (source === target) {
    // Timestamp/Timestamp and Time/Time are same-category but still
    // downgraded to Review -- see reasoning items 2 above.
    if (source === "Timestamp" || source === "Time") {
      return "Review";
    }
    return "Compatible";
  }

  const pairKey = [source, target].sort().join("|");

  const riskPairs = new Set<string>([
    pairsKey("Decimal", "FloatingPoint"),
    pairsKey("Integer", "FloatingPoint"),
    pairsKey("String", "Binary"),
  ]);
  if (riskPairs.has(pairKey)) {
    return "Risk";
  }

  const reviewPairs = new Set<string>([
    pairsKey("Integer", "Decimal"),
    pairsKey("Date", "Timestamp"),
    pairsKey("Date", "TimestampWithTimezone"),
    pairsKey("Time", "Timestamp"),
    pairsKey("Time", "TimestampWithTimezone"),
    pairsKey("Timestamp", "TimestampWithTimezone"),
    pairsKey("JSON", "String"),
    pairsKey("JSON", "Array"),
    pairsKey("JSON", "Object"),
    pairsKey("Array", "String"),
    pairsKey("Array", "Object"),
    pairsKey("Object", "String"),
  ]);
  if (reviewPairs.has(pairKey)) {
    return "Review";
  }

  if (source === "Geospatial" || target === "Geospatial") {
    return "Review";
  }

  // Every other cross-category pair (no meaningful value-space overlap):
  // treat as Risk by default -- see reasoning item 12 above.
  return "Risk";
}

function pairsKey(a: CanonicalTypeCategory, b: CanonicalTypeCategory): string {
  return [a, b].sort().join("|");
}
