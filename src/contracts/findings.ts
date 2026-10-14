import * as z from "zod";
import { articleRefSchema, regimeSchema, ruleIdSchema, sensitivitySchema, sinkKindSchema } from "./catalog.ts";
import { mechanismSchema } from "./config.ts";
import { TRANSFER_STATUSES } from "./flows.ts";
import { LIMITS } from "./limits.ts";
import { scanWarningSchema } from "./source-model.ts";

export const EVIDENCE_KINDS = ["field-name", "type-hint", "attribute", "value-pattern", "checksum", "entity-context", "test-path", "sink", "vendor", "llm-label"] as const;
export const evidenceSchema = z.object({ kind: z.enum(EVIDENCE_KINDS), detail: z.string(), weight: z.number() }).strict();
export type Evidence = z.infer<typeof evidenceSchema>;
export type EvidenceKind = Evidence["kind"];

export const severitySchema = z.enum(["error", "warning", "note"]);
export type Severity = z.infer<typeof severitySchema>;

export const transferStatusSchema = z.enum(TRANSFER_STATUSES);

export const entityKindSchema = z.enum(["table", "model", "interface", "type", "class", "object"]);

/** The `Finding` of spec 5.1, exactly. */
export const findingSchema = z
  .object({
    id: z.string().regex(/^PRF-[0-9a-f]{12}$/),
    fingerprint: z.string().regex(/^[0-9a-f]{32}$/),
    ruleId: ruleIdSchema,
    origin: z.enum(["deterministic", "llm"]),
    categories: z.array(z.string().min(1)),
    sensitivity: sensitivitySchema,
    severity: severitySchema,
    confidence: z.number().min(0).max(1),
    confidenceLevel: z.enum(["high", "medium", "low"]),
    location: z
      .object({
        file: z.string().min(1),
        line: z.number().int().min(1),
        column: z.number().int().min(1),
        endLine: z.number().int().min(1).optional(),
        snippet: z.string().max(LIMITS.snippetChars),
      })
      .strict(),
    entity: z.object({ name: z.string().min(1), field: z.string(), kind: entityKindSchema }).strict().optional(),
    sink: z
      .object({
        kind: sinkKindSchema,
        callee: z.string().min(1),
        host: z.string().optional(),
        vendor: z.string().optional(),
        hqCountry: z.string().optional(),
        firstParty: z.boolean().optional(),
        hop: z.object({ via: z.string().min(1), line: z.number().int().min(1) }).strict().optional(),
      })
      .strict()
      .optional(),
    transfer: z.array(z.object({ regime: regimeSchema, status: transferStatusSchema, mechanism: mechanismSchema, text: z.string().min(1) }).strict()).optional(),
    evidence: z.array(evidenceSchema),
    articles: z.object({ lgpd: z.array(articleRefSchema), gdpr: z.array(articleRefSchema) }).strict(),
    message: z.string().min(1),
    suppressed: z.object({ reason: z.string().min(1), by: z.string().min(1), until: z.string().optional() }).strict().optional(),
    belowThreshold: z.boolean(),
  })
  .strict()
  .refine((f) => f.categories.length > 0 || f.ruleId === "PR-PARSE", { path: ["categories"], message: "empty_categories" });
export type Finding = z.infer<typeof findingSchema>;

const count = z.number().int().min(0);

/** The `findings.json` of spec 5.1. */
export const scanResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    tool: z.object({ name: z.literal("privacy-radar"), version: z.string().min(1) }).strict(),
    target: z.object({ path: z.string(), files: count, sources: z.object({ ts: count, sql: count, prisma: count }).strict() }).strict(),
    regime: z.enum(["lgpd", "gdpr", "both"]),
    provider: z.enum(["fake", "openai-compatible", "none"]),
    generatedAt: z.iso.datetime(),
    summary: z.object({ error: count, warning: count, note: count, suppressed: count, llmLabeled: count, belowThreshold: count }).strict(),
    findings: z.array(findingSchema),
    warnings: z.array(scanWarningSchema),
    llm: z.object({ calls: count, degraded: count, repaired: count, fieldsClassified: count, narrativeSections: count, simulated: z.boolean() }).strict(),
  })
  .strict();
export type ScanResult = z.infer<typeof scanResultSchema>;

export type DocId = "ropa" | "dpia" | "registro" | "ripd";
export type Locale = "en" | "pt-BR";
