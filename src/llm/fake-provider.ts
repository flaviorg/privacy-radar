import { existsSync, readFileSync } from "node:fs";
import * as z from "zod";
import { llmFixtureSchema, type FixtureTurn, type LlmFixture } from "../contracts/llm-fixture.ts";
import type { MatchKeys, PromptSpec } from "../contracts/llm.ts";
import { FixturePromptDriftError, PrivacyRadarError, UnscriptedLlmCallError } from "../infra/errors.ts";
import { describeIssues } from "../infra/zod-issues.ts";
import { ProviderError, type LlmProvider, type LlmRaw, type LlmRequest } from "./provider.ts";
import { promptHash } from "./trace.ts";

export type FakeProvider = LlmProvider & { assertAllConsumed(): void; consumedIds(): string[] };

const MODEL = "fake-scripted";
const NO_USAGE = { promptTokens: 0, completionTokens: 0 };
const REFUSAL_TEXT = "I cannot help with that.";
const INVALID_JSON_TEXT = "not json {";
const TRANSPORT = new Set(["timeout", "http-429", "http-500"]);

function describeFixtureError(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.code === "custom" ? `${issue.path.map(String).join(".")}: ${issue.message}` : describeIssues(new z.ZodError([issue]))))
    .join("; ");
}

function loadFixture(path: string): LlmFixture {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new PrivacyRadarError("USAGE", `${path}: fake fixture not readable`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    throw new PrivacyRadarError("USAGE", `${path}: fake fixture is not valid JSON`);
  }
  const parsed = llmFixtureSchema.safeParse(json);
  if (!parsed.success) throw new PrivacyRadarError("USAGE", `${path}: invalid fake fixture: ${describeFixtureError(parsed.error)}`);
  return parsed.data;
}

function checkHashes(fixture: LlmFixture, prompts: readonly PromptSpec<unknown, unknown>[], path: string): void {
  const used = new Set(fixture.turns.map((t) => t.prompt));
  for (const p of prompts) {
    const recorded = fixture.promptHashes[p.name];
    if (recorded === undefined && !used.has(p.name)) continue;
    if (recorded !== promptHash(p)) {
      throw new FixturePromptDriftError(`${path}: the prompt hash of ${p.name} does not match the prompt; run npm run fixtures:rehash after reviewing the prompt change`);
    }
  }
}

const formatKeys = (keys: MatchKeys) => Object.entries(keys).map(([k, v]) => `${k}=${String(v)}`).join(", ") || "(none)";

/**
 * The scripted provider (spec 7.2). `null` when no path is given or the file does not exist (the scan
 * then runs as `none`, LLM-11); an existing fixture is validated and strict: a call with no
 * unconsumed matching turn throws `UNSCRIPTED_LLM_CALL`.
 */
export function createFakeProvider(opts: { fixturePath: string | null; prompts: readonly PromptSpec<unknown, unknown>[] }): FakeProvider | null {
  if (opts.fixturePath === null || opts.fixturePath === "" || !existsSync(opts.fixturePath)) return null;
  const fixture = loadFixture(opts.fixturePath);
  checkHashes(fixture, opts.prompts, opts.fixturePath);
  const consumed = new Set<number>();
  const failedOnce = new Set<number>();
  const order: string[] = [];

  const consume = (i: number, turn: FixtureTurn) => {
    consumed.add(i);
    order.push(turn.id);
  };
  const answer = (text: string, simulated: boolean): LlmRaw => (simulated ? { text, usage: NO_USAGE, model: MODEL, simulated: true } : { text, usage: NO_USAGE, model: MODEL });

  return {
    name: "fake",
    async complete(call: LlmRequest): Promise<LlmRaw> {
      const name = call.prompt.name;
      const index = fixture.turns.findIndex((t, i) => !consumed.has(i) && t.prompt === name && Object.entries(t.when).every(([k, v]) => call.matchKeys[k] === v));
      if (index < 0) {
        throw new UnscriptedLlmCallError(
          `no unconsumed turn for ${name} with ${formatKeys(call.matchKeys)}; consumed: ${order.join(", ") || "none"}; known: ${fixture.turns.map((t) => t.id).join(", ") || "none"}`,
        );
      }
      const turn = fixture.turns[index]!;
      const output = JSON.stringify(turn.output ?? null);
      const sim = turn.simulate;
      if (!sim) {
        consume(index, turn);
        return answer(output, false);
      }
      if (TRANSPORT.has(sim.kind)) {
        consume(index, turn);
        if (sim.then === "ok") return answer(output, true);
        if (sim.kind === "timeout") throw new ProviderError("timeout", "simulated timeout", { simulated: true });
        throw new ProviderError("http", `simulated HTTP ${sim.kind === "http-429" ? 429 : 500}`, { status: sim.kind === "http-429" ? 429 : 500, simulated: true });
      }
      if (sim.then === "ok" && failedOnce.has(index)) {
        consume(index, turn);
        return answer(output, true);
      }
      if (sim.then === "ok") failedOnce.add(index);
      else consume(index, turn);
      if (sim.kind === "invalid-json") return answer(INVALID_JSON_TEXT, true);
      if (sim.kind === "refusal-text") return answer(REFUSAL_TEXT, true);
      const base = turn.output !== null && typeof turn.output === "object" ? (turn.output as Record<string, unknown>) : {};
      return answer(JSON.stringify({ ...base, unexpectedKey: true }), true);
    },
    assertAllConsumed() {
      const stale = fixture.turns.filter((_, i) => !consumed.has(i)).map((t) => t.id);
      if (stale.length > 0) throw new PrivacyRadarError("USAGE", `stale fake fixture turns (never called): ${stale.join(", ")}`);
    },
    consumedIds: () => [...order],
  };
}
