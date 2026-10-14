import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readText } from "../../src/infra/files.ts";
import type { Field, SourceFile } from "../../src/contracts/source-model.ts";
import { detectKind, parseSource } from "../../src/sources/index.ts";
import { parsePrismaSource } from "../../src/sources/prisma/parse.ts";
import { tokenizePrisma } from "../../src/sources/prisma/tokenizer.ts";
import { PROJECT_ROOT_FOR_TESTS } from "../helpers/child-node-args.ts";

const fx = (f: string) => join(PROJECT_ROOT_FOR_TESTS, "tests", "fixtures", "sources", f);
const read = (f: string) => readFileSync(fx(f), "utf8");
const pick = (f: Field) => ({ type: f.type, optional: f.optional, array: f.array, loc: f.loc });

test("tokenizer: words, strings with escapes, attributes, block attributes, doc comments, newlines; // dropped", () => {
  const toks = tokenizePrisma('/// doc\nmodel A { // dropped\n  x String? @db.Text @default("a\\"b")\n  @@map("as")\n}\r\n');
  assert.deepEqual(
    toks.map((t) => [t.kind, t.text]),
    [
      ["docComment", "/// doc"],
      ["newline", "\n"],
      ["word", "model"],
      ["word", "A"],
      ["punct", "{"],
      ["newline", "\n"],
      ["word", "x"],
      ["word", "String"],
      ["punct", "?"],
      ["attr", "@db.Text"],
      ["attr", "@default"],
      ["punct", "("],
      ["string", '"a\\"b"'],
      ["punct", ")"],
      ["newline", "\n"],
      ["blockAttr", "@@map"],
      ["punct", "("],
      ["string", '"as"'],
      ["punct", ")"],
      ["newline", "\n"],
      ["punct", "}"],
      ["newline", "\n"],
    ],
  );
  const x = toks.find((t) => t.text === "x")!;
  assert.deepEqual([x.line, x.column, x.start], [3, 3, 31]);
});

test("[SCH-04] models, fields, optional/array, attributes, @@map and doc comments with exact positions", () => {
  const f = parsePrismaSource("schema.prisma", read("schema.prisma"));
  assert.deepEqual(f.warnings, []);
  assert.deepEqual(f.entities.map((e) => [e.name, e.kind, e.normalizedName]), [
    ["Patient", "model", "patient"],
    ["Appointment", "model", "appointment"],
    ["Clinic", "model", "clinic"],
    ["ClinicalNote", "model", "clinicalnote"],
  ]);
  const p = f.entities.find((e) => e.name === "Patient")!;
  assert.deepEqual(p.loc, { line: 3, column: 7 });
  assert.equal(p.fields.length, 15);
  assert.deepEqual(pick(p.fields.find((x) => x.name === "obs")!), { type: "Json", optional: true, array: false, loc: { line: 17, column: 3 } });
  assert.deepEqual(p.fields.find((x) => x.name === "email")!.attributes, ["@unique"]);
  assert.deepEqual(p.fields.find((x) => x.name === "birthDate")!.attributes, ["@db.Date"]);
  assert.deepEqual(p.fields.find((x) => x.name === "id")!.attributes, ["@id", "@default(cuid())"]);
  assert.deepEqual(p.fields.find((x) => x.name === "diagnosis")!.loc, { line: 14, column: 3 });
  const note = f.entities.find((e) => e.name === "ClinicalNote")!;
  const body = note.fields.find((x) => x.name === "body")!;
  assert.equal(body.comment, "Free-text body; may hold health data. Second doc line.");
  assert.deepEqual(body.attributes, ["@db.Text"]);
  assert.deepEqual(note.fields.find((x) => x.name === "author")!.attributes, ['@default("Ana Example")', '@map("author_name")']);
  assert.deepEqual(pick(note.fields.find((x) => x.name === "tags")!), { type: "String", optional: false, array: true, loc: { line: 62, column: 3 } });
  assert.deepEqual(note.fields.find((x) => x.name === "patient")!.attributes, ["@relation(fields: [patientId], references: [id])"]);
  for (const field of p.fields) assert.equal(field.declarationText, "");
});

