# ParityLens — Design Specification

## Scope and non-goals

- **In scope:** Full MVP per `PROJECT-BRIEF.md`: a VS Code extension with
  connection management (SQL Server, Snowflake, PostgreSQL), a YAML-based
  parity definition format, and checks across schema, row count, null/distinct
  counts, min/max, basic string/numeric profiles, key-based row-level
  comparison (with numeric tolerance, string trim/case normalization, date
  truncation), a results webview with a tabular difference viewer, SQL
  preview before execution, VS Code SecretStorage-backed credential handling,
  and CSV/JSON/Markdown export.
- **Non-goals:** AI-generated column mappings, automated scheduling, full
  migration orchestration, data repair, write-back to source/target systems,
  semantic-model comparison, distributed processing, connectors beyond SQL
  Server/Snowflake/PostgreSQL (Athena, Databricks, Fabric, BigQuery, Oracle,
  MySQL, Redshift, Trino are deferred to later phases per the idea document's
  roadmap), a visual pipeline designer, a standalone CLI (the engine is built
  to make a CLI possible later, but shipping one is out of scope for this
  delivery), and CI/CD integration.
- **Compatibility boundary:** VS Code desktop (current stable release train),
  Node.js runtime bundled with the VS Code extension host. Development and
  validation target local/mocked fixtures; real SQL Server, Snowflake, and
  PostgreSQL instances are supported by the connector implementation but not
  available for validation in this delivery round (see `PROJECT-BRIEF.md`
  blockers).

## Options considered and decision

| Option | Benefits | Costs or risks | Decision |
| --- | --- | --- | --- |
| TypeScript engine + DuckDB local processing | Single-language codebase; simpler packaging/distribution; no Python runtime to manage; direct Node driver integration | Some analytical/profiling libraries are stronger in Python; large in-memory comparisons need care | **Selected** |
| TypeScript extension + Python engine (pandas/Polars/PyArrow) | Stronger analytical ecosystem, easier large-data profiling | Python runtime management, more complex packaging, cross-platform install friction, two languages to maintain | Not selected |
| In-process comparison engine (library loaded into extension host) | Simplest to build/debug; matches VS Code extension norms; clean internal module boundaries preserve a later extraction path | Less process isolation; engine and extension share a process/memory space | **Selected** |
| Separate child process / local service for the engine | Better isolation; more reuse-ready for a future CLI from day one | Added process-management complexity not justified for this delivery | Not selected |
| Official per-platform Node drivers (mssql/Tedious, snowflake-sdk, pg) | Native, well-supported, no extra runtime dependency | Each driver has different quirks the Connector SDK must normalize | **Selected** |
| Unified ODBC layer for all three platforms | Fewer driver-specific behaviors in theory | Requires native ODBC driver installation per platform on the user's machine; worse out-of-box experience | Not selected |
| DuckDB-backed fixture connectors implementing the same interface as real connectors | Lets Design/implementation proceed without real database access; real connectors swap in later with no engine changes; fixtures can encode deliberate mismatches for test coverage | Fixture behavior may not perfectly reflect every real-platform quirk (e.g. Snowflake session semantics) | **Selected** |
| Dockerized real databases (SQL Server + Postgres containers, Snowflake trial account) | More representative of real platform behavior | Heavier setup, slower iteration, no true local Snowflake emulator | Not selected |
| Hard block + SQL parse check rejecting mutating statements, in addition to read-only credentials | Defense in depth; protects even if a user supplies a writable credential by mistake | Requires a SQL statement classifier per dialect | **Selected** |
| Rely on read-only database credentials only | Simpler to implement | No protection against user error supplying writable credentials | Not selected |
| Conservative, user-configurable default row caps and query timeouts | Protects against accidental full-table pulls and cloud cost overruns out of the box | Defaults may need tuning per real-world use | **Selected** |
| No default safety limits (opt-in only) | Simpler default behavior | Risks accidental large scans/costs on first real-platform use | Not selected |

**Chosen approach:** A TypeScript VS Code extension with an in-process
TypeScript comparison engine backed by DuckDB for local SQL execution,
joins, aggregation, hashing, and profiling. Each source platform (including
a local DuckDB-backed fixture platform used for development) is accessed
through a common `DataPlatformConnector` interface implemented with each
platform's official Node driver. All query execution is read-only by
construction: connectors accept only read-only credentials by convention,
and every user-supplied statement is additionally parsed and rejected if it
contains a mutating keyword before it reaches a driver.

**Decision rationale:** This approach matches the idea document's own
recommended direction (section 8), keeps the codebase to a single language
for simpler packaging, and defers the higher-complexity choices (child
process isolation, Python analytical stack, ODBC) until a concrete need
justifies their cost. Building fixture and real connectors against the same
interface from day one means the DuckDB fixture strategy is not a shortcut
that gets thrown away — it is the same seam the real connectors plug into,
so no rework is needed when real database access becomes available.

