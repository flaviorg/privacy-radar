import { matchTerms, normalizeName, type TermHit, type TermIndex } from "../catalog/terms.ts";
import type { Category, RegimeOption, Sensitivity } from "../contracts/catalog.ts";
import type { Entity, Field, TextRange, ValueHit } from "../contracts/source-model.ts";
import { fieldConfidence, isTestPath, WEIGHTS, type Evidence } from "./confidence.ts";

export type { Evidence } from "./confidence.ts";

export type Candidate = { category: string; sensitivity: Sensitivity; confidence: number; evidence: Evidence[]; ambiguous: boolean };

export type ClassifyContext = {
  termIndex: TermIndex;
  categoryById: ReadonlyMap<string, Category>;
  regime: RegimeOption;
  /** POSIX path relative to the scan target (the test-path penalty reads it) */
  file: string;
  /** value hits of the field's own file */
  valueHits: readonly ValueHit[];
};

/** The entity as the classifier reads it; `fieldNames` (the siblings) feed the PT/ES `nif` disambiguation. */
export type EntityRef = Pick<Entity, "name" | "normalizedName"> & { fieldNames?: readonly string[] };

const SENSITIVITY_RANK: Readonly<Record<Sensitivity, number>> = { sensitive: 3, personal: 2, "children-indicator": 1, "not-personal": 0 };

/** Sensitivity of a category under a regime; under `both` the higher of the two (spec 5.2). */
export function sensitivityFor(cat: Category, regime: RegimeOption): Sensitivity {
  const lgpd = cat.lgpdSensitivity ?? cat.sensitivity;
  const gdpr = cat.gdprSensitivity ?? cat.sensitivity;
  if (regime === "lgpd") return lgpd;
  if (regime === "gdpr") return gdpr;
  return SENSITIVITY_RANK[lgpd] >= SENSITIVITY_RANK[gdpr] ? lgpd : gdpr;
}

/** Highest-ranked sensitivity of a list (sensitive > personal > children-indicator > not-personal). */
export function highestSensitivity(list: readonly Sensitivity[]): Sensitivity {
  let best: Sensitivity = "not-personal";
  for (const s of list) if (SENSITIVITY_RANK[s] > SENSITIVITY_RANK[best]) best = s;
  return best;
}

const DATE_TYPES = new Set(["date", "datetime", "timestamp", "timestamptz"]);
const DECIMAL_TYPES = new Set(["decimal", "numeric", "money"]);
const BIRTH_DATE = "demographic.birth-date";
const NIF_PT = "identifier.nif-pt";
const DNI_ES = "identifier.dni-es";

function typeHint(category: Category, type: string | null): string | null {
  const t = (type ?? "").toLowerCase();
  if (category.id === BIRTH_DATE && DATE_TYPES.has(t)) return type;
  if (category.group === "financial" && DECIMAL_TYPES.has(t)) return type;
  return null;
}

function attributeHint(category: Category, attributes: readonly string[]): string | null {
  if (category.id === BIRTH_DATE && attributes.includes("@db.Date")) return "@db.Date";
  if (category.group === "identifier") return attributes.find((a) => a === "@unique" || a === "unique") ?? null;
  return null;
}

const inside = (r: TextRange | null, h: ValueHit) => r !== null && h.start >= r.start && h.end <= r.end;

/** Languages of the siblings' term hits (en excluded: it names documents in their own language). */
function siblingLanguages(entity: EntityRef, self: string, index: TermIndex): { pt: number; es: number } {
  const counts = { pt: 0, es: 0 };
  for (const name of entity.fieldNames ?? []) {
    if (name === self) continue;
    const langs = new Set(matchTerms(name, index).map((h) => h.lang));
    if (langs.has("pt")) counts.pt++;
    if (langs.has("es")) counts.es++;
  }
  return counts;
}

/**
 * Candidates of one field (spec 5.6, ENG-01, ENG-03): one per category from the strongest term hit,
 * raised by type hints, attributes and value hits inside the field's default or comment, lowered by
 * the entity context and the test path. Sorted by confidence descending, then category.
 */
