# ParityLens

ParityLens is a VS Code extension for profiling, reconciling, and validating
datasets across heterogeneous data platforms (SQL Server, Snowflake, and
PostgreSQL for the MVP).

## Current state

This is a development / pre-release build. What exists today:

- A **Data Parity** activity bar view with a tree showing comparison
  results.
- The **ParityLens: Run Comparison** command
  (`paritylens.runComparison`).
- Comparisons currently run only against the bundled DuckDB-backed
  `FixtureConnector` fixture data. There are no real SQL Server,
  Snowflake, or PostgreSQL database connections yet.

## Requirements

- VS Code `^1.85.0`.
