import { normalizeName } from "../../catalog/terms.ts";
import { resolveArticles } from "../articles.ts";
import { findingConfidence, levelOf } from "../confidence.ts";
import { entityMessage } from "../messages.ts";
import type { ClassifiedEntity, ClassifiedField } from "../model.ts";
import { FIXED_SEVERITY } from "../severity.ts";
import { locationOf, storageEntities, strongCandidates } from "./entity-common.ts";
import type { RawFinding, Rule } from "./index.ts";

const PROTECTED_SUFFIX = new Set(["hash", "hashed", "enc", "encrypted"]);
const PROTECTED_WORD = /encrypted|hashed|@db\.Bytes/i;
const TEXT_LIKE = new Set(["string", "text", "varchar", "char", "character", "citext", "bpchar", "nvarchar", "json", "jsonb"]);

function isProtected(entity: ClassifiedEntity, field: ClassifiedField): boolean {
  const tokens = normalizeName(field.name).tokens;
  if (PROTECTED_SUFFIX.has(tokens[tokens.length - 1] ?? "")) return true;
  const f = field.field;
  if (PROTECTED_WORD.test(f.comment ?? "") || f.attributes.some((a) => PROTECTED_WORD.test(a))) return true;
  return entity.protectionHints.includes("rls");
}

const isTextLike = (type: string | null) => type !== null && TEXT_LIKE.has(type.toLowerCase().replace(/\(.*$/, ""));

/** `PR-PLAINTEXT-SENSITIVE` (spec 5.5): a sensitive storage field in plain text, per field. */
export const rule: Rule = {
  id: "PR-PLAINTEXT-SENSITIVE",
  apply(model) {
    const out: RawFinding[] = [];
    for (const entity of storageEntities(model)) {
      for (const field of entity.fields) {
        const sensitive = strongCandidates(model, field).filter((c) => c.regimeSensitivity === "sensitive");
        if (sensitive.length === 0 || isProtected(entity, field) || !isTextLike(field.field.type)) continue;
        const categories = [...new Set(sensitive.map((c) => c.category))].sort();
        const articles = resolveArticles({ ruleId: "PR-PLAINTEXT-SENSITIVE", categories, transfer: [], regime: model.regime, catalog: model.catalog });
        const confidence = findingConfidence({ family: "plaintext", contributions: sensitive.map((c) => c.confidence) });
        out.push({
          ruleId: "PR-PLAINTEXT-SENSITIVE",
          origin: "deterministic",
          categories,
          sensitivity: "sensitive",
          severity: FIXED_SEVERITY["PR-PLAINTEXT-SENSITIVE"]!,
          confidence,
          confidenceLevel: levelOf(confidence),
          location: locationOf(model, field.locations[0]),
          entity: { name: entity.name, field: field.name, kind: entity.kind },
          evidence: sensitive.flatMap((c) => c.evidence),
          articles,
          message: entityMessage({ ruleId: "PR-PLAINTEXT-SENSITIVE", entity: entity.name, field: field.name, categories, articles, regime: model.regime }),
        });
      }
    }
    return out;
  },
};
