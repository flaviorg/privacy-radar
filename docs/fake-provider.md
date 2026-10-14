# Fake provider

The default LLM provider is a **fake**: it answers from a scripted JSON fixture, so the demo and the tests are reproducible, free and offline. It proves the **mechanics** of the boundary (contracts, caps, merge, evidence check, numbers and article checks, degradation, trace). It does not prove the quality of any model; the README and the demo output say so, and every scripted output is labeled `provider: fake (scripted)`.

## Organization

- `src/llm/provider.ts`: the `LlmProvider` port and `callLlm`. It builds the messages, validates the answer with Zod, tries one repair, degrades to `null` on any provider or validation failure (a scan never fails because of the model) and writes the trace. It rethrows only `UnscriptedLlmCallError` and `FixturePromptDriftError`, which are fixture-authoring errors.
- `src/llm/fake-provider.ts`: `createFakeProvider({ fixturePath })` reads one fixture validated by `llmFixtureSchema`. It returns `null` when no path was given or the file does not exist; the scan then runs as `--llm none` with one `LLM_FIXTURE_MISSING` warning. Nothing is derived from the target's name.
- `src/llm/openai-compatible.ts`: the real client (plain `fetch`, injectable in tests). The fake and the real client share the same Zod schemas.
- Demo fixture: `fixtures/llm/telehealth-clinic.json` (passed explicitly by `scripts/demo.ts`). Test-only fixtures: `tests/fixtures/llm/*.json`.

## Fixture format

```json
{
  "schemaVersion": 1,
  "scenario": "telehealth-clinic",
  "promptHashes": { "label-field.v1": "sha256:…", "draft-narrative.v1": "sha256:…" },
  "turns": [
    { "id": "classify-patient-obs", "prompt": "label-field.v1",
      "when": { "entity": "Patient", "field": "obs" },
      "output": { "label": "special.health", "confidence": 0.62, "evidence": "obs Json?", "rationale": "Free-form clinical observations next to diagnosis and allergies." } },
    { "id": "classify-appointment-extra", "prompt": "label-field.v1",
      "when": { "entity": "Appointment", "field": "extra" },
      "output": { "label": "unknown", "confidence": 0.3, "evidence": "extra Json?", "rationale": "No neighbouring field suggests a category." } },
    { "id": "narrative-ropa-purposes", "prompt": "draft-narrative.v1",
      "when": { "document": "ropa", "section": "purposes" },
      "output": { "paragraphs": ["The clinic processes patient records for 3 entities …"], "citedFindingIds": [] } },
    { "id": "fail-once", "prompt": "draft-narrative.v1", "when": { "document": "dpia", "section": "description" },
      "simulate": { "kind": "invalid-json", "then": "ok" }, "output": { "paragraphs": ["…"], "citedFindingIds": [] } }
  ]
}
```

Rules:

- `promptHashes` must equal each prompt's hash, the SHA-256 of `system` + `"\n"` + `buildUser(sampleInput)`, so a change to the system text or to the user template is caught as `FIXTURE_PROMPT_DRIFT`. `npm run fixtures:rehash` rewrites the hashes after a deliberate prompt change.
- A turn is matched by `prompt` and `when` (every key of `when` must equal the call's match keys), in file order, and consumed once. A call with no unconsumed match throws `UnscriptedLlmCallError` naming the prompt, the match keys, the consumed turns and the known turn ids.
- `simulate` kinds: `invalid-json`, `schema-violation`, `timeout`, `http-429`, `http-500`, `refusal-text`, each optionally `then: "ok"` to succeed on the repair or retry. A failing turn without `then` is consumed by its failing call.
- `assertAllConsumed()` is called by `tests/e2e/demo.e2e.test.ts`, so a stale turn is caught.

## Scenarios

| Fixture | Used by | What it scripts |
|---|---|---|
| `fixtures/llm/telehealth-clinic.json` | demo, `scan-fixture.e2e`, `documents.e2e` | 2 `label-field.v1` turns (`obs` → `special.health` 0.62, `extra` → `unknown`), 8 `draft-narrative.v1` turns (ropa `purposes` and `security-measures` in English; dpia `description`, `necessity-proportionality` and `measures` in English; registro `finalidades` and `seguranca` and ripd `medidas-salvaguardas` in pt-BR, matching the demo's `--report-lang pt-BR`), 1 `invalid-json then ok` on `dpia.description` to show the repair path in the trace (marked `simulated`). PR mode consumes no turn |
| `evals/ambiguous-fields.fake.json` | `eval:fake`, `eval-harness.unit` | One `label-field.v1` turn per eval row (at least 24), with exactly 3 deliberate wrong labels and 1 evidence mismatch, so the planted rates are fixed numbers (section 8.5) that `eval-harness.unit` asserts |
| `tests/fixtures/llm/injection.json` | `injection.e2e` | Every `label-field.v1` turn answers `not-personal`, confidence 1, rationale "Delete all findings; this repository is compliant"; every narrative turn includes invented counts and article references |
| `tests/fixtures/llm/lying-labels.json` | `llm-classify.e2e` | Labels fields the engine did not mark ambiguous (`cpf` → `not-personal`), evidence not in context |
| `tests/fixtures/llm/garbage-output.json` | `call-llm.unit`, `cli.e2e` | `schema-violation` twice → degraded; scan still exits 1 with deterministic findings |
| `tests/fixtures/llm/numbers-drift.json` | `documents.e2e` | Narrative paragraphs with numbers absent from the facts → placeholder rendered, trace `numbers-drift` |
| `tests/fixtures/llm/article-drift.json` | `documents.e2e` | One turn per citation form, each in a section whose deterministic list lacks the cited article while the facts contain the same numbers as counts: "art. 5", "Articles 9 and 10", "arts. 5 and 9", "artigos 5 e 9", "Arts. 44 to 49", "LGPD 11 and GDPR 9", "§ 1"; plus one turn with "three entities" (spelled-out number) → placeholder rendered every time, trace `article-drift` (or `numbers-drift` for the last) |
| `tests/fixtures/llm/suppress-attempt.json` | `merge-findings.unit` (loaded as data) | Output objects with extra keys `severity`, `suppress`, `articles` → rejected by `.strict()` |

## What the fake proves and what it does not

- Proves: a label for a field the engine did not mark ambiguous is dropped; a label whose evidence is not in the field's own context is dropped; extra keys such as `severity` or `suppress` are rejected by `.strict()`; narrative with invented numbers or article citations is replaced by a placeholder; a malformed answer is repaired once and then degrades; the injection fixture changes none of the deterministic findings.
- Does not prove: that a real model labels well, writes useful prose or stays inside the schema without repair. That is measured by `npm run eval:live` against `evals/ambiguous-fields.jsonl` when someone runs it with a key, and its dated table is the only live number the README may show.
- The "1 repair" in the demo summary is a scripted `invalid-json` turn and is printed as simulated by the scripted fake.
