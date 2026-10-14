import type { Catalog } from "../catalog/load.ts";
import { matchTerms, normalizeName, type TermIndex } from "../catalog/terms.ts";
import type { Regime, RegimeOption } from "../contracts/catalog.ts";
import type { ProjectConfig } from "../contracts/config.ts";
import type { Reach, SinkCall, SourceCategory, SourceIndex, TypedSource } from "../contracts/flows.ts";
import type { Entity, Field, Loc, ScanWarning, SourceFile, SourceKind, ValueHit } from "../contracts/source-model.ts";
import { reach } from "../flows/reach.ts";
import { matchSinks } from "../flows/sinks.ts";
import { buildVendorIndex } from "../flows/vendors.ts";
import { normalizeEntityName } from "../sources/names.ts";
import { isAmbiguous } from "./ambiguous.ts";
import { classifyField, type Candidate } from "./classify-field.ts";
import { assessTransfer, type TransferAssessment } from "./transfer.ts";

export type SourceLocation = { file: string; loc: Loc; sourceKind: SourceKind };

export type MergedField = { entity: string; name: string; normalizedName: string; field: Field; locations: SourceLocation[] };

export type MergedEntity = {
  name: string;
  normalizedName: string;
  kind: Entity["kind"];
  sourceKind: SourceKind;
  locations: SourceLocation[];
  fields: MergedField[];
  protectionHints: string[];
};

/** Preferred source kind first (SCH-03). */
export const SOURCE_KIND_ORDER: readonly SourceKind[] = ["prisma", "sql", "ts"];
const kindRank = (k: SourceKind) => SOURCE_KIND_ORDER.indexOf(k);

type Occurrence = { file: SourceFile; entity: Entity; order: number };

/**
 * Entities of every source merged by `normalizedName` (SCH-03): display name, kind and field order
 * from the preferred source (prisma, then sql, then ts; file order within a kind); fields merged by
 * `normalizeName(name).joined`, the preferred field first and the extra fields of other sources
 * after it; locations from every source; protection hints unioned. Sorted by normalized name.
 */
export function mergeEntities(files: readonly SourceFile[]): MergedEntity[] {
  const groups = new Map<string, Occurrence[]>();
  let order = 0;
  for (const file of files) {
    for (const entity of file.entities) {
      const list = groups.get(entity.normalizedName) ?? [];
      list.push({ file, entity, order: order++ });
      groups.set(entity.normalizedName, list);
    }
  }
  const out: MergedEntity[] = [];
  for (const [normalizedName, occurrences] of groups) {
    const sorted = [...occurrences].sort((a, b) => kindRank(a.file.kind) - kindRank(b.file.kind) || a.order - b.order);
    const preferred = sorted[0]!;
    const fields = new Map<string, MergedField>();
    for (const occ of sorted) {
      for (const f of occ.entity.fields) {
        const key = normalizeName(f.name).joined || f.name;
        const location: SourceLocation = { file: occ.file.path, loc: f.loc, sourceKind: occ.file.kind };
        const existing = fields.get(key);
        if (existing) existing.locations.push(location);
        else fields.set(key, { entity: preferred.entity.name, name: f.name, normalizedName: key, field: f, locations: [location] });
      }
    }
    const hints = new Set<string>();
    for (const occ of sorted) for (const h of occ.entity.protectionHints) hints.add(h);
    out.push({
      name: preferred.entity.name,
      normalizedName,
      kind: preferred.entity.kind,
      sourceKind: preferred.file.kind,
      locations: sorted.map((occ) => ({ file: occ.file.path, loc: occ.entity.loc, sourceKind: occ.file.kind })),
      fields: [...fields.values()],
      protectionHints: [...hints],
    });
  }
  return out.sort((a, b) => (a.normalizedName < b.normalizedName ? -1 : a.normalizedName > b.normalizedName ? 1 : 0));
}

// ---------------------------------------------------------------------------------------------
// Scan model: classified entities, sources, sinks, reaches and transfers

export type ClassifiedField = MergedField & { candidates: Candidate[]; top: Candidate | null; ambiguous: boolean };

export type ClassifiedEntity = Omit<MergedEntity, "fields"> & { fields: ClassifiedField[] };

export type FileSink = SinkCall & { file: string };
export type FileReach = Reach & { file: string; sink: FileSink };

export type ScanModel = {
  files: readonly SourceFile[];
  entities: readonly ClassifiedEntity[];
  sinks: readonly FileSink[];
  reaches: readonly FileReach[];
  transfers: ReadonlyMap<SinkCall, TransferAssessment[]>;
  valueHits: readonly { file: string; hits: ValueHit[] }[];
  warnings: readonly ScanWarning[];
  maskedLines: ReadonlyMap<string, readonly string[]>;
  regime: RegimeOption;
  minConfidence: number;
  catalog: Catalog;
  config: ProjectConfig;
};

export type ScanModelInput = {
  /** source files whose texts were already re-sliced from the masked text (`applyMaskedText`) */
  files: readonly SourceFile[];
  valueHits: readonly { file: string; hits: ValueHit[] }[];
  maskedTexts: ReadonlyMap<string, string>;
  catalog: Catalog;
  config: ProjectConfig;
  regime: RegimeOption;
  minConfidence: number;
};

export function selectedRegimes(regime: RegimeOption): Regime[] {
  return regime === "both" ? ["lgpd", "gdpr"] : [regime];
}

