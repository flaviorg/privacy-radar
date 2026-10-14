# ADR 0003: PostgreSQL DDL, statement by statement, no regex fallback

Status: accepted (2026-10-08, design spec; recorded as an ADR on 2026-10-14)
Decision ids: D-06

## Context

Migrations are the schema source most teams already have. `pgsql-ast-parser` 12.0.2 parses PostgreSQL DDL with locations, but it rejects statements such as `CREATE POLICY` and `ENABLE ROW LEVEL SECURITY`, fails on MySQL syntax, and throws a plain `Error` (not a `SyntaxError`) on `E'it\'s'` inside an `INSERT`.

## Decision

- Split the file with a comment-aware, quote-aware splitter (single quotes, `E''`, dollar quoting, `--` and `/* */`), then parse each statement alone with a catch-all, so one bad statement never loses the others.
- A failed `CREATE TABLE` or `ALTER TABLE` is one `PARSE_ERROR` warning with its line; a file with backticks, `ENGINE=` or `AUTO_INCREMENT=` gets one `UNSUPPORTED_DIALECT` warning. Other failed statements are ignored, except that `ENABLE ROW LEVEL SECURITY` is recorded as the protection hint `rls`.
- `INSERT` statements are parsed only to bind each literal to its column by position, for masking and corroboration. An `INSERT` that fails to parse masks every quoted literal.
- There is no regex fallback for DDL in v0.1.

## Consequences

- Good: a half-supported migration still yields a partial inventory and exact lines.
- Cost: MySQL and SQLite are not supported; a MySQL user gets a warning and no entities from that file.
- Cost: tests never assert the error class of the parser, only that nothing escapes.

## Alternatives

- `node-sql-parser` 5.4.0: rejected, 88 MB and no locations.
- `libpg-query`: rejected, native binding.
- A regex fallback for `CREATE TABLE`: deferred to M9; it would invite silent wrong inventories.
