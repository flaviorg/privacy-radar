import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readText } from "../../src/infra/files.ts";
import type { SourceFile } from "../../src/contracts/source-model.ts";
import { parseSource } from "../../src/sources/index.ts";
import { parseSqlSource } from "../../src/sources/sql/parse.ts";
import { splitStatements } from "../../src/sources/sql/split.ts";
import { PROJECT_ROOT_FOR_TESTS } from "../helpers/child-node-args.ts";

const fx = (f: string) => join(PROJECT_ROOT_FOR_TESTS, "tests", "fixtures", "sources", f);
const read = (f: string) => readFileSync(fx(f), "utf8");

test("[SCH-01] statements split outside quotes, E'' strings, dollar quoting and both comment styles", () => {
  const sql = "-- it's a comment; with apostrophe\nCREATE TABLE a (x text);\n/* don't; */ INSERT INTO a (x) VALUES ('a;b'), (E'c\\'d;');\nDO $$ BEGIN PERFORM 1; END $$;\n";
  const stmts = splitStatements(sql);
  assert.equal(stmts.length, 3);
  assert.equal(stmts[0]!.text, "CREATE TABLE a (x text)");
  assert.match(stmts[1]!.text, /^INSERT INTO a/);
  assert.deepEqual(stmts[1]!.quoteRanges.map((r) => sql.slice(r.start, r.end)), ["'a;b'", "E'c\\'d;'"]);
  assert.equal(stmts[2]!.text, "DO $$ BEGIN PERFORM 1; END $$");
  assert.equal(sql.slice(stmts[0]!.start, stmts[0]!.end), stmts[0]!.text);
});

test("splitter: doubled quotes, quoted identifiers, tagged dollar quotes, nested block comments, no final semicolon", () => {
  const sql = "SELECT 'it''s; fine', \"we;ird\" FROM t;\nCREATE FUNCTION f() RETURNS int AS $fn$ SELECT 1; $fn$ LANGUAGE sql;\n/* outer /* inner; */ still; */ SELECT 2";
  assert.deepEqual(
    splitStatements(sql).map((s) => s.text.slice(0, 15)),
    ["SELECT 'it''s; ", "CREATE FUNCTION", "SELECT 2"],
  );
  assert.deepEqual(splitStatements("  -- only a comment\n/* and another */\n;;\n"), []);
});

test("[SCH-01] CREATE TABLE with ALTER ADD COLUMN and COMMENT ON COLUMN merged, 1-based lines and columns", () => {
  const f = parseSqlSource("postgres.sql", read("postgres.sql"));
  assert.deepEqual(f.warnings, []);
  const p = f.entities.find((e) => e.name === "patients")!;
  assert.equal(p.kind, "table");
  assert.equal(p.normalizedName, "patient");
  assert.deepEqual(p.loc, { line: 2, column: 14 });
  assert.deepEqual(p.fields.map((x) => x.name), ["id", "cpf", "full_name", "diagnosis", "tags", "mother_name"]);
  const cpf = p.fields.find((x) => x.name === "cpf")!;
  assert.equal(cpf.comment, "Brazilian taxpayer id");
  assert.equal(read("postgres.sql").slice(cpf.commentRange!.start, cpf.commentRange!.end), "Brazilian taxpayer id");
  assert.deepEqual(cpf.loc, { line: 4, column: 3 });
  assert.deepEqual([cpf.type, cpf.attributes, cpf.optional], ["varchar", ["unique"], true]);
  assert.deepEqual(p.fields.find((x) => x.name === "id")!.attributes, ["primary key"]);
  assert.equal(p.fields.find((x) => x.name === "full_name")!.optional, false);
  assert.deepEqual(pickArray(p.fields.find((x) => x.name === "tags")!), { type: "text", array: true });
  assert.deepEqual(p.fields.find((x) => x.name === "mother_name")!.loc, { line: 11, column: 33 });
  for (const field of p.fields) assert.equal(field.declarationText, "");
  // an ALTER TABLE on a table created elsewhere becomes its own entity, merged later by name
  const visits = f.entities.find((e) => e.name === "visits")!;
  assert.deepEqual(visits.fields.map((x) => x.name), ["visitor_email"]);
});

function pickArray(f: { type: string | null; array: boolean }) {
  return { type: f.type, array: f.array };
}

test("[SCH-02] a MySQL file yields one UNSUPPORTED_DIALECT and no entity", () => {
  const f = parseSqlSource("mysql.sql", read("mysql.sql"));
  assert.deepEqual(f.warnings.map((w) => [w.code, w.file]), [["UNSUPPORTED_DIALECT", "mysql.sql"]]);
  assert.deepEqual(f.entities, []);
});

