# Documents

Status: implemented

## Context

From one scan the tool drafts four documents: a RoPA (GDPR art. 30), a DPIA (GDPR art. 35), a registro de operacoes (LGPD art. 37) and a RIPD (LGPD art. 38), in English and, for the last two, in pt-BR. A minimal template renderer fills sections, tables and lists; every table, count and trigger is computed from deterministic data.
Narrative paragraphs are optional LLM proposals that pass the numbers and article checks; a rejected one is replaced by a placeholder. Inputs the tool cannot know (purposes, legal bases, retention) come from the config or are marked as not declared.
Every document carries the disclaimer banner of its locale.

## Acceptance criteria

- **DOC-01** When `--docs` includes a document, the system shall render it from the template of the selected locale with the sections of 5.9 in order, starting with the banner that names the tool version, date, target and provider.
- **DOC-02** The `ropa` and `registro` documents shall contain tables for entities and categories, recipients with vendor and country, transfer status per vendor, retention signals and security findings, each row linking to `file:line` evidence present in `findings.json`.
- **DOC-03** The `dpia` document shall state the number of WP248 criteria detected out of 9 and the sentence "a DPIA is likely required" when the count is at least 2, with the detected criteria listed, and the risks table shall contain every non-suppressed deterministic finding at or above `--min-confidence` with its articles (LLM-labeled fields only in the advisory sub-table, DOC-09).
- **DOC-04** The `ripd` document shall render the section ids of 5.9 in order, state in `contexto` that under LGPD art. 38 the ANPD may require the report, list the detected high-risk indicators from deterministic data only, and contain the three minimum content sections of art. 38 parágrafo único (`tipos-de-dados`, `metodologia-coleta-seguranca`, `medidas-salvaguardas`).
- **DOC-05** When the provider returns a narrative, the system shall insert it only under headings labeled "Draft narrative (LLM)" (pt-BR: "Rascunho narrativo (LLM)"), and shall reject paragraphs containing a cited finding id that does not exist, an article citation in any form of section 5.3 that names an article outside the section's deterministic list, a number absent from the facts, or a spelled-out number, rendering the placeholder instead.
- **DOC-06** When `--llm none` is used, every narrative section shall contain the placeholder and every table shall be identical to the `--llm fake` run.
- **DOC-07** The English and pt-BR templates of the same document shall contain the same multiset of placeholders.
- **DOC-08** When `--report-lang pt-BR` is used, the system shall write `registro.pt-BR.md` and `ripd.pt-BR.md` instead of `registro.md` and `ripd.md`, and `ropa.md` and `dpia.md` in English as always.
- **DOC-09** Every table, count, DPIA criterion, RIPD indicator and evidence-index row of every document shall be computed from deterministic data only, so that adding, removing or changing any LLM label leaves them byte-identical, and LLM-labeled fields shall appear only in the separate "LLM-labeled fields (advisory)" sub-table.

## Non-goals

- **Legal conclusions, lawfulness, legal basis selection, contract and DPF verification.** The tool cannot know contracts, consents or certifications. Findings are worded "needs a Chapter V mechanism; verify DPF listing or SCCs", legal bases are inputs in the config, and every output carries the disclaimer.
- **CCPA, HIPAA, other regimes.** Two regimes with article-level verification are the value; a third would dilute verification effort. The catalog format allows it later.
- **A web UI or dashboard.** incident-copilot covers UI. The CLI, SARIF in GitHub code scanning and Markdown documents are the interfaces.

## Resolved questions

- **WP248 has no third-party sharing criterion (Spec delta 5).** WP248 rev.01 lists nine criteria (re-read on 2026-10-14, see `docs/legal-sources.md`). The DPIA counts only those detectable from code: criterion 4 (a sensitive category), 7 (children indicators or an entity named like a patient) and 8 (an `llm` vendor reached). Third-party sharing sits under "Other risk indicators", outside the count. The demo reads "2 of 9 WP248 criteria detected: a DPIA is likely required"; the RIPD keeps its 3 high-risk indicators.
- **One-pass replacement (Step 0).** `template.replace(/\{\{([a-z]+):([^{}\s]+)\}\}/g, fn)` never rescans inserted text, so a derived string that looks like `{{table:x}}` is inserted literally.
- **Review focus 5.** A pt-BR run after an en run into the same `--out` leaves no stale `registro.md` or `ripd.md`: the scan deletes only the artifact names it owns that the current run does not write.
- **Disclaimer constants (Spec delta 13).** Every template carries its locale's sentence verbatim (REP-05).
- **Placeholders.** The English fill-in marker is produced at render time by concatenation, the pt-BR one is "(preencher)"; both are allowed in generated documents and in `*.example.json`, never in sources or templates.

## Checklist

Each criterion is proved by a test whose name starts with its id (the file is listed).

- [x] DOC-01: `tests/e2e/documents.e2e.test.ts`, `tests/unit/render.unit.test.ts`
- [x] DOC-02: `tests/unit/sections.unit.test.ts`
- [x] DOC-03: `tests/e2e/documents.e2e.test.ts`, `tests/unit/sections.unit.test.ts`
- [x] DOC-04: `tests/unit/sections.unit.test.ts`
- [x] DOC-05: `tests/e2e/documents.e2e.test.ts`, `tests/unit/call-llm.unit.test.ts`, `tests/unit/narrative-checks.unit.test.ts`, `tests/unit/render.unit.test.ts`
- [x] DOC-06: `tests/e2e/documents.e2e.test.ts`
- [x] DOC-07: `tests/unit/render.unit.test.ts`
- [x] DOC-08: `tests/e2e/documents.e2e.test.ts`
- [x] DOC-09: `tests/unit/sections.unit.test.ts`
