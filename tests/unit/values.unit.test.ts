import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCatalog } from "../../src/catalog/load.ts";
import { buildTermIndex } from "../../src/catalog/terms.ts";
import { VALUE_PATTERN_SOURCES, detectValues, lintRegexShape, maskText } from "../../src/catalog/values.ts";
import { LIMITS } from "../../src/contracts/limits.ts";
import type { LiteralBinding, ValueHit } from "../../src/contracts/source-model.ts";
import { DEMO_FIXTURE_DIR } from "../../src/infra/paths.ts";
import { parseSource } from "../../src/sources/index.ts";
import { PROJECT_ROOT_FOR_TESTS } from "../helpers/child-node-args.ts";
import { FIXTURE_ADDRESS, FIXTURE_EMAILS, FIXTURE_IDENTIFIERS, FIXTURE_NAMES } from "../helpers/fixture-values.ts";

const catalog = loadCatalog();
const termIndex = catalog.termIndex;
const fx = (rel: string) => join(PROJECT_ROOT_FOR_TESTS, "tests", "fixtures", rel);
const ctx = (over: Partial<Parameters<typeof detectValues>[1]> = {}) => ({
  path: "a.ts",
  literalBindings: [] as LiteralBinding[],
  termIndex,
  categories: catalog.categories,
  ...over,
});
const pick = (h: ValueHit) => ({ categories: h.categories, checksum: h.checksum });

function lineColOf(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, offset);
  const line = before.split("\n").length;
  return { line, column: offset - (before.lastIndexOf("\n") + 1) + 1 };
}

function binding(text: string, name: string, literal: string, from = 0): LiteralBinding {
  const start = text.indexOf(literal, from);
  assert.ok(start >= 0, `literal ${literal} not in text`);
  return { bindingName: name, start, end: start + literal.length, ...lineColOf(text, start) };
}