## Architecture and component contracts

| Component | Responsibility | Inputs | Outputs | Dependencies | Owner |
| --- | --- | --- | --- | --- | --- |
| VS Code Extension Layer | Activation, commands, tree views (Connections/Comparisons/Recent Runs), custom editor for comparison definitions, results webview, CodeLens, SecretStorage integration, SQL preview UI | User actions, `.paritylens` YAML files, SecretStorage | Rendered UI, invocations into the Orchestration API | Parity Orchestration API | Assigned in `IMPLEMENTATION-PLAN.md` |
| Parity Orchestration API | Parses parity YAML, resolves connections and column mappings, plans which checks to run, applies normalization rules, tracks execution, assembles the standardized result object | Parity definition (YAML), connector instances, comparison rules | `ComparisonResult` object (see Results Model, idea doc section 11) | Connector SDK, Comparison Core | Assigned in `IMPLEMENTATION-PLAN.md` |
| Connector SDK | Implements `DataPlatformConnector` for SQL Server, Snowflake, PostgreSQL, and a local DuckDB-backed Fixture connector; declares `ConnectorCapabilities` per platform; enforces read-only statement parsing and configured row/timeout limits | Connection profile (non-secret) + SecretStorage-resolved credential, `QueryInput` | Schema metadata, `AsyncIterable<RecordBatch>` results, generated SQL for preview | Official Node drivers (mssql, snowflake-sdk, pg) or local DuckDB for fixtures | Assigned in `IMPLEMENTATION-PLAN.md` |
| Comparison Core | Canonical type mapping (native types → normalized categories), schema diff, volume/profile/aggregate computation, row-level matching (hash and/or key-based), normalization rule application, severity/tolerance evaluation | `ColumnDefinition[]` and `RecordBatch` data from two connectors, comparison rules and expectations | Schema differences, profile differences, aggregate differences, row differences, each with a severity | DuckDB (local join/hash/aggregate execution), Parity Orchestration API | Assigned in `IMPLEMENTATION-PLAN.md` |
| Result Store | Persists immutable results per run for history, export, and results-panel rendering | `ComparisonResult` objects | Stored run records (SQLite or JSON files) under the safe output root | Parity Orchestration API | Assigned in `IMPLEMENTATION-PLAN.md` |

Component ownership (specific files/modules per component) is assigned during
the Implementation Plan (kit phase 3), not in this design.

## Data flow

1. The user authors or edits a parity definition YAML file (source, target,
   keys, column mapping, rules, checks) inside VS Code, or uses the
   extension's editor/wizard to generate one.
2. The Parity Orchestration API validates the definition, resolves the named
   connections (profile + SecretStorage credential), and asks the Connector
   SDK to test connectivity and fetch schema for both sides.
3. The Comparison Core normalizes both schemas into the canonical type
   system and produces a structural diff; if the user has enabled deeper
   checks, the Orchestration API proceeds to request profile/aggregate/row
   data from the connectors, generating SQL that is shown to the user for
   preview before execution where configured.
4. The Comparison Core applies normalization rules, evaluates severity and
   tolerance rules, and assembles the standardized `ComparisonResult`.
5. The Result Store persists the run immutably under the safe output root.
   The Extension Layer renders the result in the results webview (tabular
   diff viewer, status bar summary) and offers export to CSV/JSON/Markdown.

## Error and recovery behavior

| Condition | User-visible behavior | Recovery behavior | Recorded evidence |
| --- | --- | --- | --- |
| Connection fails (auth, network, permissions) | Results panel shows a Layer 1 (Connectivity) failure with the underlying driver error, no partial run proceeds | User corrects credentials/config and re-runs; no partial state persisted | Run record marked `failed` at the connectivity stage |
| Mutating statement detected in user-supplied SQL (object/query/file) | Execution is blocked before any connector call; the extension shows which keyword/clause triggered the block | User edits the SQL/object reference; no query reaches the driver | Blocked-statement event logged locally (no data written) |
| Query exceeds configured timeout or row cap | Execution is cancelled/truncated; results panel marks the affected check as `error` or `skipped` with the limit that was hit | User raises the configured limit (explicit config change) or narrows the query/filter, then re-runs | Run record notes the specific limit exceeded |
| Schema fetch succeeds but a mapped column is missing on one side | Structural diff marks the column `missing_target_column` (or source) per the severity rules in the definition | User adjusts column mapping or accepts the finding; comparison continues for other columns | Included in `schemaDifferences` in the result object |
| DuckDB local processing runs out of memory on a large row-level comparison | Extension surfaces an explicit local-resource error and suggests narrowing scope (sampling, key range, or aggregate-first strategy) | User re-runs with a narrower strategy (Strategy A/B/C from the idea doc) | Run record marked `error` at the row-level stage with the resource condition noted |

