import { LIMITS } from "../../contracts/limits.ts";
import type { Sensitivity } from "../../contracts/catalog.ts";
import { sensitivityFor, type Candidate } from "../classify-field.ts";
import type { ClassifiedEntity, ClassifiedField, ScanModel } from "../model.ts";
import { snippetOf } from "./sink-common.ts";
import type { RawFinding } from "./index.ts";

/** Entity rules read storage entities only (spec 5.5): tables and models. */
export function storageEntities(model: ScanModel): ClassifiedEntity[] {
  return model.entities.filter((e) => e.kind === "table" || e.kind === "model");
}

/** Deterministic candidates of a field at or above the threshold, with their sensitivity under the regime. */
export function strongCandidates(model: ScanModel, field: ClassifiedField): (Candidate & { regimeSensitivity: Sensitivity })[] {
  return field.candidates
    .filter((c) => c.confidence >= model.minConfidence && model.catalog.categoryById.has(c.category))
    .map((c) => ({ ...c, regimeSensitivity: sensitivityFor(model.catalog.categoryById.get(c.category)!, model.regime) }));
}

/** The preferred (earliest source kind) location of a field or an entity, with its masked line. */
export function locationOf(model: ScanModel, loc: { file: string; loc: { line: number; column: number } } | undefined): RawFinding["location"] {
  const file = loc?.file ?? "";
  const line = loc?.loc.line ?? 1;
  return { file, line, column: loc?.loc.column ?? 1, snippet: snippetOf(model, file, line).slice(0, LIMITS.snippetChars) };
}
