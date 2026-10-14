import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parse as babelParse } from "@babel/parser";
import { parse as sqlParse } from "pgsql-ast-parser";
import * as z from "zod";
import { LIMITS } from "../../src/contracts/limits.ts";
import { PROJECT_ROOT, toPosix } from "../../src/infra/paths.ts";
import { TOOL_NAME, TOOL_VERSION, REPOSITORY_URL } from "../../src/infra/version.ts";

test("api: zod toJSONSchema emits draft 2020-12 with the range keywords", () => {
  const schema = z.object({ n: z.number().min(1).max(5), s: z.string().min(2).max(9), a: z.array(z.string()).min(1).max(3) }).strict();
  const js = z.toJSONSchema(schema) as Record<string, any>;
  assert.equal(js.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(js.additionalProperties, false);
  assert.equal(js.properties.n.minimum, 1);
  assert.equal(js.properties.n.maximum, 5);
  assert.equal(js.properties.s.minLength, 2);
  assert.equal(js.properties.s.maxLength, 9);
  assert.equal(js.properties.a.minItems, 1);
  assert.equal(js.properties.a.maxItems, 3);
});

test("api: babel loc columns are 0-based and unrecoverable errors throw SyntaxError with loc", () => {
  const ast = babelParse("\n  const a = 1;", { sourceType: "module", errorRecovery: true });
  const stmt = ast.program.body[0]!;
  assert.deepEqual({ line: stmt.loc!.start.line, column: stmt.loc!.start.column }, { line: 2, column: 2 });
  assert.throws(
    () => babelParse("foo(a, b;", { sourceType: "module", errorRecovery: true }),
    (e: any) => e.name === "SyntaxError" && e.code === "BABEL_PARSER_SYNTAX_ERROR" && e.reasonCode === "UnexpectedToken" && e.loc.line === 1 && e.loc.column === 8,
  );
  const recovered = babelParse("let a = 1; let a = 2;", { sourceType: "module", errorRecovery: true });
  assert.equal(recovered.errors.length, 1);
  assert.equal((recovered.errors[0] as any).reasonCode, "VarRedeclaration");
});

test("api: babel plugin sets behave as spec 4.2 says (decorators-legacy clean, decorators records an error)", () => {
  const nest = "class C { m(@Body() dto: any) {} }";
  assert.equal(babelParse(nest, { sourceType: "module", plugins: ["typescript", "decorators-legacy"], errorRecovery: true }).errors.length, 0);
  assert.ok(babelParse(nest, { sourceType: "module", plugins: ["typescript", "decorators"], errorRecovery: true }).errors.length > 0);
  assert.throws(() => babelParse("const a = <T>x;", { sourceType: "module", plugins: ["typescript", "jsx"], errorRecovery: true }));
  assert.equal(babelParse("const a = <T>x;", { sourceType: "module", plugins: ["typescript"], errorRecovery: true }).errors.length, 0);
});

test("api: pgsql-ast-parser gives _location on INSERT values and throws on E'it\\'s'", () => {
  const sql = "INSERT INTO a (x, y) VALUES ('52998224725', 'z');";
  const [stmt] = sqlParse(sql, { locationTracking: true }) as any[];
  assert.equal(stmt.type, "insert");
  const cell = stmt.insert.values[0][0];
  assert.equal(cell.value, "52998224725");
  const start = sql.indexOf("'52998224725'");
  assert.deepEqual(cell._location, { start, end: start + "'52998224725'".length });
  assert.equal(sql.slice(cell._location.start, cell._location.end), "'52998224725'");
  const [noCols] = sqlParse("INSERT INTO a VALUES ('x');", { locationTracking: true }) as any[];
  assert.equal(noCols.columns, undefined);
  assert.throws(() => sqlParse("INSERT INTO a (x) VALUES (E'it\\'s');", { locationTracking: true }));
  assert.throws(() => sqlParse("CREATE POLICY p ON t USING (true);", { locationTracking: true }));
});

test("api: PROJECT_ROOT holds package.json and TOOL_VERSION is 0.1.0", () => {
  assert.ok(existsSync(join(PROJECT_ROOT, "package.json")));
  assert.ok(!PROJECT_ROOT.endsWith("/"));
  assert.equal(TOOL_NAME, "privacy-radar");
  assert.equal(TOOL_VERSION, "0.1.0");
  assert.equal(REPOSITORY_URL, "https://github.com/flaviorg/privacy-radar");
  assert.equal(toPosix("a\\b\\c"), "a/b/c");
  assert.ok(Object.isFrozen(LIMITS));
  assert.equal(LIMITS.maxFiles, 5000);
});
