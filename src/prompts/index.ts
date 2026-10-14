import type { DraftNarrativeInput, DraftNarrativeOutput, LabelFieldInput, LabelFieldOutput, PromptSpec } from "../contracts/llm.ts";
import { draftNarrativePrompt } from "./v1/draft-narrative.ts";
import { createLabelFieldPrompt } from "./v1/label-field.ts";

export type LlmPrompts = {
  label: PromptSpec<LabelFieldInput, LabelFieldOutput>;
  narrative: PromptSpec<DraftNarrativeInput, DraftNarrativeOutput>;
  /** both prompts, as the fake provider and the rehash script receive them */
  all: readonly PromptSpec<unknown, unknown>[];
};

/** The current prompt versions for a catalog's category ids (catalog order). */
export function createPrompts(categoryIds: readonly string[]): LlmPrompts {
  const label = createLabelFieldPrompt(categoryIds);
  return { label, narrative: draftNarrativePrompt, all: [label as PromptSpec<unknown, unknown>, draftNarrativePrompt as PromptSpec<unknown, unknown>] };
}
