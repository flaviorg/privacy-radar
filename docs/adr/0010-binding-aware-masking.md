# ADR 0010: Binding-aware masking

Status: accepted (2026-10-08, design spec; recorded as an ADR on 2026-10-14)
Decision ids: Spec deltas 2 and 4, guardrail 5

## Context

SARIF uploaded to GitHub, PR comments and documents must never contain the personal data the tool finds. Value patterns catch identifiers, but a name or an address in a seed row (`{ fullName: "Maria Souza" }`, an `INSERT` literal) has no pattern; only the name it is bound to gives it away.

## Decision

- Source adapters return structure and offsets (value ranges, `literalBindings` with the binding name and range). `src/app/scan.ts` runs `detectValues` and the length-preserving `maskText`, masking value hits and every literal whose binding name classifies, then `applyMaskedText` re-slices every model string from the masked text.
- A literal masked because of its binding keeps separators and the first and last two letters or digits when it has at least eight of them, otherwise every letter or digit becomes `*` (`"Maria Souza"` becomes `"Ma*** ***za"`). Value hits use `maskValue` (separators and the last two kept; e-mails keep the TLD only).
- An `INSERT` that fails to parse binds every quoted literal to `*`, which is always masked. Fingerprints hash the masked line, so an uploaded hash cannot be brute-forced back to a CPF.

## Consequences

- Good: `no-leak.e2e` greps every artifact for the synthetic identifiers, names, e-mails and address of the fixture and finds none.
- Cost: masking is a pipeline stage with offsets in the source model, not a last-step filter, which touches every adapter.
- Cost: the first and last two characters of long bound literals stay visible by design; very short values are masked entirely.

## Alternatives

- Mask only at output time: rejected, a string could be built from raw text before the mask is applied.
- Mask every literal: rejected, it would hide the evidence a reviewer needs (a column name, a line).
