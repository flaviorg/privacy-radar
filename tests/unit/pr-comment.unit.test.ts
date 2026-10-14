import { before, test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { scan } from "../../src/app/scan.ts";
import { loadCatalog } from "../../src/catalog/load.ts";
import type { Finding } from "../../src/contracts/findings.ts";
import { DISCLAIMER_EN } from "../../src/output/disclaimer.ts";
import { RULE_TITLES, prSentence, renderPrComment } from "../../src/pr/comment.ts";
import { finding } from "../helpers/builders.ts";
import { defaultScanOptions } from "../helpers/run-scan.ts";

let findings: Finding[];
const pick = (ruleId: string, file: string, line: number) => findings.find((f) => f.ruleId === ruleId && f.location.file === file && f.location.line === line)!;

before(async () => {
  findings = (await scan(defaultScanOptions(null, { formats: ["json"], uriPrefix: "" }))).result.findings;
});

test("RULE_TITLES equal the titles of catalog/rules.json", () => {
  for (const r of loadCatalog().rules) assert.equal(RULE_TITLES[r.id], r.title, r.id);
});

test("[PR-03] sink sentence for the demo's added PR-ANALYTICS", () => {
  const analyticsFinding = pick("PR-ANALYTICS", "src/analytics.ts", 9);
  assert.equal(
    prSentence(analyticsFinding, "added", "both"),
    "This PR introduces a new flow of identifier.cpf and special.health to analytics vendor Mixpanel (US) at src/analytics.ts:9 (LGPD 6 I-III, 7, 11, 33, 46; GDPR 5(1)(b)(c), 6, 9(1), 28, 44-46).",
  );
});

test("[PR-03] the other sink descriptions: log, file, URL query, third party with a vendor and an unknown destination", () => {
  assert.equal(prSentence(pick("PR-LOG", "src/patients.ts", 22), "added", "both"), "This PR introduces a new flow of identifier.cpf to a log (logger.debug) at src/patients.ts:22 (LGPD 6 VII, 46; GDPR 5(1)(f), 32).");
  assert.equal(prSentence(pick("PR-FILE", "src/billing.ts", 8), "resolved", "both"), "This PR removes the flow of financial.iban and name.full-name to a file (fs.appendFileSync) at src/billing.ts:8 (LGPD 6 VII, 46; GDPR 5(1)(f), 32).");
  assert.equal(prSentence(pick("PR-URL-QUERY", "src/appointments.ts", 11), "added", "lgpd"), "This PR introduces a new flow of identifier.nif-pt to a URL query string (parameter nif) at src/appointments.ts:11 (LGPD 6 VII, 46).");
  assert.match(prSentence(pick("PR-THIRD-PARTY", "src/analytics.ts", 12), "added", "both"), /^This PR introduces a new flow of contact\.email to third party api\.mixpanel\.com \(Mixpanel \(US\)\) at src\/analytics\.ts:12 \(/);
  assert.match(prSentence(pick("PR-THIRD-PARTY", "src/appointments.ts", 11), "added", "both"), /to third party sms\.example-vendor\.invalid \(unknown destination\) at src\/appointments\.ts:11/);
});

test("[PR-03] PR-TRANSFER uses the international-transfer form and resolved findings the removes form", () => {
  const transfer = pick("PR-TRANSFER", "src/analytics.ts", 9);
  assert.equal(
    prSentence(transfer, "added", "both"),
    "This PR introduces an international transfer of identifier.cpf and special.health to Mixpanel (US) at src/analytics.ts:9: LGPD needs-mechanism, GDPR conditional; status as of 2026-10-08; verify (LGPD 33, 33 II, 33 VIII, 34-36; GDPR 44-47, 49).",
  );
  assert.equal(prSentence(transfer, "resolved", "gdpr"), "This PR removes the international transfer of identifier.cpf and special.health to Mixpanel (US) at src/analytics.ts:9 (GDPR 44-47, 49).");
  assert.match(prSentence(pick("PR-PLAINTEXT-SENSITIVE", "prisma/schema.prisma", 14), "added", "both"), /^This PR introduces sensitive field stored without protection for Patient\.diagnosis at prisma\/schema\.prisma:14 \(LGPD/);
  assert.match(prSentence(pick("PR-RETENTION", "prisma/schema.prisma", 3), "resolved", "both"), /^This PR removes storage entity has no retention signal for Patient at prisma\/schema\.prisma:3 \(/);
  assert.match(prSentence(pick("PR-HARDCODED-VALUE", "src/server.ts", 13), "added", "both"), /^This PR introduces personal data value hard-coded in a file for src\/server\.ts at src\/server\.ts:13 \(/);
});

test("[PR-03] the comment ends with the disclaimer and never contains a temporary path", () => {
  const added = [pick("PR-ANALYTICS", "src/analytics.ts", 9), pick("PR-TRANSFER", "src/analytics.ts", 9)];
  const resolved = [finding({ ruleId: "PR-FILE", categories: ["identifier.cpf"], severity: "warning", location: { file: "src/patients.ts", line: 24, column: 3, snippet: "x" }, sink: { kind: "file", callee: "fs.appendFileSync" } })];
  const md = renderPrComment({ added, resolved, unchanged: 15, baseSha: "a".repeat(40), headSha: "b".repeat(40), changed: 2, skipped: false, regime: "both" });
  assert.ok(md.trimEnd().endsWith(DISCLAIMER_EN), md);
  assert.ok(!md.includes(tmpdir()));
  assert.ok(!md.includes("a".repeat(40)) && md.includes("aaaaaaa"), "short SHAs only");
  assert.equal(md.split("\n").filter((l) => l.startsWith("- This PR introduces")).length, 2);
  assert.equal(md.split("\n").filter((l) => l.startsWith("- This PR removes")).length, 1);
  assert.match(md, /2 added · 1 resolved · 15 unchanged/);
  assert.match(md, /\| added \| error \| PR-ANALYTICS \| `src\/analytics\.ts:9` \|/);
  assert.match(md, /\| resolved \| warning \| PR-FILE \| `src\/patients\.ts:24` \|/);
  const skipped = renderPrComment({ added: [], resolved: [], unchanged: 0, baseSha: "a".repeat(40), headSha: "b".repeat(40), changed: 1, skipped: true, regime: "both" });
  assert.match(skipped, /No supported file changed: both scans were skipped\./);
  assert.ok(skipped.trimEnd().endsWith(DISCLAIMER_EN));
});

test("[OUT-09] a file named src/[x](https://e.invalid)`@team`.ts renders inert in the comment", () => {
  const file = "src/[x](https://e.invalid)`@team`.ts";
  const f = finding({ location: { file, line: 2, column: 1, snippet: "console.log(cpf);" }, sink: { kind: "log", callee: "console.log" } });
  const md = renderPrComment({ added: [f], resolved: [], unchanged: 0, baseSha: "a".repeat(40), headSha: "b".repeat(40), changed: 1, skipped: false, regime: "both" });
  const outsideCode = md.replace(/(`+)(?:(?!\1)[\s\S])*?\1/g, "");
  assert.doesNotMatch(outsideCode, /\]\(http/);
  assert.doesNotMatch(outsideCode, /(?<!\\)\[/);
  assert.doesNotMatch(outsideCode, /@team/, "no mention outside a code span (escapeMd adds a zero-width space after @)");
});
