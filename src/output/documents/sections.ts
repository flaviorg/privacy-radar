import type { Catalog } from "../../catalog/load.ts";
import { RULE_IDS, articleKey, type ArticleRef, type RegimeOption, type RuleId } from "../../contracts/catalog.ts";
import type { ProjectConfig } from "../../contracts/config.ts";
import type { DocId, Finding, Locale } from "../../contracts/findings.ts";
import type { Inventory, InventoryEntity, InventoryField } from "../../contracts/inventory.ts";
import type { DraftNarrativeInput } from "../../contracts/llm.ts";
import { compressKeys } from "../../engine/messages.ts";
import { codeSpan, escapeMd, tableCell } from "../markdown.ts";
import { TEXTS } from "./templates.ts";

// The deterministic content of the four documents (spec 5.9, DOC-02 to DOC-04, DOC-09). Every table,
// list, criterion and indicator is computed from `DocumentFacts`; LLM labels reach only the
// `llmLabeledFields` sub-table. Every repository-derived string goes through `codeSpan` or `escapeMd`. Pure.

export type LlmLabeledField = { entity: string; field: string; label: string; confidence: number };

export type DocumentFacts = {
  target: string;
  regime: RegimeOption;
  controller: ProjectConfig["controller"] | null;
  purposes: Readonly<Record<string, string>>;
  legalBases: NonNullable<ProjectConfig["legalBases"]>;
  retention: Readonly<Record<string, string>>;
  entities: Inventory["entities"];
  /** origin deterministic, not below the threshold, not suppressed, in output order */
  deterministicFindings: Finding[];
  hosts: Inventory["hosts"];
  adequacyCheckedOn: string;
  /** vendors reached by a deterministic sink finding whose catalog category is `llm` */
  llmVendors: string[];
  llmLabeledFields: LlmLabeledField[];
};

/** The only input of every document table (DOC-09). */
export function buildDocumentFacts(result: { target: { path: string }; regime: RegimeOption; findings: readonly Finding[] }, inventory: Inventory, config: ProjectConfig, catalog: Catalog): DocumentFacts {
  const deterministicFindings = result.findings.filter((f) => f.origin === "deterministic" && !f.belowThreshold && !f.suppressed);
  const vendorCategory = new Map(catalog.vendors.map((v) => [v.vendor, v.category]));
  const llmVendors = [...new Set(deterministicFindings.map((f) => f.sink?.vendor).filter((v): v is string => v !== undefined && vendorCategory.get(v) === "llm"))].sort();
  const llmLabeledFields: LlmLabeledField[] = inventory.entities.flatMap((e) =>
    e.fields.filter((f) => f.llmLabel !== undefined).map((f) => ({ entity: e.name, field: f.name, label: f.llmLabel!.label, confidence: f.llmLabel!.confidence })),
  );
  return {
    target: result.target.path,
    regime: result.regime,
    controller: config.controller ?? null,
    purposes: config.purposes ?? {},
    legalBases: config.legalBases ?? {},
    retention: config.retention ?? {},
    entities: inventory.entities,
    deterministicFindings,
    hosts: inventory.hosts,
    adequacyCheckedOn: catalog.adequacy.checkedOn,
    llmVendors,
    llmLabeledFields,
  };
}

// ---------------------------------------------------------------------------------------------
// Criteria and indicators

/** The nine criteria of WP248 rev.01 (Spec delta 5); third-party sharing is not one of them. */
export const WP248_CRITERIA: readonly string[] = [
  "evaluation-scoring",
  "automated-decision",
  "systematic-monitoring",
  "sensitive-data",
  "large-scale",
  "matching-datasets",
  "vulnerable-subjects",
  "innovative-technology",
  "prevents-rights",
];

const SHARING_STATUSES = new Set(["needs-mechanism", "conditional", "unknown-destination"]);
const PATIENT_ENTITY = /^(?:patient|paciente|pacient)e?s?$/i;