test("[SCH-04] @default string values become literal bindings named by the field", () => {
  const text = read("schema.prisma");
  const f = parsePrismaSource("schema.prisma", text);
  assert.deepEqual(f.literalBindings.map((b) => [b.bindingName, text.slice(b.start, b.end), b.line]), [
    ["author", '"Ana Example"', 61],
    ["escaped", '"say \\"hi\\""', 63],
  ]);
  const author = f.entities.find((e) => e.name === "ClinicalNote")!.fields.find((x) => x.name === "author")!;
  assert.equal(author.defaultValue, '"Ana Example"');
  assert.equal(text.slice(author.defaultRange!.start, author.defaultRange!.end), '"Ana Example"');
  const createdAt = f.entities.find((e) => e.name === "Patient")!.fields.find((x) => x.name === "createdAt")!;
  assert.equal(createdAt.defaultValue, "now()");
});

test("[SCH-04] duplicate field names across models keep their own positions", () => {
  const f = parsePrismaSource("schema.prisma", read("schema.prisma"));
  const ids = f.entities.map((e) => [e.name, e.fields.find((x) => x.name === "id")?.loc ?? null]);
  assert.deepEqual(ids, [
    ["Patient", { line: 4, column: 3 }],
    ["Appointment", { line: 23, column: 3 }],
    ["Clinic", null],
    ["ClinicalNote", { line: 57, column: 3 }],
  ]);
});

test("enum, generator and datasource blocks are skipped without warnings", () => {
  const f = parsePrismaSource("x.prisma", 'generator client {\n  provider = "prisma-client-js"\n}\ndatasource db {\n  url = env("X")\n}\nenum Role {\n  A\n  B\n}\ntype Address {\n  street String\n}\n');
  assert.deepEqual([f.entities, f.warnings, f.literalBindings], [[], [], []]);
});

test("[RF-3] models split across prisma/schema/*.prisma are all scanned and merged", () => {
  assert.equal(detectKind("prisma/schema/patient.prisma"), "prisma");
  const files = ["prisma-multi/schema/patient.prisma", "prisma-multi/schema/appointment.prisma"].map((r) => parseSource(r.replace("prisma-multi/", "prisma/"), read(r)));
  assert.deepEqual(files.map((f) => [f.path, f.kind, f.entities.map((e) => e.name)]), [
    ["prisma/schema/patient.prisma", "prisma", ["Patient"]],
    ["prisma/schema/appointment.prisma", "prisma", ["Appointment"]],
  ]);
});

const shape = (f: SourceFile) => ({
  entities: f.entities.map((e) => [e.name, e.normalizedName, e.loc, e.fields.map((x) => [x.name, x.loc, x.type, x.optional, x.comment, x.attributes, x.defaultValue])]),
  literals: f.literalBindings.map((b) => [b.bindingName, b.line, b.column]),
  warnings: f.warnings,
});

test("[RF-2] a CRLF Prisma file with a BOM yields the same fields, lines and columns as its LF twin", () => {
  const lf = parseSource("lf.prisma", readText(fx("crlf-bom/lf.prisma")));
  const crlf = parseSource("crlf.prisma", readText(fx("crlf-bom/crlf.prisma")));
  assert.deepEqual(shape(crlf), shape(lf));
  assert.equal(lf.entities[0]!.fields.length, 3);
  assert.equal(lf.entities[0]!.fields[1]!.comment, "contact e-mail");
  assert.ok(!JSON.stringify(shape(crlf)).includes("\\r"));
  const withBom = parseSource("crlf.prisma", readFileSync(fx("crlf-bom/crlf.prisma"), "utf8"));
  assert.deepEqual(withBom.entities.map((e) => e.name), ["Patient"]);
});

test("garbage Prisma input never throws and keeps what it can", () => {
  for (const text of ["model {", "model A {\n  x\n", "model A { x String @default(\"unterminated", "}}}}", "@@map(\"x\")", "model A {\n  b String @relation(fields: [\n}"]) {
    assert.doesNotThrow(() => parsePrismaSource("g.prisma", text), text);
  }
});
