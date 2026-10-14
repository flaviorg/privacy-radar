import { readFileSync } from "node:fs";
import * as z from "zod";
import { projectConfigSchema, type ProjectConfig } from "../contracts/config.ts";
import { LIMITS } from "../contracts/limits.ts";
import { PrivacyRadarError } from "./errors.ts";
import { describeIssues } from "./zod-issues.ts";

const positiveInt = z.coerce.number().int().positive();

export const envSchema = z.object({
  LLM_PROVIDER: z.enum(["fake", "openai-compatible", "anthropic", "none"]).default("fake"),
  LLM_API_KEY: z.string().optional(),
  LLM_BASE_URL: z.string().default("https://openrouter.ai/api/v1"),
  LLM_MODEL: z.string().optional(),
  LLM_TIMEOUT_MS: positiveInt.default(LIMITS.llmTimeoutMs),
  LLM_FIXTURE: z.string().optional(),
  PRIVACY_RADAR_MAX_FILES: positiveInt.default(LIMITS.maxFiles),
  PRIVACY_RADAR_CLOCK: z.string().optional(),
  PROPERTY_SEED: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});
export type Env = z.infer<typeof envSchema>;

/** Every variable `envSchema` reads (REP-02 checks `.env.example` against this list). */
export const ENV_KEYS: readonly string[] = Object.keys(envSchema.shape);

export function loadEnv(env: Record<string, string | undefined>): Env {
  const cleaned: Record<string, string> = {};
  for (const key of ENV_KEYS) {
    const value = env[key];
    if (value !== undefined && value !== "") cleaned[key] = value;
  }
  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    throw new PrivacyRadarError("CONFIG_INVALID", `environment: ${describeIssues(parsed.error)}`);
  }
  return parsed.data;
}

export function loadProjectConfig(path: string | null): ProjectConfig {
  if (path === null) return { schemaVersion: 1 };
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new PrivacyRadarError("CONFIG_INVALID", `${path}: file not found or not readable`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    throw new PrivacyRadarError("CONFIG_INVALID", `${path}: not valid JSON`);
  }
  const parsed = projectConfigSchema.safeParse(json);
  if (!parsed.success) {
    throw new PrivacyRadarError("CONFIG_INVALID", `${path}: ${describeIssues(parsed.error)}`);
  }
  return parsed.data;
}
