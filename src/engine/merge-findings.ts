import type { Catalog } from "../catalog/load.ts";
import type { RegimeOption } from "../contracts/catalog.ts";
import type { Finding } from "../contracts/findings.ts";
import { LIMITS } from "../contracts/limits.ts";
import type { AmbiguousField, LlmLabel } from "../contracts/llm.ts";
import { collapseWs, evidenceMatches } from "../shared/text.ts";
import { resolveArticles } from "./articles.ts";
import { sensitivityFor } from "./classify-field.ts";
import { levelOf, round2 } from "./confidence.ts";
import { compareFindings } from "./finalize.ts";
import { fingerprint, normalizeLine } from "./fingerprint.ts";
import { ambiguousMessage } from "./messages.ts";

export type MergeContext = {
  catalog: Pick<Catalog, "categoryById" | "ruleById" | "articles">;
  regime: RegimeOption;
  maskedLines: ReadonlyMap<string, readonly string[]>;
  minConfidence: number;
};

/** Spec 5.5: a label adds a finding only at or above this confidence. */
const LABEL_MIN_CONFIDENCE = 0.5;
/** Spec 5.6: an LLM finding is never `high`. */
const LLM_CONFIDENCE_CAP = 0.79;
/** Spec 4.4: evidence verified against the field's own declaration or comment, at least 3 characters. */
const EVIDENCE_MIN_CHARS = 3;

const keyOf = (entity: string, field: string) => `${entity}\u0000${field}`;

/**
 * The only place LLM output meets findings (spec 4.4, LLM-04): the deterministic findings are
 * returned as the same objects, never changed; one `PR-AMBIGUOUS` note is appended per label whose
 * field the engine marked ambiguous, whose label is a personal category with confidence at least
 * 0.5 and whose evidence is in the field's own declaration or comment. Its articles are the fixed
 * `*` keys of the rule (LLM-12). The combined list is sorted with `compareFindings`.
 */
export function mergeFindings(deterministic: readonly Finding[], labels: readonly LlmLabel[], ambiguous: readonly AmbiguousField[], ctx: MergeContext): Finding[] {
  const byField = new Map(ambiguous.map((a) => [keyOf(a.entity, a.field), a]));
  const added: Finding[] = [];
  const seen = new Map<string, number>();
  const done = new Set<string>();
  for (const label of labels) {
    const key = keyOf(label.entity, label.field);
    const field = byField.get(key);
    if (!field || done.has(key)) continue;
    const category = ctx.catalog.categoryById.get(label.label);
    if (!category) continue;
    const sensitivity = sensitivityFor(category, ctx.regime);
    if (sensitivity === "not-personal" || label.confidence < LABEL_MIN_CONFIDENCE) continue;
    const own = `${field.input.field.declarationText} ${field.input.comment ?? ""}`;
    if (!evidenceMatches(label.evidence, own, EVIDENCE_MIN_CHARS)) continue;
    done.add(key);

    const categories = [label.label];
    const confidence = round2(Math.min(label.confidence, LLM_CONFIDENCE_CAP));
    const articles = resolveArticles({ ruleId: "PR-AMBIGUOUS", categories, transfer: [], regime: ctx.regime, catalog: ctx.catalog });
    const maskedLine = ctx.maskedLines.get(field.file)?.[field.line - 1] ?? field.input.field.declarationText;
    const fpKey = ["PR-AMBIGUOUS", categories.join(","), field.file, normalizeLine(maskedLine)].join("\u0000");
    const occurrence = seen.get(fpKey) ?? 0;
    seen.set(fpKey, occurrence + 1);
    const fp = fingerprint({ ruleId: "PR-AMBIGUOUS", categories, file: field.file, maskedLine, occurrence });
    added.push({
      id: `PRF-${fp.slice(0, 12)}`,
      fingerprint: fp,
      ruleId: "PR-AMBIGUOUS",
      origin: "llm",
      categories,
      sensitivity,
      severity: "note",
      confidence,
      confidenceLevel: levelOf(confidence),
      location: { file: field.file, line: field.line, column: field.column, snippet: collapseWs(maskedLine).slice(0, LIMITS.snippetChars) },
      entity: { name: field.entity, field: field.field, kind: field.entityKind },
      evidence: [{ kind: "llm-label", detail: `${label.label} (${label.confidence.toFixed(2)})`, weight: 0 }],
      articles,
      message: ambiguousMessage({ entity: field.entity, field: field.field, label: label.label, confidence, articles, regime: ctx.regime }),
      belowThreshold: confidence < ctx.minConfidence,
    });
  }
  return [...deterministic, ...added].sort(compareFindings);
}