## Security, privacy, and safety

- **Data classification:** Database contents accessed by ParityLens are
  treated as potentially sensitive (customer/production data) by default,
  regardless of platform. No assumption of "safe" test data is made unless
  the user explicitly configures a fixture/sandbox connection.
- **Access controls:** Credentials are resolved only through VS Code
  SecretStorage, environment variables, or native cloud/OS credential
  mechanisms (per `AGENTS.md`). Parity definition YAML files reference named
  connection profiles only — never inline secrets. This is enforced by the
  parity definition schema rejecting any credential-shaped field.
- **External actions:** Any read against a real (non-fixture) database is an
  external action against a live system and requires the connection to be
  explicitly configured by the user with credentials they supply; ParityLens
  performs no external action (network call, file write outside the safe
  output root, etc.) without a corresponding user-initiated command.
- **Write safety:** All engine writes (result store, exports, cached
  profiling data) are contained under a configurable safe output root
  (default: a project-local `.paritylens/` directory), verified before
  write. Exports are explicit user actions, never automatic. Results are
  immutable per run — no run record is overwritten in place.
- **Read-only systems:** Every configured source/target connection is
  read-only from ParityLens's perspective. Enforced two ways: (1) documented
  requirement that supplied credentials are read-only-scoped, and (2) a hard
  statement-parse check that rejects INSERT/UPDATE/DELETE/DROP/ALTER/
  TRUNCATE/MERGE and equivalent platform-specific mutating statements before
  any statement reaches a driver. Default safety limits: a configurable
  maximum row cap (default 100,000 rows for row-level previews) and query
  timeout (default 60 seconds), both overridable per-connection or
  per-comparison in the YAML definition. Generated SQL is shown to the user
  for preview before execution wherever the definition requests it.

## Testing and release strategy

- **Focused tests:** Unit tests per component (Connector SDK type mapping
  and statement-safety parsing; Comparison Core schema diff, profile
  computation, tolerance/severity evaluation, row-matching classification;
  Orchestration API definition parsing and rule application) — exact
  commands are defined per task in the Implementation Plan.
- **Integration tests:** End-to-end runs against the DuckDB-backed fixture
  connector standing in for all three platforms, covering deliberately
  mismatched schema, volume, profile, and row-level fixture cases.
- **Release checks:** Package-content review (no fixture credentials or
  sample sensitive data bundled), dependency and license inventory for all
  three Node drivers and DuckDB bindings, and a bounded packaged-extension
  smoke test (install, author a definition, run against fixtures, view and
  export results).
- **Evidence location:** Task-level evidence in `IMPLEMENTATION-REPORT.md`
  and `REVIEW-REPORT.md` per task; release-level evidence in
  `RELEASE-CHECKLIST.md`.

## Acceptance criteria

1. A schema comparison run against the DuckDB fixture connector, standing in
   for each of the three MVP platform shapes, produces a correct structural
   diff for at least one deliberately mismatched fixture pair per platform
   shape — evidenced by a reviewer-verified implementation report and test
   run (mirrors the first success measure in `PROJECT-BRIEF.md`).
2. A row-level parity check against a keyed fixture dataset correctly
   classifies matching, missing-from-source, missing-from-target,
   duplicate, and differing rows with 100% accuracy against a hand-verified
   expected set — evidenced by a reviewer-verified test run.
3. A user can author a parity definition YAML, run it from VS Code, view
   results in the results webview, and export at least one of
   CSV/JSON/Markdown — evidenced by a manual smoke test recorded during the
   kit's real-world validation phase.
4. No plaintext credentials appear in any committed parity configuration,
   generated log, or exported report — evidenced by a scan recorded in
   `RELEASE-CHECKLIST.md`.
5. Any user-supplied SQL (object, query, or file) containing a mutating
   statement is rejected before reaching a database driver, across all three
   connector implementations and the fixture connector — evidenced by a
   focused test per connector.

## Human approval record

- **Design reviewed by:** alex.nykolaiszyn@gmail.com
- **Decision:** APPROVED (architecture, connector/driver strategy, fixture
  strategy, and query-safety posture were confirmed section-by-section
  during the design session on 2026-07-27)
- **Date:** 2026-07-27
- **Conditions or rationale:** All four material decisions were presented
  with a recommended option and confirmed as recommended: (1) TypeScript +
  DuckDB engine, (2) in-process library architecture, (3) official
  per-platform Node drivers, (4) DuckDB-backed fixture connectors sharing
  the real connector interface, (5) hard-block statement parsing plus
  read-only credentials, (6) conservative user-configurable safety limits.
