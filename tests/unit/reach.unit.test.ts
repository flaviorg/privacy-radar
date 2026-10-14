import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCatalog } from "../../src/catalog/load.ts";
import { reach } from "../../src/flows/reach.ts";
import { matchSinks } from "../../src/flows/sinks.ts";
import { buildVendorIndex } from "../../src/flows/vendors.ts";
import { parseSource } from "../../src/sources/index.ts";
import { isValidCpf } from "../../src/validators/cpf.ts";
import { VALIDATORS } from "../../src/validators/index.ts";
import type { Reach } from "../../src/contracts/flows.ts";
import { DEMO_BASE_DIR, DEMO_FIXTURE_DIR } from "../../src/infra/paths.ts";
import { PATIENT_FIELDS, termSourceIndex } from "../helpers/builders.ts";
import { PROJECT_ROOT_FOR_TESTS } from "../helpers/child-node-args.ts";
import { ALL_FIXTURE_SECRETS, FIXTURE_ADDRESS, FIXTURE_EMAILS, FIXTURE_IDENTIFIERS, FIXTURE_NAMES } from "../helpers/fixture-values.ts";

const catalog = loadCatalog();
const vendors = buildVendorIndex(catalog.vendors);
const sources = termSourceIndex(catalog.termIndex, { Patient: PATIENT_FIELDS });
const read = (f: string) => readFileSync(join(PROJECT_ROOT_FOR_TESTS, "tests", "fixtures", "sources", f), "utf8");

function reachOf(text: string, path = "a.ts"): Reach[] {
  const file = parseSource(path, text);
  const moduleFn = file.functions.find((f) => f.name === "<module>")!;
  return file.functions.flatMap((fn) => matchSinks(fn, catalog, vendors).flatMap((sink) => reach(fn, sink, sources, moduleFn.bindings)));
}
const cats = (r: Reach[]) => r.map((x) => x.source.category).sort();

test("[FLOW-03] a source directly in a sink argument reaches it with hop null", () => {
  const r = reachOf('function f(patient: Patient) {\n  console.info("x", patient.cpf);\n}\n');
  assert.deepEqual(r.map((x) => [x.source.category, x.source.expressionText, x.source.loc.line, x.hop, x.sink.kind]), [["identifier.cpf", "patient.cpf", 2, null, "log"]]);
});

const SHAPES: Record<string, string> = {
  "object value": "console.log({ id: patient.cpf });",
  "array element": "console.log([1, patient.cpf]);",
  "template interpolation": "console.log(`cpf ${patient.cpf}`);",
  "+ operand": 'console.log("cpf " + patient.cpf);',
  "JSON.stringify": "console.log(JSON.stringify(patient.cpf));",
  String: "console.log(String(patient.cpf));",
  "util.format": 'console.log(util.format("%s", patient.cpf));',
};
for (const [shape, line] of Object.entries(SHAPES)) {
  test(`[FLOW-03] direct shape: ${shape}`, () => {
    const r = reachOf(`function f(patient: Patient) {\n  ${line}\n}\n`);
    assert.deepEqual(r.map((x) => [x.source.category, x.hop]), [["identifier.cpf", null]], shape);
  });
}

test("[FLOW-04] one local hop records via and line", () => {
  const r = reachOf(read("one-hop.ts"));
  assert.deepEqual(r.map((x) => [x.source.category, x.hop?.via, x.hop?.loc.line]), [["contact.email", "payload", 2]]);
});

test("[FLOW-04] destructuring from a source is one hop and module-scope const counts as local", () => {
  const destructured = reachOf("function f(patient: Patient) {\n  const { cpf: value } = patient;\n  console.log(value);\n}\n");
  assert.deepEqual(destructured.map((x) => [x.source.category, x.source.expressionText, x.hop?.via]), [["identifier.cpf", "patient.cpf", "value"]]);
  const moduleScope = reachOf('const SEED = { email: "x" };\nexport function f() {\n  console.log(SEED);\n}\n');
  assert.deepEqual(moduleScope.map((x) => [x.source.category, x.source.evidence, x.hop?.via, x.hop?.loc.line]), [["contact.email", "key", "SEED", 1]]);
  const shadowed = reachOf('const SEED = { email: "x" };\nexport function f(SEED: string) {\n  console.log(SEED);\n}\n');
  assert.deepEqual(shadowed, [], "a parameter shadows the module binding");
});

