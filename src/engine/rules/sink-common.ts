import type { RuleId, SinkKind } from "../../contracts/catalog.ts";
import type { Evidence } from "../../contracts/findings.ts";
import { LIMITS } from "../../contracts/limits.ts";
import { collapseWs } from "../../shared/text.ts";
import { resolveArticles } from "../articles.ts";
import { highestSensitivity, sensitivityFor } from "../classify-field.ts";
import { findingConfidence, levelOf } from "../confidence.ts";
import { sinkMessage, transferMessage } from "../messages.ts";
import type { FileReach, FileSink, ScanModel } from "../model.ts";
import { classOf, sinkSeverity, transferSeverity } from "../severity.ts";
import { worstStatus, type TransferAssessment } from "../transfer.ts";
import type { RawFinding } from "./index.ts";

/** The masked line of a location, whitespace collapsed, at most `LIMITS.snippetChars`. */
export function snippetOf(model: ScanModel, file: string, line: number): string {
  return collapseWs(model.maskedLines.get(file)?.[line - 1] ?? "").slice(0, LIMITS.snippetChars);
}

type Reached = { categories: string[]; reaches: FileReach[]; strongest: FileReach };

/** Personal categories reaching one sink (not-personal dropped), sorted and unique; null when none. */
export function reachedCategories(model: ScanModel, sink: FileSink): Reached | null {
  const personal = (id: string) => {
    const cat = model.catalog.categoryById.get(id);
    return cat !== undefined && sensitivityFor(cat, model.regime) !== "not-personal";
  };
  const reaches = model.reaches.filter((r) => r.sink === sink && personal(r.source.category));
  if (reaches.length === 0) return null;
  const categories = [...new Set(reaches.map((r) => r.source.category))].sort();
  const strongest = reaches.reduce((best, r) => (r.source.confidence > best.source.confidence ? r : best), reaches[0]!);
  return { categories, reaches, strongest };
}

const SOURCE_EVIDENCE: Readonly<Record<FileReach["source"]["evidence"], Evidence["kind"]>> = {
  "field-name": "field-name",
  "type-hint": "type-hint",
  spread: "type-hint",
  key: "field-name",
};

function evidenceOf(sink: FileSink, reaches: readonly FileReach[]): Evidence[] {
  const out: Evidence[] = [{ kind: "sink", detail: `${sink.kind} sink ${sink.callee} at line ${sink.loc.line}`, weight: 0 }];
  if (sink.kind === "http" || sink.kind === "analytics") {
    const detail = sink.vendor ? `${sink.vendor.vendor} (${sink.vendor.hqCountry})` : sink.host !== null ? `${sink.host} (unknown destination)` : "unresolved host";
    out.push({ kind: "vendor", detail, weight: 0 });
  }
  for (const r of reaches) {
    const via = r.hop ? ` through ${r.hop.via}` : "";
    const how = r.source.evidence === "spread" ? "spread of " : r.source.evidence === "key" ? "object key " : "";
    out.push({ kind: SOURCE_EVIDENCE[r.source.evidence], detail: `${r.source.category} from ${how}${r.source.expressionText} at line ${r.source.loc.line}${via}`, weight: r.source.confidence });
  }
  return out;
}

function sinkBlock(sink: FileSink, strongest: FileReach): NonNullable<RawFinding["sink"]> {
  const block: NonNullable<RawFinding["sink"]> = { kind: sink.kind, callee: sink.callee };
  if (sink.host !== null) block.host = sink.host;
  if (sink.vendor) {
    block.vendor = sink.vendor.vendor;
    block.hqCountry = sink.vendor.hqCountry;
  }
  if (sink.kind === "http") block.firstParty = sink.firstParty;
  if (strongest.hop) block.hop = { via: strongest.hop.via, line: strongest.hop.loc.line };
  return block;
}

const transferEntries = (list: readonly TransferAssessment[]) => list.map((t) => ({ regime: t.regime, status: t.status, mechanism: t.mechanism, text: t.text }));

