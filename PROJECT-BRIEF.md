# ParityLens — Project Brief

## Problem and intended users

- **Problem:** Teams migrating or replicating data between heterogeneous
  platforms (e.g. SQL Server → Snowflake, Oracle → Fabric) currently lack a
  developer-workflow-native way to prove that a source and target dataset are
  structurally, volumetrically, and content-equivalent. Existing database
  clients can query multiple connections but do not provide a platform-neutral
  parity contract, normalization rules, or auditable comparison definitions.
- **Intended users:** Data engineers, analytics engineers, and migration
  teams performing platform migrations, pipeline modernization, replication
  validation, dev-vs-prod comparisons, ETL/ELT regression testing, dbt model
  validation, or semantic-layer source reconciliation.
- **User context:** Used during active migration or pipeline development
  inside VS Code, and potentially later in CI/CD, whenever a user needs to
  validate that two datasets that should be equivalent actually are, at a
  chosen depth (schema only, up to full row-level comparison).

## Desired outcome

- **Deliverable:** ParityLens, a VS Code extension that connects to two data
  platforms, compares selected tables/queries/SQL files, and produces a
  structured parity report across progressively deeper comparison layers
  (connectivity, structural/schema, volume, profile, aggregate, row-level).
- **Primary outcome:** A user can configure a source and target connection,
  define a comparison (as version-controlled YAML), run it, and get a clear,
  severity-scored report of differences — without leaving VS Code and without
  writing ad hoc comparison SQL by hand.
- **Completion boundary:** Full MVP as defined in the source idea document,
  section 14: connection sidebar, YAML parity definitions, run commands,
  results webview, tabular difference viewer, SQL preview, and secret
  storage; connectors for SQL Server, Snowflake, and PostgreSQL; input types
  table-vs-table, query-vs-query, and SQL-file-vs-SQL-file; checks covering
  connection test, schema comparison, row count, null counts, distinct
  counts, min/max, basic string/numeric profiles, key-based row comparison,
  numeric tolerance, string trimming/case normalization, date truncation;
  CSV/JSON/Markdown export. Explicitly excluded from this delivery: the items
  listed under "Excluded work" below. Given the size of this scope, the
  Implementation Plan (kit phase 3) should still sequence work in
  dependency-ordered, independently reviewable slices — this boundary sets
  the target for the full delivery, not a mandate to build it in one
  undivided task.

## Inputs and existing systems

| Input or system | Owner | Access level | How it is used |
| --- | --- | --- | --- |
| `Idea Prompt.md` (product concept document) | Project owner | Read | Source of the product concept, MVP scope, architecture direction, and phased roadmap used to seed this brief. |
| Local/mocked comparison fixtures (e.g. DuckDB or SQLite standing in for SQL Server/Snowflake/PostgreSQL) | Project owner | Read/write within safe output root | Primary development and testing target for Design and early implementation, since no real source or target platform instances are available yet. |
| SQL Server (real instance, future) | Not yet identified | Read-only, once available | Real connector target for later validation; not available for this delivery round. |
| Snowflake (real instance, future) | Not yet identified | Read-only, once available | Real connector target for later validation; not available for this delivery round. |
| PostgreSQL (real instance, future) | Not yet identified | Read-only, once available | Real connector target for later validation; not available for this delivery round. |
| VS Code extension host / marketplace | Project owner | N/A (build target) | Runtime and eventual distribution surface for the extension. |

Decision recorded 2026-07-27: no real SQL Server, Snowflake, or PostgreSQL
instances or sample datasets are available yet. Design and early
implementation will target local/mocked comparison fixtures (e.g. DuckDB or
SQLite) so work is not blocked on provisioning real databases. Real-connector
validation against actual platform instances is deferred until such
instances are identified — this is carried forward as an open blocker, not a
scope change (the three connectors remain in the completion boundary).

## Constraints and exclusions

- **Technical constraints:** VS Code extension using TypeScript for the
  extension layer (activation, commands, tree views, secret storage, custom
  editors, webviews, CodeLens). Comparison engine direction proposed in the
  idea document: TypeScript orchestration layer with a DuckDB-backed local
  comparison service; Arrow as the preferred internal transfer format where
  drivers support it. MVP connector platforms: SQL Server, Snowflake,
  PostgreSQL. MVP input types: table vs. table, query vs. query, SQL file vs.
  SQL file.
- **Operational constraints:** [NEEDS OWNER INPUT: timeline, budget, and
  staffing are not yet specified in the source idea document.]
