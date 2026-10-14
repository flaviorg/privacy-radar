import { sensitivityFor, highestSensitivity, type Candidate } from "../engine/classify-field.ts";
import { levelOf } from "../engine/confidence.ts";
import type { Finding } from "../contracts/findings.ts";
import type { FieldStatus, Inventory, InventoryEntity, InventoryField } from "../contracts/inventory.ts";
import type { LlmLabel } from "../contracts/llm.ts";
import type { Sensitivity } from "../contracts/catalog.ts";
import type { ClassifiedEntity, ClassifiedField, ScanModel } from "../engine/model.ts";
import { retentionSignalOf } from "../engine/rules/missing-retention.ts";
import { DISCLAIMER_EN } from "./disclaimer.ts";
import { codeSpan, escapeMd, tableCell } from "./markdown.ts";

/** What the inventory reads of an accepted label (advisory; keyed by entity and field name). */
export type InventoryLabel = Pick<LlmLabel, "entity" | "field" | "label" | "confidence" | "scripted" | "rationale">;

const CHILDREN_TAG = "children-indicator";

const byOrder = <T>(key: (x: T) => string | number) => (a: T, b: T) => {
  const [x, y] = [key(a), key(b)];
  return x < y ? -1 : x > y ? 1 : 0;
};

function categoryOf(model: ScanModel, id: string) {
  return model.catalog.categoryById.get(id);
}

function sensitivityOf(model: ScanModel, c: Candidate): Sensitivity {
  const cat = categoryOf(model, c.category);
  return cat ? sensitivityFor(cat, model.regime) : c.sensitivity;
}

function statusOf(model: ScanModel, f: ClassifiedField): FieldStatus {
  if (f.ambiguous) return "ambiguous";
  const top = f.top;
  if (!top) return "unclassified";
  if (sensitivityOf(model, top) === "not-personal") return "not-personal";
  return top.confidence < model.minConfidence ? "below-threshold" : "personal";
}

function isChildrenIndicator(model: ScanModel, f: ClassifiedField): boolean {
  const cat = f.top ? categoryOf(model, f.top.category) : undefined;
  return cat !== undefined && (cat.group === "children" || (cat.tags ?? []).includes(CHILDREN_TAG));
}

/**
 * The inventory of one scan (spec 5.1): entities × fields × categories × sinks × vendors. Counts and
 * flags come from deterministic candidates only; an LLM label sits in its own `llmLabel` key and never
 * changes `categories`, `status` or a count.
 */
export function buildInventory(model: ScanModel, _findings: readonly Finding[], labels: readonly InventoryLabel[]): Inventory {
  const labelOf = new Map(labels.map((l) => [`${l.entity}\u0000${l.field}`, l]));
  const counts = { entities: 0, fields: 0, personal: 0, sensitive: 0, childrenIndicators: 0, notPersonal: 0, belowThreshold: 0, ambiguous: 0, unclassified: 0, valuesMasked: 0 };

  const entities: InventoryEntity[] = model.entities.map((e: ClassifiedEntity) => {
    let hasSensitive = false;
    let hasChildrenIndicator = false;
    const fields: InventoryField[] = e.fields.map((f) => {
      const status = statusOf(model, f);
      const sens = highestSensitivity(f.candidates.map((c) => sensitivityOf(model, c)));
      const top = f.top;
      const sinks = model.reaches
        .filter((r) => r.source.entity === e.name && r.source.field === f.name)
        .map((r) => ({ kind: r.sink.kind, callee: r.sink.callee, ...(r.sink.vendor ? { vendor: r.sink.vendor.vendor } : {}), file: r.file, line: r.sink.loc.line }))
        .sort((a, b) => byOrder((x: typeof a) => `${x.file}\u0000${String(x.line).padStart(8, "0")}\u0000${x.callee}`)(a, b))
        .filter((s, i, all) => i === 0 || JSON.stringify(s) !== JSON.stringify(all[i - 1]));
      counts.fields++;
      if (status === "personal") {
        counts.personal++;
        if (sens === "sensitive") counts.sensitive++;
        if (isChildrenIndicator(model, f)) counts.childrenIndicators++;
        if (sens === "sensitive") hasSensitive = true;
        if (isChildrenIndicator(model, f)) hasChildrenIndicator = true;
      } else if (status === "not-personal") counts.notPersonal++;
      else if (status === "below-threshold") counts.belowThreshold++;
      else if (status === "ambiguous") counts.ambiguous++;
      else counts.unclassified++;
      const label = labelOf.get(`${e.name}\u0000${f.name}`);
      const field: InventoryField = {
        name: f.name,
        locations: f.locations.map((l) => ({ file: l.file, line: l.loc.line, column: l.loc.column, sourceKind: l.sourceKind })),
        categories: f.candidates.map((c) => c.category),
        sensitivity: sens,
        confidence: top?.confidence ?? 0,
        level: levelOf(top?.confidence ?? 0),
        status,
        sinks,
      };
      if (label) field.llmLabel = { label: label.label, confidence: label.confidence, scripted: label.scripted, rationale: label.rationale };
      return field;
    });
    counts.entities++;
    return {
      name: e.name,
      kind: e.kind,
      locations: e.locations.map((l) => ({ file: l.file, line: l.loc.line, column: l.loc.column, sourceKind: l.sourceKind })),
      flags: { hasSensitive, hasChildrenIndicator, retentionSignal: retentionSignalOf(e, model.config.retention ?? {}), protectionHints: [...e.protectionHints] },
      fields,
    };
  });

  const hostMap = new Map<string, { host: string; vendor: string | null; hqCountry: string | null }>();
  for (const s of model.sinks) {
    if ((s.kind !== "http" && s.kind !== "analytics") || s.host === null || s.firstParty) continue;
    if (!hostMap.has(s.host)) hostMap.set(s.host, { host: s.host, vendor: s.vendor?.vendor ?? null, hqCountry: s.vendor?.hqCountry ?? null });
  }
  const hosts = [...hostMap.values()].sort(byOrder((h) => h.host));

  const valueHits = model.valueHits
    .flatMap(({ file, hits }) => hits.filter((h) => h.categories.length > 0).map((h) => ({ file, line: h.line, column: h.column, categories: [...h.categories], checksum: h.checksum, masked: h.masked })))
    .sort((a, b) => byOrder((x: typeof a) => x.file)(a, b) || a.line - b.line || a.column - b.column)
    .map(({ file, line, categories, checksum, masked }) => ({ file, line, categories, checksum, masked }));
  counts.valuesMasked = valueHits.length;

  return { schemaVersion: 1, entities, hosts, valueHits, counts };
}

