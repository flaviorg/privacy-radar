import { before, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scanResultSchema, type Finding } from "../../src/contracts/findings.ts";
import { toFindingsJson } from "../../src/output/json.ts";
import { isTestPath } from "../../src/engine/confidence.ts";
import { runScanInProcess } from "../helpers/run-scan.ts";
import type { ScanOutcome } from "../../src/app/scan.ts";
import { resolveLlm } from "../../src/app/llm.ts";
import { loadCatalog } from "../../src/catalog/load.ts";
import { loadEnv } from "../../src/infra/config.ts";
import { createPrompts } from "../../src/prompts/index.ts";

const EXPECTED: readonly [string, string, string, number | null][] = [
  // spec 5.10, deterministic part
  ["error", "PR-ANALYTICS", "src/analytics.ts", 9],
  ["error", "PR-LOG", "src/patients.ts", 14],
  ["error", "PR-LOG", "src/patients.ts", 22],
  ["error", "PR-TRANSFER", "src/analytics.ts", 9],
  ["error", "PR-URL-QUERY", "src/appointments.ts", 11],
  ["warning", "PR-FILE", "src/billing.ts", 8],
  ["warning", "PR-HARDCODED-VALUE", "migrations/001_init.sql", null],
  ["warning", "PR-HARDCODED-VALUE", "src/server.ts", null],
  ["warning", "PR-PLAINTEXT-SENSITIVE", "prisma/schema.prisma", 14],
  ["warning", "PR-PLAINTEXT-SENSITIVE", "prisma/schema.prisma", 15],
  ["warning", "PR-PLAINTEXT-SENSITIVE", "prisma/schema.prisma", 16],
  ["warning", "PR-RETENTION", "prisma/schema.prisma", 3],
  ["warning", "PR-THIRD-PARTY", "src/analytics.ts", 12],
  ["warning", "PR-THIRD-PARTY", "src/appointments.ts", 11],
  ["warning", "PR-TRANSFER", "src/analytics.ts", 12],
  ["note", "PR-CHILD", "prisma/schema.prisma", 3],
  ["note", "PR-RETENTION", "prisma/schema.prisma", null],
];

const active = (findings: readonly Finding[]) => findings.filter((f) => !f.belowThreshold && !f.suppressed);

let outcome: ScanOutcome & { outDir: string };
before(async (t) => {
  outcome = await runScanInProcess(t as TestContext); // a hook receives a TestContext at run time
});

test("[ENG-09] the fixture yields the 17 deterministic findings of spec 5.10 by rule, file and line", () => {
  const got = active(outcome.result.findings).map((f) => [f.severity, f.ruleId, f.location.file, f.location.line] as const);
  assert.equal(got.length, 17, JSON.stringify(got));
  for (const e of EXPECTED) {
    assert.ok(got.some((g) => g[0] === e[0] && g[1] === e[1] && g[2] === e[2] && (e[3] === null || g[3] === e[3])), JSON.stringify(e));
  }
});

test("[ENG-09] summary 5 error, 10 warning, 2 note and target 8 files: 6 ts, 1 sql, 1 prisma", () => {
  const { summary, target, regime, provider, generatedAt, tool } = outcome.result;
  assert.equal(summary.error, 5);
  assert.equal(summary.warning, 10);
  assert.equal(summary.note, 2);
  assert.equal(summary.suppressed, 0);
  assert.equal(summary.llmLabeled, 0);
  assert.deepEqual(target, { path: "fixtures/telehealth-clinic", files: 8, sources: { ts: 6, sql: 1, prisma: 1 } });
  assert.equal(regime, "both");
  assert.equal(provider, "none");
  assert.equal(generatedAt, "2026-10-08T12:00:00.000Z");
  assert.equal(tool.name, "privacy-radar");
  assert.deepEqual(outcome.result.llm, { calls: 0, degraded: 0, repaired: 0, fieldsClassified: 0, narrativeSections: 0, simulated: false });
});

