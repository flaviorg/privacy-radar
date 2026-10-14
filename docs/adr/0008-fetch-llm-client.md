# ADR 0008: A plain fetch client for OpenAI-compatible providers

Status: accepted (2026-10-08, design spec; recorded as an ADR on 2026-10-14)
Decision ids: D-09

## Context

The real provider path must be testable offline, work with several backends (OpenRouter, OpenAI, Gemini's compatibility layer, local servers) and never leak a key.

## Decision

- Write a client of about 110 lines for `POST {LLM_BASE_URL}/chat/completions` with `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }`, `AbortSignal.timeout`, two attempts in total on 429, 5xx, a network error or a timeout, no retry on other 4xx, and an injectable `fetch`.
- `providerSchema` is `z.toJSONSchema` minus `$schema` and the length and range keywords (`minLength`, `maxLength`, `minimum`, `maximum`, `minItems`, `maxItems`), which some backends reject. Zod still enforces them on the way back.
- The key is never logged and is redacted from error bodies. Anthropic's native API is an M9 item.

## Consequences

- Good: the unit test asserts the URL, the exact schema, the body and the retries with a fake `fetch`; the fake provider and the real client share the same schemas.
- Cost: no streaming, no tool calls (not needed). A provider that needs them gets a new adapter.

## Alternatives

- The `openai` SDK 7.30.1 or `@anthropic-ai/sdk` 0.132.1: rejected, a heavier dependency and harder to fake.
