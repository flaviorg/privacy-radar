import type { Rule } from "./index.ts";
import { transferRule } from "./sink-common.ts";

/** `PR-TRANSFER`: a known vendor with `needs-mechanism` or `conditional` under a selected regime (ENG-10). */
export const rule: Rule = { id: "PR-TRANSFER", apply: transferRule };
