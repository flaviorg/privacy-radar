import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RuleId } from "../../src/contracts/catalog.ts";
import type { ProjectConfig } from "../../src/contracts/config.ts";
import { DEMO_FIXTURE_DIR } from "../../src/infra/paths.ts";
import { compressKeys } from "../../src/engine/messages.ts";
import { applyRules, dedupeFindings, RULES, type RawFinding } from "../../src/engine/rules/index.ts";
import { loadCatalog } from "../../src/catalog/load.ts";
import { findingSchema } from "../../src/contracts/findings.ts";
import type { ScanModel } from "../../src/engine/model.ts";
import { buildModelFromTexts, type ModelOptions } from "../helpers/builders.ts";
import { PROJECT_ROOT_FOR_TESTS } from "../helpers/child-node-args.ts";

const demo = (rel: string) => readFileSync(join(DEMO_FIXTURE_DIR, rel), "utf8");
const source = (f: string) => readFileSync(join(PROJECT_ROOT_FOR_TESTS, "tests", "fixtures", "sources", f), "utf8");
const SCHEMA = { "prisma/schema.prisma": demo("prisma/schema.prisma") };
const ANALYTICS = { ...SCHEMA, "src/analytics.ts": demo("src/analytics.ts") };

const ruleOf = (id: RuleId) => RULES.find((r) => r.id === id)!;
const runModel = (id: RuleId, model: ScanModel): RawFinding[] => ruleOf(id).apply(model);
const run = (id: RuleId, files: Record<string, string>, opts?: ModelOptions) => runModel(id, buildModelFromTexts(files, opts));
const keys = (refs: readonly { article: string; item?: string }[]) => refs.map((r) => (r.item === undefined ? r.article : `${r.article} ${r.item}`));
const patientFn = (body: string) => ({ ...SCHEMA, "src/a.ts": `import type { Patient, Clinic } from "@prisma/client";\n${body}\n` });

