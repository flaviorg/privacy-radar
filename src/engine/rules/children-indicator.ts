import { normalizeName } from "../../catalog/terms.ts";
import type { Evidence } from "../../contracts/findings.ts";
import { resolveArticles } from "../articles.ts";
import { findingConfidence, levelOf } from "../confidence.ts";
import { entityMessage } from "../messages.ts";
import { FIXED_SEVERITY } from "../severity.ts";
import { locationOf, storageEntities, strongCandidates } from "./entity-common.ts";
import type { RawFinding, Rule } from "./index.ts";

const AGE_LIKE = new Set(["demographic.birth-date", "demographic.age"]);
const CHILD_COMPANIONS = new Set(["children.guardian", "children.school", "children.minor-flag"]);
const MINOR_FLAG = "children.minor-flag";

/**
 * `PR-CHILD` (spec 5.5): a storage entity with a `children.*` category, or a birth-date/age field
 * together with guardian/school/minor-flag, or a field named with a minor term. Always `note`; it
 * never asserts minority. One category: the first children indicator in field order.
 */
export const rule: Rule = {
  id: "PR-CHILD",
  apply(model) {
    const out: RawFinding[] = [];
    for (const entity of storageEntities(model)) {
      const strong = entity.fields.map((f) => ({ f, cands: strongCandidates(model, f) }));
      const children = strong.flatMap(({ cands }) => cands.filter((c) => c.category.startsWith("children.")));
      const ageLike = strong.flatMap(({ cands }) => cands.filter((c) => AGE_LIKE.has(c.category)));
      const minorNamed = entity.fields.filter((f) => {
        const { tokens, joined } = normalizeName(f.name);
        return model.catalog.termIndex.minorTerms.has(joined) || tokens.some((t) => model.catalog.termIndex.minorTerms.has(t));
      });
      const companion = children.some((c) => CHILD_COMPANIONS.has(c.category));
      if (children.length === 0 && minorNamed.length === 0 && !(ageLike.length > 0 && companion)) continue;
      const contributing = [...children, ...(companion ? ageLike : [])];
      const category = children[0]?.category ?? MINOR_FLAG;
      const categories = [category];
      const articles = resolveArticles({ ruleId: "PR-CHILD", categories, transfer: [], regime: model.regime, catalog: model.catalog });
      const contributions = [...contributing.map((c) => c.confidence), ...minorNamed.map((f) => f.top?.confidence ?? 0)];
      const confidence = findingConfidence({ family: "child", contributions });
      const evidence: Evidence[] = [
        ...contributing.map((c): Evidence => ({ kind: "field-name", detail: `${c.category} (${c.confidence.toFixed(2)})`, weight: c.confidence })),
        ...minorNamed.map((f): Evidence => ({ kind: "field-name", detail: `field ${f.name} is named with a minor term`, weight: f.top?.confidence ?? 0 })),
      ];
      out.push({
        ruleId: "PR-CHILD",
        origin: "deterministic",
        categories,
        sensitivity: "children-indicator",
        severity: FIXED_SEVERITY["PR-CHILD"]!,
        confidence,
        confidenceLevel: levelOf(confidence),
        location: locationOf(model, entity.locations[0]),
        entity: { name: entity.name, field: "", kind: entity.kind },
        evidence,
        articles,
        message: entityMessage({ ruleId: "PR-CHILD", entity: entity.name, field: null, categories: [...new Set([...children, ...ageLike].map((c) => c.category))].sort(), articles, regime: model.regime }),
      });
    }
    return out;
  },
};
