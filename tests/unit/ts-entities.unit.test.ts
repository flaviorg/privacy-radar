import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractEntities, normalizeEntityName } from "../../src/sources/ts/entities.ts";
import { parseTs } from "../../src/sources/ts/parse.ts";
import { LIMITS } from "../../src/contracts/limits.ts";
import type { Field } from "../../src/contracts/source-model.ts";
import { PROJECT_ROOT_FOR_TESTS } from "../helpers/child-node-args.ts";

const read = (f: string) => readFileSync(join(PROJECT_ROOT_FOR_TESTS, "tests", "fixtures", "sources", f), "utf8");
const entitiesOf = (src: string, path = "a.ts") => extractEntities(parseTs(path, src).ast!, src, path);
const pick = (f: Field) => ({ name: f.name, optional: f.optional, array: f.array, loc: f.loc });

test("[SRC-03] interfaces, type literals, classes, z.object and exported object literals become entities with 1-based positions", () => {
  const src =
    'export interface Patient {\n  email: string;\n  tags?: string[];\n}\ntype T = { cpf: string };\nclass C { phone: string = ""; }\nconst S = z.object({ diagnosis: z.string() });\nexport const DEFAULTS = { country: "BR" };\n';
  const { entities, warnings } = entitiesOf(src);
  assert.deepEqual(warnings, []);
  assert.deepEqual(
    entities.map((e) => [e.name, e.kind, e.loc.line, e.loc.column]),
    [
      ["Patient", "interface", 1, 18],
      ["T", "type", 5, 6],
      ["C", "class", 6, 7],
      ["S", "object", 7, 7],
      ["DEFAULTS", "object", 8, 14],
    ],
  );
  assert.deepEqual(pick(entities[0]!.fields[1]!), { name: "tags", optional: true, array: true, loc: { line: 3, column: 3 } });
  assert.deepEqual(entities.map((e) => e.fields.map((f) => f.name)), [["email", "tags"], ["cpf"], ["phone"], ["diagnosis"], ["country"]]);
});

test("[SRC-03] field types, defaults and comments keep their source text and ranges", () => {
  const src = 'class Visit {\n  // when the visit happens\n  at: Date;\n  notes: Array<string> = [];\n  status = "open";\n}\n';
  const [visit] = entitiesOf(src).entities;
  const [at, notes, status] = visit!.fields;
  assert.deepEqual([at!.type, at!.rawType, at!.comment, at!.array], ["Date", "Date", "when the visit happens", false]);
  assert.equal(src.slice(at!.commentRange!.start, at!.commentRange!.end), "// when the visit happens");
  assert.deepEqual([notes!.type, notes!.array, notes!.defaultValue], ["Array<string>", true, "[]"]);
  assert.deepEqual([status!.type, status!.defaultValue], [null, '"open"']);
  assert.equal(src.slice(status!.defaultRange!.start, status!.defaultRange!.end), '"open"');
  assert.deepEqual([status!.attributes, status!.declarationText, status!.rawName], [[], "", "status"]);
});

test("[SRC-03] z.object and new Schema fields carry the schema expression as their type", () => {
  const src = 'const S = z.object({ birthDate: z.date().optional(), tags: z.array(z.string()) });\nconst M = new Schema({ email: { type: String } });\n';
  const [s, m] = entitiesOf(src).entities;
  assert.deepEqual(s!.fields.map((f) => [f.name, f.rawType, f.optional, f.array]), [
    ["birthDate", "z.date().optional()", true, false],
    ["tags", "z.array(z.string())", false, true],
  ]);
  assert.deepEqual([m!.name, m!.kind, m!.fields.map((f) => f.name)], ["M", "object", ["email"]]);
});

test("[SRC-03] an exported object whose values are all functions is not an entity", () => {
  const src = "export const logger = { info: (m: string) => m, debug() {}, error: function () {} };";
  assert.deepEqual(entitiesOf(src, "l.ts").entities, []);
  const shorthand = "function info() {}\nconst debug = () => undefined;\nfunction error() {}\nexport const logger = { info, debug, error };\n";
  assert.deepEqual(entitiesOf(shorthand).entities, []);
  const mixed = "function info() {}\nexport const cfg = { info, level: 'debug' };\n";
  assert.deepEqual(entitiesOf(mixed).entities.map((e) => e.name), ["cfg"]);
});

test("an exported array of object literals is not an entity, and neither is a non-exported object literal", () => {
  const src = 'export const DEMO_SEED = [{ fullName: "A", cpf: "1" }, { fullName: "B" }];\nconst local = { email: "x" };\n';
  assert.deepEqual(entitiesOf(src).entities, []);
});

test("[SRC-03] normalizedName strips case, separators and one trailing s", () => {
  assert.equal(normalizeEntityName("Patient"), "patient");
  assert.equal(normalizeEntityName("patients"), "patient");
  assert.equal(normalizeEntityName("Clinic_Branches"), "clinicbranche");
  assert.equal(normalizeEntityName("clinic-address"), "clinicaddres");
  const { entities } = entitiesOf("export interface Patients { id: string }");
  assert.equal(entities[0]!.normalizedName, "patient");
});

test("[SRC-03] fixtures: a company entity and a DTO", () => {
  const company = entitiesOf(read("company-entity.ts")).entities;
  assert.deepEqual(company.map((e) => [e.name, e.kind, e.fields.length]), [["Company", "interface", 4]]);
  const dto = entitiesOf(read("dto-only.ts")).entities;
  assert.deepEqual(dto.map((e) => [e.name, e.kind]), [["IntakeRequestDto", "interface"]]);
  assert.deepEqual(dto[0]!.fields.map((f) => [f.name, f.optional, f.loc.line]), [["email", false, 3], ["diagnosis", false, 4], ["notes", true, 5]]);
});

test("an entity with more fields than the limit is truncated with one ENTITY_TOO_LARGE", () => {
  const n = LIMITS.entityFields + 3;
  const src = `interface Big {\n${Array.from({ length: n }, (_, i) => `  f${i}: string;`).join("\n")}\n}\n`;
  const { entities, warnings } = entitiesOf(src, "big.ts");
  assert.equal(entities[0]!.fields.length, LIMITS.entityFields);
  assert.deepEqual(warnings.map((w) => [w.code, w.file, w.line]), [["ENTITY_TOO_LARGE", "big.ts", 1]]);
});
