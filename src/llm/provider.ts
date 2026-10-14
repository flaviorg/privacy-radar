import type * as z from "zod";
import { LIMITS } from "../contracts/limits.ts";
import type { MatchKeys, PromptSpec, TraceOutcome } from "../contracts/llm.ts";
import { FixturePromptDriftError, UnscriptedLlmCallError } from "../infra/errors.ts";
import { providerSchema } from "./openai-compatible.ts";
import { inputSha256, type Trace } from "./trace.ts";

// The provider port (spec 4.4). `callLlm` (the only caller of `complete`) lives here too.

export type LlmCall = { prompt: PromptSpec<unknown, unknown>; input: unknown; signal?: AbortSignal; matchKeys: MatchKeys };
export type LlmMessage = { role: "system" | "user"; content: string };
export type LlmRequest = LlmCall & { messages: LlmMessage[]; jsonSchema: object };
/** `simulated` is set by the fake on every answer from a turn that carries a `simulate` block. */
export type LlmRaw = { text: string; usage: { promptTokens: number; completionTokens: number }; model: string; simulated?: true };

export interface LlmProvider {
  readonly name: "fake" | "openai-compatible";
  complete(call: LlmRequest): Promise<LlmRaw>;
}

export type ProviderErrorKind = "timeout" | "http" | "network" | "refusal";

/** A provider problem: never an error of the scan (`callLlm` turns it into a degraded outcome). */
export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status: number | null;
  readonly simulated: boolean;

  constructor(kind: ProviderErrorKind, message: string, opts: { status?: number | null; simulated?: boolean } = {}) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
    this.status = opts.status ?? null;
    this.simulated = opts.simulated ?? false;
  }
}

/** The `LLM_*` reason code of a provider problem (spec 5.13). */
export function degradedReason(err: unknown): string {
  if (err instanceof ProviderError) {
    if (err.kind === "timeout") return "LLM_TIMEOUT";
    if (err.kind === "refusal") return "LLM_REFUSAL";
    if (err.kind === "http") return `LLM_HTTP_${err.status ?? "ERROR"}`;
    return "LLM_NETWORK";
  }
  return "LLM_ERROR";
}

// ---------------------------------------------------------------------------------------------
// callLlm: the only way the scan talks to a provider

export type CallLlmContext<O> = {
  trace: Trace;
  signal?: AbortSignal;
  redact: (s: string) => string;
  /** a post-parse check: an outcome rejects the value without a repair (for example `evidence-mismatch`) */
  accept?: (value: O) => TraceOutcome | null;
  /** called once with the `LLM_*` reason code when the call degrades */
  onDegraded?: (reason: string) => void;
  /** clock for `durationMs` (test seam) */
  now?: () => number;
};

export type CallLlmResult<O> = {
  value: O | null;
  outcome: "ok" | "repaired" | "degraded";
  /** the post-parse rejection, when `accept` refused the value */
  rejected: TraceOutcome | null;
  simulated: boolean;
};

/** The first balanced `{...}` of a text, parsed; `undefined` when there is none or it is not JSON. */
export function firstJsonObject(text: string): unknown {
  for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (ch === "\\") i++;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          break;
        }
      }
    }
  }
  return undefined;
}

function validationIssues(error: z.ZodError): string {
  return error.issues
    .flatMap((i) => (i.code === "unrecognized_keys" ? i.keys.map((k) => `${[...i.path, k].map(String).join(".")}: ${i.code}`) : [`${i.path.map(String).join(".") || "(root)"}: ${i.code}`]))
    .join("; ");
}

const schemaCache = new WeakMap<object, object>();
function jsonSchemaOf(schema: z.ZodType): object {
  let cached = schemaCache.get(schema);
  if (!cached) {
    cached = providerSchema(schema);
    schemaCache.set(schema, cached);
  }
  return cached;
}

const isFixtureError = (err: unknown) => err instanceof UnscriptedLlmCallError || err instanceof FixturePromptDriftError;

/**
 * One logical call (spec 4.4, LLM-07): system + user message, the provider schema, parse the first
 * JSON object and validate it; on failure exactly one repair call that names the issues; a second
 * failure or any provider error degrades to `null`. Only the two fixture errors are rethrown. Writes
 * one trace line, never the input or output text.
 */
export async function callLlm<I, O>(provider: LlmProvider, prompt: PromptSpec<I, O>, input: I, ctx: CallLlmContext<O>): Promise<CallLlmResult<O>> {
  const now = ctx.now ?? (() => performance.now());
  const started = now();
  const user = prompt.buildUser(input);
  const matchKeys = prompt.matchKeys(input);
  const base = { prompt: prompt as PromptSpec<unknown, unknown>, input: input as unknown, matchKeys, jsonSchema: jsonSchemaOf(prompt.outputSchema), ...(ctx.signal ? { signal: ctx.signal } : {}) };
  const usage = { promptTokens: 0, completionTokens: 0 };
  let model: string = provider.name;
  let simulated = false;

  const finish = (outcome: TraceOutcome, value: O | null, result: CallLlmResult<O>["outcome"], rejected: TraceOutcome | null): CallLlmResult<O> => {
    ctx.trace.write({
      prompt: prompt.name,
      matchKeys,
      inputSha256: inputSha256(input),
      outcome,
      model: ctx.redact(model),
      usage: { ...usage },
      durationMs: Math.max(0, Math.round(now() - started)),
      ...(simulated ? { simulated: true as const } : {}),
    });
    return { value, outcome: result, rejected, simulated };
  };
  const degrade = (reason: string) => {
    ctx.onDegraded?.(reason);
    return finish("degraded", null, "degraded", null);
  };

  let issues = "";
  for (let attempt = 0; attempt <= LIMITS.llmRepairs; attempt++) {
    const content = attempt === 0 ? user : `${user}\n\nYour previous answer failed validation: ${issues}. Return only JSON matching the schema.`;
    let raw: LlmRaw;
    try {
      raw = await provider.complete({ ...base, messages: [{ role: "system", content: prompt.system }, { role: "user", content }] });
    } catch (err) {
      if (isFixtureError(err)) throw err;
      if (err instanceof ProviderError && err.simulated) simulated = true;
      return degrade(degradedReason(err));
    }
    model = raw.model;
    usage.promptTokens += raw.usage.promptTokens;
    usage.completionTokens += raw.usage.completionTokens;
    if (raw.simulated) simulated = true;
    const json = firstJsonObject(raw.text);
    if (json === undefined) {
      issues = "invalid JSON";
      continue;
    }
    const parsed = prompt.outputSchema.safeParse(json);
    if (!parsed.success) {
      issues = validationIssues(parsed.error);
      continue;
    }
    const outcome = attempt === 0 ? "ok" : "repaired";
    const rejected = ctx.accept?.(parsed.data) ?? null;
    if (rejected !== null) return finish(rejected, null, outcome, rejected);
    return finish(outcome, parsed.data, outcome, null);
  }
  return degrade("LLM_OUTPUT_INVALID");
}
