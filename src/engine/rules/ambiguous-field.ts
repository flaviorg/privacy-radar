import type { Rule } from "./index.ts";

/** `PR-AMBIGUOUS` is registered for its rule id only: its findings come from `mergeFindings` (LLM labels, Task 36). */
export const rule: Rule = { id: "PR-AMBIGUOUS", apply: () => [] };
