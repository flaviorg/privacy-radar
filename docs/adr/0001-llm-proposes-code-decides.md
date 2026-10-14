# ADR 0001: The LLM proposes, deterministic code decides

Status: accepted (2026-10-08, design spec; recorded as an ADR on 2026-10-14)
Decision ids: D-01, D-10, D-16 and guardrails 1 to 4 of the design spec

## Context

privacy-radar produces findings that people may act on: a DPO reads a RoPA draft, a team reads a PR comment. A model that can change a severity, an article reference or a suppression would make every output unverifiable, and a hostile repository could write its own instructions into field names and comments.

A model is still useful for two jobs the catalog cannot do: labeling a field whose name says nothing (`obs`, `extra`) and writing narrative prose for the documents.

## Decision

- The model has exactly two tasks, `labelAmbiguousField` and `draftNarrative`. Its output has no field for severity, article, file, line or suppression; labels are a closed enum and extra keys are rejected by `.strict()`.
- `mergeFindings` copies deterministic findings unchanged and appends `PR-AMBIGUOUS` notes for accepted labels, with fixed articles. A label is accepted only for a field the engine marked ambiguous and only when its evidence is a substring of the field's own context.
- Narrative prose is accepted only if every number is in the facts the engine supplied and every article citation is in the section's deterministic list; otherwise a placeholder is rendered. Counts, DPIA criteria and tables never read model output.
- `--llm none` yields byte-identical deterministic findings (the `PR-AMBIGUOUS` notes aside).

## Consequences

- Good: a property test over 500 seeded random pairs proves the superset and byte-identity postconditions; an injection fixture that answers `not-personal` with confidence 1 changes nothing deterministic.
- Good: the PR check never depends on a model, so it needs no key and cannot flake.
- Cost: the model's contribution is small and visible (a `note`, a paragraph); a rejected paragraph shows a placeholder instead of prose.
- Cost: the boundary needs its own tests (`merge-findings.unit`, `call-llm.unit`, `injection.e2e`, `documents.e2e`).

## Alternatives

- Let the model classify every field: rejected, it cannot be measured against the checksum validators and invites silent drift.
- Let the model write findings or severities: rejected, a finding must be reproducible from the code and the catalog alone.
- No model at all: rejected, ambiguous fields and prose are real needs, and the boundary itself is the point of the project.
