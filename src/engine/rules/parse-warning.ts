import { levelOf } from "../confidence.ts";
import { parseMessage } from "../messages.ts";
import { FIXED_SEVERITY } from "../severity.ts";
import { snippetOf } from "./sink-common.ts";
import type { RawFinding, Rule } from "./index.ts";

const CODES = new Set(["PARSE_ERROR", "DEPTH_LIMIT", "UNSUPPORTED_DIALECT"]);

/** `PR-PARSE` (spec 5.5): one note per PARSE_ERROR, DEPTH_LIMIT or UNSUPPORTED_DIALECT warning, at its file and line (1 when absent). */
export const rule: Rule = {
  id: "PR-PARSE",
  apply(model) {
    return model.warnings
      .filter((w) => CODES.has(w.code))
      .map((w): RawFinding => {
        const line = w.line ?? 1;
        return {
          ruleId: "PR-PARSE",
          origin: "deterministic",
          categories: [],
          sensitivity: "not-personal",
          severity: FIXED_SEVERITY["PR-PARSE"]!,
          confidence: 1,
          confidenceLevel: levelOf(1),
          location: { file: w.file, line, column: 1, snippet: snippetOf(model, w.file, line) },
          evidence: [],
          articles: { lgpd: [], gdpr: [] },
          message: parseMessage(w.code, w.file),
        };
      });
  },
};
