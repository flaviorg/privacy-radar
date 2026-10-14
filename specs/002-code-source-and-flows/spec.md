# Code source and flows

Status: implemented

## Context

TypeScript and JavaScript files are parsed with `@babel/parser` (one plugin set per extension, `errorRecovery` on) and walked iteratively with a depth cap. The adapters return structure plus offsets: entities, functions, local bindings, call sites and literal bindings.
The flow model is deliberately small: a classified source reaches a sink directly or through exactly one local binding in the same function. Sinks and vendors come from `catalog/sinks.json` and `catalog/vendors.json`; the transfer status comes from the dated adequacy file and the config.
What is not detected (two hops, cross-function flows, runtime values) is documented with negative fixtures in `docs/flow-model.md` and tested as such.

## Acceptance criteria

- **SRC-01** When a `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs` or `.cjs` file is parsed, the system shall use `@babel/parser` with `errorRecovery` and the plugin set of section 4.2 for that extension (`.ts`: `typescript`, `decorators-legacy`; `.tsx`: those plus `jsx`; `.js`, `.jsx`, `.mjs`, `.cjs`: `jsx`, `decorators-legacy`), keep the entities and calls of a file whose errors Babel recovers with one `PARSE_ERROR` warning per recovered error, and for an error Babel cannot recover record one `PARSE_ERROR` warning with its line, skip the file and continue.
- **SRC-02** If a file exceeds the file-size limit of section 6.1, or nests deeper than the AST depth limit of section 6.1 (the walker cap of 300, or a parser `RangeError`), then the system shall emit `FILE_TOO_LARGE` or `DEPTH_LIMIT`, skip the file and continue.
- **SRC-03** When a file declares interfaces, type-literal aliases, classes with property declarations, `z.object({...})` calls or object literals assigned to an exported `const`, the system shall list them as entities with fields, 1-based line and 1-based column.
- **SRC-04** When a function body declares local bindings and calls, the system shall record each binding with the identifiers and member chains in its initializer and each call with its callee text, arguments and URL text when the first argument is a string literal, a template with a literal prefix or `new URL("…")`.
- **SRC-05** When the same `ScanModel` is built twice from the same files in a different order, the output shall be byte-identical.
- **SRC-06** When the source registry receives any byte string as a `.ts`, `.sql` or `.prisma` file (200 seeded random strings and garbage files), it shall return a `SourceFile` with at most warnings and no exception shall escape.
- **SRC-07** When the target contains a symbolic link (to a file or directory) or a path whose real path resolves outside the target, the walker shall not read it, shall record `SYMLINK_SKIPPED`, and its content shall appear in no output.
- **SRC-08** When a TS file binds a string, number or template literal to a name (object-literal property value, variable initializer, assignment right-hand side), the adapter shall return a `literalBinding` with the name and the literal's offsets, line and column, without classifying the name.
- **FLOW-01** When a call's callee text matches a pattern of `catalog/sinks.json`, the system shall produce a `SinkCall` with the kind and the inspected arguments, and near-miss callees (`console.table`, `logger.child`, `fetchPolicy`) shall not match.
- **FLOW-02** When an `http` sink's URL text has a host, the system shall resolve it against the vendor index by suffix, else report `host` with `vendor: null`; when the URL is not literal, `host` shall be `null` and the sink `unresolved`.
- **FLOW-03** When a classified source appears directly in a sink argument (identifier, member chain, object/array literal value, template interpolation, `+` concatenation, `JSON.stringify`/`String`/`util.format` wrapper), the system shall record a reach with `hop: null`.
- **FLOW-04** When a classified source is assigned to a local or module-scope binding in the same function or module and that binding appears in a sink argument by FLOW-03, the system shall record a reach with `hop: { via, line }`.
- **FLOW-05** When a source reaches a sink only through two bindings, through a user-defined function call, through a class field read in another method, through a computed key or through `Array.join`, the system shall record no reach (negative fixtures).
- **FLOW-06** When a template literal, concatenation or `URLSearchParams` builds a query string whose value is a classified source, the system shall record a `url-query` sink reach naming the parameter.
- **FLOW-07** When an `http` sink's URL is relative (no scheme, for example `/api/x` or `./x`), the system shall mark the sink `firstParty: true`, keep the reach in the inventory, and emit neither `PR-THIRD-PARTY` nor `PR-TRANSFER`.

