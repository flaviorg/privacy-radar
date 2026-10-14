# LLM boundary

Status: implemented

## Context

The model is the least trusted component. Two tasks exist: `labelAmbiguousField` (a closed enum label with confidence and an evidence substring, for fields the engine marked ambiguous) and `draftNarrative` (prose for the documents). Both go through `callLlm`: Zod validation, one repair attempt, degradation to `null`, a trace.
`mergeFindings` copies deterministic findings unchanged and turns accepted labels into `PR-AMBIGUOUS` notes with fixed articles. A fake provider with scripted, hash-checked fixtures is the default; an OpenAI-compatible `fetch` client is env-gated.
Two evals measure what is claimed: the deterministic classifier against 200+ hand labels, and the labeling harness (planted rates offline, a live table only when someone runs it with a key).

## Acceptance criteria

- **LLM-01** When a prompt's user message is built, every string derived from the target shall be inside an `<untrusted>` block, the message shall be a pure function of the input, and it shall contain no absolute path and no environment value.
- **LLM-02** When the provider answers a classify call, the system shall accept the label only if it parses the strict schema, the label is in the catalog enum or `not-personal`/`unknown`, and `evidence` is a substring of the field context; `not-personal` and `unknown` shall produce only the inventory's `llmLabel` and no finding.
- **LLM-03** While `LLM_PROVIDER` is `fake`, the system shall answer every call from the fixture whose `promptHashes` match, fail with `FIXTURE_PROMPT_DRIFT` otherwise, and throw `UNSCRIPTED_LLM_CALL` naming prompt, match keys and known turns when no turn matches.
- **LLM-04** For any deterministic finding list and any label list, `mergeFindings` shall return a list that contains every deterministic finding deep-equal and unchanged, so that no label can remove, downgrade, re-sever or re-article a deterministic finding.
- **LLM-05** When the scan runs with the injection fixture, the deterministic findings, severities, articles, fingerprints and exit code shall equal those of the demo fixture run.
- **LLM-06** When a label names a field the engine did not mark ambiguous, or its evidence is not in the context, the system shall drop it and record `evidence-mismatch` or `not-ambiguous` in the trace.
- **LLM-07** When a provider's raw text fails the schema, the system shall make exactly one repair call including the validation issues, and if that also fails, record `LLM_DEGRADED` and continue the scan with deterministic output and exit code unchanged.
- **LLM-08** The system shall pass every log line, trace line, error message and CLI output through `redactSecrets`, so that a key-shaped string or the configured `LLM_API_KEY` value never appears in any output or artifact.
- **LLM-09** When `LLM_PROVIDER` is `openai-compatible`, the client shall POST to `<LLM_BASE_URL>/chat/completions` with `temperature: 0` and a `json_schema` response format built from the Zod schema, abort after `LLM_TIMEOUT_MS`, retry once on 429, 5xx or network error, and never retry on other 4xx.
- **LLM-10** While `LLM_API_KEY` is absent, `test:live` shall skip; with it, it shall assert structure only.
- **LLM-11** While `LLM_PROVIDER` is `fake` and no fixture path is given (no `--llm-fixture`, empty `LLM_FIXTURE`) or the named file does not exist, the system shall run the scan as `--llm none` with one `LLM_FIXTURE_MISSING` warning, whatever the target directory is named, and `createFakeProvider` shall return `null`.
- **LLM-12** Every `PR-AMBIGUOUS` finding shall carry exactly the `*` articles of that rule in `rules.json` (LGPD 5 I; GDPR 4(1)), identical for every label, and `rules.json` shall hold no other key for that rule.
- **EVAL-01** When `scripts/eval.ts --target labeler --provider fake` runs on `evals/ambiguous-fields.jsonl` with `evals/ambiguous-fields.fake.json`, it shall report exactly the planted rates of section 8.5 (accuracy = (rows − 3 − 1) / rows, evidence-mismatch = 1 / rows), with no network.
- **EVAL-02** The README shall claim only measurements that exist: the classifier table equal to `tests/golden/evals/classifier.md`, a live-eval table only when a `docs/evals/<date>-<model>.md` file exists, a field-study table only when `docs/field-study.md` has a results section, and no "not run" phrasing.
- **EVAL-03** When `scripts/eval.ts --target classifier` runs on `evals/field-names.jsonl`, it shall compute, with the deterministic classifier only and no provider, precision and recall per category group and overall (a prediction is the top candidate at or above `--min-confidence`, else `not-personal`), and the Markdown table shall equal `tests/golden/evals/classifier.md`.