test("[FLOW-05] two hops, a user-defined function, a class field, a computed key and Array.join reach nothing", () => {
  for (const f of ["two-hops.ts", "cross-function.ts"]) assert.deepEqual(reachOf(read(f)), [], f);
  const inline = [
    "class Holder {\n  state = { v: '' };\n  save(p: Patient) { this.state = { v: p.cpf }; }\n  dump() { console.log(this.state); console.log(this.cpf); }\n}\n",
    "function f(p: Patient, key: keyof Patient) {\n  console.log(p[key]);\n}\n",
    "function f(p: Patient) {\n  console.log([p.cpf, p.email].join(','));\n}\n",
    "function f(p: Patient) {\n  const a = p.cpf;\n  const b = a;\n  console.log(b);\n}\n",
  ];
  for (const src of inline) assert.deepEqual(reachOf(src), [], src);
});

test("[FLOW-06] a query string built from a source is a url-query reach naming the parameter", () => {
  const r = reachOf("async function f(p: Patient) {\n  await fetch(`https://x.example.invalid/?nif=${p.nifPt}`);\n}\n");
  const q = r.filter((x) => x.sink.kind === "url-query");
  assert.deepEqual(q.map((x) => [x.sink.queryParam, x.source.category]), [["nif", "identifier.nif-pt"]]);
  const qs = reachOf("function f(p: Patient) {\n  return new URLSearchParams({ email: p.email });\n}\n");
  assert.deepEqual(qs.map((x) => [x.sink.kind, x.sink.queryParam, x.source.category]), [["url-query", "email", "contact.email"]]);
});

test("type hint: input: Patient reaches with all entity categories; patient.cpf only with identifier.cpf", () => {
  const whole = reachOf("function f(input: Patient) {\n  console.info('new', input);\n}\n");
  assert.ok(whole.length >= 9);
  assert.ok(whole.every((x) => x.source.evidence === "type-hint" && x.source.entity === "Patient" && x.hop === null));
  assert.ok(cats(whole).includes("special.health") && cats(whole).includes("identifier.cpf"));
  const member = reachOf("function f(patient: Patient) {\n  console.info(patient.cpf);\n}\n");
  assert.deepEqual(member.map((x) => [x.source.category, x.source.entity, x.source.field, x.source.confidence]), [["identifier.cpf", "Patient", "cpf", 0.6]]);
  const spread = reachOf("function f(patient: Patient) {\n  console.info({ ...patient });\n}\n");
  assert.ok(spread.length >= 9 && spread.every((x) => x.source.evidence === "spread"));
  const untyped = reachOf("function f(patient: unknown) {\n  console.info(patient);\n}\n");
  assert.deepEqual(untyped, []);
});

test("categories are de-duplicated keeping the highest confidence, direct before hop", () => {
  const r = reachOf("function f(patient: Patient) {\n  const cpf = patient.cpf;\n  console.log(cpf, { value: cpf });\n}\n");
  assert.deepEqual(r.map((x) => [x.source.category, x.hop]), [["identifier.cpf", null]]);
});

const sinkLines = (dir: string, rel: string) => {
  const file = parseSource(rel, readFileSync(join(dir, rel), "utf8"));
  return file.functions.flatMap((fn) => matchSinks(fn, catalog, vendors).map((s) => `${s.kind}@${s.loc.line}`));
};

test("the fixture's code files yield the expected sink calls at the expected lines", () => {
  assert.deepEqual(sinkLines(DEMO_FIXTURE_DIR, "src/patients.ts"), ["log@14", "log@22"]);
  assert.deepEqual(sinkLines(DEMO_FIXTURE_DIR, "src/analytics.ts"), ["analytics@9", "http@12"]);
  assert.deepEqual(sinkLines(DEMO_FIXTURE_DIR, "src/appointments.ts"), ["http@11", "url-query@11"]);
  assert.deepEqual(sinkLines(DEMO_FIXTURE_DIR, "src/billing.ts"), ["file@8"]);
  assert.deepEqual(sinkLines(DEMO_FIXTURE_DIR, "src/logger.ts"), []);
  assert.deepEqual(sinkLines(DEMO_FIXTURE_DIR, "src/server.ts"), []);
  assert.deepEqual(sinkLines(DEMO_BASE_DIR, "src/patients.ts"), ["log@15", "log@23", "file@24"]);
  assert.deepEqual(sinkLines(DEMO_BASE_DIR, "src/analytics.ts"), ["analytics@9", "http@12"]);
  const columns = parseSource("src/patients.ts", readFileSync(join(DEMO_FIXTURE_DIR, "src/patients.ts"), "utf8")).functions.flatMap((fn) => matchSinks(fn, catalog, vendors).map((s) => s.loc.column));
  assert.deepEqual(columns, [3, 3]);
});

