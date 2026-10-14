import { before, test } from "node:test";
import assert from "node:assert/strict";
import { scan, type ScanOutcome } from "../../src/app/scan.ts";
import type { Finding } from "../../src/contracts/findings.ts";
import { renderDemoMd, renderHero, topFindings, type HeroInput } from "../../src/output/summary.ts";
import { defaultScanOptions } from "../helpers/run-scan.ts";

let outcome: ScanOutcome;
let full: HeroInput;
let m5: HeroInput;

before(async () => {
  outcome = await scan(defaultScanOptions(null, { formats: ["json"], uriPrefix: "" }));
  const f = outcome.result.findings;
  const pick = (rule: string, file: string, line: number) => f.find((x) => x.ruleId === rule && x.location.file === file && x.location.line === line)!;
  const resolved: Finding = { ...pick("PR-LOG", "src/patients.ts", 22), ruleId: "PR-FILE", severity: "warning", sink: { kind: "file", callee: "fs.appendFileSync" }, location: { ...pick("PR-LOG", "src/patients.ts", 22).location, line: 24 } };
  full = {
    version: "0.1.0",
    clockIso: "2026-10-08T12:00:00.000Z",
    providerLabel: "fake (scripted)",
    regime: "both",
    pr: { baseShort: "1a2b3c4", headShort: "5d6e7f8", changed: 2, added: [pick("PR-ANALYTICS", "src/analytics.ts", 9), pick("PR-TRANSFER", "src/analytics.ts", 9)], resolved: [resolved], unchanged: 15, exitCode: 1 },
    scan: outcome.result,
    inventory: outcome.inventory,
    sarif: { results: 17, rules: 12 },
    documents: { names: ["ropa.md", "dpia.md", "registro.pt-BR.md", "ripd.pt-BR.md"], wp248: 2, ripdIndicators: 3 },
    scanExitCode: 1,
    demoExitCode: 0,
  };
  m5 = { ...full, pr: null, documents: null };
});

test("renderHero: every line at most 100 columns and the M5 variant has no PR or documents lines", () => {
  for (const input of [full, m5]) {
    for (const format of ["console", "markdown"] as const) {
      const text = renderHero(input, format);
      for (const line of text.split("\n")) assert.ok(line.length <= 100, `${format}: ${line.length}: ${line}`);
    }
  }
  const console5 = renderHero(m5, "console");
  assert.doesNotMatch(console5, /PR mode|This PR|^documents:/m);
  assert.match(console5, /documents: not in this version/);
  assert.match(console5, /^sarif: 17 results, 12 rules, fingerprints ok$/m);
  const md5 = renderHero(m5, "markdown");
  assert.ok(md5.startsWith("```text\n"), "no blockquote without a PR");
});

test("renderHero console: banner first and last, the PR block, the top findings and the counts of spec 10.2", () => {
  const text = renderHero(full, "console");
  const lines = text.trimEnd().split("\n");
  assert.equal(lines[0], "privacy-radar 0.1.0 · demo · provider: fake (scripted) · no network · regime: both");
  assert.equal(lines[1], "clock 2026-10-08T12:00:00.000Z");
  assert.equal(lines[2], "DRAFTS, NOT LEGAL ADVICE: findings and documents are starting points for a DPO review.");
  assert.equal(lines.at(-1), "DRAFTS, NOT LEGAL ADVICE.");
  assert.equal(lines.filter((l) => l.startsWith("+ This PR introduces")).length, 2);
  assert.equal(lines.filter((l) => l.startsWith("- This PR removes")).length, 1);
  assert.match(text, /^2 added · 1 resolved · 15 unchanged · 2 new findings at or above "error" → PR check exit 1$/m);
  assert.match(text, /^inventory: 3 entities · 24 fields · 14 personal \(3 sensitive, 2 children indicators\)$/m);
  assert.match(text, /^ {11}1 not personal \(cnpj\) · 2 below threshold · 2 ambiguous → LLM · 16 values masked$/m);
  assert.match(text, /^ … 11 more in DEMO\.md \(11 deterministic, 0 LLM\)$/m, "the in-process scan has no LLM finding");
  assert.match(text, /^documents: ropa\.md · dpia\.md \(2 of 9 WP248 criteria → likely required\) · registro\.pt-BR\.md$/m);
  assert.match(text, /^scan exit code 1 \(errors found\) · demo exit 0$/m);
  assert.doesNotMatch(text, /done in/, "no wall-clock value inside the hero");
});

test("topFindings: the first five plus the first PR-HARDCODED-VALUE", () => {
  const top = topFindings(outcome.result.findings);
  assert.equal(top.length, 6);
  assert.deepEqual(top.slice(0, 5), outcome.result.findings.filter((f) => !f.belowThreshold).slice(0, 5));
  assert.equal(top[5]!.ruleId, "PR-HARDCODED-VALUE");
});

test("renderHero markdown: the PR sentences as a blockquote first, the rest inside a text fence", () => {
  const md = renderHero(full, "markdown");
  assert.ok(md.startsWith("> PR mode on a two-commit copy"));
  assert.match(md, /^> \+ This PR introduces a new flow of identifier\.cpf and special\.health/m);
  assert.match(md, /^> - This PR removes the flow of identifier\.cpf to a file/m);
  const fence = md.slice(md.indexOf("```text"));
  assert.match(fence, /^```text\nprivacy-radar 0\.1\.0 · demo/);
  assert.ok(fence.trimEnd().endsWith("DRAFTS, NOT LEGAL ADVICE.\n```"));
});

test("renderDemoMd lists every shown finding and the PR comment", () => {
  const md = renderDemoMd({ ...full, prComment: "## privacy-radar: compliance changes in this pull request\n\n- This PR introduces x.\n" });
  assert.equal(md.split("\n").filter((l) => /^\| \d+ \|/.test(l)).length, outcome.result.findings.filter((f) => !f.belowThreshold).length);
  assert.match(md, /^### privacy-radar: compliance changes in this pull request$/m);
  assert.match(md, /This is not legal advice and not a complete assessment\./);
});