## Non-goals

- **Fixing code, opening PRs with patches, auto-suppressing.** The LLM never edits anything; suppressions are human, with a reason.
- **Legal conclusions, lawfulness, legal basis selection, contract and DPF verification.** The tool cannot know contracts, consents or certifications. Findings are worded "needs a Chapter V mechanism; verify DPF listing or SCCs", legal bases are inputs in the config, and every output carries the disclaimer.

## Resolved questions

- **Fake versus real (D-09).** Plain `fetch`, OpenAI-compatible, `json_schema` response format; `providerSchema` strips `$schema` and the length and range keywords, and Zod still enforces them on the way back (ADR 0008). Zod 4.6.5 emits the range keywords next to `type` at every depth, so the stripping is recursive.
- **Step 0 results.** `AbortSignal.timeout` and `AbortSignal.any` exist on Node 24.21, so the client combines its per-attempt timeout with the caller's signal. Under the guard `globalThis.fetch` fails with `NetworkDisabledInTests`, reported as a network error (two attempts, then `LLM_DEGRADED`). Strict Zod outputs report `invalid_value`, `too_big`, `too_small` and `unrecognized_keys`; the repair message lists `path: code` only.
- **Shared text helpers (File map).** `src/shared/text.ts` (pure) holds `collapseWs`, `fieldContext` and `evidenceMatches`, used by the engine and by the LLM layer, so neither imports the other.
- **Small modules (Spec delta 10).** `src/app/llm.ts` builds the provider from an env object; `src/llm/tasks.ts` holds the two tasks.
- **Narrative numbers (D-16).** A narrative with a number absent from the facts, or an article citation outside the section's deterministic list, is rejected and replaced by a placeholder; the trace records `numbers-drift` or `article-drift`.
- **Eval honesty.** `eval:fake` proves the harness computes the planted rates (3 wrong labels, 1 evidence mismatch); it says nothing about any model. A live number appears in the README only if `docs/evals/<date>-<model>.md` exists.

## Checklist

Each criterion is proved by a test whose name starts with its id (the file is listed).

- [x] LLM-01: `tests/unit/prompts.unit.test.ts`
- [x] LLM-02: `tests/e2e/llm-classify.e2e.test.ts`, `tests/unit/call-llm.unit.test.ts`
- [x] LLM-03: `tests/e2e/cli.e2e.test.ts`, `tests/unit/fake-provider.unit.test.ts`
- [x] LLM-04: `tests/unit/merge-findings.unit.test.ts`
- [x] LLM-05: `tests/e2e/injection.e2e.test.ts`
- [x] LLM-06: `tests/e2e/llm-classify.e2e.test.ts`, `tests/unit/merge-findings.unit.test.ts`
- [x] LLM-07: `tests/e2e/cli.e2e.test.ts`, `tests/unit/call-llm.unit.test.ts`
- [x] LLM-08: `tests/e2e/cli.e2e.test.ts`, `tests/unit/openai-compatible.unit.test.ts`, `tests/unit/redact.unit.test.ts`
- [x] LLM-09: `tests/unit/openai-compatible.unit.test.ts`
- [x] LLM-10: `tests/live/real-provider.live.ts`
- [x] LLM-11: `tests/e2e/cli.e2e.test.ts`, `tests/unit/fake-provider.unit.test.ts`
- [x] LLM-12: `tests/unit/catalog.unit.test.ts`, `tests/unit/merge-findings.unit.test.ts`
- [x] EVAL-01: `tests/e2e/eval-classifier.e2e.test.ts`, `tests/unit/eval-harness.unit.test.ts`
- [x] EVAL-02: `tests/unit/conventions.unit.test.ts`
- [x] EVAL-03: `tests/e2e/eval-classifier.e2e.test.ts`, `tests/unit/eval-harness.unit.test.ts`
