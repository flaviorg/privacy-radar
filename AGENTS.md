# AGENTS.md

Guidance for people and coding agents working on privacy-radar. Facts only; the rules behind them are in `specs/constitution.md`.

## What this is

A TypeScript CLI and composite GitHub Action that scans a Node/TypeScript repository (TS/JS, PostgreSQL DDL, `schema.prisma`) for a personal-data inventory, finds flows into risky sinks (one local hop), maps findings to LGPD and GDPR articles, drafts RoPA, DPIA, registro and RIPD documents and explains pull requests in plain sentences. Its output is a draft for a DPO, not legal advice.

## Commands

Run everything from the project root. The path may contain a space: quote it.

- `npm run demo`: the one-command demo (fake provider, no key, no network).
- `npm test`: unit and e2e tests with the network guard. `npm run test:unit` is what the hook runs.
- `npm run typecheck`: `tsc --noEmit` (TypeScript 7.0.2, no build step; Node runs `.ts` directly).
- `npm run verify`: typecheck, tests, `check:secrets`, `catalog:validate`, `catalog:freshness`, `diagrams:check`, `eval:fake` (what CI runs). `diagrams:check` is the only step that needs the network: it runs the pinned `@mermaid-js/mermaid-cli@12.0.0` through `npx`, which downloads it (and a headless Chrome) on the first run of a machine.
- `npm run regen`: rewrites the goldens, `DEMO.md` and the generated README blocks. Read the diff.
- `npm run fixtures:rehash`: updates `promptHashes` in the fake fixtures after a prompt change.
- `npm run eval:fake`: the labeling eval against its scripted fixture (proves the harness, not a model).
- `npm run setup:hooks`: points `core.hooksPath` at `.githooks` once per clone.

## Layers (checked by `tests/unit/conventions.unit.test.ts`)

- `src/contracts`: Zod schemas, no logic. Imports only `zod`.
- Pure layers: `src/validators`, `src/catalog/{terms,values,index}.ts`, `src/flows`, `src/engine`, `src/output`, `src/shared`. No `node:fs`, no `node:child_process`, no `process.env`, no `src/llm`, no `src/app`.
- `src/sources`: one adapter per format; imports its parser library and contracts only; text is passed in, never read here.
- `src/llm`, `src/prompts`: never import `src/engine`, `src/output`, `src/sources` or `src/app`. No article reference is written there.
- I/O edges: `src/catalog/load.ts` (the only reader of `catalog/`), `src/infra/*`. `src/app` orchestrates (`scan.ts`, `documents.ts`, `pr.ts`, `llm.ts`); `src/pr` is Git-only or pure; `src/cli.ts` is the only CLI port.
- `process.env` is read only by `src/cli.ts`, `src/infra/config.ts`, `scripts/*` and tests. `src/app` receives an `env` object.
- Erasable TypeScript only: no `enum`, `namespace`, parameter properties or decorators. Relative imports end in `.ts`. Classes only for errors.
- Limits live in `src/contracts/limits.ts`; no other file hard-codes one.

## The rules that matter most

- **Masking.** Every snippet, message, fingerprint, document row, PR sentence and LLM sample is built from the masked text (`maskText`, `applyMaskedText`). Never put raw scanned text in an output.
- **The LLM proposes, code decides.** Labels go through `callLlm`, an evidence check and `mergeFindings`; narratives go through the numbers and article checks. Tests: `tests/unit/merge-findings.unit.test.ts` (property tests), `tests/unit/call-llm.unit.test.ts`, `tests/e2e/injection.e2e.test.ts`, `tests/e2e/documents.e2e.test.ts`.
- **Honest fake.** Scripted output is always labeled `provider: fake (scripted)`.
- **Catalog edits** change `tests/golden/catalog/*`; review the diff, then `npm run regen`. Legal references carry `sourceUrl`, `verifiedOn`, `verifiedAgainst`.

## Tests

- TDD: a failing test first. A test that proves an EARS criterion starts its name with the id (`[VAL-01] ...`); the ids live in `specs/*/spec.md` and are checked both ways.
- `node:test` and `node:assert/strict` only. No network (`tests/setup/no-network.ts`; spawned children get `CHILD_NODE_ARGS`). No `skip` outside `tests/live`.
- Unit tests never spawn processes. Each e2e file scans into its own `mkdtemp` folder.
- Goldens under `tests/golden/` are written only by `npm run regen` (`UPDATE_GOLDEN=1`), never by hand.
- Key-shaped test values are built at run time (`"sk-or-v1-" + "a".repeat(40)`).
- `PROPERTY_SEED` defaults to `20261008`; assertion messages print the seed.

## Process

- No `git commit`, `git push`, release or publication unless the owner asks. Checkpoint = `npm run typecheck && npm test` green.
- In some shells `git` is a function that fails in agent sessions: write `command git ...`.
- Exact dependency versions only (`.npmrc`), three runtime dependencies. A new dependency needs an ADR in `docs/adr/`.
- Everything in English (code, tests, CLI, docs) except the pt-BR templates. Never copy course material into the repository. Fixture data is synthetic.
- No pending-work markers or placeholder text in versioned files outside `tests/` (REP-05). Generated documents may carry the fill-in marker.
- Record real failures in `docs/incidents/notes.md` and API surprises in `docs/api-notes.md`.

## Where things are

- Specs: `specs/`. Architecture and decisions: `docs/architecture.md`, `docs/adr/`. Legal sources: `docs/legal-sources.md`.
- Demo fixture: `fixtures/telehealth-clinic/` (README lists every deliberate issue). Scripted LLM fixtures: `fixtures/llm/`, `tests/fixtures/llm/`.
