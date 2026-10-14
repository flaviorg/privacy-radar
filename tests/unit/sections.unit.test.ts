import { before, test } from "node:test";
import assert from "node:assert/strict";
import { scan, type ScanOutcome } from "../../src/app/scan.ts";
import { loadCatalog } from "../../src/catalog/load.ts";
import type { ProjectConfig } from "../../src/contracts/config.ts";
import type { Finding } from "../../src/contracts/findings.ts";
import {
  SECTION_ARTICLES,
  WP248_CRITERIA,
  buildDocumentFacts,
  buildTables,
  detectRipdIndicators,
  detectWp248,
  narrativeFacts,
  type DocumentFacts,
  type LlmLabeledField,
} from "../../src/output/documents/sections.ts";
import { DOCUMENTS } from "../../src/output/documents/templates.ts";
import { defaultScanOptions } from "../helpers/run-scan.ts";

const catalog = loadCatalog();
let outcome: ScanOutcome;
let base: DocumentFacts;

before(async () => {
  outcome = await scan(defaultScanOptions(null, { formats: ["json"], uriPrefix: "" }));
  base = buildDocumentFacts(outcome.result, outcome.inventory, { schemaVersion: 1 }, catalog);
});

const facts = (labels: LlmLabeledField[], over: Partial<DocumentFacts> = {}): DocumentFacts => ({ ...base, llmLabeledFields: labels, ...over });
const lbl = (field: string, label: string): LlmLabeledField => ({ entity: field === "extra" ? "Appointment" : "Patient", field, label, confidence: 0.7 });
const omit = (o: Record<string, string>, key: string) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== key));
const locations = (findings: readonly Finding[]) => new Set(findings.map((f) => `${f.location.file}:${f.location.line}`));
const fileLines = (md: string) => [...md.matchAll(/`([^`\s]+\.(?:ts|sql|prisma):\d+)`/g)].map((m) => m[1]!);
const rows = (table: string) => table.split("\n").filter((l) => l.startsWith("| ") && !/^\|[-| ]+\|$/.test(l)).slice(1);

test("buildDocumentFacts keeps only deterministic, active findings and takes LLM labels only into llmLabeledFields", () => {
  assert.equal(base.deterministicFindings.length, 17);
  assert.ok(base.deterministicFindings.every((f) => f.origin === "deterministic" && !f.belowThreshold && !f.suppressed));
  assert.equal(base.target, "fixtures/telehealth-clinic");
  assert.deepEqual(base.llmLabeledFields, []);
  assert.equal(base.adequacyCheckedOn, catalog.adequacy.checkedOn);
  assert.deepEqual(base.llmVendors, []);
});

test("[DOC-02] ropa and registro tables cover entities and categories, recipients with vendor and country, transfers, retention and security findings, each row linking to file:line in findings.json", () => {
  const known = locations(outcome.result.findings);
  const inventoryLocations = new Set(outcome.inventory.entities.flatMap((e) => [...e.locations, ...e.fields.flatMap((f) => f.locations)].map((l) => `${l.file}:${l.line}`)));
  for (const [doc, locale] of [["ropa", "en"], ["registro", "en"], ["registro", "pt-BR"]] as const) {
    const { tables } = buildTables(doc, locale, base, catalog);
    for (const name of ["entities", "categories", "recipients", "transfers", "retention", "security"]) {
      const body = tables[name];
      assert.ok(body !== undefined, `${doc}/${locale}: table ${name}`);
      const r = rows(body);
      assert.ok(r.length > 0, `${doc}/${locale}: ${name} has rows`);
      for (const row of r) {
        const refs = fileLines(row);
        assert.ok(refs.length > 0, `${doc}/${locale}: ${name} row without file:line: ${row}`);
        const pool = name === "entities" || name === "categories" ? new Set([...known, ...inventoryLocations]) : known;
        assert.ok(refs.every((x) => pool.has(x)), `${doc}/${locale}: ${name}: ${row}`);
      }
    }
    assert.match(tables.recipients!, /Mixpanel/);
    assert.match(tables.recipients!, /\| US \|/);
    assert.match(tables.recipients!, /sms\.example-vendor\.invalid/);
    assert.match(tables.transfers!, /needs-mechanism/);
    assert.match(tables.transfers!, /unknown-destination/);
    assert.match(tables.transfers!, /status as of 2026-10-08; verify/);
    assert.equal(rows(tables.security!).length, base.deterministicFindings.filter((f) => ["PR-LOG", "PR-FILE", "PR-URL-QUERY", "PR-PLAINTEXT-SENSITIVE", "PR-HARDCODED-VALUE"].includes(f.ruleId)).length);
  }
  const en = buildTables("ropa", "en", base, catalog).tables;
  assert.match(en.retention!, /not declared \(fill in\)/);
  const pt = buildTables("registro", "pt-BR", base, catalog).tables;
  assert.match(pt.retention!, /não declarado \(preencher\)/);
  assert.match(pt.entities!, /\| Entidade \|/);
});

test("[DOC-02] a retention period declared in config shows as declared in config", () => {
  const withRetention = facts([], { retention: { Patient: "5 years after the last visit" } });
  const t = buildTables("ropa", "en", withRetention, catalog).tables.retention!;
  assert.match(t, /declared in config: 5 years after the last visit/);
});

test("[DOC-03] the DPIA states 2 of 9 WP248 criteria and 'a DPIA is likely required' for the fixture, listing sensitive data and vulnerable subjects", () => {
  assert.equal(WP248_CRITERIA.length, 9);
  const w = detectWp248(base);
  assert.deepEqual(w.detected, ["sensitive-data", "vulnerable-subjects"]);
  const { lists } = buildTables("dpia", "en", base, catalog);
  assert.match(lists.criteria!, /^2 of 9 WP248 criteria detected: a DPIA is likely required/);
  assert.match(lists.criteria!, /Sensitive data or data of a highly personal nature/);
  assert.match(lists.criteria!, /vulnerable data subjects/);
});

test("[DOC-03] fewer than 2 criteria drop the 'likely required' clause", () => {
  const plain = facts([], { entities: base.entities.map((e) => ({ ...e, name: "Ledger", flags: { ...e.flags, hasSensitive: false, hasChildrenIndicator: false } })), deterministicFindings: base.deterministicFindings.filter((f) => f.sensitivity !== "sensitive") });
  const { lists } = buildTables("dpia", "en", plain, catalog);
  assert.match(lists.criteria!, /^0 of 9 WP248 criteria detected\n/);
  assert.doesNotMatch(lists.criteria!, /likely required/);
});

test("[DOC-03] third-party sharing is listed under other indicators, outside the WP248 count", () => {
  const w = detectWp248(base);
  assert.ok(!w.detected.includes("third-party-sharing"));
  assert.deepEqual(w.otherIndicators, ["third-party-sharing"]);
  const { lists } = buildTables("dpia", "en", base, catalog);
  assert.match(lists.otherIndicators!, /Data sharing with third parties/);
  const llm = detectWp248(facts([], { llmVendors: ["OpenAI"] }));
  assert.deepEqual(llm.detected, ["sensitive-data", "vulnerable-subjects", "innovative-technology"]);
});

test("[DOC-03] the risks table holds every non-suppressed deterministic finding at or above the threshold with its articles", () => {
  const { tables } = buildTables("dpia", "en", base, catalog);
  const r = rows(tables.risks!);
  assert.equal(r.length, 17);
  for (const f of base.deterministicFindings) assert.ok(r.some((row) => row.includes(f.id) && row.includes(f.ruleId)), f.id);
  const log = r.find((row) => row.includes("PR-LOG") && row.includes("src/patients.ts:22"))!;
  assert.match(log, /LGPD 6 VII, 46 · GDPR 5\(1\)\(f\), 32/);
  assert.ok(!r.some((row) => row.includes("PR-AMBIGUOUS")));
});

test("[DOC-04] the RIPD context says the ANPD may require the report and lists 3 high-risk indicators from deterministic data", () => {
  assert.deepEqual(detectRipdIndicators(base), ["sensitive-data", "children-or-vulnerable", "third-party-sharing"]);
  const en = buildTables("ripd", "en", base, catalog).lists;
  assert.match(en.context!, /the ANPD may require this report/);
  assert.doesNotMatch(en.context!, /\bmust\b/);
  assert.match(en.context!, /art\. 5 XVII/);
  assert.match(en.indicators!, /^3 high-risk indicators/);
  const pt = buildTables("ripd", "pt-BR", base, catalog).lists;
  assert.match(pt.context!, /a ANPD poderá determinar/);
  assert.match(pt.indicators!, /^3 indicadores de alto risco/);
  assert.match(pt.undeclared!, /não declarado \(preencher\)/);
});

test("[DOC-09] adding, removing or changing an LLM label leaves every table, count, criterion, indicator and evidence row byte-identical", () => {
  for (const [doc, locale] of [["dpia", "en"], ["ropa", "en"], ["registro", "pt-BR"], ["ripd", "en"]] as const) {
    const first = buildTables(doc, locale, facts([]), catalog);
    for (const labels of [[lbl("obs", "special.health")], [lbl("extra", "children.minor-flag")], [lbl("obs", "special.genetic")]]) {
      const other = buildTables(doc, locale, facts(labels), catalog);
      assert.deepEqual(omit(other.tables, "llmLabeledFields"), omit(first.tables, "llmLabeledFields"), `${doc}/${locale}`);
      assert.deepEqual(other.lists, first.lists, `${doc}/${locale}`);
      assert.match(other.tables.llmLabeledFields!, new RegExp(labels[0]!.label.replace(".", "\\.")));
    }
    for (const [name, body] of Object.entries(first.tables)) if (name !== "llmLabeledFields") assert.doesNotMatch(body, /special\.genetic|children\.minor-flag/, name);
  }
  assert.deepEqual(detectWp248(facts([lbl("extra", "children.minor-flag")])), detectWp248(base));
  assert.deepEqual(detectRipdIndicators(facts([lbl("obs", "special.genetic")])), detectRipdIndicators(base));
});

test("art. 30(5) sentence: not available with a sensitive field (names it with file:line), possibly available without", () => {
  const { lists } = buildTables("ropa", "en", base, catalog);
  assert.equal(lists.art30_5, "Art. 30(5) exemption: not available (special categories detected: `special.health` at `prisma/schema.prisma:14`)");
  const none = facts([], { entities: base.entities.map((e) => ({ ...e, fields: e.fields.map((f) => ({ ...f, sensitivity: f.sensitivity === "sensitive" ? ("personal" as const) : f.sensitivity })) })) });
  assert.match(buildTables("ropa", "en", none, catalog).lists.art30_5!, /^Art\. 30\(5\) exemption: possibly available; verify headcount \(fewer than 250\)/);
});

test("art. 37 echo appears only when a legal basis mentions legítimo interesse or legitimate interest", () => {
  assert.equal(buildTables("registro", "pt-BR", base, catalog).lists.art37, "");
  const config: ProjectConfig = { schemaVersion: 1, legalBases: { analytics: { lgpd: "legítimo interesse (art. 7 IX)" } } };
  const withBasis = buildDocumentFacts(outcome.result, outcome.inventory, config, catalog);
  assert.match(buildTables("registro", "pt-BR", withBasis, catalog).lists.art37!, /especialmente quando baseado no legítimo interesse/);
  const en = buildDocumentFacts(outcome.result, outcome.inventory, { schemaVersion: 1, legalBases: { crm: { gdpr: "Legitimate interest (art. 6(1)(f))" } } }, catalog);
  assert.match(buildTables("registro", "en", en, catalog).lists.art37!, /legitimate interest/);
  assert.match(buildTables("registro", "en", en, catalog).tables.legalBases!, /Legitimate interest/);
});

test("[OUT-09] entity and field names in tables go through codeSpan", () => {
  const evil = facts([{ entity: "a](b)", field: "<img>", label: "special.health", confidence: 0.6 }], {
    entities: base.entities.map((e, i) => (i === 0 ? { ...e, name: "a](https://e.invalid)", fields: e.fields.map((f) => ({ ...f, name: `${f.name}\`@team` })) } : e)),
  });
  const { tables } = buildTables("ropa", "en", evil, catalog);
  for (const body of Object.values(tables)) {
    assert.doesNotMatch(body.replace(/(`+)(?:(?!\1)[\s\S])*?\1/g, ""), /\]\(|<img>|@team/, body);
  }
  assert.match(tables.entities!, /`a\]\(https:\/\/e\.invalid\)`/);
});

test("every SECTION_ARTICLES key exists in the catalog and every narrative section has a list", () => {
  for (const [doc, spec] of Object.entries(DOCUMENTS)) {
    for (const section of spec.narrative) {
      const entry = SECTION_ARTICLES[doc as keyof typeof SECTION_ARTICLES][section];
      assert.ok(entry, `${doc}.${section}`);
      for (const k of entry.lgpd) assert.ok(catalog.articleByKey.lgpd.has(k), `${doc}.${section}: LGPD ${k}`);
      for (const k of entry.gdpr) assert.ok(catalog.articleByKey.gdpr.has(k), `${doc}.${section}: GDPR ${k}`);
    }
  }
});

test("narrativeFacts come from deterministic data only and carry the section's allowed articles", () => {
  const f = narrativeFacts(base, "dpia", "measures");
  assert.deepEqual(f.counts, { error: 5, warning: 10, note: 2, entities: 3, fields: 24, vendors: 1 });
  assert.deepEqual(f.allowedArticles, SECTION_ARTICLES.dpia.measures);
  assert.equal(f.controller, null);
  assert.deepEqual(narrativeFacts(facts([lbl("obs", "special.genetic")]), "dpia", "measures"), f);
  assert.ok(!JSON.stringify(f).includes("special.genetic"));
  const patient = f.entities.find((e) => e.name === "Patient")!;
  assert.equal(patient.sensitiveCount, 3);
  assert.ok(f.sinks.some((s) => s.kind === "analytics" && s.vendor === "Mixpanel" && s.hqCountry === "US"));
  assert.ok(f.transfers.some((t) => t.regime === "lgpd" && t.status === "needs-mechanism"));
});

test("evidence list: one row per deterministic finding, PRF id · rule · file:line", () => {
  const { lists } = buildTables("ropa", "en", base, catalog);
  const lines = lists.evidence!.split("\n");
  assert.equal(lines.length, 17);
  for (const [i, f] of base.deterministicFindings.entries()) assert.equal(lines[i], `- ${f.id} · ${f.ruleId} · \`${f.location.file}:${f.location.line}\``);
});