- **Safety constraints:** All source and target database connections are
  read-only from the extension's perspective — no INSERT/UPDATE/DELETE/DROP
  or other mutating statements may be issued. Credentials must never be
  stored directly in parity configuration files (use VS Code SecretStorage,
  environment variables, or native cloud/OS credential mechanisms). Generated
  SQL must be previewable before execution. Query timeouts, maximum
  downloaded rows, and cost warnings for full-table scans are required
  safety controls, per the idea document's security model.
- **Excluded work (MVP, per source idea document section 14):** AI-generated
  column mappings, automated scheduling, full migration orchestration, data
  repair, write-back to source/target systems, semantic-model comparison,
  distributed processing, connectors beyond SQL Server/Snowflake/PostgreSQL
  (e.g. Athena, Databricks, Fabric, BigQuery, Oracle, MySQL, Redshift, Trino
  are explicitly deferred to later phases), and a visual pipeline designer.

## Primary workflow boundary

Research-only deliverables and non-technical business deliverables are outside
this primary technical delivery workflow. Route either category through a
separate process with its own owner, approval path, and success measures.

## Risks and approvals

| Risk or external action | Mitigation or approval required | Approver | Recorded decision |
| --- | --- | --- | --- |
| Credential handling for source/target database connections | Use VS Code SecretStorage / native credential chains only; never persist secrets in comparison config committed to source control | alex.nykolaiszyn@gmail.com | Recorded 2026-07-27 as a standing safety constraint (see `AGENTS.md`); no exception approved |
| Accidental mutation of source or target systems | Enforce read-only connectors; block mutating SQL statements; require query preview before execution | alex.nykolaiszyn@gmail.com | Recorded 2026-07-27 as a standing safety constraint; no exception approved |
| Uncontrolled query cost/volume against cloud warehouses (Snowflake, etc.) | Require query timeouts, row-download limits, and cost warnings for full-table scans before any real-database validation | alex.nykolaiszyn@gmail.com | Recorded 2026-07-27; applies once real connectors are validated against live platforms |
| No real database instances/sample data available for validation | Use local/mocked fixtures (e.g. DuckDB/SQLite) for Design and early implementation; real-platform validation deferred | alex.nykolaiszyn@gmail.com | Decided 2026-07-27 — see Inputs table |
| Full-MVP scope is large for a single delivery round | Implementation Plan (kit phase 3) must sequence the full MVP into dependency-ordered, independently reviewable task slices rather than one undivided task | alex.nykolaiszyn@gmail.com | Decided 2026-07-27 — full MVP confirmed as completion boundary, phased task breakdown required |

## Success measures

| Measure | Target | Evidence source | Owner |
| --- | --- | --- | --- |
| Schema comparison runs end-to-end against local fixtures for all three MVP connector shapes (SQL Server, Snowflake, PostgreSQL, via mocked/local data) | Correct structural diff produced for at least one deliberately-mismatched fixture pair per connector | Implementation report + reviewer-verified test run | alex.nykolaiszyn@gmail.com |
| Row-level parity check correctly classifies matching, missing, duplicate, and differing rows on a keyed fixture dataset | 100% correct classification against a hand-verified fixture set | Implementation report + reviewer-verified test run | alex.nykolaiszyn@gmail.com |
| A parity definition (YAML) can be authored, run, and produce a results report without leaving VS Code | Manual smoke test: author config, run comparison, view results panel, export at least one format (CSV/JSON/Markdown) | Real-world validation phase (kit lifecycle step 6) | alex.nykolaiszyn@gmail.com |
| No credentials appear in committed parity configuration or logs | Manual + automated scan of generated config and log output finds zero plaintext secrets | Release checklist evidence | alex.nykolaiszyn@gmail.com |

## Approval record

- **Brief approved by:** alex.nykolaiszyn@gmail.com
- **Approval date:** 2026-07-27
- **Scope notes:** Full MVP (SQL Server, Snowflake, PostgreSQL connectors;
  schema/volume/profile/aggregate/row-level checks; YAML config; results
  webview; CSV/JSON/Markdown export) confirmed as the completion boundary on
  2026-07-27. Development and validation will target local/mocked fixtures
  (e.g. DuckDB/SQLite) since no real platform instances are available yet;
  real-connector validation against live SQL Server/Snowflake/PostgreSQL
  instances is deferred until such instances are identified. This brief is
  drafted and ready for the owner's explicit sign-off before proceeding to
  Design.