test("the fixture's reaches: type hints, the payload hop, the query parameter and the file sink", () => {
  const at = (rel: string) => reachOf(readFileSync(join(DEMO_FIXTURE_DIR, rel), "utf8"), rel);
  const analytics = at("src/analytics.ts");
  assert.deepEqual(analytics.filter((x) => x.sink.loc.line === 9).map((x) => x.source.category).sort(), ["identifier.cpf", "special.health"]);
  assert.deepEqual(analytics.filter((x) => x.sink.loc.line === 12).map((x) => [x.source.category, x.hop?.via]), [["contact.email", "payload"]]);
  assert.equal(analytics[0]!.sink.vendor?.vendor, "Mixpanel");
  const appointments = at("src/appointments.ts");
  assert.deepEqual(appointments.map((x) => [x.sink.kind, x.sink.host, x.sink.queryParam, x.source.category]), [
    ["http", "sms.example-vendor.invalid", null, "identifier.nif-pt"],
    ["url-query", null, "nif", "identifier.nif-pt"],
  ]);
  assert.deepEqual(cats(at("src/billing.ts")), ["financial.iban", "name.full-name"]);
  assert.deepEqual(at("src/patients.ts").filter((x) => x.sink.loc.line === 22).map((x) => x.source.category), ["identifier.cpf"]);
});

test("DEMO_SEED is not an entity and its names and address come back as literal bindings", () => {
  const text = readFileSync(join(DEMO_FIXTURE_DIR, "src/server.ts"), "utf8");
  const file = parseSource("src/server.ts", text);
  assert.deepEqual(file.entities, []);
  const names = file.literalBindings.map((b) => b.bindingName);
  assert.equal(names.filter((n) => n === "fullName").length, 2);
  assert.equal(names.filter((n) => n === "address").length, 1);
  for (const v of [...FIXTURE_NAMES, ...FIXTURE_ADDRESS]) {
    assert.ok(file.literalBindings.some((b) => text.slice(b.start + 1, b.end - 1) === v.raw && b.line === v.line), v.raw);
  }
  const logger = parseSource("src/logger.ts", readFileSync(join(DEMO_FIXTURE_DIR, "src/logger.ts"), "utf8"));
  assert.deepEqual(logger.entities, []);
});

test("fixture values are checksum-valid, distinct from Appendix A and sit on their recorded lines", () => {
  const validatorOf: Record<string, keyof typeof VALIDATORS> = {
    "identifier.cpf": "cpf",
    "identifier.cnpj": "cnpj",
    "identifier.nif-pt": "nif-pt",
    "identifier.dni-es": "dni-es",
    "identifier.nie-es": "nie-es",
    "identifier.codice-fiscale-it": "codice-fiscale-it",
    "identifier.steuer-id-de": "steuer-id-de",
    "identifier.bsn-nl": "bsn-nl",
    "identifier.nir-fr": "nir-fr",
    "financial.iban": "iban",
    "financial.card-pan": "luhn",
  };
  assert.equal(FIXTURE_IDENTIFIERS.length, 14);
  for (const v of FIXTURE_IDENTIFIERS) assert.ok(VALIDATORS[validatorOf[v.kind]!](v.raw), `${v.kind} ${v.raw}`);
  assert.ok(!FIXTURE_IDENTIFIERS.some((v) => ["529.982.247-25", "11.222.333/0001-81", "123456789", "999999990", "12345678Z", "X1234567L", "65929970489", "111222333"].includes(v.raw)));
  assert.equal(isValidCpf("159.368.495-97"), true);
  for (const v of [...FIXTURE_IDENTIFIERS, ...FIXTURE_EMAILS, ...FIXTURE_NAMES, ...FIXTURE_ADDRESS]) {
    const lines = readFileSync(join(DEMO_FIXTURE_DIR, v.file), "utf8").split("\n");
    assert.ok(lines[v.line - 1]?.includes(v.raw), `${v.raw} on ${v.file}:${v.line}`);
  }
  assert.equal(new Set(ALL_FIXTURE_SECRETS).size, ALL_FIXTURE_SECRETS.length);
  assert.ok(ALL_FIXTURE_SECRETS.includes("15936849597") && ALL_FIXTURE_SECRETS.includes("4585465941323107"));
});
