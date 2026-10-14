import type { ScanWarning } from "../contracts/source-model.ts";
import type { Env } from "../infra/config.ts";
import { PrivacyRadarError } from "../infra/errors.ts";
import { createFakeProvider, type FakeProvider } from "../llm/fake-provider.ts";
import { createOpenAiCompatibleProvider } from "../llm/openai-compatible.ts";
import type { LlmProvider } from "../llm/provider.ts";
import type { LlmPrompts } from "../prompts/index.ts";

export type LlmChoice = "fake" | "openai-compatible" | "anthropic" | "none";

/** The LLM side of one scan: the provider (or none), the label the outputs print and the warnings known before the scan. */
export type LlmSetup = { provider: LlmProvider | null; label: string; warnings: ScanWarning[]; fake: FakeProvider | null };

/**
 * The provider of one scan (spec 5.11, 5.12). Scanning a directory never depends on a fixture:
 * `fake` without a fixture path, or with a path to a missing file, runs as `none` with one
 * `LLM_FIXTURE_MISSING` warning (LLM-11); an existing fixture is validated now, before the scan
 * (invalid → `USAGE`, hash drift → `FIXTURE_PROMPT_DRIFT`). `openai-compatible` needs `LLM_API_KEY`
 * and `LLM_MODEL`; `anthropic` is an M9 provider.
 */
export function resolveLlm(input: {
  choice: LlmChoice;
  fixturePath: string | null;
  env: Env;
  prompts: LlmPrompts;
  redact: (s: string) => string;
  fetch?: typeof fetch;
}): LlmSetup {
  switch (input.choice) {
    case "none":
      return { provider: null, label: "none", warnings: [], fake: null };
    case "anthropic":
      throw new PrivacyRadarError("USAGE", "LLM_PROVIDER=anthropic is not implemented; use fake, openai-compatible or none");
    case "openai-compatible": {
      const apiKey = input.env.LLM_API_KEY;
      const model = input.env.LLM_MODEL;
      if (!apiKey || !model) throw new PrivacyRadarError("USAGE", "--llm openai-compatible needs LLM_API_KEY and LLM_MODEL in the environment");
      const provider = createOpenAiCompatibleProvider({
        baseUrl: input.env.LLM_BASE_URL,
        apiKey,
        model,
        timeoutMs: input.env.LLM_TIMEOUT_MS,
        redact: input.redact,
        ...(input.fetch ? { fetch: input.fetch } : {}),
      });
      return { provider, label: input.redact(`openai-compatible (${model})`), warnings: [], fake: null };
    }
    case "fake": {
      const fake = createFakeProvider({ fixturePath: input.fixturePath, prompts: input.prompts.all });
      if (fake === null) {
        const shown = input.fixturePath === null || input.fixturePath === "" ? "none given" : input.fixturePath;
        const warning: ScanWarning = { file: "", code: "LLM_FIXTURE_MISSING", message: `fake fixture not found: ${shown}; scanned without an LLM` };
        return { provider: null, label: `none (fake fixture not found: ${shown})`, warnings: [warning], fake: null };
      }
      return { provider: fake, label: "fake (scripted)", warnings: [], fake };
    }
  }
}
