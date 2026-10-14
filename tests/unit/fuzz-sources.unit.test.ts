import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readText } from "../../src/infra/files.ts";
import { detectKind, parseSource } from "../../src/sources/index.ts";
import type { SourceFile } from "../../src/contracts/source-model.ts";
import { PROJECT_ROOT_FOR_TESTS } from "../helpers/child-node-args.ts";
import { mulberry32, propertySeed, randomString } from "../helpers/prng.ts";

const fx = (rel: string) => join(PROJECT_ROOT_FOR_TESTS, "tests", "fixtures", rel);

test("[SRC-06] 200 seeded random byte strings as .ts never throw out of parseSource", () => {
  const seed = propertySeed();
  const rnd = mulberry32(seed);
  for (let i = 0; i < 200; i++) {
    const s = randomString(rnd, 0, 400);
    let r: SourceFile | undefined;
    assert.doesNotThrow(() => {
      r = parseSource("f.ts", s);
    }, `seed=${seed} i=${i}`);
    assert.ok(Array.isArray(r!.warnings), `seed=${seed} i=${i}`);
    assert.equal(r!.kind, "ts", `seed=${seed} i=${i}`);
  }
});

test("[SRC-06] garbage .sql and .prisma files and 200 seeded random strings per kind never throw out of parseSource", () => {
  const seed = propertySeed();
  for (const [rel, kind] of [
    ["f.sql", "sql"],
    ["schema.prisma", "prisma"],
  ] as const) {
    const rnd = mulberry32(seed);
    for (let i = 0; i < 200; i++) {
      const s = randomString(rnd, 0, 400);
      let r: SourceFile | undefined;
      assert.doesNotThrow(() => {
        r = parseSource(rel, s);
      }, `seed=${seed} kind=${kind} i=${i}`);
      assert.equal(r!.kind, kind, `seed=${seed} i=${i}`);
      assert.ok(Array.isArray(r!.warnings), `seed=${seed} i=${i}`);
    }
  }
  const garbage: [string, string][] = [
    ["a.sql", "CREATE TABLE (((;;; INSERT INTO VALUES ('unterminated"],
    ["b.sql", "$$ never closed ; /* nor this"],
    ["c.sql", "\u0000\u0001 E'\\"],
    ["schema.prisma", "model A { x String @default(\"\n} model { @@map("],
    ["d.prisma", "{{{{ }}}} @ @@ /// // \"\\\""],
  ];
  for (const [rel, text] of garbage) assert.doesNotThrow(() => parseSource(rel, text), rel);
});

test("[SRC-06] garbage, empty and deeply nested files come back as SourceFiles with warnings", () => {
  for (const [rel, text] of [
    ["empty.ts", ""],
    ["nul.ts", "\u0000\u0001\u0002"],
    ["deep.ts", `export const d = ${"[".repeat(400)}${"]".repeat(400)};`],
    ["deeper.ts", `export const d = ${"(".repeat(700)}1${")".repeat(700)};`],
    ["x.sql", "CREATE TABLE ("],
    ["schema.prisma", "model {"],
  ] as const) {
    const r = parseSource(rel, text);
    assert.ok(Array.isArray(r.warnings), rel);
  }
  assert.deepEqual(parseSource("deep.ts", `export const d = ${"[".repeat(400)}${"]".repeat(400)};`).warnings.map((w) => w.code), ["DEPTH_LIMIT"]);
});

test("detectKind by extension: ts family, sql, every .prisma, never .d.ts", () => {
  const cases: [string, string | null][] = [
    ["a.ts", "ts"],
    ["a.tsx", "ts"],
    ["a.js", "ts"],
    ["a.jsx", "ts"],
    ["a.mjs", "ts"],
    ["a.cjs", "ts"],
    ["types.d.ts", null],
    ["migrations/001.sql", "sql"],
    ["prisma/schema.prisma", "prisma"],
    ["prisma/schema/patient.prisma", "prisma"],
    ["README.md", null],
    ["package.json", null],
  ];
  for (const [rel, kind] of cases) assert.equal(detectKind(rel), kind, rel);
});

test("parseSource for a TS file returns entities, functions and literal bindings with the path", () => {
  const r = parseSource("src/a.ts", 'export interface P { email: string }\nconst o = { fullName: "X" };\nconsole.log(o);\n');
  assert.deepEqual([r.path, r.kind, r.entities.map((e) => e.name), r.functions.map((f) => f.name), r.literalBindings.map((b) => b.bindingName)], [
    "src/a.ts",
    "ts",
    ["P"],
    ["<module>"],
    ["fullName"],
  ]);
});

const shape = (f: SourceFile) => ({
  entities: f.entities.map((e) => [e.name, e.loc.line, e.loc.column, e.fields.map((x) => [x.name, x.loc.line, x.loc.column, x.type, x.comment])]),
  calls: f.functions.flatMap((fn) => fn.calls.map((c) => [fn.name, c.calleeText, c.loc.line, c.loc.column, c.urlText])),
  bindings: f.functions.flatMap((fn) => fn.bindings.map((b) => [b.name, b.loc.line, b.loc.column, b.refersTo])),
  literals: f.literalBindings.map((b) => [b.bindingName, b.line, b.column]),
  warnings: f.warnings,
});

test("[RF-2] a CRLF file with a BOM yields the same entities, lines and columns as its LF twin", () => {
  const lf = parseSource("lf.ts", readText(fx("sources/crlf-bom/lf.ts")));
  const crlf = parseSource("crlf.ts", readText(fx("sources/crlf-bom/crlf.ts")));
  assert.deepEqual(shape(crlf), { ...shape(lf), warnings: [] });
  assert.equal(lf.entities.length, 1);
  assert.ok(lf.functions.some((f) => f.calls.some((c) => c.calleeText === "console.info")));
  assert.ok(!JSON.stringify(shape(crlf)).includes("\\r"));
});
