import type { Rule } from "./index.ts";
import { sinkRule } from "./sink-common.ts";

/** `PR-FILE`: a classified source reaches a `file` sink (spec 5.5); severity from the matrix. */
export const rule: Rule = { id: "PR-FILE", apply: (model) => sinkRule("PR-FILE", ["file"], model) };
