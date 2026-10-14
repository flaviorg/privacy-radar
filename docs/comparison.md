# Comparison with existing tools

Every row was read on 2026-10-08 from the project's own pages or release notes (GitHub repository, vendor site or package registry). A statement that a tool "covers more" or "does not do" something is limited to what was read on that date; tools change, and the check below is the author's, not a benchmark. This is not legal advice and not a complete assessment.

| Tool | What it does (checked 2026-10-08) | What this project does differently | Status |
|---|---|---|---|
| Bearer CLI 2.1.1 (Elastic License 2.0) | SAST with 120+ data types, data-flow privacy reports for Go, Java, JS, TS, PHP, Python, Ruby | LGPD and GDPR article mapping from a verified catalog; checksum validators for nine national IDs; schema sources (SQL, Prisma) in one inventory; draft RIPD/DPIA/RoPA/registro; PR sentences; explicit LLM boundary. Bearer covers more languages and deeper flows | Maintained (release 2026-08-24) |
| HoundDog.ai | Closed-source scanner with interprocedural taint analysis to logs, files, third parties and LLM prompts; RoPA suggestions; free local tier | Open and auditable catalog, LGPD first-class with pt-BR documents, offline reproducible demo and tests. HoundDog's flow depth is far beyond this one-hop model | Commercial |
| Privado 1.3.91 (LGPL-3.0) | Open-source data-flow scanner with RoPA (art. 30) reports; Java and Python GA, JS/TS forthcoming | TS/JS first, LGPD, DPIA/RIPD, schema-first inventory | Maintained (release 2025-11-10) |
| Microsoft Presidio 2.2.364 (MIT) | PII detection and anonymization in text and images with recognizers and checksums | Complementary: Presidio scans data, privacy-radar scans code and schemas; no flows or articles there | Maintained |
| Ethyca Fides | Declarative data maps and DSR automation | Not a code scanner; repository archived | Archived (last release 2026-06-01) |
| Enterprise data-mapping suites | Discovery over live stores and SaaS, RoPA workflows | Not code-first, not offline, not at PR time (generic statement, no vendor claims) | Commercial |
| Semgrep/CodeQL custom rules | Generic SAST engines | No curated multilingual personal-data catalog or regulation mapping out of the box | Active |

## Sources and dates

| Tool | Where it was read | Date |
|---|---|---|
| Bearer CLI 2.1.1 | Project repository and release page (Elastic License 2.0, release 2026-08-24) | 2026-10-08 |
| HoundDog.ai | Vendor site and documentation (closed source, free local tier) | 2026-10-08 |
| Privado 1.3.91 | Project repository and release page (LGPL-3.0, release 2025-11-10) | 2026-10-08 |
| Microsoft Presidio 2.2.364 | Project repository and documentation (MIT) | 2026-10-08 |
| Ethyca Fides | Project repository (archived; last release 2026-06-01) | 2026-10-08 |
| Enterprise data-mapping suites | Generic statement; no vendor claim | 2026-10-08 |
| Semgrep and CodeQL custom rules | Project documentation | 2026-10-08 |

## Dependencies this project did not adopt

Chosen against, with the reason (decision D-04 and the design spec section 4.7; ADRs 0002, 0004 and 0008 give the detail):

- `@mrleebo/prisma-ast` 0.16.0: no line or column on nodes, plus `chevrotain` and `lilconfig`; a small in-repo tokenizer (about 270 lines with its parser) gives exact positions.
- `ibantools` 4.5.4: the mod-97 check is ten lines.
- `openai` 7.30.1 and `@anthropic-ai/sdk` 0.132.1: a `fetch` client of about 110 lines is easier to fake.
- `commander`, `cac`, `citty`: `node:util.parseArgs` is enough.
- `fast-glob`, `tinyglobby`: a small walker keeps control over symbolic links and the ignore list.
- `parse-diff`, `diff`: PR mode exports both trees with Git and diffs findings, not hunks.
- `ajv`: a hand-written Zod subset covers the SARIF fields GitHub requires.
- `@typescript-eslint/typescript-estree` 8.71.1 (peer `typescript <6.1.0`, incompatible with TypeScript 7), `oxc-parser` 0.153.0 (native binding, 0.x churn) and `@babel/traverse` (fifteen transitive packages for what a 70-line walker does): rejected for the TS/JS parser.
- `node-sql-parser` 5.4.0 (88 MB, no locations) and `libpg-query` (native): rejected for SQL.
