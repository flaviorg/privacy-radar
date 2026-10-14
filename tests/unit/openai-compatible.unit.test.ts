import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog } from "../../src/catalog/load.ts";
import type { PromptSpec } from "../../src/contracts/llm.ts";
import { createRedactor } from "../../src/infra/redact.ts";
import { createOpenAiCompatibleProvider, providerSchema } from "../../src/llm/openai-compatible.ts";
import { ProviderError, type LlmRequest } from "../../src/llm/provider.ts";
import { createPrompts } from "../../src/prompts/index.ts";

const prompts = createPrompts(loadCatalog().categories.map((c) => c.id));
const labelPrompt = prompts.label;
const KEY = "sk-or-v1-" + "a".repeat(40);
const BASE = "https://llm.example.invalid/v1/";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const OK_BODY = { model: "test/model", choices: [{ message: { content: '{"label":"unknown","confidence":0.3,"evidence":"extra Json?","rationale":"x"}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } };

function client(over: { fetch: typeof fetch; timeoutMs?: number }) {
  return createOpenAiCompatibleProvider({ baseUrl: BASE, apiKey: KEY, model: "test/model", timeoutMs: over.timeoutMs ?? 1000, fetch: over.fetch, redact: createRedactor(KEY), retryDelayMs: 0 });
}

function callFor<I, O>(prompt: PromptSpec<I, O>): LlmRequest {
  return {
    prompt: prompt as PromptSpec<unknown, unknown>,
    input: prompt.sampleInput,
    matchKeys: prompt.matchKeys(prompt.sampleInput),
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.buildUser(prompt.sampleInput) },
    ],
    jsonSchema: providerSchema(prompt.outputSchema),
  };
}

test("[LLM-09] POSTs to <base>/chat/completions with temperature 0 and the exact provider schema", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const p = client({ fetch: async (url, init) => (calls.push({ url: String(url), init: init! }), json(OK_BODY)) });
  const raw = await p.complete(callFor(labelPrompt));
  assert.equal(calls.length, 1);
  const body = JSON.parse(String(calls[0]!.init.body));
  assert.equal(calls[0]!.url, "https://llm.example.invalid/v1/chat/completions");
  assert.equal(calls[0]!.init.method, "POST");
  assert.equal(body.temperature, 0);
  assert.equal(body.model, "test/model");
  assert.deepEqual(body.response_format, { type: "json_schema", json_schema: { name: "label-field_v1", strict: true, schema: providerSchema(labelPrompt.outputSchema) } });
  assert.deepEqual(body.messages, callFor(labelPrompt).messages);
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(headers.Authorization!.length, "Bearer ".length + KEY.length);
  assert.equal(headers["Content-Type"], "application/json");
  assert.ok(calls[0]!.init.signal instanceof AbortSignal);
  assert.deepEqual(raw, { text: OK_BODY.choices[0]!.message.content, usage: { promptTokens: 10, completionTokens: 5 }, model: "test/model" });
});

test("[LLM-09] providerSchema has no $schema or range keyword at any depth", () => {
  const banned = new Set(["$schema", "minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems"]);
  const walk = (v: unknown, path: string): void => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v !== null && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        assert.ok(!banned.has(k), `${path}.${k}`);
        walk(x, `${path}.${k}`);
      }
    }
  };
  for (const schema of [labelPrompt.outputSchema, prompts.narrative.outputSchema]) {
    const s = providerSchema(schema) as { type?: string; additionalProperties?: boolean; required?: string[] };
    walk(s, "$");
    assert.equal(s.type, "object");
    assert.equal(s.additionalProperties, false);
  }
  const label = providerSchema(labelPrompt.outputSchema) as { properties: { label: { enum: string[] } }; required: string[] };
  assert.ok(label.properties.label.enum.includes("special.health") && label.properties.label.enum.includes("unknown"));
  assert.deepEqual(label.required, ["label", "confidence", "evidence", "rationale"]);
});

test("[LLM-09] retries once on 429, 500 and network error; never on 400", async () => {
  const attempts = async (respond: () => Promise<Response>) => {
    let n = 0;
    const p = client({ fetch: async () => (n++, respond()) });
    await assert.rejects(p.complete(callFor(labelPrompt)), ProviderError);
    return n;
  };
  assert.equal(await attempts(async () => json({ error: "rate" }, 429)), 2);
  assert.equal(await attempts(async () => json({ error: "boom" }, 500)), 2);
  assert.equal(await attempts(async () => Promise.reject(new TypeError("fetch failed"))), 2);
  assert.equal(await attempts(async () => json({ error: "bad" }, 400)), 1);
  let n = 0;
  const recovers = client({ fetch: async () => (++n === 1 ? json({ error: "rate" }, 429) : json(OK_BODY)) });
  assert.equal((await recovers.complete(callFor(labelPrompt))).model, "test/model");
  assert.equal(n, 2);
});

test("[LLM-09] aborts after LLM_TIMEOUT_MS", async () => {
  let n = 0;
  const waitsForSignal: typeof fetch = (_url, init) =>
    new Promise((_resolve, reject) => {
      n++;
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason));
    });
  const started = Date.now();
  await assert.rejects(client({ fetch: waitsForSignal, timeoutMs: 20 }).complete(callFor(labelPrompt)), (e: unknown) => e instanceof ProviderError && e.kind === "timeout");
  assert.equal(n, 2);
  assert.ok(Date.now() - started < 2000);
});

test("[LLM-08] a key-shaped string in an error body is redacted", async () => {
  const p = client({ fetch: async () => json({ error: { message: `invalid key ${KEY} and sk-${"z".repeat(30)}` } }, 401) });
  await assert.rejects(p.complete(callFor(labelPrompt)), (e: unknown) => {
    assert.ok(e instanceof ProviderError);
    assert.equal(e.status, 401);
    assert.ok(e.message.includes("[REDACTED]"));
    assert.ok(!e.message.includes(KEY) && !e.message.includes("z".repeat(30)));
    assert.ok(e.message.length <= "HTTP 401: ".length + 200);
    return true;
  });
});

test("a refusal or an empty answer is a refusal error", async () => {
  const refuse = client({ fetch: async () => json({ choices: [{ message: { content: null, refusal: "I cannot help with that." } }] }) });
  await assert.rejects(refuse.complete(callFor(labelPrompt)), (e: unknown) => e instanceof ProviderError && e.kind === "refusal");
});
