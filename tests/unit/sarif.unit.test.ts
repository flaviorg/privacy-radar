import { before, test } from "node:test";
import assert from "node:assert/strict";
import type { Log } from "sarif";
import { scan } from "../../src/app/scan.ts";
import type { Finding } from "../../src/contracts/findings.ts";
import { LIMITS } from "../../src/contracts/limits.ts";
import { sarifSubsetSchema, validateSarifInvariants } from "../../src/contracts/sarif.ts";
import { TOOL_VERSION } from "../../src/infra/version.ts";
import { DISCLAIMER_EN } from "../../src/output/disclaimer.ts";
import { buildSarif, precisionOf } from "../../src/output/sarif.ts";
import { testCatalog, finding } from "../helpers/builders.ts";
import { join } from "node:path";
import { PROJECT_ROOT_FOR_TESTS } from "../helpers/child-node-args.ts";
import { makeRepo, readTree } from "../helpers/git-repo.ts";
import { defaultScanOptions } from "../helpers/run-scan.ts";

const INFO = "https://github.com/flaviorg/privacy-radar";
let fixtureFindings: Finding[];

before(async () => {
  fixtureFindings = (await scan(defaultScanOptions(null, { formats: ["json"] }))).result.findings;
});

const sarifFor = (findings: readonly Finding[], uriPrefix: string): Log =>
  buildSarif({ findings, catalog: testCatalog(), regime: "both", toolVersion: TOOL_VERSION, uriPrefix, informationUri: INFO });
const uriOf = (r: NonNullable<Log["runs"][number]["results"]>[number]) => r.locations![0]!.physicalLocation!.artifactLocation!.uri!;

test("[OUT-02] the fixture SARIF passes the subset and the GitHub invariants", () => {
  const log = sarifFor(fixtureFindings, "");
  assert.deepEqual(validateSarifInvariants(log), []);
  sarifSubsetSchema.parse(log);
  const run = log.runs[0]!;
  assert.equal(log.version, "2.1.0");
  assert.equal(run.results!.length, fixtureFindings.filter((f) => !f.belowThreshold).length);
  for (const r of run.results!) {
    const loc = r.locations![0]!.physicalLocation!;
    assert.ok(loc.region!.startLine! >= 1 && loc.region!.startColumn! >= 1);
    assert.match(r.partialFingerprints!.primaryLocationLineHash!, /^[0-9a-f]{32}$/);
    assert.ok(["error", "warning", "note"].includes(r.level!));
    assert.ok(Array.isArray((r.properties as { articles: { lgpd: string[] } }).articles.lgpd));
    assert.equal(loc.artifactLocation!.uriBaseId, "%SRCROOT%");
  }
});