/** Maximum source confidence per category, then the finding confidence of the sink family (ENG-11). */
function sinkConfidence(reaches: readonly FileReach[]): number {
  return findingConfidence({ family: "sink", contributions: reaches.map((r) => r.source.confidence) });
}

/** One finding per sink call of `kinds` that `accept` keeps (spec 5.5 sink rules). */
export function sinkRule(ruleId: RuleId, kinds: readonly SinkKind[], model: ScanModel, accept: (sink: FileSink) => boolean = () => true): RawFinding[] {
  const out: RawFinding[] = [];
  for (const sink of model.sinks) {
    if (!kinds.includes(sink.kind) || !accept(sink)) continue;
    const reached = reachedCategories(model, sink);
    if (!reached) continue;
    const transfer = model.transfers.get(sink) ?? [];
    const articles = resolveArticles({ ruleId, categories: reached.categories, transfer, regime: model.regime, catalog: model.catalog });
    const cls = classOf(reached.categories, model.catalog.categoryById, model.regime);
    const confidence = sinkConfidence(reached.reaches);
    const finding: RawFinding = {
      ruleId,
      origin: "deterministic",
      categories: reached.categories,
      sensitivity: highestSensitivity(reached.categories.map((id) => sensitivityFor(model.catalog.categoryById.get(id)!, model.regime))),
      severity: sinkSeverity(sink.kind, cls, worstStatus(transfer.map((t) => t.status)), sink.unresolved),
      confidence,
      confidenceLevel: levelOf(confidence),
      location: { file: sink.file, line: sink.loc.line, column: sink.loc.column, snippet: snippetOf(model, sink.file, sink.loc.line) },
      sink: sinkBlock(sink, reached.strongest),
      evidence: evidenceOf(sink, reached.reaches),
      articles,
      message: sinkMessage({ categories: reached.categories, sink, hop: reached.strongest.hop, transfer, articles, regime: model.regime }),
    };
    if (transfer.length > 0) finding.transfer = transferEntries(transfer);
    out.push(finding);
  }
  return out;
}

/** `PR-TRANSFER`: http/analytics sinks with a known vendor and `needs-mechanism` or `conditional` under a selected regime (ENG-10). */
export function transferRule(model: ScanModel): RawFinding[] {
  const out: RawFinding[] = [];
  for (const sink of model.sinks) {
    if ((sink.kind !== "http" && sink.kind !== "analytics") || sink.vendor === null) continue;
    const transfer = model.transfers.get(sink) ?? [];
    if (!transfer.some((t) => t.status === "needs-mechanism" || t.status === "conditional")) continue;
    const reached = reachedCategories(model, sink);
    if (!reached) continue;
    const articles = resolveArticles({ ruleId: "PR-TRANSFER", categories: reached.categories, transfer, regime: model.regime, catalog: model.catalog });
    const cls = classOf(reached.categories, model.catalog.categoryById, model.regime);
    const confidence = sinkConfidence(reached.reaches);
    out.push({
      ruleId: "PR-TRANSFER",
      origin: "deterministic",
      categories: reached.categories,
      sensitivity: highestSensitivity(reached.categories.map((id) => sensitivityFor(model.catalog.categoryById.get(id)!, model.regime))),
      severity: transferSeverity(cls),
      confidence,
      confidenceLevel: levelOf(confidence),
      location: { file: sink.file, line: sink.loc.line, column: sink.loc.column, snippet: snippetOf(model, sink.file, sink.loc.line) },
      sink: sinkBlock(sink, reached.strongest),
      transfer: transferEntries(transfer),
      evidence: evidenceOf(sink, reached.reaches),
      articles,
      message: transferMessage({ categories: reached.categories, sink, transfer, checkedOn: model.catalog.adequacy.checkedOn, articles, regime: model.regime }),
    });
  }
  return out;
}