const personalFields = (e: InventoryEntity) => e.fields.filter((f) => f.status === "personal");
const hasSensitive = (facts: DocumentFacts) => facts.entities.some((e) => e.flags.hasSensitive) || facts.deterministicFindings.some((f) => f.sensitivity === "sensitive");
const hasVulnerable = (facts: DocumentFacts) => facts.entities.some((e) => e.flags.hasChildrenIndicator || PATIENT_ENTITY.test(e.name.replace(/[_-]/g, "")));
const hasSharing = (facts: DocumentFacts) => facts.deterministicFindings.some((f) => (f.transfer ?? []).some((t) => SHARING_STATUSES.has(t.status)));

/** WP248 criteria detectable from code (4, 7, 8) plus the indicators outside the count. */
export function detectWp248(facts: DocumentFacts): { detected: string[]; otherIndicators: string[] } {
  const detected: string[] = [];
  if (hasSensitive(facts)) detected.push("sensitive-data");
  if (hasVulnerable(facts)) detected.push("vulnerable-subjects");
  if (facts.llmVendors.length > 0) detected.push("innovative-technology");
  return { detected, otherIndicators: hasSharing(facts) ? ["third-party-sharing"] : [] };
}

/** The RIPD high-risk indicators (spec 5.9): worded as indicators, never as a conclusion. */
export function detectRipdIndicators(facts: DocumentFacts): string[] {
  const out: string[] = [];
  if (hasSensitive(facts)) out.push("sensitive-data");
  if (hasVulnerable(facts)) out.push("children-or-vulnerable");
  if (hasSharing(facts)) out.push("third-party-sharing");
  if (facts.llmVendors.length > 0) out.push("llm-vendor");
  return out;
}

// ---------------------------------------------------------------------------------------------
// Narrative facts and the articles each narrative section may cite

type SectionArticles = { lgpd: string[]; gdpr: string[] };

/**
 * The deterministic article list each narrative section may cite (spec 5.3, DOC-05). Chosen so that
 * the citations of `article-drift.json` fall outside every list, including through the structural
 * prefix rule (`art. 5` would pass if any `5(...)` key were listed).
 */
export const SECTION_ARTICLES: Readonly<Record<DocId, Readonly<Record<string, SectionArticles>>>> = Object.freeze({
  ropa: {
    purposes: { lgpd: ["6 I", "7"], gdpr: ["6", "30(1)"] },
    "security-measures": { lgpd: ["6 VII", "46"], gdpr: ["5(1)(f)", "32"] },
  },
  dpia: {
    description: { lgpd: ["5 II", "11"], gdpr: ["4(15)", "35(7)"] },
    "necessity-proportionality": { lgpd: ["6 I", "6 III"], gdpr: ["5(1)(c)", "35(7)"] },
    measures: { lgpd: ["46"], gdpr: ["25", "32", "35(7)"] },
  },
  registro: {
    finalidades: { lgpd: ["6 I", "7"], gdpr: [] },
    seguranca: { lgpd: ["6 VII", "46"], gdpr: [] },
  },
  ripd: {
    "medidas-salvaguardas": { lgpd: ["38 parágrafo único", "46"], gdpr: [] },
  },
});

const SINK_RULES = new Set<RuleId>(["PR-LOG", "PR-THIRD-PARTY", "PR-ANALYTICS", "PR-FILE", "PR-URL-QUERY"]);
const SECURITY_RULES = new Set<RuleId>(["PR-LOG", "PR-FILE", "PR-URL-QUERY", "PR-PLAINTEXT-SENSITIVE", "PR-HARDCODED-VALUE"]);
const MEASURE_RULES = RULE_IDS.filter((r) => r !== "PR-AMBIGUOUS" && r !== "PR-PARSE");

const uniqueSorted = (xs: Iterable<string>) => [...new Set(xs)].sort();
const topCategory = (f: InventoryField) => f.categories[0] ?? null;
const severityCount = (findings: readonly Finding[], s: Finding["severity"]) => findings.filter((f) => f.severity === s).length;

