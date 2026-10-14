# Constitution

The rules every change to privacy-radar answers to. They are short on purpose; the tests and the feature specs next to this file carry the detail.

## Who decides

1. **Deterministic code decides.** Every finding, severity, article reference, file and line, suppression, document table, count and exit code comes from code over data files (`src/`, `catalog/`). The decision table is `docs/threat-model.md` and the README section "Who decides what".
2. **The LLM proposes, never decides.** It may label a field the engine marked ambiguous (always a `note`, never a suppression) and draft narrative paragraphs. Its output passes a Zod schema, an evidence check and `mergeFindings` before it touches any output; numbers and article references in prose must come from the facts the engine supplied. No path leads from the model to a severity, an article, a location or a suppression.
3. **Honest fake.** Every scripted output is labeled `provider: fake (scripted)`; a repair the fake simulates is printed as simulated. A fixture proves mechanics, never model quality.

## What leaves the process

4. **Mask before anything leaves the engine.** Snippets, declaration lines, comments, defaults, LLM samples, fingerprints, messages, PR sentences and document rows are built from the masked copy of the scanned text. Raw personal data never reaches SARIF, a PR comment, a document, a log or a trace.
5. **Drafts, not legal advice.** Every output carries the disclaimer of its locale. Legal references are the author's own short summaries with `sourceUrl`, `verifiedOn` and `verifiedAgainst`; wording says "verify" wherever the tool cannot know (contracts, legal bases, certifications).
6. **Secrets stay out.** No key in any file; key-shaped test values are built at run time; `.env` is ignored; error text never echoes a value.

## How we build

7. **TDD with the EARS id in the test name.** A failing test first, then the smallest code that passes. A test that proves a criterion starts with its id in brackets (`[VAL-01] ...`); `tests/unit/conventions.unit.test.ts` checks both directions between `specs/` and the test names.
8. **`npm test` never touches the network.** The guard `tests/setup/no-network.ts` fails any attempt with `NetworkDisabledInTests`; child processes receive it through `CHILD_NODE_ARGS`.
9. **Goldens are generated, not typed.** Only `npm run regen` writes `tests/golden/**`, `DEMO.md` and the generated README blocks; a diff is read by a person.
10. **Exact versions.** Three runtime dependencies at exact versions, `engine-strict`, a lockfile. A new dependency needs an ADR in `docs/adr/`.
11. **Layers are enforced by tests.** The import rules of spec 4.3 are checked by `conventions.unit`; erasable TypeScript syntax is checked by `tsc`.

## Process

12. **Nothing is published without the owner.** No commit, push, release, Marketplace listing or npm publication happens before the owner validates the work.
13. **English everywhere** (code, comments, tests, CLI, docs), except the pt-BR templates and the strings that localize them.
14. **No course material** (transcripts, slides) is copied into this repository. Fixture identifiers, names and addresses are synthetic and listed in `fixtures/telehealth-clinic/README.md`.
15. **Failures are recorded.** A real failure during the build goes to `docs/incidents/notes.md`; an API that differs from what was expected goes to `docs/api-notes.md`.
