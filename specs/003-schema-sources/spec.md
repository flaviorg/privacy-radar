# Schema sources

Status: implemented

## Context

PostgreSQL DDL is read statement by statement with `pgsql-ast-parser` (with a statement splitter that understands quotes, dollar quoting and comments); `schema.prisma` and any `*.prisma` file are read with an in-repo tokenizer that gives exact lines and columns.
Both feed one merged entity model, so the same patient table described in SQL and in Prisma is one inventory entity. `INSERT` statements are parsed only to bind each value literal to its column, for masking and corroboration.
A statement that fails to parse is one warning, never a crash; an unparsed seed row is masked conservatively.

## Acceptance criteria

- **SCH-01** When a `.sql` file is scanned, the system shall split it into statements outside quotes and dollar-quoting, parse each with `pgsql-ast-parser`, convert offsets to 1-based lines and columns, and produce entities for `CREATE TABLE` with `ALTER TABLE ... ADD COLUMN` and `COMMENT ON COLUMN` merged in.
- **SCH-02** If a `CREATE TABLE` or `ALTER TABLE` statement fails to parse (any exception type), then the system shall record a `PARSE_ERROR` warning with its line, or one `UNSUPPORTED_DIALECT` warning per file when the file contains backticks, `ENGINE=` or `AUTO_INCREMENT=`, while the other statements of the file are still parsed; there is no regex fallback in v0.1.
- **SCH-03** When an entity is found in more than one source (Prisma model and SQL table with the same normalized name), the inventory shall list one entity with both locations and findings shall be de-duplicated by `(rule, entity, field)` keeping the location with the earliest source kind in the order prisma, sql, ts.
- **SCH-04** When `schema.prisma` is scanned, the in-repo tokenizer shall produce models, fields (name, type, optional, array), attributes (`@id`, `@unique`, `@map`, `@db.*`, `@default`, `@relation`), block attributes and `///` comments, with the exact line and column of each field name, including duplicate field names across models.
- **SCH-05** When a `.sql` file contains `INSERT` statements, the system shall return one `literalBinding` per value literal with its column name by position; if an `INSERT` fails to parse (including the internal `SyntaxError` on `E'it\'s'`), it shall return one binding named `*` per quoted literal of that statement and use its column list as the corroboration window, and shall not emit a warning for it.

## Non-goals

- **OpenAPI as a source in v0.1.** Moved to M9 (section 2.2): it adds a dependency, a parser and a declaration-only finding without flow evidence, while SQL and Prisma already prove the schema-first inventory.
- **Scanning live data stores, logs or text (de-identification).** That is Microsoft Presidio's job (data level). privacy-radar scans code and schemas. The README names Presidio as the complementary tool.
- **Anonymization quality, k-anonymity, pseudonymization detection beyond name hints.** Needs data, not code. `*_hash`, `*_enc` and `encrypted` hints are recorded as evidence only.

## Resolved questions

- **`INSERT` value locations exist (Spec delta 1).** `pgsql-ast-parser` 12.0.2 returns `_location` on every value of `INSERT ... VALUES` (the range includes the quotes), so every literal is bound to its column by position. An `INSERT` without a column list binds every literal to `*` (always masked) and uses the line window for corroboration. The `E'it\'s'` failure throws a plain `Error`, so tests never assert an error class.
- **Failing statements (Step 0).** `CREATE POLICY`, `ENABLE ROW LEVEL SECURITY` and MySQL backticks throw plain errors; the first two are ignored silently (RLS is recorded as a hint), the third gives one `UNSUPPORTED_DIALECT` warning per file. `COMMENT ON` has no `_location` for its string, so the splitter's last quote range is used. See `docs/api-notes.md`.
- **Review focus 3.** Models split across `prisma/schema/*.prisma` are all scanned and merged; `detectKind` accepts `*.prisma`.
- **Inventory output (Spec delta 12).** The inventory output moved from M3 to M4 because it needs field classification; M3 ends with merged entities and both adapters.
- **D-04 and D-06.** In-repo Prisma tokenizer instead of `@mrleebo/prisma-ast`; PostgreSQL only, no regex fallback for DDL (ADR 0003, ADR 0004).

## Checklist

Each criterion is proved by a test whose name starts with its id (the file is listed).

- [x] SCH-01: `tests/unit/sql.unit.test.ts`
- [x] SCH-02: `tests/unit/sql.unit.test.ts`
- [x] SCH-03: `tests/unit/model.unit.test.ts`, `tests/unit/rules.unit.test.ts`
- [x] SCH-04: `tests/unit/prisma.unit.test.ts`
- [x] SCH-05: `tests/unit/sql.unit.test.ts`