/** One binding per single-quoted literal, all bound to the same column name (what the SQL adapter will produce). */
function handMadeInsertBindings(text: string, column: string): LiteralBinding[] {
  return [...text.matchAll(/'[^']*'/g)].map((m) => ({ bindingName: column, start: m.index, end: m.index + m[0].length, ...lineColOf(text, m.index) }));
}

test("[VAL-04] a formatted CPF with a wrong check digit is kept as invalid, never dropped", () => {
  const [h] = detectValues("const a = '529.982.247-24';", ctx());
  assert.deepEqual(pick(h!), { categories: ["identifier.cpf"], checksum: "invalid" });
  assert.equal(h!.corroborated, true);
  assert.equal(h!.masked, "***.***.***-24");
});

test("[VAL-04] a digits-only candidate corroborated by its binding name that fails the checksum is invalid with that category", () => {
  const text = "const row = { cpf: '52998224724' };";
  const [h] = detectValues(text, ctx({ literalBindings: [binding(text, "cpf", "'52998224724'")] }));
  assert.deepEqual(pick(h!), { categories: ["identifier.cpf"], checksum: "invalid" });
});

test("[VAL-06] a formatted value passing two checksums keeps both categories", () => {
  const hits = detectValues("const v = '999 999 990';", ctx());
  assert.equal(hits.length, 1);
  assert.deepEqual(pick(hits[0]!), { categories: ["identifier.bsn-nl", "identifier.nif-pt"], checksum: "valid" });
});

test("[VAL-06] a digits-only candidate with no term nearby is n/a with no category, and masked", () => {
  const text = "const port = 999999990;\n";
  const [h] = detectValues(text, ctx());
  assert.deepEqual({ ...pick(h!), corroborated: h!.corroborated }, { checksum: "n/a", categories: [], corroborated: false });
  assert.ok(!maskText(text, { valueHits: [h!], literalBindings: [], termIndex }).includes("999999990"));
});

test("[VAL-06] a digits-only candidate is valid only for the categories its binding name corroborates", () => {
  const text = "const seed = { steuerId: '53460972865', bsn: '143973782' };";
  const b = [binding(text, "steuerId", "'53460972865'"), binding(text, "bsn", "'143973782'")];
  const hits = detectValues(text, ctx({ literalBindings: b }));
  assert.deepEqual(hits.map(pick), [
    { categories: ["identifier.steuer-id-de"], checksum: "valid" },
    { categories: ["identifier.bsn-nl"], checksum: "valid" },
  ]);
});

test("[VAL-06] every row of an 11-row INSERT is corroborated by its column", () => {
  const text = readFileSync(fx("sources/insert-eleven-rows.sql"), "utf8");
  const bindings = handMadeInsertBindings(text, "nif_pt");
  const hits = detectValues(text, { ...ctx(), path: "seed.sql", literalBindings: bindings });
  assert.equal(hits.filter((h) => h.checksum === "valid" && h.categories.includes("identifier.nif-pt")).length, 11);
  const withoutBindings = detectValues(text, { ...ctx(), path: "seed.sql" });
  assert.ok(withoutBindings.filter((h) => h.checksum === "valid").length < 11, "the line window alone misses the last rows");
});

test("[VAL-06] a comment term that matches only in suffix mode corroborates nothing (no suffix mode in free text)", () => {
  const termFile = (mode: "suffix" | "token") => ({
    lang: "xx",
    reviewed: true,
    nonPersonEntities: [],
    negativeSamples: [],
    terms: [{ category: "identifier.nif-pt", exact: [], token: mode === "token" ? ["contribuinte"] : [], suffix: mode === "suffix" ? ["contribuinte"] : [] }],
  });
  const text = "// numero_contribuinte\nconst v = '338091467';\n";
  const suffixOnly = detectValues(text, ctx({ termIndex: buildTermIndex([termFile("suffix")]) }));
  assert.deepEqual(pick(suffixOnly[0]!), { categories: [], checksum: "n/a" });
  const tokenTerm = detectValues(text, ctx({ termIndex: buildTermIndex([termFile("token")]) }));
  assert.deepEqual(pick(tokenTerm[0]!), { categories: ["identifier.nif-pt"], checksum: "valid" });
  const realCatalog = detectValues("// responsavel_mae\nconst v = '338091467';\n", ctx());
  assert.deepEqual(pick(realCatalog[0]!), { categories: [], checksum: "n/a" });
});

test("[VAL-06] corroboration window is the same line and the 10 preceding lines", () => {
  const at = (candidateLine: number) => {
    const lines = ["// nif_pt of the seed patient"];
    while (lines.length < candidateLine - 1) lines.push("const filler = 1;");
    lines.push("const v = '338091467';");
    return detectValues(lines.join("\n"), ctx())[0]!;
  };
  assert.deepEqual(pick(at(12)), { categories: [], checksum: "n/a" });
  assert.deepEqual(pick(at(11)), { categories: ["identifier.nif-pt"], checksum: "valid" });
  assert.deepEqual(pick(at(1 + 1)), { categories: ["identifier.nif-pt"], checksum: "valid" });
});

test("regex-only patterns: e-mail hits are n/a, corroborated, masked keeping the TLD; hits are sorted by start", () => {
  const text = "const a = 'ana.exemplo@example.invalid'; const iban = 'PT50 0002 0123 1234 5678 9015 4';";
  const hits = detectValues(text, ctx());
  assert.deepEqual(
    hits.map((h) => [h.categories, h.checksum, h.corroborated]),
    [
      [["contact.email"], "n/a", true],
      [["financial.iban"], "valid", true],
    ],
  );
  assert.equal(hits[0]!.masked, "***.*******@*******.invalid");
  assert.ok(hits[0]!.start < hits[1]!.start);
  assert.deepEqual([hits[0]!.line, hits[0]!.column, hits[0]!.length], [1, 12, 27]);
  assert.equal(text.slice(hits[0]!.start, hits[0]!.end), "ana.exemplo@example.invalid");
});

test("[VAL-05] every value pattern passes the shape lint", () => {
  assert.ok(VALUE_PATTERN_SOURCES(catalog).length >= 15);
  assert.deepEqual(VALUE_PATTERN_SOURCES(catalog).flatMap(lintRegexShape), []);
});

test("[VAL-05] the lint rejects nested quantifiers and unbounded lookaheads", () => {
  assert.ok(lintRegexShape("(a+)+").length > 0);
  assert.ok(lintRegexShape("(?=.*x)").length > 0);
  assert.ok(lintRegexShape("(?:ab|c*){2,}").length > 0);
  assert.ok(lintRegexShape("(x\\d{2,})*").length > 0);
  assert.deepEqual(lintRegexShape("(a+)?b"), []);
  assert.deepEqual(lintRegexShape("[(+)]+(?:\\+\\d{1,3})+"), []);
  assert.deepEqual(lintRegexShape("(?=[a-z]{1,4})x"), []);
});

test("[VAL-05] detection on a 100 kB adversarial string finishes within the budget and every hit is masked", () => {
  const s = "1.".repeat(25_000) + "a@".repeat(25_000);
  assert.equal(s.length, LIMITS.regexAdversarialBytes);
  const t0 = performance.now();
  const hits = detectValues(s, ctx());
  assert.ok(performance.now() - t0 < LIMITS.regexBudgetMs * VALUE_PATTERN_SOURCES(catalog).length);
  for (const h of hits) assert.match(h.masked, /\*/);
});

test("[VAL-05] each pattern alone stays within the per-regex budget on adversarial inputs", () => {
  const inputs = ["1.".repeat(50_000), "a@".repeat(50_000), "1 ".repeat(50_000), "a:".repeat(50_000), "A1".repeat(50_000)];
  for (const source of VALUE_PATTERN_SOURCES(catalog)) {
    const re = new RegExp(source, "g");
    for (const input of inputs) {
      const t0 = performance.now();
      for (const _ of input.matchAll(re)) void _;
      assert.ok(performance.now() - t0 < LIMITS.regexBudgetMs, `${source} on ${input.slice(0, 4)}`);
    }
  }
});

test("[OUT-06] maskText masks bound literals whose names classify, keeps others, always masks * bindings", () => {
  const ts = 'const a = { fullName: "Maria Souza", status: "active" };';
  const b = [binding(ts, "fullName", '"Maria Souza"'), binding(ts, "status", '"active"')];
  const out = maskText(ts, { valueHits: [], literalBindings: b, termIndex });
  assert.ok(out.includes('"Ma*** ***za"') && out.includes('"active"'), out);

  const sql = "INSERT INTO a VALUES ('Rua Exemplo 12', 'ok');";
  const star = [binding(sql, "*", "'Rua Exemplo 12'"), binding(sql, "*", "'ok'")];
  assert.equal(maskText(sql, { valueHits: [], literalBindings: star, termIndex }), "INSERT INTO a VALUES ('Ru* ******* 12', '**');");

  const prisma = '  email String @default("nobody@example.invalid")';
  const def = [binding(prisma, "email", '"nobody@example.invalid"')];
  assert.equal(maskText(prisma, { valueHits: [], literalBindings: def, termIndex }), '  email String @default("no****@*******.*****id")');
});

test("[OUT-06] maskText is length-preserving and keeps line breaks", () => {
  const text = "const seed = {\r\n  fullName: `Joana Exemplo`,\n  cpf: '529.982.247-25',\n  n: 3,\n};\n";
  const hits = detectValues(text, ctx());
  const b = [binding(text, "fullName", "`Joana Exemplo`"), binding(text, "cpf", "'529.982.247-25'"), binding(text, "n", "3")];
  const out = maskText(text, { valueHits: hits, literalBindings: b, termIndex });
  assert.equal(out.length, text.length);
  assert.deepEqual([...out.matchAll(/\r?\n/g)].map((m) => [m.index, m[0]]), [...text.matchAll(/\r?\n/g)].map((m) => [m.index, m[0]]));
  assert.ok(!out.includes("529.982.247") && !out.includes("Joana Exemplo"), out);
  assert.ok(out.includes("n: 3,"));
});

test("[OUT-06] the demo fixture's server.ts and SQL seed: every planted value is detected with its kind, then masked away", () => {
  const planted = [...FIXTURE_IDENTIFIERS, ...FIXTURE_EMAILS];
  for (const rel of ["src/server.ts", "migrations/001_init.sql"]) {
    const text = readFileSync(join(DEMO_FIXTURE_DIR, rel), "utf8");
    const literalBindings = parseSource(rel, text).literalBindings;
    const hits = detectValues(text, { ...ctx(), path: rel, literalBindings });
    const expected = planted.filter((v) => v.file === rel);
    assert.deepEqual(
      hits.map((h) => [text.slice(h.start, h.end), h.categories, h.checksum, h.line]),
      expected
        .map((v) => [v.raw, [v.kind], v.kind === "contact.email" ? "n/a" : "valid", v.line] as const)
        .sort((a, b) => text.indexOf(a[0]) - text.indexOf(b[0])),
      rel,
    );
    const masked = maskText(text, { valueHits: hits, literalBindings, termIndex });
    assert.equal(masked.length, text.length);
    for (const v of [...planted, ...FIXTURE_NAMES, ...FIXTURE_ADDRESS].filter((x) => x.file === rel)) assert.ok(!masked.includes(v.raw), `${rel}: ${v.raw}`);
  }
});
