import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCatalog } from "../../src/catalog/load.ts";
import type { ValueHit } from "../../src/contracts/source-model.ts";
import type { RegimeOption } from "../../src/contracts/catalog.ts";
import { isAmbiguous, selectAmbiguous, GENERIC_NAMES } from "../../src/engine/ambiguous.ts";
import { classifyField, sensitivityFor, type Candidate, type ClassifyContext } from "../../src/engine/classify-field.ts";
import { cand, ent, field } from "../helpers/builders.ts";
import { PROJECT_ROOT_FOR_TESTS } from "../helpers/child-node-args.ts";

const catalog = loadCatalog();
const ctx = (over: Partial<ClassifyContext> = {}): ClassifyContext => ({
  termIndex: catalog.termIndex,
  categoryById: catalog.categoryById,
  regime: "both",
  file: "prisma/schema.prisma",
  valueHits: [],
  ...over,
});
const pick = (c: Candidate) => ({ category: c.category, confidence: c.confidence, ambiguous: c.ambiguous });
const top = (cs: Candidate[]) => cs[0] ?? null;

test("[ENG-01] a name-matched field gets candidates with evidence and the term weight", () => {
  const [c] = classifyField(field({ name: "cpf", type: "String" }), ent("Patient"), ctx());
  assert.deepEqual(pick(c!), { category: "identifier.cpf", confidence: 0.6, ambiguous: false });
  assert.deepEqual(c!.evidence.map((e) => e.kind), ["field-name"]);
  assert.equal(c!.sensitivity, "personal");
});

test("[ENG-01] type hint and attribute raise birthDate to 0.75", () => {
  const [c] = classifyField(field({ name: "birthDate", type: "DateTime", attributes: ["@db.Date"] }), ent("Patient"), ctx());
  assert.deepEqual(pick(c!), { category: "demographic.birth-date", confidence: 0.75, ambiguous: false });
  assert.deepEqual(c!.evidence.map((e) => [e.kind, e.weight]), [
    ["field-name", 0.6],
    ["type-hint", 0.1],
    ["attribute", 0.05],
  ]);
  const sql = top(classifyField(field({ name: "birth_date", type: "date" }), ent("patients"), ctx({ file: "migrations/001_init.sql" })));
  assert.equal(sql!.confidence, 0.7);
});

test("[ENG-01] @unique on an identifier adds the attribute weight; Decimal is a financial type hint", () => {
  assert.equal(top(classifyField(field({ name: "cpf", type: "String", attributes: ["@unique"] }), ent("Patient"), ctx()))!.confidence, 0.65);
  assert.equal(top(classifyField(field({ name: "email", type: "String", attributes: ["@unique"] }), ent("Patient"), ctx()))!.confidence, 0.6);
  assert.equal(top(classifyField(field({ name: "salary", type: "Decimal" }), ent("Employee"), ctx()))!.confidence, 0.7);
});

test("[ENG-01] nifPt reaches 0.60 from the exact pt term alone", () => {
  assert.deepEqual(pick(top(classifyField(field({ name: "nifPt", type: "String" }), ent("Patient"), ctx()))!), { category: "identifier.nif-pt", confidence: 0.6, ambiguous: false });
});

test("[ENG-01] reminderPhone gets 0.50 from the token term phone", () => {
  assert.deepEqual(pick(top(classifyField(field({ name: "reminderPhone", type: "String" }), ent("Appointment"), ctx()))!), { category: "contact.phone", confidence: 0.5, ambiguous: false });
});

test("[ENG-01] value hits inside a default or a comment add value-pattern and checksum evidence", () => {
  const text = 'model A {\n  doc String @default("245.452.155-56")\n}\n';
  const start = text.indexOf("245");
  const hit: ValueHit = { categories: ["identifier.cpf"], checksum: "valid", corroborated: true, masked: "***.***.***-56", line: 2, column: start - text.indexOf("\n") , length: 14, start, end: start + 14 };
  const f = field({ name: "doc", type: "String", defaultRange: { start: start - 1, end: start + 15 }, defaultValue: '"245.452.155-56"' });
  const [c] = classifyField(f, ent("A"), ctx({ valueHits: [hit] }));
  assert.deepEqual([c!.category, c!.confidence, c!.evidence.map((e) => e.kind)], ["identifier.cpf", 0.55, ["value-pattern", "checksum"]]);
  // a hit outside the field's ranges is ignored
  assert.deepEqual(classifyField(field({ name: "doc", type: "String" }), ent("A"), ctx({ valueHits: [hit] })), []);
});

test("[ENG-01] ambiguous only for generic names or JSON/text with a generic token and no term hit", () => {
  assert.equal(isAmbiguous(field({ name: "obs", type: "Json" }), []), true);
  assert.equal(isAmbiguous(field({ name: "extra", type: "Json" }), []), true);
  assert.equal(isAmbiguous(field({ name: "extraData", type: "jsonb" }), []), true);
  assert.equal(isAmbiguous(field({ name: "status", type: "String" }), []), false);
  assert.equal(isAmbiguous(field({ name: "notes", type: "String" }), [cand("special.health")]), false);
  assert.equal(isAmbiguous(field({ name: "payloadBlob", type: "String" }), []), false);
  assert.ok(GENERIC_NAMES.includes("observacoes"));
});

