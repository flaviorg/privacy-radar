import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseTs, pluginsFor, toLoc } from "../../src/sources/ts/parse.ts";
import { walk, type AnyNode } from "../../src/sources/ts/walk.ts";
import { LIMITS } from "../../src/contracts/limits.ts";
import { PROJECT_ROOT_FOR_TESTS } from "../helpers/child-node-args.ts";

const read = (f: string) => readFileSync(join(PROJECT_ROOT_FOR_TESTS, "tests", "fixtures", "sources", f), "utf8");

test("[SRC-01] each extension gets its plugin set", () => {
  assert.deepEqual(pluginsFor("a.ts"), ["typescript", "decorators-legacy"]);
  assert.deepEqual(pluginsFor("a.tsx"), ["typescript", "decorators-legacy", "jsx"]);
  for (const e of ["js", "jsx", "mjs", "cjs"]) assert.deepEqual(pluginsFor(`a.${e}`), ["jsx", "decorators-legacy"]);
  assert.deepEqual(pluginsFor("src/Dir.With.Dots/A.TS"), ["typescript", "decorators-legacy"]);
});

for (const f of ["nestjs-controller.ts", "tsx-component.tsx", "react-component.js", "generic-casts.ts"]) {
  test(`[SRC-01] ${f} parses with zero errors`, () => {
    const r = parseTs(f, read(f));
    assert.deepEqual(r.warnings, []);
    assert.equal(r.ast?.type, "File");
  });
}

test("[SRC-01] a recoverable error keeps the AST and yields one PARSE_ERROR with its line", () => {
  const r = parseTs("x.ts", read("syntax-error-recoverable.ts"));
  assert.ok(r.ast);
  assert.deepEqual(r.warnings.map((w) => [w.code, w.line, w.file]), [["PARSE_ERROR", 2, "x.ts"]]);
});

test("[SRC-01] an unrecoverable error yields one PARSE_ERROR, no AST and no throw", () => {
  const r = parseTs("y.ts", read("syntax-error-unrecoverable.ts"));
  assert.equal(r.ast, null);
  assert.deepEqual(r.warnings.map((w) => [w.code, w.line]), [["PARSE_ERROR", 3]]);
});

test("[SRC-01] a parse warning message names the reason and position, never source text", () => {
  const src = 'const secret = "52998224725"\nfoo(a, b;';
  const r = parseTs("z.ts", src);
  assert.equal(r.warnings.length, 1);
  assert.doesNotMatch(r.warnings[0]!.message, /52998224725|foo/);
  assert.match(r.warnings[0]!.message, /UnexpectedToken/);
});

test("[SRC-01] decorators-legacy is what makes @Body() parse cleanly (plain decorators records an error)", () => {
  const r = parseTs("c.ts", "class C { m(@Body() dto: any) {} }");
  assert.deepEqual(r.warnings, []);
});

test("[SRC-02] 600 nested parentheses give one DEPTH_LIMIT and no throw", () => {
  const r = parseTs("deep.ts", read("deep-nesting.ts"));
  assert.equal(r.ast, null);
  assert.deepEqual(r.warnings.map((w) => w.code), ["DEPTH_LIMIT"]);
});

test("[SRC-02] the walker stops at depth 300 and reports depthExceeded", () => {
  let root: AnyNode = { type: "Leaf" };
  for (let i = 0; i < 400; i++) root = { type: "Wrap", child: root };
  let visited = 0;
  const r = walk(root, () => {
    visited += 1;
  });
  assert.equal(r.depthExceeded, true);
  assert.equal(visited, LIMITS.astDepth + 1);
  let shallow: AnyNode = { type: "Leaf" };
  for (let i = 0; i < 10; i++) shallow = { type: "Wrap", child: shallow };
  assert.equal(walk(shallow, () => undefined).depthExceeded, false);
});

test("walker visits CallExpression and TemplateLiteral with 1-based columns through toLoc", () => {
  const src = "const a = 1;\n  foo(`x${a}`);\n";
  const { ast } = parseTs("w.ts", src);
  const seen: [string, number, number][] = [];
  walk(ast!, (node) => {
    if (node.type === "CallExpression" || node.type === "TemplateLiteral") {
      const loc = toLoc(node);
      seen.push([node.type, loc.line, loc.column]);
    }
  });
  assert.deepEqual(seen, [
    ["CallExpression", 2, 3],
    ["TemplateLiteral", 2, 7],
  ]);
});

test("walker passes ancestors, skips location and comment keys, and honours skip", () => {
  const src = "// lead\nfunction f() { g(1); }\nh(2);\n";
  const { ast } = parseTs("s.ts", src);
  const calls: string[] = [];
  let sawComment = false;
  walk(ast!, (node, ancestors) => {
    if (node.type === "CommentLine") sawComment = true;
    if (node.type === "FunctionDeclaration") return "skip";
    if (node.type === "CallExpression") calls.push(`${(node.callee as AnyNode).name}:${ancestors.map((a) => a.type).join(">")}`);
    return undefined;
  });
  assert.equal(sawComment, false);
  assert.deepEqual(calls, ["h:File>Program>ExpressionStatement"]);
});