/** The `facts` of one `draftNarrative` call (spec 5.3): deterministic data only, no LLM label. */
export function narrativeFacts(facts: DocumentFacts, doc: DocId, section: string): DraftNarrativeInput["facts"] {
  const findings = facts.deterministicFindings;
  const sinks = new Map<string, DraftNarrativeInput["facts"]["sinks"][number]>();
  for (const f of findings) {
    if (!SINK_RULES.has(f.ruleId) || !f.sink) continue;
    const entry = { kind: f.sink.kind, vendor: f.sink.vendor ?? null, hqCountry: f.sink.hqCountry ?? null, categories: [...f.categories] };
    const key = JSON.stringify(entry);
    if (!sinks.has(key)) sinks.set(key, entry);
  }
  const transfers = new Map<string, DraftNarrativeInput["facts"]["transfers"][number]>();
  for (const f of findings) {
    for (const t of f.transfer ?? []) {
      const entry = { vendor: f.sink?.vendor ?? f.sink?.host ?? null, hqCountry: f.sink?.hqCountry ?? null, regime: t.regime, status: t.status };
      const key = JSON.stringify(entry);
      if (!transfers.has(key)) transfers.set(key, entry);
    }
  }
  const allowed = SECTION_ARTICLES[doc][section] ?? { lgpd: [], gdpr: [] };
  return {
    controller: facts.controller?.name ?? null,
    entities: facts.entities.map((e) => ({
      name: e.name,
      categories: uniqueSorted(personalFields(e).map(topCategory).filter((c): c is string => c !== null)),
      sensitiveCount: personalFields(e).filter((f) => f.sensitivity === "sensitive").length,
      retentionSignal: e.flags.retentionSignal,
    })),
    sinks: [...sinks.values()],
    transfers: [...transfers.values()],
    counts: {
      error: severityCount(findings, "error"),
      warning: severityCount(findings, "warning"),
      note: severityCount(findings, "note"),
      entities: facts.entities.length,
      fields: facts.entities.reduce((n, e) => n + e.fields.length, 0),
      vendors: uniqueSorted(findings.map((f) => f.sink?.vendor).filter((v): v is string => v !== undefined)).length,
    },
    allowedArticles: { lgpd: [...allowed.lgpd], gdpr: [...allowed.gdpr] },
  };
}

// ---------------------------------------------------------------------------------------------
// Tables and lists

type Texts = Readonly<Record<string, string>>;

const loc = (file: string, line: number) => codeSpan(`${file}:${line}`);
const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_m, k: string) => values[k] ?? "");

function table(t: Texts, headers: readonly string[], rows: readonly (readonly string[])[]): string {
  if (rows.length === 0) return t["value.none"]!;
  const head = `| ${headers.join(" | ")} |`;
  const rule = `|${headers.map(() => "---").join("|")}|`;
  return [head, rule, ...rows.map((r) => `| ${r.map((c) => tableCell(c)).join(" | ")} |`)].join("\n");
}

const bullets = (t: Texts, items: readonly string[]) => (items.length === 0 ? t["value.none"]! : items.map((i) => `- ${i}`).join("\n"));
const cats = (ids: readonly string[]) => (ids.length === 0 ? "-" : ids.map((c) => codeSpan(c)).join(", "));
const keys = (refs: readonly ArticleRef[]) => compressKeys(refs.map(articleKey));

/** `LGPD 6 VII, 46 · GDPR 5(1)(f), 32` with only the regimes that have keys; `-` when none. */
function bothArticles(f: Finding): string {
  const parts: string[] = [];
  if (f.articles.lgpd.length > 0) parts.push(`LGPD ${keys(f.articles.lgpd)}`);
  if (f.articles.gdpr.length > 0) parts.push(`GDPR ${keys(f.articles.gdpr)}`);
  return parts.length === 0 ? "-" : parts.join(" · ");
}

/** LGPD documents show LGPD keys, GDPR documents GDPR keys. */
function docArticles(doc: DocId, f: Finding): string {
  const refs = doc === "registro" || doc === "ripd" ? f.articles.lgpd : f.articles.gdpr;
  return refs.length === 0 ? "-" : keys(refs);
}

const evidenceCell = (file: string, line: number, ids: readonly string[]) => [loc(file, line), ...ids].join(" · ");