test("[SCH-02] one bad CREATE TABLE gives PARSE_ERROR with its line and the other statements still parse", () => {
  const f = parseSqlSource("mixed-statements.sql", read("mixed-statements.sql"));
  assert.deepEqual(f.warnings.map((w) => [w.code, w.line]), [["PARSE_ERROR", 4]]);
  assert.doesNotMatch(f.warnings[0]!.message, /name text/);
  assert.deepEqual(f.entities.map((e) => [e.name, e.fields.map((x) => x.name)]), [
    ["good_one", ["email", "phone"]],
    ["good_two", ["birth_date"]],
  ]);
});

test("[SCH-02] CREATE POLICY is ignored and ENABLE ROW LEVEL SECURITY becomes the rls hint", () => {
  const f = parseSqlSource("comments-and-rls.sql", read("comments-and-rls.sql"));
  assert.deepEqual(f.warnings, []);
  assert.deepEqual(f.entities.map((e) => [e.name, e.protectionHints]), [
    ["notes", ["rls"]],
    ["other", []],
  ]);
});

test("[SCH-05] INSERT literals are bound to their column by position", () => {
  const text = "INSERT INTO patients (id, cpf, nif_pt) VALUES ('1', '529.982.247-25', '123456789');";
  const f = parseSqlSource("x.sql", text);
  assert.deepEqual(f.literalBindings.map((b) => b.bindingName), ["id", "cpf", "nif_pt"]);
  assert.deepEqual(f.literalBindings.map((b) => text.slice(b.start, b.end)), ["'1'", "'529.982.247-25'", "'123456789'"]);
  assert.deepEqual(f.literalBindings.map((b) => [b.line, b.column]), [
    [1, 48],
    [1, 53],
    [1, 71],
  ]);
  const multi = parseSqlSource("y.sql", "INSERT INTO t (a, b) VALUES\n  ('x', 42),\n  (NULL, -3.5);");
  assert.deepEqual(multi.literalBindings.map((b) => [b.bindingName, b.line]), [
    ["a", 2],
    ["b", 2],
    ["b", 3],
  ]);
});

test("[SCH-05] an unparsable INSERT (E'it\\'s') binds every quoted literal to * without a warning", () => {
  const text = read("insert-unparseable.sql");
  let f: SourceFile | undefined;
  assert.doesNotThrow(() => {
    f = parseSqlSource("insert-unparseable.sql", text);
  });
  assert.deepEqual(f!.warnings, []);
  assert.deepEqual(f!.literalBindings.map((b) => [b.bindingName, text.slice(b.start, b.end)]), [
    ["*", "E'it\\'s Ana Example'"],
    ["*", "'second literal'"],
  ]);
});

test("an INSERT without a column list binds every literal to *", () => {
  const text = read("insert-no-columns.sql");
  const f = parseSqlSource("insert-no-columns.sql", text);
  assert.deepEqual(f.literalBindings.map((b) => [b.bindingName, text.slice(b.start, b.end)]), [
    ["*", "'p-9'"],
    ["*", "'Ana Example'"],
    ["*", "42"],
  ]);
});

test("the demo fixture SQL binds the digits-only PT NIFs to nif_pt", () => {
  const text = readText(join(PROJECT_ROOT_FOR_TESTS, "fixtures", "telehealth-clinic", "migrations", "001_init.sql"));
  const f = parseSqlSource("migrations/001_init.sql", text);
  assert.deepEqual(f.warnings, []);
  assert.deepEqual(f.entities.map((e) => [e.name, e.fields.length]), [
    ["clinics", 3],
    ["patients", 16],
    ["appointments", 5],
  ]);
  const nif = f.literalBindings.filter((b) => b.bindingName === "nif_pt").map((b) => text.slice(b.start, b.end));
  assert.deepEqual(nif.length, 2);
  assert.ok(nif.every((v) => /^'\d{9}'$/.test(v)));
});

const shape = (f: SourceFile) => ({
  entities: f.entities.map((e) => [e.name, e.loc, e.fields.map((x) => [x.name, x.loc, x.type, x.comment, x.attributes])]),
  literals: f.literalBindings.map((b) => [b.bindingName, b.line, b.column]),
  warnings: f.warnings.map((w) => [w.code, w.line]),
});

test("[RF-2] a CRLF SQL file with a BOM yields the same entities, lines and columns as its LF twin", () => {
  const lf = parseSource("lf.sql", readText(fx("crlf-bom/lf.sql")));
  const crlf = parseSource("crlf.sql", readText(fx("crlf-bom/crlf.sql")));
  assert.deepEqual(shape(crlf), shape(lf));
  assert.equal(lf.entities.length, 1);
  assert.equal(lf.literalBindings.length, 2);
  assert.ok(!JSON.stringify(shape(crlf)).includes("\\r"));
  // a BOM left in place (no readText) does not break parsing either
  const withBom = parseSource("crlf.sql", readFileSync(fx("crlf-bom/crlf.sql"), "utf8"));
  assert.deepEqual(withBom.entities.map((e) => e.name), ["patients"]);
});