const pct = (n: number) => n.toFixed(2);
const loc = (l: { file: string; line: number }) => codeSpan(`${l.file}:${l.line}`);

/**
 * `inventory.md`: one table per entity (field, categories, sensitivity, confidence, sinks reached,
 * locations, advisory LLM label) with the entity flags above it. Every derived string goes through
 * `codeSpan` or `escapeMd`; an LLM rationale is never written.
 */
export function renderInventoryMd(inv: Inventory): string {
  const out: string[] = ["# Personal-data inventory", "", `> ${DISCLAIMER_EN}`, ""];
  const c = inv.counts;
  out.push(
    `${c.entities} entities, ${c.fields} fields: ${c.personal} personal (${c.sensitive} sensitive, ${c.childrenIndicators} children indicators), ${c.notPersonal} not personal, ` +
      `${c.belowThreshold} below threshold, ${c.ambiguous} ambiguous, ${c.unclassified} unclassified; ${c.valuesMasked} values masked.`,
    "",
  );
  for (const e of inv.entities) {
    out.push(`## ${codeSpan(e.name)} (${escapeMd(e.kind)})`, "");
    out.push(`Locations: ${e.locations.map(loc).join(", ")}`, "");
    out.push(
      `- Has sensitive data: ${e.flags.hasSensitive ? "yes" : "no"}`,
      `- Has children indicator: ${e.flags.hasChildrenIndicator ? "yes" : "no"}`,
      `- Retention signal: ${e.flags.retentionSignal === null ? "none" : codeSpan(e.flags.retentionSignal)}`,
      `- Protection hints: ${e.flags.protectionHints.length === 0 ? "none" : e.flags.protectionHints.map((h) => codeSpan(h)).join(", ")}`,
      "",
    );
    out.push("| Field | Categories | Sensitivity | Confidence | Sinks reached | Locations | LLM label (advisory) |", "|---|---|---|---|---|---|---|");
    for (const f of e.fields) {
      const cats = f.categories.length === 0 ? "none" : f.categories.map((x) => codeSpan(x)).join(", ");
      const sinks = f.sinks.length === 0 ? "none" : f.sinks.map((s) => `${codeSpan(s.callee)} ${loc(s)}${s.vendor ? ` (${escapeMd(s.vendor)})` : ""}`).join("; ");
      const label = f.llmLabel ? `${codeSpan(f.llmLabel.label)} (${pct(f.llmLabel.confidence)}${f.llmLabel.scripted ? ", scripted" : ""})` : "none";
      const row = [codeSpan(f.name), cats, `${escapeMd(f.sensitivity)} (${escapeMd(f.status)})`, `${pct(f.confidence)} ${escapeMd(f.level)}`, sinks, f.locations.map(loc).join(", "), label];
      out.push(`| ${row.map(tableCell).join(" | ")} |`);
    }
    out.push("");
  }
  out.push("## Hosts", "");
  if (inv.hosts.length === 0) out.push("No third-party host found.", "");
  else {
    out.push("| Host | Vendor | HQ |", "|---|---|---|");
    for (const h of inv.hosts) out.push(`| ${tableCell(codeSpan(h.host))} | ${h.vendor === null ? "unknown" : tableCell(escapeMd(h.vendor))} | ${h.hqCountry === null ? "unknown" : escapeMd(h.hqCountry)} |`);
    out.push("");
  }
  out.push("## Values found in code (masked)", "");
  if (inv.valueHits.length === 0) out.push("None.", "");
  else {
    out.push("| Location | Categories | Checksum | Masked value |", "|---|---|---|---|");
    for (const h of inv.valueHits) out.push(`| ${tableCell(loc(h))} | ${tableCell(h.categories.map((x) => codeSpan(x)).join(", "))} | ${escapeMd(h.checksum)} | ${tableCell(codeSpan(h.masked))} |`);
    out.push("");
  }
  return `${out.join("\n").trimEnd()}\n`;
}
