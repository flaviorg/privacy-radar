import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractFunctions, extractLiteralBindings } from "../../src/sources/ts/functions.ts";
import { parseTs } from "../../src/sources/ts/parse.ts";
import type { FunctionModel } from "../../src/contracts/source-model.ts";
import { PROJECT_ROOT_FOR_TESTS } from "../helpers/child-node-args.ts";

const read = (f: string) => readFileSync(join(PROJECT_ROOT_FOR_TESTS, "tests", "fixtures", "sources", f), "utf8");
const fns = (src: string, path = "a.ts") => extractFunctions(parseTs(path, src).ast!, src);
const fnNamed = (src: string, name: string): FunctionModel => {
  const f = fns(src).find((x) => x.name === name);
  assert.ok(f, `function ${name}`);
  return f;
};
const argChains = (fn: FunctionModel, callee: string, arg = 0) => fn.calls.find((c) => c.calleeText === callee)!.args[arg]!.refs.map((r) => [r.chain, r.context]);

test("[SRC-04] bindings record the refs of their initializer and calls record callee, args and URL text", () => {
  const src = 'export async function sync(patient: Patient) {\n  const payload = { email: patient.email };\n  await fetch("https://api.mixpanel.com/engage", { method: "POST", body: JSON.stringify(payload) });\n}\n';
  const fn = fnNamed(src, "sync");
  assert.deepEqual(fn.params, [{ name: "patient", typeName: "Patient", loc: { line: 1, column: 28 } }]);
  assert.deepEqual(fn.bindings[0]!.refs.map((r) => [r.chain, r.context]), [["email", "key"], ["patient.email", "direct"]]);
  assert.deepEqual(fn.bindings[0]!.refersTo, ["email", "patient.email"]);
  assert.equal(src.slice(fn.bindings[0]!.initRange.start, fn.bindings[0]!.initRange.end), "{ email: patient.email }");
  const call = fn.calls.find((c) => c.calleeText === "fetch")!;
  assert.equal(call.urlText, "https://api.mixpanel.com/engage");
  assert.deepEqual(call.loc, { line: 3, column: 9 });
  assert.equal(src.slice(call.urlRange!.start, call.urlRange!.end), '"https://api.mixpanel.com/engage"');
  assert.ok(call.args[1]!.refs.some((r) => r.chain === "payload"));
  assert.deepEqual(fn.loc, { line: 1, column: 8 });
  assert.equal(fn.endLine, 4);
});

test("[SRC-04] template URL text keeps the literal prefix and new URL(literal) is read", () => {
  const src = 'async function f(path: string, base: string) {\n  await fetch(`https://api.example.invalid/v1/${path}?a=1`);\n  await fetch(new URL("https://x.example.invalid/a"));\n  await fetch(base + "/x");\n}\n';
  const fn = fnNamed(src, "f");
  assert.deepEqual(fn.calls.filter((c) => c.calleeText === "fetch").map((c) => c.urlText), ["https://api.example.invalid/v1/${}?a=1", "https://x.example.invalid/a", null]);
  const urlCall = fn.calls.find((c) => c.calleeText === "URL");
  assert.equal(urlCall, undefined, "new expressions are not calls");
});

test("[SRC-04] refs are not collected through user-defined calls, computed keys or join()", () => {
  const src = [
    "function g(p: Patient, obj: Record<string, string>, key: string, a: string, b: string) {",
    "  log(format(p));",
    "  log(obj[key]);",
    "  log([a, b].join(','));",
    "  log(() => p.cpf);",
    "  log(this.state.cpf);",
    "}",
  ].join("\n");
  const fn = fnNamed(src, "g");
  for (const call of fn.calls.filter((c) => c.calleeText === "log")) assert.deepEqual(call.args[0]!.refs, [], `line ${call.loc.line}`);
});

test("[SRC-04] the allowed shapes: wrappers, templates, concatenation, arrays, spread and tagged templates", () => {
  const src = [
    "function h(p: Patient, cpf: string) {",
    "  log(JSON.stringify(p), String(cpf), util.format('%s', p.email), util.inspect(p.phone), p.nifPt.toString());",
    "  log(`id ${cpf}`, 'x' + p.fullName, [p.iban], { ...p }, sql`select ${p.dni}`);",
    "}",
  ].join("\n");
  const fn = fnNamed(src, "h");
  const [first, second] = fn.calls.filter((c) => c.calleeText === "log");
  assert.deepEqual(first!.args.map((a) => a.refs.map((r) => r.chain)), [["p"], ["cpf"], ["p.email"], ["p.phone"], ["p.nifPt"]]);
  assert.deepEqual(second!.args.map((a) => a.refs.map((r) => [r.chain, r.context])), [
    [["cpf", "direct"]],
    [["p.fullName", "direct"]],
    [["p.iban", "direct"]],
    [["p", "spread"]],
    [["p.dni", "direct"]],
  ]);
  assert.deepEqual(first!.args[2]!.refs[0], { chain: "p.email", root: "p", last: "email", loc: { line: 2, column: src.split("\n")[1]!.indexOf("p.email") + 1 }, context: "direct" });
});

test("[SRC-04] destructuring from a source binds each name with a ref to its member", () => {
  const src = "function d(patient: Patient) {\n  const { cpf, email: mail } = patient;\n  const [first] = list;\n  log(cpf, mail, first);\n}\n";
  const fn = fnNamed(src, "d");
  assert.deepEqual(fn.bindings.map((b) => [b.name, b.refs.map((r) => r.chain)]), [
    ["cpf", ["patient.cpf"]],
    ["mail", ["patient.email"]],
    ["first", ["list"]],
  ]);
  assert.deepEqual(fn.bindings[0]!.loc, { line: 2, column: 11 });
});