export function classifyField(field: Field, entity: EntityRef, ctx: ClassifyContext): Candidate[] {
  const byCategory = new Map<string, Evidence[]>();
  const evidenceOf = (category: string) => {
    let list = byCategory.get(category);
    if (!list) {
      list = [];
      byCategory.set(category, list);
    }
    return list;
  };

  const strongest = new Map<string, TermHit>();
  for (const h of matchTerms(field.name, ctx.termIndex)) {
    const prev = strongest.get(h.category);
    if (!prev || h.weight > prev.weight) strongest.set(h.category, h);
  }
  for (const [category, h] of strongest) {
    if (!ctx.categoryById.has(category)) continue;
    evidenceOf(category).push({ kind: "field-name", detail: `${h.mode} term "${h.term}" (${h.lang})`, weight: h.weight });
  }

  const hits = ctx.valueHits.filter((h) => h.categories.length > 0 && (inside(field.defaultRange, h) || inside(field.commentRange, h)));
  for (const h of hits) {
    for (const category of h.categories) {
      if (!ctx.categoryById.has(category)) continue;
      const list = evidenceOf(category);
      if (!list.some((e) => e.kind === "value-pattern")) list.push({ kind: "value-pattern", detail: `value ${h.masked} at line ${h.line}`, weight: WEIGHTS.valuePattern });
      if (h.checksum === "valid" && !list.some((e) => e.kind === "checksum")) list.push({ kind: "checksum", detail: "checksum valid", weight: WEIGHTS.checksumValid });
      if (h.checksum === "invalid" && !list.some((e) => e.kind === "checksum")) list.push({ kind: "checksum", detail: "checksum invalid", weight: WEIGHTS.checksumInvalid });
    }
  }

  // PT/ES `nif`: decided by a value checksum, else by the siblings' languages, else both stay.
  if (byCategory.has(NIF_PT) && byCategory.has(DNI_ES)) {
    const checksumFor = (c: string) => byCategory.get(c)!.some((e) => e.kind === "checksum" && e.weight > 0);
    const pt = checksumFor(NIF_PT);
    const es = checksumFor(DNI_ES);
    if (pt !== es) byCategory.delete(pt ? DNI_ES : NIF_PT);
    else {
      const langs = siblingLanguages(entity, field.name, ctx.termIndex);
      if (langs.pt > langs.es) byCategory.delete(DNI_ES);
      else if (langs.es > langs.pt) byCategory.delete(NIF_PT);
    }
  }

  const entityNames = [normalizeName(entity.name), normalizeName(entity.normalizedName)];
  const nonPerson = entityNames.some((n) => ctx.termIndex.nonPersonEntities.has(n.joined) || n.tokens.some((t) => ctx.termIndex.nonPersonEntities.has(t)));
  const testPath = isTestPath(ctx.file);

  const out: Candidate[] = [];
  for (const [category, evidence] of byCategory) {
    const cat = ctx.categoryById.get(category)!;
    const hint = typeHint(cat, field.type);
    if (hint !== null && evidence.some((e) => e.kind === "field-name")) evidence.push({ kind: "type-hint", detail: `type ${hint}`, weight: WEIGHTS.typeHint });
    const attr = attributeHint(cat, field.attributes);
    if (attr !== null && evidence.some((e) => e.kind === "field-name")) evidence.push({ kind: "attribute", detail: `attribute ${attr}`, weight: WEIGHTS.attribute });
    if (nonPerson) evidence.push({ kind: "entity-context", detail: `entity ${entity.name} is a non-person entity`, weight: WEIGHTS.entityContext });
    if (testPath) evidence.push({ kind: "test-path", detail: `test path ${ctx.file}`, weight: WEIGHTS.testPath });
    const confidence = fieldConfidence(evidence);
    if (confidence <= 0) continue;
    out.push({ category, sensitivity: sensitivityFor(cat, ctx.regime), confidence, evidence, ambiguous: false });
  }
  return out.sort((a, b) => b.confidence - a.confidence || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
}