test("[OUT-01] findings.json validates, is ordered by severity, file, line, rule, and its snippets are masked", () => {
  const text = readFileSync(join(outcome.outDir, "findings.json"), "utf8");
  assert.equal(text, toFindingsJson(outcome.result));
  assert.ok(text.endsWith("}\n"));
  const parsed = scanResultSchema.parse(JSON.parse(text));
  const rank = { error: 0, warning: 1, note: 2 } as const;
  for (let i = 1; i < parsed.findings.length; i++) {
    const a = parsed.findings[i - 1]!;
    const b = parsed.findings[i]!;
    const key = (f: Finding) => [rank[f.severity], f.location.file, f.location.line, f.ruleId] as const;
    const [ka, kb] = [key(a), key(b)];
    const order = ka[0] - kb[0] || (ka[1] < kb[1] ? -1 : ka[1] > kb[1] ? 1 : 0) || ka[2] - kb[2] || (ka[3] < kb[3] ? -1 : ka[3] > kb[3] ? 1 : 0);
    assert.ok(order <= 0, `${a.id} before ${b.id}`);
  }
  for (const f of parsed.findings) assert.ok(f.location.snippet.length <= 160);
  assert.ok(Object.keys(JSON.parse(text)).join() === "schemaVersion,tool,target,regime,provider,generatedAt,summary,findings,warnings,llm", "keys in schema order");
});

test("[ENG-03] Clinic.name and Clinic.address findings, if any, carry belowThreshold and stay in JSON only", () => {
  const clinic = outcome.result.findings.filter((f) => f.entity?.name === "Clinic" && (f.entity.field === "name" || f.entity.field === "address"));
  for (const f of clinic) assert.equal(f.belowThreshold, true);
  assert.equal(outcome.result.summary.belowThreshold, outcome.result.findings.filter((f) => f.belowThreshold).length);
  assert.equal(outcome.exitFindings.filter((f) => f.belowThreshold).length, 0);
});

test("[SRC-05] scanning the same files listed in a shuffled order gives byte-identical findings.json", async (t) => {
  const reversed = await runScanInProcess(t, { orderFiles: (files) => [...files].reverse() });
  const rotated = await runScanInProcess(t, { orderFiles: (files) => [...files.slice(3), ...files.slice(0, 3)] });
  const base = readFileSync(join(outcome.outDir, "findings.json"), "utf8");
  assert.equal(readFileSync(join(reversed.outDir, "findings.json"), "utf8"), base);
  assert.equal(readFileSync(join(rotated.outDir, "findings.json"), "utf8"), base);
  assert.equal(JSON.stringify(reversed.inventory), JSON.stringify(outcome.inventory));
});

test("PR-LOG at patients.ts:14 carries the 11 deterministic categories of Patient and evidence type-hint", () => {
  const f = outcome.result.findings.find((x) => x.ruleId === "PR-LOG" && x.location.file === "src/patients.ts" && x.location.line === 14);
  assert.ok(f);
  assert.equal(f.categories.length, 11, f.categories.join());
  assert.equal(f.sensitivity, "sensitive");
  assert.ok(f.evidence.some((e) => e.kind === "type-hint"));
});

test("[ENG-04] --regime lgpd and --regime gdpr empty the other article array in every finding", async (t) => {
  const lgpd = await runScanInProcess(t, { regime: "lgpd" });
  const gdpr = await runScanInProcess(t, { regime: "gdpr" });
  assert.ok(lgpd.result.findings.length > 0);
  for (const f of lgpd.result.findings) assert.deepEqual(f.articles.gdpr, [], f.id);
  for (const f of gdpr.result.findings) assert.deepEqual(f.articles.lgpd, [], f.id);
  assert.ok(lgpd.result.findings.some((f) => f.articles.lgpd.length > 0));
  assert.ok(gdpr.result.findings.some((f) => f.articles.gdpr.length > 0));
  assert.equal(lgpd.result.regime, "lgpd");
});

test("target.path is POSIX and never absolute, even when the target is given as an absolute path", async (t) => {
  const { PROJECT_ROOT } = await import("../../src/infra/paths.ts");
  const abs = await runScanInProcess(t, { target: join(PROJECT_ROOT, "fixtures", "telehealth-clinic") });
  assert.ok(!abs.result.target.path.startsWith("/"), abs.result.target.path);
  assert.ok(!abs.result.target.path.includes("\\"));
  assert.ok(!isTestPath("src/x.ts"));
});

