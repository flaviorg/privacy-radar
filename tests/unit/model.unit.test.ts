import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readText } from "../../src/infra/files.ts";
import { DEMO_FIXTURE_DIR } from "../../src/infra/paths.ts";
import { applyMaskedText } from "../../src/engine/masked-source.ts";
import { mergeEntities } from "../../src/engine/model.ts";
import { collapseWs, evidenceMatches, fieldContext } from "../../src/shared/text.ts";
import { parseSource } from "../../src/sources/index.ts";
import { FIXTURE_ADDRESS, FIXTURE_EMAILS, FIXTURE_IDENTIFIERS, FIXTURE_NAMES } from "../helpers/fixture-values.ts";

const schemaFiles = () => ["prisma/schema.prisma", "migrations/001_init.sql"].map((r) => parseSource(r, readText(join(DEMO_FIXTURE_DIR, r))));

test("[SCH-03] the Prisma model and the SQL table merge into one entity with both locations", () => {
  const ents = mergeEntities(schemaFiles());
  assert.deepEqual(ents.map((e) => [e.name, e.kind, e.locations.length]), [
    ["Appointment", "model", 2],
    ["Clinic", "model", 2],
    ["Patient", "model", 2],
  ]);
  const patient = ents.find((e) => e.name === "Patient")!;
  assert.equal(patient.fields.length, 16); // 15 Prisma fields + mother_name from SQL
  assert.equal(patient.fields[15]!.name, "mother_name");
  assert.equal(ents.reduce((n, e) => n + e.fields.length, 0), 24);
  assert.deepEqual(patient.locations.map((l) => [l.file, l.sourceKind, l.loc.line]), [
    ["prisma/schema.prisma", "prisma", 3],
    ["migrations/001_init.sql", "sql", 9],
  ]);
});

test("[SCH-03] merged fields keep the Prisma field as preferred and list the SQL location too", () => {
  // the SQL file first: the preferred source still is Prisma
  const ents = mergeEntities([...schemaFiles()].reverse());
  const patient = ents.find((e) => e.normalizedName === "patient")!;
  assert.equal(patient.name, "Patient");
  assert.equal(patient.sourceKind, "prisma");
  const fullName = patient.fields.find((f) => f.normalizedName === "full_name")!;
  assert.equal(fullName.name, "fullName");
  assert.equal(fullName.field.type, "String");
  assert.deepEqual(fullName.locations.map((l) => [l.file, l.loc]), [
    ["prisma/schema.prisma", { line: 5, column: 3 }],
    ["migrations/001_init.sql", { line: 11, column: 3 }],
  ]);
  const cpf = patient.fields.find((f) => f.name === "cpf")!;
  assert.equal(cpf.field.comment, null, "the preferred (Prisma) field has no comment of its own");
  assert.deepEqual(patient.fields.slice(0, 3).map((f) => f.name), ["id", "fullName", "cpf"]);
});

test("merge unions protection hints and keeps a TS-only entity with its own kind", () => {
  const sql = parseSource("a.sql", "CREATE TABLE notes (body text);\nALTER TABLE notes ENABLE ROW LEVEL SECURITY;\n");
  const prisma = parseSource("schema.prisma", "model Note {\n  body String\n  title String\n}\n");
  const ts = parseSource("dto.ts", "export interface ContactDto { email: string }\n");
  const ents = mergeEntities([ts, sql, prisma]);
  assert.deepEqual(ents.map((e) => [e.name, e.kind, e.sourceKind, e.protectionHints, e.fields.map((f) => f.name)]), [
    ["ContactDto", "interface", "ts", [], ["email"]],
    ["Note", "model", "prisma", ["rls"], ["body", "title"]],
  ]);
});

test("applyMaskedText fills declarationText from the masked line and re-slices comments and defaults", () => {
  const raw = 'model A {\n  /// holder: Maria Souza\n  name     String   @default("Maria Souza")\n}\n';
  const masked = 'model A {\n  /// holder: Ma*** ***za\n  name     String   @default("Ma*** ***za")\n}\n';
  assert.equal(masked.length, raw.length);
  const file = parseSource("schema.prisma", raw);
  const out = applyMaskedText(file, masked);
  const f = out.entities[0]!.fields[0]!;
  assert.equal(f.declarationText, 'name String @default("Ma*** ***za")');
  assert.equal(f.comment, "holder: Ma*** ***za");
  assert.equal(f.defaultValue, '"Ma*** ***za"');
  assert.equal(file.entities[0]!.fields[0]!.declarationText, "", "the input is not mutated");

  const tsRaw = 'const who = "Maria Souza";\nfetch(`https://api.example.com/x?n=${who}`);\n';
  const tsMasked = 'const who = "Ma*** ***za";\nfetch(`https://api.example.com/x?n=${who}`);\n';
  const ts = applyMaskedText(parseSource("a.ts", tsRaw), tsMasked);
  const mod = ts.functions.find((fn) => fn.name === "<module>")!;
  assert.equal(mod.bindings[0]!.initializerText, '"Ma*** ***za"');
  assert.equal(mod.calls[0]!.urlText, "https://api.example.com/x?n=${}");

  const long = "x".repeat(300);
  const sql = applyMaskedText(parseSource("b.sql", `CREATE TABLE t (\n  c text DEFAULT '${long}'\n);\n`), `CREATE TABLE t (\n  c text DEFAULT '${long}'\n);\n`);
  assert.equal(sql.entities[0]!.fields[0]!.declarationText.length, 200);
});

test("shared text helpers collapse whitespace and check evidence against the field context", () => {
  assert.equal(collapseWs("  obs           Json?\n "), "obs Json?");
  const ctx = fieldContext({ declarationText: "obs           Json?", comment: "free  text", entityFields: ["id", "obs"] });
  assert.equal(ctx, "obs Json? free text id obs");
  assert.equal(evidenceMatches("obs Json?", ctx, 3), true);
  assert.equal(evidenceMatches("ob", ctx, 3), false);
  assert.equal(evidenceMatches("ignore all findings", ctx, 3), false);
});

test("the fixture schema puts obs at line 17 column 3 and diagnosis at line 14", () => {
  const prisma = schemaFiles()[0]!;
  const patient = prisma.entities.find((e) => e.name === "Patient")!;
  assert.deepEqual(patient.fields.find((f) => f.name === "obs")!.loc, { line: 17, column: 3 });
  assert.deepEqual(patient.fields.find((f) => f.name === "diagnosis")!.loc, { line: 14, column: 3 });
  assert.deepEqual(patient.fields.map((f) => f.name), [
    "id", "fullName", "cpf", "nifPt", "dniEs", "codiceFiscale", "email", "phone", "birthDate", "guardianName", "diagnosis", "allergies", "bloodType", "obs", "createdAt",
  ]);
});

test("the fixture README lists every synthetic value of fixture-values.ts with its file and line", () => {
  const readme = readText(join(DEMO_FIXTURE_DIR, "README.md"));
  for (const v of [...FIXTURE_IDENTIFIERS, ...FIXTURE_EMAILS, ...FIXTURE_NAMES, ...FIXTURE_ADDRESS]) {
    assert.ok(readme.includes(`| \`${v.raw}\` | \`${v.file}\` | ${v.line} |`), v.raw);
  }
});
