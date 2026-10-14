import { normalizeName } from "../catalog/terms.ts";
import { LIMITS } from "../contracts/limits.ts";
import type { AmbiguousField } from "../contracts/llm.ts";
import type { Field } from "../contracts/source-model.ts";
import { sensitivityFor, type Candidate } from "./classify-field.ts";
import type { ClassifiedEntity, ClassifiedField, ScanModel } from "./model.ts";

/** Generic field names (spec 5.6), normalized. */
export const GENERIC_NAMES: readonly string[] = [
  "obs", "observacao", "observacoes", "extra", "extras", "data", "dados", "info", "informacoes", "notes", "note", "meta", "metadata", "payload",
  "details", "detalhes", "comment", "comments", "description", "descricao", "value", "misc", "other", "outros", "custom", "attributes", "properties", "json", "blob",
];
const GENERIC = new Set(GENERIC_NAMES);
const JSON_OR_TEXT = new Set(["json", "jsonb", "text"]);

/** A JSON or text column type (`Json`, `jsonb`, `text`, `@db.Text` is an attribute and does not count). */
function isJsonOrText(type: string | null): boolean {
  return type !== null && JSON_OR_TEXT.has(type.toLowerCase());
}

/**
 * ENG-01: no term hit (no candidate backed by a field name), and either a generic name or a
 * JSON/`jsonb`/`Json`/`text` type with a generic name token.
 */
export function isAmbiguous(field: Field, candidates: readonly Candidate[]): boolean {
  if (candidates.some((c) => c.evidence.some((e) => e.kind === "field-name"))) return false;
  const { tokens, joined } = normalizeName(field.name);
  if (GENERIC.has(joined)) return true;
  return isJsonOrText(field.type) && tokens.some((t) => GENERIC.has(t));
}

export type AmbiguousCandidate = { entity: string; field: string; file: string; line: number; sensitiveEntity: boolean };

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Fields sent to the labeler: sensitive entities first, then file, then line; at most `min(cap, LIMITS.maxLlmFieldsHard)`. */
export function selectAmbiguous<T extends AmbiguousCandidate>(fields: readonly T[], cap: number): T[] {
  const limit = Math.max(0, Math.min(cap, LIMITS.maxLlmFieldsHard));
  return [...fields]
    .sort((a, b) => Number(b.sensitiveEntity) - Number(a.sensitiveEntity) || cmp(a.file, b.file) || a.line - b.line || cmp(a.field, b.field))
    .slice(0, limit);
}

/** A field has sensitive data when its top candidate is sensitive under the regime and at or above the threshold. */
function hasSensitiveField(model: ScanModel, e: ClassifiedEntity): boolean {
  return e.fields.some((f) => {
    const top = f.top;
    const cat = top ? model.catalog.categoryById.get(top.category) : undefined;
    return top !== null && cat !== undefined && !f.ambiguous && top.confidence >= model.minConfidence && sensitivityFor(cat, model.regime) === "sensitive";
  });
}

/** Up to three masked literals bound to the field's name in the files that declare it (same-line slices of the masked text). */
function maskedSamplesOf(model: ScanModel, f: ClassifiedField): string[] {
  const out: string[] = [];
  const files = new Set(f.locations.map((l) => l.file));
  for (const file of model.files) {
    if (!files.has(file.path)) continue;
    const lines = model.maskedLines.get(file.path) ?? [];
    for (const b of file.literalBindings) {
      if (out.length >= LIMITS.llmSamples) return out;
      if (b.bindingName === "*" || normalizeName(b.bindingName).joined !== f.normalizedName) continue;
      const line = lines[b.line - 1] ?? "";
      const text = line.slice(b.column - 1, b.column - 1 + (b.end - b.start)).replace(/^['"`]|['"`]$/g, "");
      const sample = text.slice(0, LIMITS.llmSampleChars);
      if (sample !== "" && !out.includes(sample)) out.push(sample);
    }
  }
  return out;
}

/**
 * Every field the engine marked ambiguous, with the masked, capped input of `label-field.v1`; the
 * preferred location (prisma, then sql, then ts) is the field's location. Selection and the cap
 * are `selectAmbiguous`.
 */
export function ambiguousFields(model: ScanModel): AmbiguousField[] {
  const out: AmbiguousField[] = [];
  for (const e of model.entities) {
    const sensitiveEntity = hasSensitiveField(model, e);
    for (const f of e.fields) {
      if (!f.ambiguous) continue;
      const loc = f.locations[0];
      if (!loc) continue;
      out.push({
        entity: e.name,
        field: f.name,
        entityKind: e.kind,
        file: loc.file,
        line: loc.loc.line,
        column: loc.loc.column,
        sensitiveEntity,
        input: {
          field: {
            name: f.name,
            rawType: f.field.rawType,
            optional: f.field.optional,
            array: f.field.array,
            entity: e.name,
            declarationText: f.field.declarationText.slice(0, LIMITS.declarationChars),
            entityFields: e.fields.map((x) => x.name).slice(0, LIMITS.llmEntityFields),
            sourceKind: loc.sourceKind,
            file: loc.file,
            line: loc.loc.line,
          },
          candidateCategories: f.candidates.map((c) => c.category),
          maskedSamples: maskedSamplesOf(model, f),
          comment: f.field.comment === null ? null : f.field.comment.slice(0, LIMITS.llmCommentChars),
        },
      });
    }
  }
  return out;
}