function entityRows(t: Texts, facts: DocumentFacts): string[][] {
  return facts.entities
    .filter((e) => personalFields(e).length > 0)
    .map((e) => {
      const first = e.locations[0]!;
      const ids = facts.deterministicFindings.filter((f) => f.entity?.name === e.name).map((f) => f.id);
      const personal = personalFields(e);
      return [
        codeSpan(e.name),
        e.kind,
        cats(uniqueSorted(personal.map(topCategory).filter((c): c is string => c !== null))),
        String(personal.filter((f) => f.sensitivity === "sensitive").length),
        evidenceCell(first.file, first.line, ids),
      ];
    });
}

function categoryRows(facts: DocumentFacts): string[][] {
  const byCategory = new Map<string, { sensitivity: string; fields: string[]; first: { file: string; line: number } }>();
  for (const e of facts.entities) {
    for (const f of personalFields(e)) {
      const c = topCategory(f);
      if (c === null) continue;
      const l = f.locations[0]!;
      const entry = byCategory.get(c) ?? { sensitivity: f.sensitivity, fields: [], first: { file: l.file, line: l.line } };
      entry.fields.push(codeSpan(`${e.name}.${f.name}`));
      byCategory.set(c, entry);
    }
  }
  return [...byCategory.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([c, v]) => [codeSpan(c), v.sensitivity, v.fields.join(", "), loc(v.first.file, v.first.line)]);
}

function recipientOf(t: Texts, f: Finding): string {
  if (f.sink?.vendor) return escapeMd(f.sink.vendor);
  return f.sink?.host ? t["value.unknownDestination"]! : t["value.unresolved"]!;
}

function recipientRows(t: Texts, facts: DocumentFacts): string[][] {
  return facts.deterministicFindings
    .filter((f) => f.sink && (f.sink.kind === "http" || f.sink.kind === "analytics") && f.ruleId !== "PR-TRANSFER")
    .map((f) => [
      recipientOf(t, f),
      f.sink!.host ? codeSpan(f.sink!.host) : "-",
      f.sink!.hqCountry ? escapeMd(f.sink!.hqCountry) : "-",
      `${f.sink!.kind} (${codeSpan(f.sink!.callee)})`,
      cats(f.categories),
      evidenceCell(f.location.file, f.location.line, [f.id]),
    ]);
}

