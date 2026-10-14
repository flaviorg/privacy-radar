# Engine and outputs

Status: implemented

## Context

The engine classifies fields (catalog terms, value patterns, type hints, context), runs twelve rules (log, third-party, analytics, file and URL-query sinks, international transfer, hardcoded values, plaintext sensitive data, missing retention, children indicator, ambiguous field, parse warning), maps each finding to exact LGPD and GDPR articles through `catalog/rules.json`, applies a severity matrix, computes a confidence, applies human suppressions and fingerprints every finding.
Outputs are findings JSON, SARIF 2.1.0 (GitHub constraints enforced by a Zod subset), the inventory in JSON and Markdown, and a console table. All Markdown goes through `escapeMd`/`codeSpan`.
Everything is deterministic, masked and ordered stably; the exit code depends only on deterministic findings.

## Acceptance criteria

- **ENG-01** When a field is classified, the system shall combine term hits, type hints, attributes, value hits in defaults and comments, entity context and test path into candidates with evidence and confidence per section 5.6, and mark `ambiguous: true` only for fields with no term hit whose name is in the generic list or whose type is JSON/text with a generic token.
- **ENG-02** When a finding is built, its severity shall come from the matrix of 6.1 for sink rules and from the fixed values of 5.5 for the others, and no code path shall set a severity from LLM output.
- **ENG-03** When an entity name normalizes to a non-person term or the file path is a test path, the system shall apply the penalties of 5.6, and a finding below `--min-confidence` shall be kept in JSON with `belowThreshold: true` and excluded from SARIF, table and documents.
- **ENG-04** When a finding is built for `--regime both`, the system shall attach the LGPD and GDPR article references resolved from `catalog/rules.json` by rule and category group; for `--regime lgpd` or `gdpr` the other array shall be empty and the message shall quote only the selected regime.
- **ENG-05** When an `http` or `analytics` sink has a vendor, the system shall assess the transfer per regime as `domestic`, `adequate`, `mechanism-declared` (a config mechanism other than `"unknown"`), `conditional`, `needs-mechanism` or `unknown-destination`, in that order of precedence, using `adequacy.json` and `config.vendors`, treat `BR` as domestic under LGPD and EU/EEA as domestic under GDPR, treat `mechanism: "unknown"` as not declared, and word the message with "verify" and the `checkedOn` date.
- **ENG-06** When the fixture entity `Patient` is scanned, the system shall emit `PR-RETENTION` (warning), `PR-CHILD` (note) and `PR-PLAINTEXT-SENSITIVE` for `diagnosis`, `allergies` and `bloodType`, and shall emit no `PR-PLAINTEXT-SENSITIVE` for a field named `diagnosis_enc` or commented `encrypted`.
- **ENG-07** When the config contains a suppression, the system shall require a reason of at least 10 characters and an author, keep the finding with `suppressed`, exclude it from the exit-code count, and reject a suppression without a reason with `CONFIG_INVALID`.
- **ENG-08** When the fixture is scanned with `--llm none` and with `--llm fake`, the deterministic findings (all with `origin: "deterministic"`, compared as whole objects with nothing removed) shall be byte-identical.
- **ENG-09** When the fixture is scanned, the findings shall match the expected table of 5.10 by rule, file and line (the golden is the source of truth after M8).
- **ENG-10** When a classified source reaches an `http` or `analytics` sink, the system shall emit `PR-TRANSFER` only when the vendor is known and its status is `needs-mechanism` or `conditional` under at least one selected regime, and shall describe an `unknown-destination` or unresolved host in the `PR-THIRD-PARTY` message instead.
- **ENG-11** When a finding is built, its confidence shall follow the finding-level formula of section 5.6 for its rule family, and a finding below `--min-confidence` shall get `belowThreshold: true`.
- **ENG-12** When a scanned file holds value hits with `checksum: "valid"` and a personal category, or e-mail matches, the system shall emit exactly one `PR-HARDCODED-VALUE` warning for that file at the first qualifying hit with the union of their categories and their count in the message, and shall emit none for a file whose only hits are `not-personal` (CNPJ) or `checksum: "n/a"`.
- **OUT-01** When `--format json` is requested, the system shall write `findings.json` valid under `scanResultSchema`, ordered by severity, file, line, rule, with masked snippets.
- **OUT-02** When `--format sarif` is requested, the system shall write a SARIF 2.1.0 log with one run, rules for every rule id present, and for every result a relative POSIX `uri`, `startLine` and `startColumn` ≥ 1, `partialFingerprints.primaryLocationLineHash`, `level`, `properties.articles`, and shall cap results at 25,000 with `truncated: true`.
- **OUT-03** When the same file is scanned twice, and when unrelated lines are inserted above a finding, the fingerprint shall be identical; when the finding's own line text changes, the fingerprint shall change.
- **OUT-04** The SARIF `tool.driver.fullDescription.text` and every rule `help.markdown` shall contain the disclaimer sentence.
- **OUT-05** When `--format md` is requested, the system shall write `inventory.md` with one table per entity (field, categories, sensitivity, confidence, sinks reached, locations) and the per-entity flags.
- **OUT-06** No output (JSON, SARIF, Markdown, console, PR comment, trace, logs) shall contain any detected personal-data value or any literal bound to a classified name unmasked; the no-leak test shall find none of the 14 fixture identifiers, the 2 fixture e-mails, the 2 synthetic names or the synthetic address in any artifact.
- **OUT-07** When the scan ends, the exit code shall be 1 if any non-suppressed deterministic finding at or above `--fail-on` exists, 0 otherwise, regardless of LLM findings.
- **OUT-08** Every CLI failure shall exit with the code of 5.11 and print one `error: <CODE>: <message>` line on stderr with no stack and no secret.
- **OUT-09** When a repository- or LLM-derived string is written into Markdown (PR comment, step summary, `inventory.md`, documents), the system shall pass it through `escapeMd`/`codeSpan`, so that a file named ``src/[x](https://e.invalid)`@team`.ts`` produces no link, image, HTML or mention, and shall never write an LLM `rationale` into Markdown.

## Non-goals

- **Legal conclusions, lawfulness, legal basis selection, contract and DPF verification.** The tool cannot know contracts, consents or certifications. Findings are worded "needs a Chapter V mechanism; verify DPF listing or SCCs", legal bases are inputs in the config, and every output carries the disclaimer.
- **Fixing code, opening PRs with patches, auto-suppressing.** The LLM never edits anything; suppressions are human, with a reason.
- **Coverage gate.** Reports only; a gate on a code base with many fixture files would invite inflation.
- **Anonymization quality, k-anonymity, pseudonymization detection beyond name hints.** Needs data, not code. `*_hash`, `*_enc` and `encrypted` hints are recorded as evidence only.
- **A web UI or dashboard.** incident-copilot covers UI. The CLI, SARIF in GitHub code scanning and Markdown documents are the interfaces.

## Resolved questions

- **Masking pipeline (Spec delta 2).** Adapters return structure plus offsets; `scan.ts` runs `detectValues` and `maskText` (length-preserving) and `applyMaskedText`, which re-slices every model string. No raw scanned text leaves `src/app/scan.ts`. ADR 0010.
- **Small modules the spec implies (Spec delta 10).** `src/engine/model.ts`, `masked-source.ts`, `articles.ts`, `messages.ts`, `src/infra/clock.ts`, `src/output/summary.ts` and `disclaimer.ts` exist as separate files with single responsibilities.
- **Disclaimer constants (Spec delta 13).** `DISCLAIMER_EN` and `DISCLAIMER_PT_BR` are exported by `src/output/disclaimer.ts`; the console table, SARIF `fullDescription`/`help.markdown` and the PR comment footer contain `DISCLAIMER_EN`, asserted on rendered output.
- **Transfer severity.** Under `--regime both` the severity matrix uses the worst transfer status across the regimes; a GB vendor is `needs-mechanism` under LGPD and `adequate` under GDPR, so `--regime gdpr` alone is lower for the same sink.
- **SARIF (D-15).** A hand-written Zod subset covers what GitHub requires; the CI `self-action` job is the integration check (it runs on GitHub on every push and pull request; its local proof is `tests/e2e/action.e2e.test.ts` plus `catalog --validate-sarif`).
- **Zod strict objects (Step 0).** `z.looseObject` and exact-length arrays are enough for the SARIF subset; problem lines carry `issue.code` and `issue.path` and never echo a value.

## Checklist

Each criterion is proved by a test whose name starts with its id (the file is listed).

- [x] ENG-01: `tests/unit/classify-field.unit.test.ts`
- [x] ENG-02: `tests/unit/severity.unit.test.ts`
- [x] ENG-03: `tests/e2e/scan-fixture.e2e.test.ts`, `tests/unit/classify-field.unit.test.ts`, `tests/unit/confidence.unit.test.ts`, `tests/unit/fingerprint.unit.test.ts`
- [x] ENG-04: `tests/e2e/scan-fixture.e2e.test.ts`, `tests/unit/rules.unit.test.ts`
- [x] ENG-05: `tests/unit/transfer.unit.test.ts`
- [x] ENG-06: `tests/unit/rules.unit.test.ts`
- [x] ENG-07: `tests/unit/config.unit.test.ts`, `tests/unit/suppressions.unit.test.ts`
- [x] ENG-08: `tests/e2e/scan-fixture.e2e.test.ts`
- [x] ENG-09: `tests/e2e/scan-fixture.e2e.test.ts`
- [x] ENG-10: `tests/unit/rules.unit.test.ts`
- [x] ENG-11: `tests/unit/confidence.unit.test.ts`
- [x] ENG-12: `tests/unit/rules.unit.test.ts`
- [x] OUT-01: `tests/e2e/scan-fixture.e2e.test.ts`
- [x] OUT-02: `tests/unit/sarif.unit.test.ts`
- [x] OUT-03: `tests/unit/fingerprint.unit.test.ts`
- [x] OUT-04: `tests/unit/sarif.unit.test.ts`
- [x] OUT-05: `tests/e2e/scan-fixture.e2e.test.ts`
- [x] OUT-06: `tests/e2e/no-leak.e2e.test.ts`, `tests/unit/mask.unit.test.ts`, `tests/unit/values.unit.test.ts`
- [x] OUT-07: `tests/e2e/cli.e2e.test.ts`, `tests/unit/scan-helpers.unit.test.ts`
- [x] OUT-08: `tests/e2e/cli.e2e.test.ts`, `tests/unit/config.unit.test.ts`, `tests/unit/errors.unit.test.ts`, `tests/unit/redact.unit.test.ts`
- [x] OUT-09: `tests/unit/inventory.unit.test.ts`, `tests/unit/markdown.unit.test.ts`, `tests/unit/pr-comment.unit.test.ts`, `tests/unit/render.unit.test.ts`, `tests/unit/sections.unit.test.ts`