function bestPerCategory(list: readonly SourceCategory[]): SourceCategory[] {
  const best = new Map<string, SourceCategory>();
  for (const c of list) {
    const prev = best.get(c.category);
    if (!prev || c.confidence > prev.confidence) best.set(c.category, c);
  }
  return [...best.values()];
}

/**
 * The `SourceIndex` of spec 5.4, from deterministic classifications only: `byName` from the term
 * hits of a name (strongest hit per category); `byType` from the merged entity of that normalized
 * name, whose `all` lists the categories of candidates at or above `minConfidence` (empty: the bare
 * identifier is no source) and whose `field(last)` gives the candidates of the matching entity
 * field at any confidence, so member-chain precedence holds for a field below the threshold too
 * (`clinic.name` stays at the entity's 0.30, never the bare term's 0.60).
 */
export function buildSourceIndex(entities: readonly ClassifiedEntity[], termIndex: TermIndex, minConfidence: number): SourceIndex {
  const byNormalized = new Map<string, ClassifiedEntity>();
  for (const e of entities) if (!byNormalized.has(e.normalizedName)) byNormalized.set(e.normalizedName, e);
  const nameCache = new Map<string, SourceCategory[]>();
  const typeCache = new Map<string, TypedSource | null>();
  const fromField = (e: ClassifiedEntity, f: ClassifiedField, cands: readonly Candidate[]): SourceCategory[] =>
    cands.map((c) => ({ category: c.category, confidence: c.confidence, entity: e.name, field: f.name, evidence: "field-name" }));
  return {
    byName(last) {
      let hit = nameCache.get(last);
      if (!hit) {
        const strongest = new Map<string, number>();
        for (const h of matchTerms(last, termIndex)) if (!strongest.has(h.category) || h.weight > strongest.get(h.category)!) strongest.set(h.category, h.weight);
        hit = [...strongest].map(([category, confidence]) => ({ category, confidence, entity: null, field: null, evidence: "field-name" as const }));
        nameCache.set(last, hit);
      }
      return hit;
    },
    byType(typeName) {
      const key = normalizeEntityName(typeName);
      if (typeCache.has(key)) return typeCache.get(key)!;
      const e = byNormalized.get(key);
      let typed: TypedSource | null = null;
      if (e) {
        typed = {
          entity: e.name,
          field(last) {
            const joined = normalizeName(last).joined;
            const f = e.fields.find((x) => x.normalizedName === joined);
            return f ? fromField(e, f, f.candidates) : [];
          },
          all: bestPerCategory(e.fields.flatMap((f) => fromField(e, f, f.candidates.filter((c) => c.confidence >= minConfidence)))),
        };
      }
      typeCache.set(key, typed);
      return typed;
    },
  };
}

/**
 * One scan's model (Task 23): merge entities, classify every field, build the source index, match
 * sinks, compute reaches and assess transfers for `http` and `analytics` sinks per selected regime.
 */
export function buildScanModel(input: ScanModelInput): ScanModel {
  const { catalog, regime, minConfidence } = input;
  const hitsByFile = new Map(input.valueHits.map((v) => [v.file, v.hits]));
  const entities: ClassifiedEntity[] = mergeEntities(input.files).map((e) => {
    const fieldNames = e.fields.map((f) => f.name);
    return {
      ...e,
      fields: e.fields.map((f) => {
        const file = f.locations[0]?.file ?? "";
        const candidates = classifyField(f.field, { name: e.name, normalizedName: e.normalizedName, fieldNames }, {
          termIndex: catalog.termIndex,
          categoryById: catalog.categoryById,
          regime,
          file,
          valueHits: hitsByFile.get(file) ?? [],
        });
        return { ...f, candidates, top: candidates[0] ?? null, ambiguous: isAmbiguous(f.field, candidates) };
      }),
    };
  });

  const sources = buildSourceIndex(entities, catalog.termIndex, minConfidence);
  const vendorIndex = buildVendorIndex(catalog.vendors);
  const sinks: FileSink[] = [];
  const reaches: FileReach[] = [];
  const transfers = new Map<SinkCall, TransferAssessment[]>();
  const regimes = selectedRegimes(regime);
  for (const file of input.files) {
    const moduleBindings = file.functions.find((fn) => fn.name === "<module>")?.bindings ?? [];
    for (const fn of file.functions) {
      for (const call of matchSinks(fn, catalog, vendorIndex)) {
        const sink: FileSink = { ...call, file: file.path };
        sinks.push(sink);
        for (const r of reach(fn, sink, sources, moduleBindings)) reaches.push({ ...r, sink, file: file.path });
        const assess = (sink.kind === "http" && !sink.firstParty && !sink.unresolved) || (sink.kind === "analytics" && sink.vendor !== null);
        if (assess) {
          transfers.set(
            sink,
            regimes.map((r) => assessTransfer({ vendor: sink.vendor, host: sink.host, regime: r, adequacy: catalog.adequacy, configVendors: input.config.vendors })),
          );
        }
      }
    }
  }

  const maskedLines = new Map<string, readonly string[]>();
  for (const [file, text] of input.maskedTexts) maskedLines.set(file, text.split("\n"));
  return {
    files: input.files,
    entities,
    sinks,
    reaches,
    transfers,
    valueHits: input.valueHits,
    warnings: input.files.flatMap((f) => f.warnings),
    maskedLines,
    regime,
    minConfidence,
    catalog,
    config: input.config,
  };
}
