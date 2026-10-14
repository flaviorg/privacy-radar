import type { Rule } from "./index.ts";
import { sinkRule } from "./sink-common.ts";

/** `PR-LOG`: a classified source reaches a `log` sink (spec 5.5); severity from the matrix. */
export const rule: Rule = { id: "PR-LOG", apply: (model) => sinkRule("PR-LOG", ["log"], model) };