test("[SRC-04] query builds name the parameter for templates, concatenation and URLSearchParams", () => {
  const src = [
    "function q(p: Patient, url: URL) {",
    "  fetch(`https://sms.example-vendor.invalid/send?nif=${p.nifPt}&msg=reminder`);",
    "  fetch('https://x.example.invalid/?cpf=' + p.cpf);",
    "  const qs = new URLSearchParams({ email: p.email });",
    "  url.searchParams.set('phone', p.phone);",
    "  qs.append('dni', p.dni);",
    "}",
  ].join("\n");
  const fn = fnNamed(src, "q");
  assert.deepEqual(fn.queryBuilds.map((b) => [b.param, b.via, b.loc.line, b.refs.map((r) => r.chain)]), [
    ["nif", "template", 2, ["p.nifPt"]],
    ["cpf", "concat", 3, ["p.cpf"]],
    ["email", "url-search-params", 4, ["p.email"]],
    ["phone", "url-search-params", 5, ["p.phone"]],
    ["dni", "url-search-params", 6, ["p.dni"]],
  ]);
  assert.deepEqual(fn.queryBuilds[0]!.loc, { line: 2, column: src.split("\n")[1]!.indexOf("p.nifPt") + 1 });
});

test("functions: declarations, expressions, arrows, methods, nested functions and <module>", () => {
  const src = [
    "const top = log('boot');",
    "export function a() { inner(); function inner2() { console.log(1); } }",
    "const b = () => console.warn('b');",
    "class K { m() { console.error('m'); } }",
    "const o = { n() { console.info('n'); }, p: function () {} };",
  ].join("\n");
  const list = fns(src);
  assert.deepEqual(list.map((f) => f.name), ["<module>", "a", "inner2", "b", "m", "n", "p"]);
  const byName = (n: string) => list.find((f) => f.name === n)!;
  assert.deepEqual(byName("<module>").calls.map((c) => c.calleeText), ["log"]);
  assert.deepEqual(byName("a").calls.map((c) => c.calleeText), ["inner"]);
  assert.deepEqual(byName("inner2").calls.map((c) => c.calleeText), ["console.log"]);
  assert.deepEqual(byName("m").calls.map((c) => c.calleeText), ["console.error"]);
  assert.deepEqual(byName("<module>").bindings.map((b) => b.name), ["top", "b", "o"]);
  assert.deepEqual(byName("<module>").loc, { line: 1, column: 1 });
});

test("callee text keeps this. and replaces computed and call parts", () => {
  const src = "class S { run() { this.logger.error('x'); getLogger().info('y'); loggers[0].warn('z'); req.log.warn('w'); } }";
  assert.deepEqual(fnNamed(src, "run").calls.map((c) => c.calleeText), ["this.logger.error", "getLogger().info", "getLogger", "loggers[].warn", "req.log.warn"]);
});

test("[SRC-04] fixtures: one hop, two hops, cross-function, relative URL and a URL with a port", () => {
  assert.deepEqual(argChains(fnNamed(read("one-hop.ts"), "sync"), "console.log"), [["payload", "direct"]]);
  assert.deepEqual(fnNamed(read("two-hops.ts"), "audit").bindings.map((b) => [b.name, b.refersTo]), [["first", ["patient.cpf"]], ["second", ["value", "first"]]]);
  assert.deepEqual(argChains(fnNamed(read("cross-function.ts"), "report"), "console.log"), []);
  assert.equal(fnNamed(read("relative-url.ts"), "save").calls.find((c) => c.calleeText === "fetch")!.urlText, "/api/patients");
  assert.deepEqual(fnNamed(read("url-with-port.ts"), "track").calls.filter((c) => c.calleeText === "fetch").map((c) => c.urlText), [
    "https://u:p@api.mixpanel.com:443/track",
    "http://localhost:3000/health",
  ]);
});

test("[SRC-08] literal bindings for property values, initializers and assignments, unclassified", () => {
  const src = 'const a = { fullName: "Maria Souza", n: 3 };\nlet city = "Lisboa";\nobj.address = `Rua X`;\n';
  assert.deepEqual(
    extractLiteralBindings(parseTs("n.ts", src).ast!).map((b) => [b.bindingName, b.line, b.column, src.slice(b.start, b.end)]),
    [
      ["fullName", 1, 23, '"Maria Souza"'],
      ["n", 1, 41, "3"],
      ["city", 2, 12, '"Lisboa"'],
      ["address", 3, 15, "`Rua X`"],
    ],
  );
});

test("[SRC-08] literal bindings inside arrays, class fields, defaults and `as const`, and the name-literal fixture", () => {
  const src = 'const rows = [{ cpf: "1" }];\nclass C { email = "e"; }\nfunction f(phone = "p") {}\nconst tag = "x" as const;\n';
  assert.deepEqual(extractLiteralBindings(parseTs("m.ts", src).ast!).map((b) => b.bindingName), ["cpf", "email", "phone", "tag"]);
  const fixture = read("name-literal.ts");
  assert.deepEqual(extractLiteralBindings(parseTs("name-literal.ts", fixture).ast!).map((b) => [b.bindingName, fixture.slice(b.start, b.end)]), [
    ["fullName", '"Rita Amostra"'],
    ["role", '"admin"'],
    ["city", '"Porto"'],
    ["address", "`Avenida Teste 7`"],
  ]);
});