## Non-goals

- **Whole-program or interprocedural taint analysis.** HoundDog and Bearer do this with years of work; a portfolio project that claims it would overclaim. The flow model is intra-procedural with one local hop (section 5.4) and the README says so with negative examples.
- **Python, Java, Go, Ruby, PHP sources.** Each language is a parser and a sink catalog. TS/JS plus SQL and Prisma already make the "many sources, one inventory" point. Privado covers Java/Python.
- **Windows.** Portable by construction (`node:path`, no shell-specific scripts); CI on Ubuntu only.
- **Scanning live data stores, logs or text (de-identification).** That is Microsoft Presidio's job (data level). privacy-radar scans code and schemas. The README names Presidio as the complementary tool.

## Resolved questions

- **Typing for reach (Spec delta 14).** `FunctionModel.params` carries `typeName`; `Binding` gains `typeName` and `refs` (the allowed-shape references of its initializer); `CallSite.args[i].refs` likewise; `FunctionModel` gains `queryBuilds`. The extractor applies the allowed shapes, so `reach` only matches references. Module scope is a pseudo-function named `<module>`.
- **Masking pipeline (Spec delta 2).** Adapters parse the raw text and return offsets; `src/app/scan.ts` masks and re-slices every model string from the masked text. `ValueHit`, `Field`, `Binding` and `CallSite` carry `TextRange` offsets for that purpose.
- **Babel 8.0.7 (Step 0, 2026-10-14).** A recoverable error (`let a = 1; let a = 2;`) comes back in `ast.errors`; `foo(a, b;` throws `SyntaxError` and 600 nested parentheses throw `RangeError`, both reported as warnings; plain `decorators` returns a recoverable error instead of throwing, so tests assert a non-zero error count. Babel error messages can quote source text, so only the reason code and position are reported.
- **Review focus 2.** A CRLF file with a BOM yields the same entities, lines and columns as its LF twin, for `.ts`, `.sql` and `.prisma` (tests named `[RF-2]`).
- **Review focus 1.** Paths with spaces work end to end; URIs and snippets carry relative paths only.
- **Symbolic links.** The walker uses `lstat`, never follows a link and skips any path whose real path leaves the target (`SYMLINK_SKIPPED`).

## Checklist

Each criterion is proved by a test whose name starts with its id (the file is listed).

- [x] SRC-01: `tests/unit/ts-parse.unit.test.ts`
- [x] SRC-02: `tests/unit/files.unit.test.ts`, `tests/unit/ts-parse.unit.test.ts`
- [x] SRC-03: `tests/unit/ts-entities.unit.test.ts`
- [x] SRC-04: `tests/unit/ts-functions.unit.test.ts`
- [x] SRC-05: `tests/e2e/scan-fixture.e2e.test.ts`
- [x] SRC-06: `tests/unit/fuzz-sources.unit.test.ts`
- [x] SRC-07: `tests/unit/files.unit.test.ts`
- [x] SRC-08: `tests/unit/ts-functions.unit.test.ts`
- [x] FLOW-01: `tests/unit/sinks.unit.test.ts`
- [x] FLOW-02: `tests/unit/sinks.unit.test.ts`, `tests/unit/vendors.unit.test.ts`
- [x] FLOW-03: `tests/unit/reach.unit.test.ts`
- [x] FLOW-04: `tests/unit/reach.unit.test.ts`
- [x] FLOW-05: `tests/unit/reach.unit.test.ts`
- [x] FLOW-06: `tests/unit/reach.unit.test.ts`, `tests/unit/sinks.unit.test.ts`
- [x] FLOW-07: `tests/unit/rules.unit.test.ts`, `tests/unit/vendors.unit.test.ts`