function transferRows(t: Texts, facts: DocumentFacts): string[][] {
  const groups = new Map<string, Finding[]>();
  for (const f of facts.deterministicFindings) {
    if (!f.transfer || f.transfer.length === 0) continue;
    const key = `${f.location.file}:${f.location.line}:${f.location.column}`;
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const rows: string[][] = [];
  for (const group of groups.values()) {
    const f = group[0]!;
    for (const tr of f.transfer!) {
      rows.push([
        recipientOf(t, f),
        f.sink?.hqCountry ? escapeMd(f.sink.hqCountry) : "-",
        tr.regime.toUpperCase(),
        tr.status,
        escapeMd(tr.text),
        evidenceCell(f.location.file, f.location.line, group.map((g) => g.id)),
      ]);
    }
  }
  return rows;
}

function retentionRows(t: Texts, facts: DocumentFacts): string[][] {
  return facts.entities
    .filter((e) => personalFields(e).length > 0)
    .map((e) => {
      let signal: string;
      if (Object.hasOwn(facts.retention, e.name)) signal = `${t["value.declared"]}: ${escapeMd(facts.retention[e.name]!)}`;
      else if (e.flags.retentionSignal !== null) signal = `${t["value.fieldSignal"]} ${codeSpan(e.flags.retentionSignal)}`;
      else signal = t["value.notDeclared"]!;
      const finding = facts.deterministicFindings.find((f) => f.ruleId === "PR-RETENTION" && f.entity?.name === e.name);
      const first = e.locations[0]!;
      const ev = finding ? evidenceCell(finding.location.file, finding.location.line, [finding.id]) : loc(first.file, first.line);
      return [codeSpan(e.name), signal, ev];
    });
}

function findingRow(f: Finding, articles: string): string[] {
  return [f.severity, f.ruleId, cats(f.categories), loc(f.location.file, f.location.line), f.id, articles];
}

function art30Sentence(t: Texts, facts: DocumentFacts): string {
  const found = new Map<string, string>();
  for (const e of facts.entities) {
    for (const f of personalFields(e)) {
      const c = topCategory(f);
      if (f.sensitivity !== "sensitive" || c === null || found.has(c)) continue;
      const l = f.locations[0]!;
      found.set(c, `${codeSpan(c)} at ${loc(l.file, l.line)}`);
    }
  }
  if (found.size === 0) return t["art30_5.possible"]!;
  return fill(t["art30_5.notAvailable"]!, { list: [...found.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => v).join(", ") });
}

const LEGITIMATE_INTEREST = /legítimo interesse|legitimo interesse|legitimate interest/i;

function undeclaredItems(t: Texts, facts: DocumentFacts): string[] {
  const nd = t["value.notDeclared"]!;
  const out: string[] = [];
  const c = facts.controller;
  if (!c?.name || !c.contact) out.push(`${t["undeclared.controller"]}: ${nd}`);
  if (!c?.dpo) out.push(`${t["undeclared.dpo"]}: ${nd}`);
  if (Object.keys(facts.purposes).length === 0) out.push(`${t["undeclared.purposes"]}: ${nd}`);
  if (Object.keys(facts.legalBases).length === 0) out.push(`${t["undeclared.legalBases"]}: ${nd}`);
  for (const e of facts.entities) {
    if (personalFields(e).length > 0 && !Object.hasOwn(facts.retention, e.name)) out.push(`${fill(t["undeclared.retention"]!, { entity: codeSpan(e.name) })}: ${nd}`);
  }
  // a declared mechanism turns the status into mechanism-declared, so these statuses mean "not declared"
  const destinations = uniqueSorted(
    facts.deterministicFindings
      .filter((f) => (f.transfer ?? []).some((tr) => SHARING_STATUSES.has(tr.status)))
      .map((f) => f.sink?.vendor ?? f.sink?.host)
      .filter((v): v is string => v !== undefined),
  );
  for (const v of destinations) out.push(`${fill(t["undeclared.mechanism"]!, { vendor: escapeMd(v) })}: ${nd}`);
  return out;
}

/**
 * Every table and list a document template may reference, for one document and locale (spec 5.9).
 * The templates pick what they need; `render` rejects any name not built here.
 */
export function buildTables(doc: DocId, locale: Locale, facts: DocumentFacts, _catalog: Catalog): { tables: Record<string, string>; lists: Record<string, string> } {
  const t = TEXTS[locale];
  const nd = t["value.notDeclared"]!;
  const c = facts.controller ?? {};
  const findings = facts.deterministicFindings;

  const controller = table(t, [t["col.field"]!, t["col.value"]!], [
    [t["controller.name"]!, c.name ? escapeMd(c.name) : nd],
    [t["controller.contact"]!, c.contact ? escapeMd(c.contact) : nd],
    [t["controller.dpo"]!, c.dpo ? escapeMd(c.dpo) : nd],
    [t["controller.country"]!, c.country ? escapeMd(c.country) : nd],
  ]);
  const purposeEntries = Object.entries(facts.purposes);
  const purposes = table(t, [t["col.processing"]!, t["col.purpose"]!], purposeEntries.length === 0 ? [["-", nd]] : purposeEntries.map(([k, v]) => [codeSpan(k), escapeMd(v)]));
  const basisEntries = Object.entries(facts.legalBases);
  const legalBases = table(
    t,
    [t["col.processing"]!, "LGPD", "GDPR"],
    basisEntries.length === 0 ? [["-", nd, nd]] : basisEntries.map(([k, v]) => [codeSpan(k), v.lgpd ? escapeMd(v.lgpd) : nd, v.gdpr ? escapeMd(v.gdpr) : nd]),
  );

  const tables: Record<string, string> = {
    controller,
    purposes,
    legalBases,
    entities: table(t, [t["col.entity"]!, t["col.kind"]!, t["col.categories"]!, t["col.sensitive"]!, t["col.evidence"]!], entityRows(t, facts)),
    categories: table(t, [t["col.category"]!, t["col.sensitivity"]!, t["col.fields"]!, t["col.evidence"]!], categoryRows(facts)),
    recipients: table(t, [t["col.recipient"]!, t["col.host"]!, t["col.country"]!, t["col.sink"]!, t["col.categories"]!, t["col.evidence"]!], recipientRows(t, facts)),
    transfers: table(t, [t["col.recipient"]!, t["col.country"]!, t["col.regime"]!, t["col.status"]!, t["col.text"]!, t["col.evidence"]!], transferRows(t, facts)),
    retention: table(t, [t["col.entity"]!, t["col.retention"]!, t["col.evidence"]!], retentionRows(t, facts)),
    security: table(
      t,
      [t["col.severity"]!, t["col.rule"]!, t["col.categories"]!, t["col.location"]!, t["col.finding"]!, t["col.articles"]!],
      findings.filter((f) => SECURITY_RULES.has(f.ruleId)).map((f) => findingRow(f, docArticles(doc, f))),
    ),
    risks: table(t, [t["col.severity"]!, t["col.rule"]!, t["col.categories"]!, t["col.location"]!, t["col.finding"]!, t["col.articles"]!], findings.map((f) => findingRow(f, bothArticles(f)))),
    sources: table(
      t,
      [t["col.entity"]!, t["col.source"]!, t["col.evidence"]!],
      facts.entities.filter((e) => personalFields(e).length > 0).flatMap((e) => e.locations.map((l) => [codeSpan(e.name), l.sourceKind, loc(l.file, l.line)])),
    ),
    sinks: table(
      t,
      [t["col.sink"]!, t["col.recipient"]!, t["col.categories"]!, t["col.evidence"]!],
      findings
        .filter((f) => SINK_RULES.has(f.ruleId) && f.sink)
        .map((f) => [`${f.sink!.kind} (${codeSpan(f.sink!.callee)})`, f.sink!.kind === "http" || f.sink!.kind === "analytics" ? recipientOf(t, f) : "-", cats(f.categories), evidenceCell(f.location.file, f.location.line, [f.id])]),
    ),
    llmLabeledFields: table(
      t,
      [t["col.field"]!, t["col.label"]!, t["col.confidence"]!],
      facts.llmLabeledFields.map((l) => [codeSpan(`${l.entity}.${l.field}`), codeSpan(l.label), l.confidence.toFixed(2)]),
    ),
  };

  const wp = detectWp248(facts);
  const n = wp.detected.length;
  const criteriaSentence = fill(n >= 2 ? t["criteria.likely"]! : t["criteria.count"]!, { n: String(n) });
  const indicators = detectRipdIndicators(facts);
  const rulesSeen = new Set(findings.map((f) => f.ruleId));
  const hints = facts.entities.flatMap((e) => e.flags.protectionHints.map((h) => `${codeSpan(e.name)}: ${codeSpan(h)}`));

  const lists: Record<string, string> = {
    art30_5: art30Sentence(t, facts),
    art37: Object.values(facts.legalBases).some((b) => LEGITIMATE_INTEREST.test(`${b.lgpd ?? ""} ${b.gdpr ?? ""}`)) ? t["art37.echo"]! : "",
    criteria: `${criteriaSentence}\n\n${bullets(t, wp.detected.map((id) => t[`wp248.${id}`]!))}`,
    otherIndicators: bullets(t, wp.otherIndicators.map((id) => t[`other.${id}`]!)),
    measures: bullets(t, MEASURE_RULES.filter((r) => rulesSeen.has(r)).map((r) => `**${r}**: ${t[`measure.${r}`]}`)),
    hints: bullets(t, hints),
    undeclared: bullets(t, undeclaredItems(t, facts)),
    context: `${t["ripd.mayRequire"]}\n\n${t["ripd.definition"]}`,
    indicators: `${fill(t["indicators.lead"]!, { n: String(indicators.length) })}\n\n${bullets(t, indicators.map((id) => t[`indicator.${id}`]!))}`,
    evidence: findings.length === 0 ? t["value.none"]! : findings.map((f) => `- ${f.id} · ${f.ruleId} · ${loc(f.location.file, f.location.line)}`).join("\n"),
  };
  return { tables, lists };
}
