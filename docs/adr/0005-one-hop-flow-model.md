# ADR 0005: A one-hop, intra-procedural flow model

Status: accepted (2026-10-08, design spec; recorded as an ADR on 2026-10-14)
Decision ids: D-07

## Context

Whole-program taint analysis is years of work (HoundDog and Bearer do it). A portfolio project that claims it would overclaim, and a scanner that is wrong about flows teaches users to ignore it.

## Decision

- A classified source reaches a sink directly, or through exactly one local binding in the same function or at module scope. The allowed shapes are listed in `docs/flow-model.md`; everything else is not detected.
- Each not-detected shape (two hops, user-defined functions, class fields, computed keys, `Array.join`) has a negative test, and the README lists them with examples.

## Consequences

- Good: the model is explainable in a paragraph, fast, and its limits are tested, not hidden.
- Cost: real flows through helper functions are missed. The README limits section says so, and findings are never described as complete.
- Revisit: never for v0.1; depth is the honesty line.

## Alternatives

- k-hop bounded analysis: rejected, it moves the line without removing the overclaim.
- Interprocedural taint: rejected as out of scope for the project.
