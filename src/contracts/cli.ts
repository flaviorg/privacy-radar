import * as z from "zod";
import { LIMITS } from "./limits.ts";

export const OUTPUT_FORMATS = ["json", "sarif", "md", "table"] as const;
export const DOC_IDS = ["ropa", "dpia", "registro", "ripd"] as const;
export const FAIL_ON_VALUES = ["error", "warning", "note", "none"] as const;

const regime = z.enum(["lgpd", "gdpr", "both"]);
const failOn = z.enum(FAIL_ON_VALUES);

/** A comma-separated list of known values; empty items and unknown values are invalid, duplicates collapse. */
function list<const T extends readonly [string, ...string[]]>(allowed: T) {
  return z
    .string()
    .transform((s) => s.split(",").map((x) => x.trim()))
    .pipe(z.array(z.enum(allowed)).min(1))
    .transform((items) => [...new Set(items)]);
}

const docs = z
  .string()
  .transform((s) => s.trim())
  .pipe(z.union([z.literal("all").transform(() => [...DOC_IDS]), z.literal("none").transform((): (typeof DOC_IDS)[number][] => []), list(DOC_IDS)]));

const minConfidence = z.coerce.number().min(0).max(1);
const maxLlmFields = z.coerce.number().int().min(0).max(LIMITS.maxLlmFieldsHard);

/** The values `util.parseArgs` returns for `scan`, validated and defaulted (spec 5.11). Invalid → `USAGE`. */
export const scanOptionsSchema = z.object({
  regime: regime.default("both"),
  format: list(OUTPUT_FORMATS).default(["table", "json"]),
  out: z.string().min(1).optional(),
  "min-confidence": minConfidence.default(LIMITS.minConfidenceDefault),
  config: z.string().min(1).optional(),
  docs: docs.default([]),
  "report-lang": z.enum(["en", "pt-BR"]).default("en"),
  llm: z.enum(["fake", "openai-compatible", "none"]).optional(),
  "llm-fixture": z.string().min(1).optional(),
  "max-llm-fields": maxLlmFields.default(LIMITS.maxLlmFields),
  "fail-on": failOn.default("error"),
  json: z.boolean().default(false),
});
export type ScanCliOptions = z.infer<typeof scanOptionsSchema>;

/** The values of `pr` (spec 5.11); the command itself arrives with the PR mode. */
export const prOptionsSchema = z.object({
  base: z.string().min(1),
  head: z.string().min(1).default("HEAD"),
  repo: z.string().min(1).default("."),
  regime: regime.default("both"),
  format: list(["md", "json", "sarif"] as const).default(["md", "json"]),
  out: z.string().min(1).optional(),
  "fail-on": failOn.default("error"),
  json: z.boolean().default(false),
});
export type PrCliOptions = z.infer<typeof prOptionsSchema>;
