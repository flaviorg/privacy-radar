import type { Rule } from "./index.ts";
import { sinkRule } from "./sink-common.ts";

/** `PR-ANALYTICS`: a classified source reaches a `analytics` sink (spec 5.5); severity from the matrix. */
export const rule: Rule = { id: "PR-ANALYTICS", apply: (model) => sinkRule("PR-ANALYTICS", ["analytics"], model) };
