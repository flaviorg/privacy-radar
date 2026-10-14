import * as z from "zod";
import { LIMITS } from "./limits.ts";

export const mechanismSchema = z.enum(["adequacy", "dpf", "scc", "bcr", "consent", "other", "unknown"]);
export type Mechanism = z.infer<typeof mechanismSchema>;

const suppressionCommon = {
  reason: z.string().min(LIMITS.suppressionReasonMin),
  by: z.string().min(1),
  until: z.iso.date().optional(),
};

export const suppressionSchema = z.union([
  z.object({ fingerprint: z.string().min(1), ...suppressionCommon }).strict(),
  z.object({ rule: z.string().min(1), file: z.string().min(1), line: z.number().int().min(1), ...suppressionCommon }).strict(),
]);
export type Suppression = z.infer<typeof suppressionSchema>;

export const projectConfigSchema = z
  .object({
    schemaVersion: z.literal(1),
    controller: z
      .object({
        name: z.string().optional(),
        contact: z.string().optional(),
        dpo: z.string().optional(),
        country: z.string().optional(),
      })
      .strict()
      .optional(),
    purposes: z.record(z.string(), z.string()).optional(),
    legalBases: z
      .record(z.string(), z.object({ lgpd: z.string().optional(), gdpr: z.string().optional() }).strict())
      .optional(),
    retention: z.record(z.string(), z.string()).optional(),
    vendors: z
      .record(z.string(), z.object({ mechanism: mechanismSchema, notes: z.string().optional() }).strict())
      .optional(),
    ignore: z.array(z.string()).optional(),
    suppressions: z.array(suppressionSchema).optional(),
    llm: z.object({ maxFields: z.number().int().min(1).max(LIMITS.maxLlmFieldsHard).optional() }).strict().optional(),
    reportLanguage: z.enum(["en", "pt-BR"]).optional(),
  })
  .strict();
export type ProjectConfig = z.infer<typeof projectConfigSchema>;
