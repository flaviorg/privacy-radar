import { matchTerms, normalizeName, type TermIndex } from "../../src/catalog/terms.ts";
import type { SourceCategory, SourceIndex } from "../../src/contracts/flows.ts";
import type { Field } from "../../src/contracts/source-model.ts";
import type { Candidate } from "../../src/engine/classify-field.ts";
import { loadCatalog, type Catalog } from "../../src/catalog/load.ts";
import { detectValues, maskText } from "../../src/catalog/values.ts";
import type { RegimeOption } from "../../src/contracts/catalog.ts";
import type { ProjectConfig } from "../../src/contracts/config.ts";
import type { ValueHit } from "../../src/contracts/source-model.ts";
import type { Finding } from "../../src/contracts/findings.ts";
import { LIMITS } from "../../src/contracts/limits.ts";
import { applyMaskedText } from "../../src/engine/masked-source.ts";
import { buildScanModel, type ScanModel } from "../../src/engine/model.ts";
import { parseSource } from "../../src/sources/index.ts";

/** Field categories by name, from the term matcher (highest weight per category). */
function termCategories(name: string, termIndex: TermIndex): { category: string; confidence: number }[] {
  const seen = new Map<string, number>();
  for (const h of matchTerms(name, termIndex)) if (!seen.has(h.category)) seen.set(h.category, h.weight);
  return [...seen].map(([category, confidence]) => ({ category, confidence }));
}

/**
 * A hand-made `SourceIndex` for flow tests (the engine builds the real one in a later task):
 * `byName` classifies a name with the term matcher; `byType` knows the entities given here, whose
 * fields are classified the same way.
 */
export function termSourceIndex(termIndex: TermIndex, entities: Record<string, readonly string[]> = {}): SourceIndex {
  const byName = (last: string): SourceCategory[] =>
    termCategories(last, termIndex).map((c) => ({ ...c, entity: null, field: null, evidence: "field-name" as const }));
  return {
    byName,
    byType(typeName) {
      const fields = entities[typeName];
      if (!fields) return null;
      const fieldCats = (field: string): SourceCategory[] =>
        termCategories(field, termIndex).map((c) => ({ ...c, entity: typeName, field, evidence: "field-name" as const }));
      const all = new Map<string, SourceCategory>();
      for (const f of fields) {
        for (const c of fieldCats(f)) {
          const prev = all.get(c.category);
          if (!prev || c.confidence > prev.confidence) all.set(c.category, { ...c, evidence: "type-hint" });
        }
      }
      return {
        entity: typeName,
        field: (last) => {
          const key = normalizeName(last).joined;
          const match = fields.find((f) => normalizeName(f).joined === key);
          return match === undefined ? [] : fieldCats(match);
        },
        all: [...all.values()],
      };
    },
  };
}

/** The Prisma `Patient` model of the demo fixture (spec 5.10), as field names. */
export const PATIENT_FIELDS: readonly string[] = [
  "id",
  "fullName",
  "cpf",
  "nifPt",
  "dniEs",
  "codiceFiscale",
  "email",
  "phone",
  "birthDate",
  "guardianName",
  "diagnosis",
  "allergies",
  "bloodType",
  "obs",
  "createdAt",
];

// ---------------------------------------------------------------------------------------------
// Hand-built source-model values for engine unit tests


/** A `Field` with neutral defaults; `loc` defaults to line 1, column 3. */
export function field(over: Partial<Field> & { name: string }): Field {
  return {
    rawName: over.name,
    type: null,
    rawType: over.type ?? null,
    optional: false,
    array: false,
    loc: { line: 1, column: 3 },
    attributes: [],
    comment: null,
    commentRange: null,
    defaultValue: null,
    defaultRange: null,
    declarationText: "",
    ...over,
  };
}

/** An entity reference as `classifyField` reads it. */
export function ent(name: string, fieldNames: readonly string[] = []): { name: string; normalizedName: string; fieldNames: readonly string[] } {
  return { name, normalizedName: name.toLowerCase().replace(/[_-]/g, "").replace(/s$/, ""), fieldNames };
}

/** A deterministic candidate backed by one field-name evidence. */
export function cand(category: string, confidence = 0.6): Candidate {
  return { category, sensitivity: "personal", confidence, evidence: [{ kind: "field-name", detail: `test term for ${category}`, weight: confidence }], ambiguous: false };
}

let cachedCatalog: Catalog | null = null;
/** The real catalog, loaded once per test process. */
export function testCatalog(): Catalog {
  cachedCatalog ??= loadCatalog();
  return cachedCatalog;
}

export type ModelOptions = { regime?: RegimeOption; minConfidence?: number; config?: ProjectConfig; catalog?: Catalog };

/**
 * Runs the real pipeline on in-memory files (path -> text): adapters, value detection, masking,
 * `applyMaskedText` and `buildScanModel`. The order of `files` is kept.
 */
export function buildModelFromTexts(files: Record<string, string>, opts: ModelOptions = {}): ScanModel {
  const catalog = opts.catalog ?? testCatalog();
  const parsed = [];
  const valueHits: { file: string; hits: ValueHit[] }[] = [];
  const maskedTexts = new Map<string, string>();
  for (const [rel, text] of Object.entries(files)) {
    const source = parseSource(rel, text);
    const hits = detectValues(text, { path: rel, literalBindings: source.literalBindings, termIndex: catalog.termIndex, categories: catalog.categories });
    const masked = maskText(text, { valueHits: hits, literalBindings: source.literalBindings, termIndex: catalog.termIndex });
    parsed.push(applyMaskedText(source, masked));
    valueHits.push({ file: rel, hits });
    maskedTexts.set(rel, masked);
  }
  return buildScanModel({
    files: parsed,
    valueHits,
    maskedTexts,
    catalog,
    config: opts.config ?? { schemaVersion: 1 },
    regime: opts.regime ?? "both",
    minConfidence: opts.minConfidence ?? LIMITS.minConfidenceDefault,
  });
}

/** A valid deterministic `Finding` (PR-LOG on src/a.ts:1:1) with any field overridden. */
export function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "PRF-000000000000",
    fingerprint: "0".repeat(32),
    ruleId: "PR-LOG",
    origin: "deterministic",
    categories: ["identifier.cpf"],
    sensitivity: "personal",
    severity: "error",
    confidence: 0.6,
    confidenceLevel: "medium",
    location: { file: "src/a.ts", line: 1, column: 1, snippet: "console.log(cpf);" },
    evidence: [],
    articles: { lgpd: [], gdpr: [] },
    message: "identifier.cpf reaches the log call console.log.",
    belowThreshold: false,
    ...over,
  };
}
