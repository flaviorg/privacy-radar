import type { ValueHit } from "../../contracts/source-model.ts";
import { articleSuffix, hardcodedMessage } from "../messages.ts";
import { resolveArticles } from "../articles.ts";
import { highestSensitivity, sensitivityFor } from "../classify-field.ts";
import { findingConfidence, isTestPath, levelOf, valueHitConfidence } from "../confidence.ts";
import { FIXED_SEVERITY } from "../severity.ts";
import { snippetOf } from "./sink-common.ts";
import type { RawFinding, Rule } from "./index.ts";

const EMAIL = "contact.email";

/**
 * `PR-HARDCODED-VALUE` (spec 5.5, ENG-12): one finding per file with at least one qualifying hit
 * (checksum-valid with a personal category, or an e-mail match), at the first qualifying hit, with
 * the union of their personal categories and their count. CNPJ (not personal) and `n/a` hits never qualify.
 */
export const rule: Rule = {
  id: "PR-HARDCODED-VALUE",
  apply(model) {
    const out: RawFinding[] = [];
    const personal = (id: string) => {
      const c = model.catalog.categoryById.get(id);
      return c !== undefined && sensitivityFor(c, model.regime) !== "not-personal";
    };
    for (const { file, hits } of model.valueHits) {
      const qualifying: { hit: ValueHit; categories: string[] }[] = [];
      for (const hit of hits) {
        if (hit.categories.includes(EMAIL)) qualifying.push({ hit, categories: [EMAIL] });
        else if (hit.checksum === "valid" && hit.corroborated) {
          const cats = hit.categories.filter(personal);
          if (cats.length > 0) qualifying.push({ hit, categories: cats });
        }
      }
      const first = qualifying[0];
      if (!first) continue;
      const categories = [...new Set(qualifying.flatMap((q) => q.categories))].sort();
      const articles = resolveArticles({ ruleId: "PR-HARDCODED-VALUE", categories, transfer: [], regime: model.regime, catalog: model.catalog });
      const confidence = findingConfidence({ family: "hardcoded", contributions: qualifying.map((q) => valueHitConfidence(q.hit)), testPath: isTestPath(file) });
      const suffix = articleSuffix(articles, model.regime);
      out.push({
        ruleId: "PR-HARDCODED-VALUE",
        origin: "deterministic",
        categories,
        sensitivity: highestSensitivity(categories.map((id) => sensitivityFor(model.catalog.categoryById.get(id)!, model.regime))),
        severity: FIXED_SEVERITY["PR-HARDCODED-VALUE"]!,
        confidence,
        confidenceLevel: levelOf(confidence),
        location: { file, line: first.hit.line, column: first.hit.column, snippet: snippetOf(model, file, first.hit.line) },
        evidence: qualifying.map((q) => ({
          kind: q.hit.checksum === "valid" ? ("checksum" as const) : ("value-pattern" as const),
          detail: `${q.categories.join(", ")} value ${q.hit.masked} at line ${q.hit.line}`,
          weight: valueHitConfidence(q.hit),
        })),
        articles,
        message: `${hardcodedMessage(qualifying.length, categories)}${suffix === "" ? "" : ` ${suffix}`}.`,
      });
    }
    return out;
  },
};
