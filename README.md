# ParityLens

A VS Code extension that compares tables, queries, or SQL files across SQL Server, Snowflake, and PostgreSQL — for proving a data migration, replication pipeline, or dev-vs-prod dataset actually matches, without leaving your editor.

## Why

Migrating or replicating data between platforms (SQL Server → Snowflake, dev → prod, source → warehouse) leaves a gap: did it actually come across right? Database clients let you query two connections side by side, but you still end up hand-writing `COUNT(*)` and `EXCEPT` queries and eyeballing the results. ParityLens turns that into a version-controlled comparison definition you can run, re-run, and diff — schema, volume, profile, and row-level — with a structured, severity-scored report instead of ad hoc SQL.

## What it compares

A comparison definition can check, at increasing depth:

- **Connectivity** — can both sides be reached at all.
- **Schema** — column names, types (normalized into a canonical type system), nullability differences between source and target.
- **Row count** — with optional percentage/absolute tolerance.
- **Profile** — null counts, distinct counts, min/max, and top-N values per column.
- **Row-level** — key-based matching that classifies rows as matching, missing-from-source, missing-from-target, duplicate, or differing, with configurable normalization (trim, case sensitivity, numeric tolerance, timezone conversion, date truncation, null-equivalent values).

Results are meant to be exported as CSV, JSON, or Markdown from the results view.

## Supported platforms

Implemented today, backed by each platform's official Node driver:

- **SQL Server** (`mssql`)
- **PostgreSQL** (`pg`)
- **A local DuckDB-backed fixture connector**, used for development, tests, and the one working demo command (see Status below)

**Snowflake is designed but not implemented.** The connector interface (`DataPlatformConnector`) and the read-only statement-safety check are built to support it, but no Snowflake connector code exists yet — it was deferred for lack of a trial account, per the project's release notes. Everything else in this README's "Supported platforms" list is real, working code with test coverage, not just planned.

All connections are read-only by construction: every user-supplied SQL statement is parsed and rejected before it reaches a driver if it contains a mutating keyword (`INSERT`/`UPDATE`/`DELETE`/`DROP`/`ALTER`/`TRUNCATE`/`MERGE` and platform equivalents), in addition to documenting that supplied credentials should themselves be read-only.

## Status

This is a pre-release, development build — **not published to the VS Code Marketplace or Open VSX**. There is no install-from-Marketplace path yet.

What works right now, per the project's own release checklist (`RELEASE-CHECKLIST.md`):

- The full comparison engine — schema/profile/volume/row-level/hash checks — runs end-to-end against the SQL Server and PostgreSQL connectors (verified against real containers) and against the bundled DuckDB fixture connector.
- A parity definition (`.paritylens` YAML) can be authored and parsed, with a dedicated custom editor registered for the file extension.
- One extension command, **ParityLens: Run Comparison**, is wired up — but it currently runs only against the bundled fixture data, not a real connection you configure. There is no connection-management UI, comparison-authoring wizard, or run-history view yet; the activity bar's tree view is an intentional empty-state shell.

In short: the comparison engine and connectors are real and tested; the in-editor workflow for pointing them at your own databases is the next phase of work, not yet shipped.

## Install

There is no Marketplace listing. To try it:

1. Clone this repo and install dependencies:
   ```
   git clone https://github.com/anykolaiszyn/VSC-DB-SQL-Compare.git
   cd VSC-DB-SQL-Compare
   npm install
   ```
2. Build a `.vsix` package:
   ```
   cd packages/extension
   npm run package
   ```
   This produces `packages/extension/paritylens-<version>.vsix`.
3. Install it into VS Code:
   ```
   code --install-extension paritylens-<version>.vsix
   ```
   or use "Extensions: Install from VSIX..." from the Command Palette.

Requires VS Code `^1.85.0`.

## Quick start (current build)

1. Open the **Data Parity** icon in the activity bar.
2. Run the **ParityLens: Run Comparison** command from the Command Palette. In this build it runs against the bundled DuckDB fixture data (a `sqlserver-customer` fixture pair with deliberate schema and row-level mismatches), not a connection you configure — see Status above.
3. Review the results in the Data Parity view: schema differences, row counts, and row-level differences (matching / missing / duplicate / differing).

## How a comparison definition works

A comparison is a `.paritylens` YAML file — a source, a target, the key column(s) to match rows on, a column mapping, and which checks to run. Connections are referenced by name only; the schema rejects any credential-shaped field (`password`, `secret`, `token`, `connection_string`, etc.) anywhere in the document, so credentials never belong in a `.paritylens` file — they're resolved separately through VS Code's SecretStorage.

```yaml
version: 1

name: customer-migration-parity

source:
  connection: legacy-sql
  object: dbo.Customer
  where: "ModifiedDate >= '2026-01-01'"

target:
  connection: analytics-snowflake
  object: CURATED.CUSTOMER
  where: "MODIFIED_DATE >= '2026-01-01'"

keys:
  - customer_id

column_mapping:
  customer_id: CUSTOMER_ID
  customer_name: CUSTOMER_NAME
  customer_status: STATUS
  modified_date: MODIFIED_TIMESTAMP

exclude_columns:
  - load_batch_id
  - ingestion_timestamp

rules:
  customer_name:
    trim: true
    case_sensitive: false

  modified_date:
    truncate_to: second
    timezone:
      source: America/New_York
      target: UTC

checks:
  schema:
    enabled: true

  row_count:
    enabled: true
    tolerance:
      percentage: 0.01

  profile:
    enabled: true
    top_values: 20

  row_level:
    enabled: true
    strategy: hash
    max_differences: 1000
```

A `source`/`target` can also be `kind: query` (raw SQL) or `kind: sqlFile` (a `.sql` file on disk) instead of `kind: table` (the default).

## Architecture

- `packages/shared` — canonical types shared across the engine and extension.
- `packages/engine` — the comparison engine: connector SDK (SQL Server, PostgreSQL, DuckDB fixture), YAML parity-definition parser, schema/profile/row-level comparison logic, all in-process and backed by DuckDB for local joins/hashing/aggregation.
- `packages/extension` — the VS Code extension host: activity bar view, commands, custom editor for `.paritylens` files.

See `PROJECT-BRIEF.md` and `DESIGN-SPEC.md` for the full product brief and architecture decisions, and `RELEASE-CHECKLIST.md` / `RELEASE-REVIEW-REPORT.md` for the current release's verified scope and known limitations.

## Roadmap

Explicitly out of scope for the MVP (per `PROJECT-BRIEF.md`): AI-generated column mappings, automated scheduling, full migration orchestration, data repair, write-back to source/target systems, semantic-model comparison, distributed processing, additional connectors (Athena, Databricks, Fabric, BigQuery, Oracle, MySQL, Redshift, Trino), and a visual pipeline designer.

Planned next, not yet built: connection-management UI, a comparison-authoring wizard, run history, and the Snowflake connector.

## License

MIT — see `LICENSE`.
