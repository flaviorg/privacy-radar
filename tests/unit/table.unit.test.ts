import { before, test } from "node:test";
import assert from "node:assert/strict";
import { scan } from "../../src/app/scan.ts";
import type { ScanResult } from "../../src/contracts/findings.ts";
import { DISCLAIMER_EN } from "../../src/output/disclaimer.ts";
import { BANNER_FIRST, BANNER_LAST, MAX_LINE, fit, formatFindingRows, renderTable } from "../../src/output/table.ts";
import { finding } from "../helpers/builders.ts";
import { defaultScanOptions } from "../helpers/run-scan.ts";

let result: ScanResult;
before(async () => {
  result = (await scan(defaultScanOptions(null, { formats: ["json"] }))).result;
});

test("every table line is at most 100 columns", () => {
  const table = renderTable(result, { regime: "both", providerLabel: "none" });
  for (const line of table.split("\n")) assert.ok(line.length <= MAX_LINE, `${line.length}: ${line}`);
  for (const regime of ["lgpd", "gdpr"] as const) for (const line of renderTable(result, { regime, providerLabel: "none" }).split("\n")) assert.ok(line.length <= MAX_LINE, line);
});

test("table output prints the banner first and last, the provider line, the summary and DISCLAIMER_EN", () => {
  const lines = renderTable(result, { regime: "both", providerLabel: "none (fake fixture not found: x.json)" }).trimEnd().split("\n");
  assert.equal(lines[0], BANNER_FIRST);
  assert.equal(lines.at(-1), BANNER_LAST);
  assert.equal(lines[1], "privacy-radar 0.1.0 · provider: none (fake fixture not found: x.json) · regime: both");
  assert.equal(lines[2], "target: fixtures/telehealth-clinic (8 files: 6 ts, 1 sql, 1 prisma)");
  assert.ok(lines.includes(DISCLAIMER_EN));
  assert.ok(lines.includes("summary: 5 error · 10 warning · 2 note · 0 suppressed · 17 results"));
});

test("a finding takes two lines: severity, rule, file:line:column and what, then LGPD · GDPR articles compressed", () => {
  const f = result.findings.find((x) => x.ruleId === "PR-ANALYTICS")!;
  const [first, second] = formatFindingRows(f, "both");
  assert.equal(first, ` error    PR-ANALYTICS           src/analytics.ts:9:3       cpf, health → mixpanel.track (US)`);
  assert.equal(second, `${" ".repeat(10)}6 I-III, 7, 11, 33, 46 · 5(1)(b)(c), 6, 9(1), 28, 44-46`);
});

test("the second line shows only the selected regime", () => {
  const f = result.findings.find((x) => x.ruleId === "PR-LOG" && x.location.line === 22)!;
  assert.ok(formatFindingRows(f, "lgpd")[1].endsWith("6 VII, 46"));
  assert.ok(!formatFindingRows(f, "lgpd")[1].includes("·"));
  assert.ok(formatFindingRows(f, "gdpr")[1].endsWith("5(1)(f), 32"));
});

test("more than two categories are shown as the most sensitive one plus a count", () => {
  const f = result.findings.find((x) => x.ruleId === "PR-LOG" && x.location.line === 14)!;
  assert.match(formatFindingRows(f, "both")[0], /health \+ 10 more → console\.info$/);
});

test("a long 'what' is truncated with an ellipsis and a short row is never padded at the end", () => {
  const long = finding({ ruleId: "PR-THIRD-PARTY", location: { file: "src/a.ts", line: 1, column: 1, snippet: "" }, sink: { kind: "http", callee: "fetch", host: `${"very-long-subdomain.".repeat(6)}example.invalid` } });
  const [first] = formatFindingRows(long, "both");
  assert.equal(first.length, MAX_LINE);
  assert.ok(first.endsWith("…"));
  const short = formatFindingRows(finding({ ruleId: "PR-PARSE", message: "x" }), "both")[0];
  assert.equal(short, short.trimEnd());
});

test("fit cuts at the width and marks it", () => {
  assert.equal(fit("abcdef", 4), "abc…");
  assert.equal(fit("abc", 4), "abc");
});

test("below-threshold findings are not printed and an empty result says so", () => {
  const empty: ScanResult = { ...result, findings: [], summary: { ...result.summary, error: 0, warning: 0, note: 0 } };
  assert.ok(renderTable(empty, { regime: "both", providerLabel: "none" }).includes("no findings"));
  const below = { ...result, findings: [finding({ belowThreshold: true, confidence: 0.3 })] };
  const table = renderTable(below, { regime: "both", providerLabel: "none" });
  assert.ok(!table.includes("PR-LOG"));
  assert.ok(table.includes("0 results"));
});

test("an LLM line appears only when the LLM was called, with the simulated mark next to repairs and degradations", () => {
  assert.ok(!renderTable(result, { regime: "both", providerLabel: "none" }).includes("llm:"));
  const withLlm = { ...result, llm: { calls: 2, degraded: 0, repaired: 1, fieldsClassified: 2, narrativeSections: 0, simulated: true } };
  assert.ok(renderTable(withLlm, { regime: "both", providerLabel: "fake (scripted)" }).includes("llm: 2 calls · 2 fields labeled · 1 repaired · 0 degraded (simulated by the scripted fake)"));
  const real = { ...result, llm: { ...withLlm.llm, repaired: 0, simulated: false } };
  assert.ok(renderTable(real, { regime: "both", providerLabel: "x" }).includes("llm: 2 calls · 2 fields labeled · 0 repaired · 0 degraded\n"));
});

test("a PR-AMBIGUOUS row says the label is from the LLM and advisory", () => {
  const f = finding({ ruleId: "PR-AMBIGUOUS", origin: "llm", severity: "note", categories: ["special.health"], entity: { name: "Patient", field: "obs", kind: "model" }, location: { file: "prisma/schema.prisma", line: 17, column: 3, snippet: "obs Json?" } });
  assert.match(formatFindingRows(f, "both")[0], /prisma\/schema\.prisma:17:3\s+Patient\.obs: health \(LLM, advisory\)$/);
});