test("[ENG-04] PR-ANALYTICS for cpf + health to Mixpanel cites the spec 5.5 keys for both regimes", () => {
  const f = run("PR-ANALYTICS", ANALYTICS)[0]!;
  assert.deepEqual([f.location.file, f.location.line, f.severity], ["src/analytics.ts", 9, "error"]);
  assert.deepEqual(keys(f.articles.lgpd), ["6 I", "6 II", "6 III", "7", "11", "33", "46"]);
  assert.deepEqual(keys(f.articles.gdpr), ["5(1)(b)", "5(1)(c)", "6", "9(1)", "28", "44", "45", "46"]);
  assert.match(f.message, /\(LGPD 6 I-III, 7, 11, 33, 46; GDPR 5\(1\)\(b\)\(c\), 6, 9\(1\), 28, 44-46\)/);
  assert.match(f.message, /art\. 28 applies if the vendor acts as a processor; verify the vendor's role/);
  assert.deepEqual(f.sink, { kind: "analytics", callee: "mixpanel.track", vendor: "Mixpanel", hqCountry: "US" });
  assert.deepEqual(f.transfer!.map((t) => [t.regime, t.status]), [
    ["lgpd", "needs-mechanism"],
    ["gdpr", "conditional"],
  ]);
  assert.deepEqual([f.confidence, f.confidenceLevel, f.sensitivity, f.origin], [0.65, "medium", "sensitive", "deterministic"]);
  assert.ok(f.evidence.some((e) => e.kind === "sink") && f.evidence.some((e) => e.kind === "vendor"));
  assert.equal(f.location.snippet, 'mixpanel.track("visit", { cpf: patient.cpf, diagnosis: patient.diagnosis });');
});

test("[ENG-04] --regime lgpd empties the gdpr array and the message quotes only LGPD", () => {
  const f = run("PR-ANALYTICS", ANALYTICS, { regime: "lgpd" })[0]!;
  assert.deepEqual(f.articles.gdpr, []);
  assert.deepEqual(keys(f.articles.lgpd), ["6 I", "6 II", "6 III", "7", "11", "33", "46"]);
  assert.match(f.message, /\(LGPD 6 I-III, 7, 11, 33, 46\)/);
  assert.doesNotMatch(f.message, /GDPR/);
  assert.deepEqual(f.transfer!.map((t) => t.regime), ["lgpd"]);
  const g = run("PR-ANALYTICS", ANALYTICS, { regime: "gdpr" })[0]!;
  assert.deepEqual(g.articles.lgpd, []);
  assert.doesNotMatch(g.message, /LGPD/);
});

test("one finding per sink call with sorted unique categories", () => {
  const f = run("PR-ANALYTICS", patientFn('declare const mixpanel: any;\nexport function t(patient: Patient) {\n  mixpanel.track("v", { diagnosis: patient.diagnosis, cpf: patient.cpf, again: patient.cpf, allergies: patient.allergies });\n}'));
  assert.equal(f.length, 1);
  assert.deepEqual(f[0]!.categories, ["identifier.cpf", "special.health"]);
});

test("the six sink rules on the demo fixture code give the expected findings (spec 5.10)", () => {
  const files: Record<string, string> = { ...SCHEMA, "migrations/001_init.sql": demo("migrations/001_init.sql") };
  for (const f of ["analytics", "appointments", "billing", "logger", "patients", "server"]) files[`src/${f}.ts`] = demo(`src/${f}.ts`);
  const model = buildModelFromTexts(files);
  const got = (["PR-LOG", "PR-THIRD-PARTY", "PR-ANALYTICS", "PR-FILE", "PR-URL-QUERY", "PR-TRANSFER"] as const).flatMap((id) =>
    runModel(id, model).map((f) => [id, f.location.file, f.location.line, f.severity, f.categories.length]),
  );
  assert.deepEqual(got, [
    ["PR-LOG", "src/patients.ts", 14, "error", 11],
    ["PR-LOG", "src/patients.ts", 22, "error", 1],
    ["PR-THIRD-PARTY", "src/analytics.ts", 12, "warning", 1],
    ["PR-THIRD-PARTY", "src/appointments.ts", 11, "warning", 1],
    ["PR-ANALYTICS", "src/analytics.ts", 9, "error", 2],
    ["PR-FILE", "src/billing.ts", 8, "warning", 2],
    ["PR-URL-QUERY", "src/appointments.ts", 11, "error", 1],
    ["PR-TRANSFER", "src/analytics.ts", 9, "error", 2],
    ["PR-TRANSFER", "src/analytics.ts", 12, "warning", 1],
  ]);
  const log14 = runModel("PR-LOG", model)[0]!;
  assert.deepEqual(keys(log14.articles.lgpd), ["6 VII", "11", "14", "46"]);
  assert.deepEqual(keys(log14.articles.gdpr), ["5(1)(f)", "8", "9(1)", "32"]);
  const third = runModel("PR-THIRD-PARTY", model)[0]!;
  assert.deepEqual(third.sink!.hop, { via: "payload", line: 11 });
  const url = runModel("PR-URL-QUERY", model)[0]!;
  assert.deepEqual([url.categories, url.confidence], [["identifier.nif-pt"], 0.6]);
});

test("[ENG-10] PR-TRANSFER fires only for a known vendor with needs-mechanism or conditional", () => {
  assert.equal(run("PR-TRANSFER", ANALYTICS).length, 2);
  const unknown = { ...SCHEMA, "src/appointments.ts": demo("src/appointments.ts") };
  assert.equal(run("PR-TRANSFER", unknown).length, 0);
  const third = run("PR-THIRD-PARTY", unknown)[0]!;
  assert.match(third.message, /unknown destination/);
  assert.deepEqual(third.transfer!.map((t) => t.status), ["unknown-destination", "unknown-destination"]);
  const config: ProjectConfig = JSON.parse(source("../config/vendor-mechanism.json"));
  const declared = { ...SCHEMA, "src/a.ts": 'import type { Patient } from "@prisma/client";\nexport async function s(patient: Patient) {\n  await fetch("https://api.mixpanel.com/engage", { body: JSON.stringify({ email: patient.email }) });\n}\n' };
  assert.equal(run("PR-TRANSFER", declared, { config }).length, 0);
  const tp = run("PR-THIRD-PARTY", declared, { config })[0]!;
  assert.match(tp.message, /mechanism declared in config: scc; verify the contract/);
  assert.equal(tp.severity, "note", "mechanism-declared uses the adequate row: other personal → note");
  assert.equal(run("PR-TRANSFER", declared).length, 1);
});

test("[ENG-10] a non-literal URL gives PR-THIRD-PARTY note with 'unresolved host' and no PR-TRANSFER", () => {
  const files = patientFn("export async function s(patient: Patient, url: string) {\n  await fetch(url, { body: JSON.stringify({ email: patient.email }) });\n}");
  const [f] = run("PR-THIRD-PARTY", files);
  assert.deepEqual([f!.severity, f!.sink!.host, f!.transfer], ["note", undefined, undefined]);
  assert.match(f!.message, /unresolved host/);
  assert.equal(run("PR-TRANSFER", files).length, 0);
});

test("[FLOW-07] fetch('/api/patients', { body }) yields neither PR-THIRD-PARTY nor PR-TRANSFER", () => {
  const files = { ...SCHEMA, "src/relative-url.ts": source("relative-url.ts") };
  assert.equal(run("PR-THIRD-PARTY", files).length, 0);
  assert.equal(run("PR-TRANSFER", files).length, 0);
});

test("not-personal categories (cnpj) never produce a sink finding", () => {
  assert.equal(run("PR-LOG", patientFn("export function f(clinic: Clinic) {\n  console.log(clinic.cnpj);\n}")).length, 0);
  assert.equal(run("PR-LOG", patientFn("export function f(cnpj: string) {\n  console.log(cnpj);\n}")).length, 0);
  // an entity field below the threshold keeps member-chain precedence: clinic.name is not a person's name at 0.60
  const named = run("PR-LOG", patientFn("export function f(clinic: Clinic) {\n  console.log(clinic.name);\n}"));
  assert.deepEqual(named.map((f) => [f.categories, f.confidence]), [[["name.full-name"], 0.3]]);
});

test("PR-FILE and PR-LOG messages name the sink and never a value", () => {
  const files = { ...SCHEMA, "src/b.ts": 'import * as fs from "node:fs";\nexport function w(cpf: string) {\n  const note = "245.452.155-56";\n  fs.appendFileSync("a.log", cpf + note);\n  console.log(cpf);\n}\n' };
  const file = run("PR-FILE", files)[0]!;
  assert.match(file.message, /fs\.appendFileSync/);
  assert.doesNotMatch(JSON.stringify(file), /245\.452\.155-56/);
  assert.equal(run("PR-LOG", files)[0]!.severity, "error");
});

test("compressKeys compresses numbers, roman items and letter suffixes for display only", () => {
  assert.equal(compressKeys(["44", "45", "46"]), "44-46");
  assert.equal(compressKeys(["6 I", "6 II", "6 III", "7"]), "6 I-III, 7");
  assert.equal(compressKeys(["5(1)(b)", "5(1)(c)", "6"]), "5(1)(b)(c), 6");
  assert.equal(compressKeys(["33", "33 II", "33 VIII", "34", "35", "36"]), "33, 33 II, 33 VIII, 34-36");
  assert.equal(compressKeys(["44", "45", "46", "47", "49"]), "44-47, 49");
  assert.equal(compressKeys(["6 III", "15", "16"]), "6 III, 15, 16");
  assert.equal(compressKeys(["8", "recital 38", "recital 75"]), "8, recital 38, recital 75");
  assert.equal(compressKeys([]), "");
});

// ---------------------------------------------------------------------------------------------
// Entity, literal and parse rules

const fixtureSchemaModel = (opts?: ModelOptions) => buildModelFromTexts({ ...SCHEMA, "migrations/001_init.sql": demo("migrations/001_init.sql") }, opts);
const sel = (f: readonly RawFinding[], id: RuleId) => f.filter((x) => x.ruleId === id);

test("[ENG-06] Patient: PR-RETENTION warning, PR-CHILD note and PR-PLAINTEXT-SENSITIVE for diagnosis, allergies and bloodType", () => {
  const f = applyRules(fixtureSchemaModel());
  assert.deepEqual(sel(f, "PR-PLAINTEXT-SENSITIVE").map((x) => x.entity!.field).sort(), ["allergies", "bloodType", "diagnosis"]);
  const diagnosis = sel(f, "PR-PLAINTEXT-SENSITIVE").find((x) => x.entity!.field === "diagnosis")!;
  assert.deepEqual([diagnosis.location.file, diagnosis.location.line, diagnosis.location.column, diagnosis.severity, diagnosis.confidence], ["prisma/schema.prisma", 14, 3, "warning", 0.6]);
  assert.deepEqual(diagnosis.categories, ["special.health"]);
  assert.equal(diagnosis.location.snippet, "diagnosis String");
  const retention = sel(f, "PR-RETENTION");
  assert.deepEqual(retention.map((x) => [x.entity!.name, x.severity, x.confidence, x.location.file, x.location.line]), [
    ["Appointment", "note", 0.5, "prisma/schema.prisma", 22],
    ["Patient", "warning", 0.75, "prisma/schema.prisma", 3],
  ]);
  assert.equal(sel(f, "PR-RETENTION").find((x) => x.entity!.name === "Patient")!.severity, "warning");
  assert.equal(sel(f, "PR-RETENTION").find((x) => x.entity!.name === "Appointment")!.severity, "note");
  const child = sel(f, "PR-CHILD");
  assert.equal(child.length, 1);
  assert.deepEqual([child[0]!.entity!.name, child[0]!.severity, child[0]!.categories, child[0]!.location.line], ["Patient", "note", ["children.guardian"], 3]);
  assert.match(child[0]!.message, /minority is not asserted/);
  assert.deepEqual(keys(child[0]!.articles.gdpr), ["8", "recital 38", "recital 75"]);
});

test("[ENG-06] diagnosis_enc and a field commented encrypted produce no PR-PLAINTEXT-SENSITIVE", () => {
  const schema = [
    "model Record {",
    "  id            String @id",
    "  diagnosis_enc String",
    "  bloodTypeHash String",
    "  /// encrypted at rest by the application",
    "  allergies     String",
    "  diagnosis     Bytes  @db.Bytes",
    "  medications   String",
    "}",
    "",
  ].join("\n");
  const f = sel(applyRules(buildModelFromTexts({ "prisma/schema.prisma": schema })), "PR-PLAINTEXT-SENSITIVE");
  assert.deepEqual(f.map((x) => x.entity!.field), ["medications"]);
  const rls = sel(applyRules(buildModelFromTexts({ "a.sql": "CREATE TABLE notes (id text, diagnosis text);\nALTER TABLE notes ENABLE ROW LEVEL SECURITY;\n" })), "PR-PLAINTEXT-SENSITIVE");
  assert.deepEqual(rls, []);
});

test("[ENG-06] an interface or z.object DTO never produces entity findings", () => {
  const f = applyRules(buildModelFromTexts({ "src/dto-only.ts": source("dto-only.ts"), "src/schema.ts": 'import { z } from "zod";\nexport const Intake = z.object({ email: z.string(), diagnosis: z.string(), guardian: z.string() });\n' }));
  assert.deepEqual(f.filter((x) => ["PR-RETENTION", "PR-PLAINTEXT-SENSITIVE", "PR-CHILD"].includes(x.ruleId)), []);
});

test("[ENG-12] one PR-HARDCODED-VALUE per file at the first qualifying hit with the union of categories and the count", () => {
  const f = sel(applyRules(buildModelFromTexts({ "src/server.ts": demo("src/server.ts"), "migrations/001_init.sql": demo("migrations/001_init.sql") })), "PR-HARDCODED-VALUE");
  assert.deepEqual(f.map((x) => [x.location.file, x.location.line, x.severity, x.confidence]), [
    ["src/server.ts", 13, "warning", 0.9],
    ["migrations/001_init.sql", 43, "warning", 0.9],
  ]);
  const server = f[0]!;
  assert.match(server.message, /^9 hard-coded personal values \(/);
  assert.deepEqual(server.categories, ["contact.email", "financial.card-pan", "financial.iban", "identifier.bsn-nl", "identifier.cpf", "identifier.nir-fr", "identifier.steuer-id-de"]);
  assert.match(f[1]!.message, /^6 hard-coded personal values \(identifier.codice-fiscale-it, identifier.cpf, identifier.dni-es, identifier.nie-es, identifier.nif-pt\)/);
  assert.equal(f[1]!.location.column, 14);
  for (const x of f) assert.doesNotMatch(JSON.stringify(x), /159\.368|245\.452|205174418/);
});

test("[ENG-12] a file whose only hits are a CNPJ or n/a hits yields no PR-HARDCODED-VALUE", () => {
  const f = applyRules(buildModelFromTexts({ "a.sql": "INSERT INTO clinics (cnpj) VALUES ('67.577.703/0001-58');\n", "b.ts": 'export const reading = { total: "205174418" };\n' }));
  assert.deepEqual(sel(f, "PR-HARDCODED-VALUE"), []);
  const test = sel(applyRules(buildModelFromTexts({ "tests/seed.ts": 'export const seed = { email: "someone@example.invalid" };\n' })), "PR-HARDCODED-VALUE");
  assert.deepEqual(test.map((x) => x.confidence), [0.6], "the test-path penalty applies to the literal rule");
});

test("[SCH-03] entity findings from the Prisma model and the SQL table are de-duplicated keeping the Prisma location", () => {
  const f = applyRules(fixtureSchemaModel());
  assert.equal(sel(f, "PR-RETENTION").filter((x) => x.entity!.name === "Patient").length, 1);
  const prisma = sel(f, "PR-PLAINTEXT-SENSITIVE")[0]!;
  const fromSql: RawFinding = { ...prisma, location: { ...prisma.location, file: "migrations/001_init.sql", line: 20 } };
  const fromTs: RawFinding = { ...prisma, location: { ...prisma.location, file: "src/a.ts", line: 2 } };
  const deduped = dedupeFindings([fromTs, fromSql, prisma]);
  assert.deepEqual(deduped.map((x) => x.location.file), ["prisma/schema.prisma"]);
  assert.deepEqual(dedupeFindings([fromTs, fromSql]).map((x) => x.location.file), ["migrations/001_init.sql"]);
});

test("PR-PARSE notes for PARSE_ERROR, DEPTH_LIMIT and UNSUPPORTED_DIALECT, confidence 1.0", () => {
  const f = sel(
    applyRules(
      buildModelFromTexts({
        "bad.ts": "foo(a, b;\n",
        "deep.ts": `export const d = ${"[".repeat(400)}${"]".repeat(400)};\n`,
        "mysql.sql": source("mysql.sql"),
        "mixed.sql": source("mixed-statements.sql"),
      }),
    ),
    "PR-PARSE",
  );
  assert.deepEqual(f.map((x) => [x.location.file, x.location.line, x.severity, x.confidence, x.confidenceLevel]), [
    ["bad.ts", 1, "note", 1, "high"],
    ["deep.ts", 1, "note", 1, "high"],
    ["mysql.sql", 1, "note", 1, "high"],
    ["mixed.sql", 4, "note", 1, "high"],
  ]);
  assert.deepEqual(f.map((x) => x.message.includes("DEPTH_LIMIT") || x.message.includes("PARSE_ERROR") || x.message.includes("UNSUPPORTED_DIALECT")), [true, true, true, true]);
  assert.deepEqual(f[0]!.articles, { lgpd: [], gdpr: [] });
  assert.deepEqual(f[0]!.categories, []);
});

test("every raw finding of the fixture is valid once id, fingerprint and belowThreshold are added", () => {
  const files: Record<string, string> = { ...SCHEMA, "migrations/001_init.sql": demo("migrations/001_init.sql") };
  for (const f of ["analytics", "appointments", "billing", "logger", "patients", "server"]) files[`src/${f}.ts`] = demo(`src/${f}.ts`);
  for (const raw of applyRules(buildModelFromTexts(files))) {
    const r = findingSchema.safeParse({ ...raw, id: "PRF-000000000000", fingerprint: "0".repeat(32), belowThreshold: false });
    assert.ok(r.success, `${raw.ruleId} ${raw.location.file}:${raw.location.line} ${JSON.stringify(r.error?.issues)}`);
  }
});

test("RULES lists the twelve rule ids in rules.json order", () => {
  assert.deepEqual(RULES.map((r) => r.id), loadCatalog().rules.map((r) => r.id));
  assert.deepEqual(ruleOf("PR-AMBIGUOUS").apply(fixtureSchemaModel()), []);
});
