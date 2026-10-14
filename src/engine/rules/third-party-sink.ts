import type { Rule } from "./index.ts";
import { sinkRule } from "./sink-common.ts";

/** `PR-THIRD-PARTY`: a classified source reaches an `http` sink that is not first-party (FLOW-07); `note` for an unresolved host. */
export const rule: Rule = { id: "PR-THIRD-PARTY", apply: (model) => sinkRule("PR-THIRD-PARTY", ["http"], model, (sink) => !sink.firstParty) };
