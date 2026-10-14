import type { Rule } from "./index.ts";
import { sinkRule } from "./sink-common.ts";

/** `PR-URL-QUERY`: a classified source reaches a `url-query` sink (spec 5.5); severity from the matrix. */
export const rule: Rule = { id: "PR-URL-QUERY", apply: (model) => sinkRule("PR-URL-QUERY", ["url-query"], model) };
