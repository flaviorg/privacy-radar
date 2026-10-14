import * as z from "zod";
import { LIMITS } from "./limits.ts";

// The LLM boundary contracts (spec 5.3, 5.14). The output schemas carry no key the LLM could use
// to change a deterministic decision (no severity, no legal reference, no location, no suppression).

/** Input of `labelAmbiguousField`: masked, capped, built from deterministic data only. */
export const labelFieldInputSchema = z
  .object({
    field: z
      .object({
        name: z.string().min(1),
        rawType: z.string().nullable(),
        optional: z.boolean(),
        array: z.boolean(),
        entity: z.string().min(1),
        declarationText: z.string().max(LIMITS.declarationChars),
        entityFields: z.array(z.string()).max(LIMITS.llmEntityFields),
        sourceKind: z.enum(["ts", "sql", "prisma"]),
        file: z.string().min(1),
        line: z.number().int().min(1),
      })
      .strict(),
    candidateCategories: z.array(z.string().min(1)),
    maskedSamples: z.array(z.string().max(LIMITS.llmSampleChars)).max(LIMITS.llmSamples),
    comment: z.string().max(LIMITS.llmCommentChars).nullable(),
  })
  .strict();
export type LabelFieldInput = z.infer<typeof labelFieldInputSchema>;

export const NOT_PERSONAL_LABEL = "not-personal";
export const UNKNOWN_LABEL = "unknown";

/** The strict output of `label-field.v1`; the label is one of the catalog ids, `not-personal` or `unknown`. */
export function makeLabelFieldOutputSchema(categoryIds: readonly string[]) {
  const labels: readonly string[] = [...categoryIds, NOT_PERSONAL_LABEL, UNKNOWN_LABEL];
  return z
    .object({
      label: z.enum(labels as unknown as [string, ...string[]]),
      confidence: z.number().min(0).max(1),
      evidence: z.string().min(1).max(LIMITS.llmEvidenceChars),
      rationale: z.string().max(LIMITS.llmRationaleChars),
    })
    .strict();
}
export type LabelFieldOutput = { label: string; confidence: number; evidence: string; rationale: string };

export const NARRATIVE_DOCUMENTS = ["ropa", "dpia", "registro", "ripd"] as const;

/** Input of `draftNarrative`: `facts` come from deterministic data only (no LLM label reaches them). */
export const draftNarrativeInputSchema = z
  .object({
    document: z.enum(NARRATIVE_DOCUMENTS),
    section: z.string().min(1),
    language: z.enum(["en", "pt-BR"]),
    facts: z
      .object({
        controller: z.string().nullable(),
        entities: z.array(z.object({ name: z.string(), categories: z.array(z.string()), sensitiveCount: z.number().int().min(0), retentionSignal: z.string().nullable() }).strict()),
        sinks: z.array(z.object({ kind: z.string(), vendor: z.string().nullable(), hqCountry: z.string().nullable(), categories: z.array(z.string()) }).strict()),
        transfers: z.array(z.object({ vendor: z.string().nullable(), hqCountry: z.string().nullable(), regime: z.enum(["lgpd", "gdpr"]), status: z.string() }).strict()),
        counts: z
          .object({ error: z.number().int().min(0), warning: z.number().int().min(0), note: z.number().int().min(0), entities: z.number().int().min(0), fields: z.number().int().min(0), vendors: z.number().int().min(0) })
          .strict(),
        allowedArticles: z.object({ lgpd: z.array(z.string()), gdpr: z.array(z.string()) }).strict(),
      })
      .strict(),
  })
  .strict();
export type DraftNarrativeInput = z.infer<typeof draftNarrativeInputSchema>;

export const draftNarrativeOutputSchema = z
  .object({
    paragraphs: z.array(z.string().min(LIMITS.narrativeParagraphMinChars).max(LIMITS.narrativeParagraphChars)).min(1).max(LIMITS.narrativeParagraphs),
    citedFindingIds: z.array(z.string()).max(LIMITS.narrativeCitedIds),
  })
  .strict();
export type DraftNarrativeOutput = z.infer<typeof draftNarrativeOutputSchema>;

export type EntityKindForLlm = "table" | "model" | "interface" | "type" | "class" | "object";

/** A field the engine marked ambiguous, with the input the labeler receives. */
export type AmbiguousField = {
  entity: string;
  field: string;
  /** kind of the entity at the preferred location (used by the `PR-AMBIGUOUS` finding's `entity`) */
  entityKind: EntityKindForLlm;
  file: string;
  line: number;
  column: number;
  sensitiveEntity: boolean;
  input: LabelFieldInput;
};

/** A label the boundary accepted (strict schema and evidence check passed); advisory only. */
export type LlmLabel = {
  entity: string;
  field: string;
  file: string;
  line: number;
  column: number;
  label: string;
  confidence: number;
  evidence: string;
  rationale: string;
  scripted: boolean;
};

export type PromptName = "label-field.v1" | "draft-narrative.v1";
export type MatchKeys = Record<string, string | number | boolean>;

/** One versioned prompt: the system text, a pure user-message builder, the output schema and the fake's match keys. */
export type PromptSpec<I, O> = {
  name: PromptName;
  version: 1;
  system: string;
  buildUser(input: I): string;
  outputSchema: z.ZodType<O>;
  matchKeys(input: I): MatchKeys;
  sampleInput: I;
};

export const TRACE_OUTCOMES = ["ok", "repaired", "degraded", "evidence-mismatch", "not-ambiguous", "numbers-drift", "article-drift", "unknown-finding-id"] as const;
export type TraceOutcome = (typeof TRACE_OUTCOMES)[number];

/** One line of `llm-trace.jsonl` (spec 5.14): never the input or output text. */
export type TraceLine = {
  seq: number;
  prompt: PromptName;
  matchKeys: MatchKeys;
  inputSha256: string;
  outcome: TraceOutcome;
  model: string;
  usage: { promptTokens: number; completionTokens: number };
  durationMs: number;
  simulated?: true;
};