test("a target that does not exist is TARGET_NOT_FOUND and one without supported files is NO_SUPPORTED_FILES", async (t) => {
  await assert.rejects(runScanInProcess(t, { target: "/nonexistent/target-dir" }), { code: "TARGET_NOT_FOUND" });
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "pr-empty-"));
  t.after(() => import("node:fs").then((fs) => fs.rmSync(dir, { recursive: true, force: true })));
  writeFileSync(join(dir, "README.md"), "# nothing to scan\n");
  await assert.rejects(runScanInProcess(t, { target: dir }), { code: "NO_SUPPORTED_FILES" });
});

test("an --out that cannot be created is OUT_NOT_WRITABLE", async (t) => {
  await assert.rejects(runScanInProcess(t, { out: "/dev/null/blocked" }), { code: "OUT_NOT_WRITABLE" });
});

test("re-running into the same --out leaves only the artifacts of the last run", async (t) => {
  const first = await runScanInProcess(t, { formats: ["json", "sarif", "md"] });
  const { readdirSync } = await import("node:fs");
  assert.deepEqual(readdirSync(first.outDir).sort(), ["findings.json", "findings.sarif", "inventory.json", "inventory.md"]);
  await runScanInProcess(t, { out: first.outDir, formats: ["json"] });
  assert.deepEqual(readdirSync(first.outDir).sort(), ["findings.json"]);
});

test("inventory counts equal spec 5.10: 3 entities, 24 fields, 14 personal, 3 sensitive, 2 children indicators, 1 not personal, 2 below threshold, 2 ambiguous, 5 unclassified, 16 values masked", () => {
  assert.deepEqual(outcome.inventory.counts, {
    entities: 3,
    fields: 24,
    personal: 14,
    sensitive: 3,
    childrenIndicators: 2,
    notPersonal: 1,
    belowThreshold: 2,
    ambiguous: 2,
    unclassified: 5,
    valuesMasked: 16,
  });
  assert.deepEqual(
    outcome.inventory.hosts.map((h) => [h.host, h.vendor]),
    [
      ["api.mixpanel.com", "Mixpanel"],
      ["sms.example-vendor.invalid", null],
    ],
  );
  for (const e of outcome.inventory.entities) assert.equal(e.locations.length, 2, `${e.name} has its Prisma model and its SQL table`);
});

test("[OUT-05] inventory.md has one table per entity with the columns and flags of spec 5.1", () => {
  const md = readFileSync(join(outcome.outDir, "inventory.md"), "utf8");
  assert.equal(md.match(/^\| Field \| Categories \| Sensitivity \| Confidence \| Sinks reached \| Locations \| LLM label \(advisory\) \|$/gm)?.length, 3);
  for (const entity of ["Appointment", "Clinic", "Patient"]) assert.ok(md.includes(`## \`${entity}\``), entity);
  assert.ok(md.includes("- Has sensitive data: yes"));
  assert.ok(md.includes("- Has children indicator: yes"));
  assert.ok(md.includes("- Retention signal: none"));
  assert.ok(md.includes("`prisma/schema.prisma:3`") && md.includes("`migrations/001_init.sql:"));
  const json = JSON.parse(readFileSync(join(outcome.outDir, "inventory.json"), "utf8"));
  assert.deepEqual(json.counts, outcome.inventory.counts);
});

test("[ENG-08] findings.json minus PR-AMBIGUOUS is byte-identical between --llm fake and --llm none", async (t) => {
  const prompts = createPrompts(loadCatalog().categories.map((c) => c.id));
  const llm = resolveLlm({ choice: "fake", fixturePath: "fixtures/llm/telehealth-clinic.json", env: loadEnv({}), prompts, redact: (s) => s });
  const fake = await runScanInProcess(t, { llm });
  const strip = (r: typeof outcome.result) => JSON.stringify(r.findings.filter((f) => f.origin === "deterministic"));
  assert.equal(strip(fake.result), strip(outcome.result));
  assert.equal(fake.result.findings.filter((f) => f.origin === "deterministic").length, outcome.result.findings.length);
  assert.deepEqual(fake.result.findings.filter((f) => f.origin !== "deterministic").map((f) => f.ruleId), ["PR-AMBIGUOUS"]);
  const det = (text: string) => JSON.stringify((JSON.parse(text) as typeof outcome.result).findings.filter((f) => f.origin === "deterministic"));
  assert.equal(det(readFileSync(join(fake.outDir, "findings.json"), "utf8")), det(readFileSync(join(outcome.outDir, "findings.json"), "utf8")));
});
