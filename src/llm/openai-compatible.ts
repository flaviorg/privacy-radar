import * as z from "zod";
import { LIMITS } from "../contracts/limits.ts";
import { ProviderError, type LlmProvider, type LlmRaw, type LlmRequest } from "./provider.ts";

const STRIPPED = new Set(["$schema", "minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems"]);

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) if (!STRIPPED.has(k)) out[k] = strip(v);
    return out;
  }
  return value;
}

/**
 * The JSON Schema sent to the provider (spec 4.4): `z.toJSONSchema` without `$schema` and the length
 * and range keywords, which some OpenAI-compatible servers reject. The Zod parse on the way back
 * still enforces them.
 */
export function providerSchema(schema: z.ZodType): object {
  return strip(z.toJSONSchema(schema)) as object;
}

export type OpenAiCompatibleOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  fetch?: typeof fetch;
  redact: (s: string) => string;
  /** pause before retrying a 429 or 5xx answer (test seam; default 500 ms) */
  retryDelayMs?: number;
};

type ChatResponse = {
  model?: unknown;
  choices?: { message?: { content?: unknown; refusal?: unknown } }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
};

const asCount = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The real client (spec 7.4, LLM-09): POST `<base>/chat/completions`, temperature 0, a strict
 * `json_schema` response format, a per-attempt timeout combined with the caller's signal, two
 * attempts on 429, 5xx, network error or timeout and none on other 4xx. Errors carry a redacted,
 * short body excerpt; request headers are never logged or echoed.
 */
export function createOpenAiCompatibleProvider(opts: OpenAiCompatibleOptions): LlmProvider {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const doFetch = opts.fetch ?? ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => globalThis.fetch(input, init));
  const retryDelay = opts.retryDelayMs ?? 500;
  const excerpt = (text: string) => opts.redact(text).slice(0, LIMITS.llmErrorExcerptChars);

  return {
    name: "openai-compatible",
    async complete(call: LlmRequest): Promise<LlmRaw> {
      const body = JSON.stringify({
        model: opts.model,
        temperature: 0,
        response_format: { type: "json_schema", json_schema: { name: call.prompt.name.replace(/\./g, "_"), strict: true, schema: call.jsonSchema } },
        messages: call.messages,
      });
      let lastError: ProviderError | null = null;
      for (let attempt = 1; attempt <= LIMITS.llmAttempts; attempt++) {
        const timeout = AbortSignal.timeout(opts.timeoutMs);
        const signal = call.signal ? AbortSignal.any([timeout, call.signal]) : timeout;
        let res: Response;
        try {
          res = await doFetch(url, { method: "POST", headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" }, body, signal });
        } catch (err) {
          if (call.signal?.aborted) throw new ProviderError("network", "request aborted by the caller");
          lastError = timeout.aborted
            ? new ProviderError("timeout", `no answer within ${opts.timeoutMs} ms`)
            : new ProviderError("network", `network error: ${excerpt(err instanceof Error ? err.message : String(err))}`);
          continue;
        }
        if (!res.ok) {
          let text = "";
          try {
            text = await res.text();
          } catch {
            text = "";
          }
          const error = new ProviderError("http", `HTTP ${res.status}: ${excerpt(text)}`, { status: res.status });
          if (res.status !== 429 && res.status < 500) throw error;
          lastError = error;
          if (attempt < LIMITS.llmAttempts && retryDelay > 0) await sleep(retryDelay);
          continue;
        }
        let json: ChatResponse;
        try {
          json = (await res.json()) as ChatResponse;
        } catch {
          throw new ProviderError("http", `HTTP ${res.status}: the answer is not JSON`, { status: res.status });
        }
        const message = json.choices?.[0]?.message;
        const content = message?.content;
        if (typeof content !== "string" || content === "") {
          throw new ProviderError("refusal", typeof message?.refusal === "string" ? `refused: ${excerpt(message.refusal)}` : "the answer has no content");
        }
        return {
          text: content,
          usage: { promptTokens: asCount(json.usage?.prompt_tokens), completionTokens: asCount(json.usage?.completion_tokens) },
          model: typeof json.model === "string" ? json.model : opts.model,
        };
      }
      throw lastError ?? new ProviderError("network", "no attempt was made");
    },
  };
}