test("[OUT-02] URIs are prefixed by uriPrefix for a sub-folder target and unprefixed outside Git", () => {
  for (const r of sarifFor(fixtureFindings, "fixtures/telehealth-clinic/").runs[0]!.results!) assert.match(uriOf(r), /^fixtures\/telehealth-clinic\//);
  for (const r of sarifFor(fixtureFindings, "").runs[0]!.results!) assert.doesNotMatch(uriOf(r), /^fixtures\//);
});

test("[OUT-02] a scan of a fixture in a sub-folder of a Git repository prefixes the URIs with the sub-folder and never with an absolute path", async (t) => {
  // A Git repository of its own, so the test does not depend on this checkout having a .git folder.
  const fixture = readTree(join(PROJECT_ROOT_FOR_TESTS, "fixtures", "telehealth-clinic"));
  const files = Object.fromEntries(Object.entries(fixture).map(([rel, text]) => [`fixtures/telehealth-clinic/${rel}`, text]));
  const repo = makeRepo(t, files);
  const outcome = await scan(defaultScanOptions(null, { target: join(repo.dir, "fixtures", "telehealth-clinic"), formats: ["sarif"] }));
  const uris = outcome.sarif!.runs[0]!.results!.map(uriOf);
  assert.ok(uris.length > 0);
  for (const u of uris) assert.match(u, /^fixtures\/telehealth-clinic\/(src|prisma|migrations)\//);
  assert.deepEqual(validateSarifInvariants(outcome.sarif), []);
});

test("[OUT-02] URIs are percent-encoded per path segment, and an unencoded URI fails the invariants", () => {
  const f = finding({ location: { file: "src/my file#1%.ts", line: 1, column: 1, snippet: "x" } });
  const log = sarifFor([f], "sub dir/");
  assert.equal(uriOf(log.runs[0]!.results![0]!), "sub%20dir/src/my%20file%231%25.ts");
  assert.deepEqual(validateSarifInvariants(log), []);
  const raw = structuredClone(log);
  raw.runs[0]!.results![0]!.locations![0]!.physicalLocation!.artifactLocation!.uri = "src/my file.ts";
  assert.ok(validateSarifInvariants(raw).some((p) => p.includes("uri_not_encoded")), JSON.stringify(validateSarifInvariants(raw)));
});

test("[OUT-02] all twelve rules are present with a stable ruleIndex and at most 10 tags", () => {
  const catalog = testCatalog();
  const empty = sarifFor([], "").runs[0]!;
  const full = sarifFor(fixtureFindings, "").runs[0]!;
  assert.deepEqual(
    full.tool.driver.rules!.map((r) => r.id),
    catalog.rules.map((r) => r.id),
  );
  assert.equal(empty.tool.driver.rules!.length, 12);
  for (const r of full.tool.driver.rules!) assert.ok((r.properties!["tags"] as string[]).length <= 10);
  for (const res of full.results!) assert.equal(full.tool.driver.rules![res.ruleIndex!]!.id, res.ruleId);
  assert.deepEqual(
    empty.tool.driver.rules!.map((r) => r.id),
    full.tool.driver.rules!.map((r) => r.id),
  );
  assert.equal(full.tool.driver.rules!.find((r) => r.id === "PR-LOG")!.properties!["security-severity"], "8.0");
});

test("[OUT-02] results above 25,000 are capped with run.properties.truncated", () => {
  const many = Array.from({ length: LIMITS.sarifMaxResults + 1 }, (_, i) => finding({ id: `PRF-${String(i).padStart(12, "0")}`, fingerprint: String(i).padStart(32, "0") }));
  const capped = sarifFor(many, "").runs[0]!;
  assert.equal(capped.results!.length, 25_000);
  assert.deepEqual(capped.properties, { truncated: true });
  assert.deepEqual(validateSarifInvariants(sarifFor(many, "")), []);
  const exact = sarifFor(many.slice(0, 25_000), "").runs[0]!;
  assert.equal(exact.results!.length, 25_000);
  assert.equal(exact.properties, undefined);
});

test("[OUT-02] precision is never very-high; LLM findings are low", () => {
  const llm = finding({ origin: "llm", ruleId: "PR-AMBIGUOUS", categories: ["special.health"] });
  const checksum = finding({ evidence: [{ kind: "checksum", detail: "checksum valid", weight: 0.35 }] });
  const exactAndType = finding({ evidence: [{ kind: "field-name", detail: 'exact term "cpf" (en)', weight: 0.6 }, { kind: "type-hint", detail: "x", weight: 0.1 }] });
  const plain = finding({ evidence: [{ kind: "field-name", detail: 'token term "cpf" (en)', weight: 0.5 }] });
  assert.deepEqual([llm, checksum, exactAndType, plain].map(precisionOf), ["low", "high", "high", "medium"]);
  const log = sarifFor([llm, checksum, plain], "");
  for (const r of log.runs[0]!.results!) assert.notEqual((r.properties as { precision: string }).precision, "very-high");
  assert.equal((log.runs[0]!.results![0]!.properties as { precision: string }).precision, "low");
  for (const rule of log.runs[0]!.tool.driver.rules!) assert.notEqual(rule.properties!["precision"], "very-high");
});

test("[OUT-04] fullDescription and every help.markdown contain the disclaimer sentence", () => {
  const driver = sarifFor([], "").runs[0]!.tool.driver;
  assert.ok(driver.fullDescription!.text.endsWith(DISCLAIMER_EN));
  for (const rule of driver.rules!) {
    assert.ok(rule.fullDescription!.text.endsWith(DISCLAIMER_EN), rule.id);
    assert.ok(rule.help!.markdown!.includes(DISCLAIMER_EN), rule.id);
    assert.ok(rule.help!.text.includes(DISCLAIMER_EN), rule.id);
  }
});

test("below-threshold findings are excluded and suppressed ones carry an external suppression", () => {
  const below = finding({ belowThreshold: true, confidence: 0.3 });
  const suppressed = finding({ suppressed: { reason: "Test fixture data", by: "flavio" } });
  const results = sarifFor([below, suppressed], "").runs[0]!.results!;
  assert.equal(results.length, 1);
  assert.deepEqual(results[0]!.suppressions, [{ kind: "external", justification: "Test fixture data" }]);
});

test("properties.articles lists the keys per regime as 'art. N'", () => {
  const log = sarifFor(fixtureFindings.filter((f) => f.ruleId === "PR-LOG"), "");
  const articles = (log.runs[0]!.results![0]!.properties as { articles: { lgpd: string[]; gdpr: string[] } }).articles;
  assert.ok(articles.lgpd.includes("art. 46"));
  assert.ok(articles.gdpr.includes("art. 32"));
});

test("catalog --validate-sarif rejects an absolute URI with SARIF_INVALID", () => {
  const log = JSON.parse(JSON.stringify(sarifFor(fixtureFindings, "")));
  log.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri = "/etc/passwd";
  const problems = validateSarifInvariants(log);
  assert.ok(problems.length > 0);
  assert.ok(problems.every((p) => !p.includes("/etc/passwd")), "a problem never echoes the value");
  log.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri = "src\\a.ts";
  assert.ok(validateSarifInvariants(log).length > 0);
  log.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri = "../a.ts";
  assert.ok(validateSarifInvariants(log).length > 0);
});

test("validateSarifInvariants reports a missing fingerprint, over 10 tags, very-high precision and too many results", () => {
  const base = JSON.parse(JSON.stringify(sarifFor(fixtureFindings, "")));
  const noFp = structuredClone(base);
  delete noFp.runs[0].results[0].partialFingerprints.primaryLocationLineHash;
  assert.ok(validateSarifInvariants(noFp).some((p) => p.includes("primaryLocationLineHash")));
  const tags = structuredClone(base);
  tags.runs[0].tool.driver.rules[0].properties.tags = Array.from({ length: 11 }, (_, i) => `t${i}`);
  assert.ok(validateSarifInvariants(tags).length > 0);
  const vh = structuredClone(base);
  vh.runs[0].tool.driver.rules[0].properties.precision = "very-high";
  assert.ok(validateSarifInvariants(vh).length > 0);
  const big = structuredClone(base);
  big.runs[0].results = Array.from({ length: LIMITS.sarifMaxResults + 1 }, () => structuredClone(base.runs[0].results[0]));
  assert.ok(validateSarifInvariants(big).some((p) => p.includes("too_many")));
  assert.ok(validateSarifInvariants({}).length > 0);
  assert.ok(validateSarifInvariants(null).length > 0);
});

test("@types/sarif typing: buildSarif returns a Log", () => {
  const log: Log = sarifFor([], "");
  assert.equal(log.version, "2.1.0");
});