test("[ENG-03] entity context demotes Clinic.name and Clinic.address below 0.50", () => {
  const name = top(classifyField(field({ name: "name", type: "String" }), ent("Clinic"), ctx()))!;
  const address = top(classifyField(field({ name: "address", type: "String" }), ent("Clinic"), ctx()))!;
  assert.deepEqual([name.category, name.confidence], ["name.full-name", 0.3]);
  assert.deepEqual([address.category, address.confidence], ["contact.address", 0.3]);
  assert.ok(name.evidence.some((e) => e.kind === "entity-context" && e.weight === -0.3));
  // the SQL table name `clinics` is a non-person entity too (by its normalized name)
  assert.equal(top(classifyField(field({ name: "name", type: "text" }), ent("clinics"), ctx()))!.confidence, 0.3);
});

test("[ENG-03] the test-path penalty uses the path relative to the target", () => {
  const conf = (file: string) => top(classifyField(field({ name: "cpf" }), ent("Patient"), ctx({ file })))!.confidence;
  assert.equal(conf("tests/x.ts"), 0.4);
  assert.equal(conf("src/a.spec.ts"), 0.4);
  assert.equal(conf("src/__tests__/a.ts"), 0.4);
  assert.equal(conf("fixtures/seed.sql"), 0.4);
  assert.equal(conf("contest/x.ts"), 0.6);
  assert.equal(conf("src/latest.ts"), 0.6);
});

test("PT/ES nif disambiguation keeps both candidates at the short-term weight when nothing else decides", () => {
  const both = classifyField(field({ name: "nif", type: "String" }), ent("Person"), ctx());
  assert.deepEqual(both.map(pick), [
    { category: "identifier.dni-es", confidence: 0.35, ambiguous: false },
    { category: "identifier.nif-pt", confidence: 0.35, ambiguous: false },
  ]);
  const pt = classifyField(field({ name: "nif", type: "String" }), ent("Pessoa", ["nif", "morada", "contribuinte"]), ctx());
  assert.deepEqual(pt.map((c) => c.category), ["identifier.nif-pt"]);
  const es = classifyField(field({ name: "nif", type: "String" }), ent("Persona", ["nif", "domicilio", "apellidos"]), ctx());
  assert.deepEqual(es.map((c) => c.category), ["identifier.dni-es"]);
});

test("sensitivity per regime: under both the higher of the two", () => {
  const phil = catalog.categoryById.get("special.philosophical")!;
  const bio = catalog.categoryById.get("special.biometric")!;
  const cases: [RegimeOption, string, string][] = [
    ["lgpd", phil.lgpdSensitivity ?? phil.sensitivity, bio.lgpdSensitivity ?? bio.sensitivity],
    ["gdpr", phil.gdprSensitivity ?? phil.sensitivity, bio.gdprSensitivity ?? bio.sensitivity],
  ];
  for (const [regime, p, b] of cases) {
    assert.equal(sensitivityFor(phil, regime), p, regime);
    assert.equal(sensitivityFor(bio, regime), b, regime);
  }
  assert.equal(sensitivityFor(phil, "both"), "sensitive");
  assert.equal(sensitivityFor(bio, "both"), "sensitive");
});

test("selectAmbiguous orders sensitive entities first and honours the cap", () => {
  const rows = [
    { entity: "Order", field: "meta", file: "b.prisma", line: 9, sensitiveEntity: false },
    { entity: "Patient", field: "obs", file: "z.prisma", line: 17, sensitiveEntity: true },
    { entity: "Order", field: "extra", file: "a.prisma", line: 3, sensitiveEntity: false },
    { entity: "Order", field: "notes", file: "a.prisma", line: 2, sensitiveEntity: false },
  ];
  assert.deepEqual(selectAmbiguous(rows, 20).map((r) => r.field), ["obs", "notes", "extra", "meta"]);
  assert.deepEqual(selectAmbiguous(rows, 2).map((r) => r.field), ["obs", "notes"]);
  assert.equal(selectAmbiguous(Array.from({ length: 150 }, (_, i) => ({ ...rows[0]!, line: i + 1 })), 1000).length, 100);
});

test("evals/field-names.jsonl has at least 200 rows, 50 per language and 60 hard negatives, every expected id known", () => {
  const rows = readFileSync(join(PROJECT_ROOT_FOR_TESTS, "evals", "field-names.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { id: string; lang: string; entity: string; field: string; rawType: string; expected: string });
  assert.ok(rows.length >= 200);
  for (const lang of ["pt", "en", "es"]) assert.ok(rows.filter((r) => r.lang === lang).length >= 50, lang);
  assert.ok(rows.filter((r) => r.expected === "not-personal").length >= 60);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  for (const r of rows) assert.ok(r.expected === "not-personal" || catalog.categoryById.has(r.expected), r.id);
});
