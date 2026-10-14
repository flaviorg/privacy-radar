# ADR 0007: Validate SARIF with a Zod subset, not a vendored schema

Status: accepted (2026-10-08, design spec; recorded as an ADR on 2026-10-14)
Decision ids: D-15

## Context

GitHub code scanning rejects SARIF with a missing fingerprint, an absolute URI, a zero column or too many results. A full JSON Schema validator would add `ajv` and a vendored schema.

## Decision

- `src/contracts/sarif.ts` holds a hand-written Zod subset that covers what GitHub requires (one run, exact rule count, relative URIs, columns from 1, `partialFingerprints.primaryLocationLineHash`, caps). It uses `z.looseObject` so other valid SARIF properties pass.
- `catalog --validate-sarif <file>` runs it on any file. The CI `self-action` job runs the composite action on the fixture and validates each SARIF; a push to main uploads it with `category: fixture`.

## Consequences

- Good: no new dependency, and the invariants that bit people before are explicit tests, including the sub-folder URI prefix.
- Cost: the subset can drift from the official schema. If GitHub rejects an upload, add the vendored schema as a dev-only test.

## Alternatives

- `ajv` plus the official SARIF 2.1.0 schema: rejected for v0.1, a dependency and a large vendored schema for fields we do not emit.
