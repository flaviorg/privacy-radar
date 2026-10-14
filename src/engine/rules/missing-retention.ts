import { normalizeName } from "../../catalog/terms.ts";
import { resolveArticles } from "../articles.ts";
import { findingConfidence, levelOf } from "../confidence.ts";
import { entityMessage } from "../messages.ts";
import type { ClassifiedEntity } from "../model.ts";
import { retentionSeverity } from "../severity.ts";
import { locationOf, storageEntities, strongCandidates } from "./entity-common.ts";
import type { RawFinding, Rule } from "./index.ts";

const RETENTION_EXACT = new Set(["deleted_at", "expires_at", "anonymized_at"]);
const RETENTION_PREFIX = ["retention", "purge"];

/** The retention signal of an entity: the config entry, else the name of a retention-like field, else null. */
export function retentionSignalOf(entity: ClassifiedEntity, configured: Readonly<Record<string, string>>): string | null {
  if (Object.hasOwn(configured, entity.name)) return configured[entity.name]!;
  const field = entity.fields.find((f) => {
    const joined = normalizeName(f.name).joined;
    return RETENTION_EXACT.has(joined) || RETENTION_PREFIX.some((p) => joined.startsWith(p));
  });
  return field ? field.name : null;
}

const hasRetentionSignal = (entity: ClassifiedEntity, configured: Readonly<Record<string, string>>): boolean => retentionSignalOf(entity, configured) !== null;

const RANK = { sensitive: 2, personal: 1 } as const;

/** `PR-RETENTION` (spec 5.5): a storage entity with a personal field and no retention signal; one category (the strongest contributing one). */
export const rule: Rule = {
  id: "PR-RETENTION",
  apply(model) {
    const out: RawFinding[] = [];
    for (const entity of storageEntities(model)) {
      const personal = entity.fields.flatMap((f) =>
        strongCandidates(model, f).filter((c): c is typeof c & { regimeSensitivity: "sensitive" | "personal" } => c.regimeSensitivity === "sensitive" || c.regimeSensitivity === "personal"),
      );
      if (personal.length === 0 || hasRetentionSignal(entity, model.config.retention ?? {})) continue;
      const strongest = [...personal].sort(
        (a, b) => RANK[b.regimeSensitivity] - RANK[a.regimeSensitivity] || b.confidence - a.confidence || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0),
      )[0]!;
      const categories = [strongest.category];
      const hasSensitive = personal.some((c) => c.regimeSensitivity === "sensitive");
      const articles = resolveArticles({ ruleId: "PR-RETENTION", categories, transfer: [], regime: model.regime, catalog: model.catalog });
      const confidence = findingConfidence({ family: "retention", contributions: personal.map((c) => c.confidence) });
      out.push({
        ruleId: "PR-RETENTION",
        origin: "deterministic",
        categories,
        sensitivity: strongest.regimeSensitivity,
        severity: retentionSeverity(hasSensitive),
        confidence,
        confidenceLevel: levelOf(confidence),
        location: locationOf(model, entity.locations[0]),
        entity: { name: entity.name, field: "", kind: entity.kind },
        evidence: [{ kind: "field-name", detail: `${personal.length} personal field candidates; no deleted_at, expires_at, retention, purge or anonymized_at field and no config retention entry`, weight: 0 }],
        articles,
        message: entityMessage({ ruleId: "PR-RETENTION", entity: entity.name, field: null, categories: [...new Set(personal.map((c) => c.category))].sort(), articles, regime: model.regime }),
      });
    }
    return out;
  },
};
