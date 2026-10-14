import type { AmbiguousField, DraftNarrativeInput, DraftNarrativeOutput, LabelFieldInput, LabelFieldOutput, LlmLabel, PromptSpec } from "../contracts/llm.ts";
import { evidenceMatches, fieldContext } from "../shared/text.ts";
import { checkNarrative } from "./narrative-checks.ts";
import { callLlm, type CallLlmContext, type LlmProvider } from "./provider.ts";

export type TaskContext = Omit<CallLlmContext<never>, "accept">;

/**
 * LLM-02: one ambiguous field through `label-field.v1`. The label is kept only when the strict
 * schema parses and the evidence is a substring of the field context (declaration, comment and
 * sibling names); otherwise `null` with the trace outcome `evidence-mismatch` (or `degraded`).
 */
export async function labelAmbiguousField(
  provider: LlmProvider,
  prompt: PromptSpec<LabelFieldInput, LabelFieldOutput>,
  field: AmbiguousField,
  ctx: TaskContext,
): Promise<LlmLabel | null> {
  const context = fieldContext({ declarationText: field.input.field.declarationText, comment: field.input.comment, entityFields: field.input.field.entityFields });
  const r = await callLlm(provider, prompt, field.input, { ...ctx, accept: (v) => (evidenceMatches(v.evidence, context) ? null : "evidence-mismatch") });
  if (r.value === null) return null;
  return {
    entity: field.entity,
    field: field.field,
    file: field.file,
    line: field.line,
    column: field.column,
    label: r.value.label,
    confidence: r.value.confidence,
    evidence: r.value.evidence,
    rationale: r.value.rationale,
    scripted: provider.name === "fake",
  };
}

const placeholder = (reason: string) => `_Narrative unavailable (LLM output rejected: ${reason})._`;

/**
 * DOC-05: one narrative section through `draft-narrative.v1`. Paragraphs are kept only when every
 * cited finding id exists, every legal citation is in the section's allowed list and every number
 * comes from the facts; otherwise the deterministic placeholder.
 */
export async function draftNarrative(
  provider: LlmProvider,
  prompt: PromptSpec<DraftNarrativeInput, DraftNarrativeOutput>,
  input: DraftNarrativeInput,
  knownFindingIds: ReadonlySet<string>,
  ctx: TaskContext,
): Promise<{ paragraphs: string[] } | { placeholder: string; reason: string }> {
  const r = await callLlm(provider, prompt, input, {
    ...ctx,
    accept: (v) => {
      const check = checkNarrative(v, input, knownFindingIds);
      return check.ok ? null : check.reason;
    },
  });
  if (r.value !== null) return { paragraphs: [...r.value.paragraphs] };
  const reason = r.rejected ?? "provider unavailable";
  return { placeholder: placeholder(reason), reason };
}
