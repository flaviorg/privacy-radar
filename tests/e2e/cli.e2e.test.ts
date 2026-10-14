import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scanResultSchema } from "../../src/contracts/findings.ts";
import { validateSarifInvariants } from "../../src/contracts/sarif.ts";
import { DEMO_FIXTURE_DIR } from "../../src/infra/paths.ts";
import { TOOL_VERSION } from "../../src/infra/version.ts";
import { DISCLAIMER_EN } from "../../src/output/disclaimer.ts";
import { BANNER_FIRST, BANNER_LAST } from "../../src/output/table.ts";
import { runCli } from "../helpers/run-cli.ts";
import { runScanInProcess } from "../helpers/run-scan.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";

test("[CAT-01] catalog --validate exits 0 and prints counts", async () => {
  const r = await runCli(["catalog", "--validate"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /46 categories · 3 term files · 30 vendors · 27 LGPD and 32 GDPR articles · 12 rules/);
});

test("[OUT-08] an unknown flag exits 2 with one error line and no stack", async () => {
  const r = await runCli(["catalog", "--nope"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr.trim(), /^error: USAGE: /);
  assert.equal(r.stderr.trim().split("\n").length, 1);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});

test("[OUT-08] an unknown command exits 2 with one USAGE line", async () => {
  const r = await runCli(["frobnicate"]);
  assert.equal(r.code, 2);
  assert.match(r.stderr.trim(), /^error: USAGE: unknown command/);
});

test("--version prints the package version and --help lists the commands", async () => {
  const v = await runCli(["--version"]);
  assert.equal(v.code, 0);
  assert.equal(v.stdout.trim(), `privacy-radar ${TOOL_VERSION}`);
  const h = await runCli(["--help"]);
  assert.equal(h.code, 0);
  for (const word of ["scan", "pr", "catalog", "--validate", "--print"]) assert.ok(h.stdout.includes(word), word);
  assert.ok(h.stdout.includes("scan writes to ./privacy-radar-out when --out is not given"), "the default output folder is documented");
});

test("catalog --print vendors prints JSON that parses, and an unknown --print value is a usage error", async () => {
  const r = await runCli(["catalog", "--print", "vendors"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).length, 30);
  const bad = await runCli(["catalog", "--print", "nothing"]);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /^error: USAGE: /);
});

// ---------------------------------------------------------------------------------------------
// scan command (Task 29)

const FIXTURE = "fixtures/telehealth-clinic";

test("[OUT-07] exit 1 with errors at or above --fail-on error, 0 with --fail-on none", async (t) => {
  assert.equal((await runCli(["scan", FIXTURE, "--llm", "none", "--out", tmpDir(t)])).code, 1);
  assert.equal((await runCli(["scan", FIXTURE, "--llm", "none", "--fail-on", "none", "--out", tmpDir(t)])).code, 0);
  assert.equal((await runCli(["scan", FIXTURE, "--llm", "none", "--fail-on", "note", "--out", tmpDir(t)])).code, 1);
});

test("[OUT-07] suppressing every error finding brings the exit code to 0 under --fail-on error", async (t) => {
  const outcome = await runScanInProcess(t, {});
  const errors = outcome.result.findings.filter((f) => f.severity === "error");
  assert.equal(errors.length, 5);
  const config = join(tmpDir(t), "privacy-radar.config.json");
  writeFileSync(config, JSON.stringify({ schemaVersion: 1, suppressions: errors.map((f) => ({ fingerprint: f.fingerprint, reason: "Synthetic fixture data, not production", by: "flavio" })) }));
  const r = await runCli(["scan", FIXTURE, "--llm", "none", "--config", config, "--out", tmpDir(t), "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const parsed = scanResultSchema.parse(JSON.parse(r.stdout));
  assert.equal(parsed.summary.suppressed, 5);
  assert.equal(parsed.summary.error, 0);
  assert.equal((await runCli(["scan", FIXTURE, "--llm", "none", "--config", config, "--fail-on", "warning", "--out", tmpDir(t)])).code, 1);
});

test("[OUT-08] exit 2 for USAGE and CONFIG_INVALID, exit 3 for TARGET_NOT_FOUND and NO_SUPPORTED_FILES, one error line each", async (t) => {
  const readmeOnly = tmpDir(t);
  writeFileSync(join(readmeOnly, "README.md"), "# nothing to scan\n");
  const cases: [string[], number, string][] = [
    [["scan"], 2, "USAGE"],
    [["scan", "x", "--min-confidence", "2"], 2, "USAGE"],
    [["scan", FIXTURE, "--format", "pdf"], 2, "USAGE"],
    [["scan", FIXTURE, "--regime", "ccpa"], 2, "USAGE"],
    [["scan", FIXTURE, "--nope"], 2, "USAGE"],
    [["scan", FIXTURE, "--config", "tests/fixtures/config/suppression-without-reason.json"], 2, "CONFIG_INVALID"],
    [["scan", "/nonexistent"], 3, "TARGET_NOT_FOUND"],
    [["scan", readmeOnly], 3, "NO_SUPPORTED_FILES"],
  ];
  for (const [args, code, name] of cases) {
    const r = await runCli([...args, "--out", join(tmpDir(t), "o")]);
    assert.equal(r.code, code, `${args.join(" ")}: ${r.stderr}`);
    const lines = r.stderr.trim().split("\n");
    assert.equal(lines.length, 1, r.stderr);
    assert.ok(lines[0]!.startsWith(`error: ${name}: `), lines[0]);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  }
});

test("[OUT-07] --json prints only the scan result on stdout", async (t) => {
  const r = await runCli(["scan", FIXTURE, "--llm", "none", "--format", "table,json", "--json", "--out", tmpDir(t)]);
  assert.equal(r.code, 1);
  const parsed = scanResultSchema.parse(JSON.parse(r.stdout));
  assert.equal(parsed.findings.length, 17);
  assert.ok(!r.stdout.includes("DRAFTS, NOT LEGAL ADVICE"));
});

test("table output prints the banner first and last and DISCLAIMER_EN", async (t) => {
  const r = await runCli(["scan", FIXTURE, "--llm", "none", "--format", "table", "--out", tmpDir(t)]);
  assert.equal(r.code, 1);
  const lines = r.stdout.trimEnd().split("\n");
  assert.equal(lines[0], BANNER_FIRST);
  assert.equal(lines.at(-1), BANNER_LAST);
  assert.ok(lines.includes(DISCLAIMER_EN));
  assert.ok(lines.some((l) => l.includes("PR-ANALYTICS")));
  for (const line of lines) assert.ok(line.length <= 100, line);
});

test("[RF-1] scan of a target and an --out whose paths contain a space exits 1 with relative URIs", async (t) => {
  const base = join(tmpDir(t), "with space");
  cpSync(DEMO_FIXTURE_DIR, join(base, "repo"), { recursive: true });
  const r = await runCli(["scan", join(base, "repo"), "--llm", "none", "--format", "json,sarif", "--out", join(base, "out")]);
  assert.equal(r.code, 1, r.stderr);
  const sarif = readFileSync(join(base, "out", "findings.sarif"), "utf8");
  assert.ok(!sarif.includes(base));
  assert.ok(!readFileSync(join(base, "out", "findings.json"), "utf8").includes(base));
  for (const res of JSON.parse(sarif).runs[0].results) assert.match(res.locations[0].physicalLocation.artifactLocation.uri, /^(src|prisma|migrations)\//);
  assert.deepEqual(validateSarifInvariants(JSON.parse(sarif)), []);
});

test("a fake provider without a fixture scans as none, with one LLM_FIXTURE_MISSING warning and the provider label", async (t) => {
  const r = await runCli(["scan", FIXTURE, "--format", "table,json", "--out", tmpDir(t), "--json"], { env: { LLM_PROVIDER: "fake" } });
  assert.equal(r.code, 1);
  const parsed = scanResultSchema.parse(JSON.parse(r.stdout));
  assert.equal(parsed.provider, "none");
  assert.deepEqual(parsed.warnings.map((w) => w.code), ["LLM_FIXTURE_MISSING"]);
  const table = await runCli(["scan", FIXTURE, "--format", "table", "--out", tmpDir(t)], { env: { LLM_FIXTURE: "tests/fixtures/does-not-exist.json" } });
  assert.match(table.stdout, /provider: none \(fake fixture not found: tests\/fixtures\/does-not-exist\.json\)/);
});

test("scan reads privacy-radar.config.json from the target when --config is not given", async (t) => {
  const repo = join(tmpDir(t), "repo");
  cpSync(DEMO_FIXTURE_DIR, repo, { recursive: true });
  writeFileSync(join(repo, "privacy-radar.config.json"), JSON.stringify({ schemaVersion: 1, suppressions: [{ rule: "PR-LOG", file: "src/patients.ts", line: 14, reason: "short", by: "x" }] }));
  const r = await runCli(["scan", repo, "--llm", "none", "--out", join(tmpDir(t), "o")]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /^error: CONFIG_INVALID: /);
});

test("an invalid environment is a CONFIG_INVALID error", async (t) => {
  const r = await runCli(["scan", FIXTURE, "--out", tmpDir(t)], { env: { LOG_LEVEL: "verbose" } });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /^error: CONFIG_INVALID: /);
});

test("catalog --validate-sarif accepts a scan's SARIF and rejects an absolute URI with SARIF_INVALID", async (t) => {
  const out = tmpDir(t);
  await runCli(["scan", FIXTURE, "--llm", "none", "--format", "sarif", "--out", out]);
  const ok = await runCli(["catalog", "--validate-sarif", join(out, "findings.sarif")]);
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stdout, /^sarif ok: 17 results · 12 rules · fingerprints ok/);
  const log = JSON.parse(readFileSync(join(out, "findings.sarif"), "utf8"));
  log.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri = "/abs/path/secret.ts";
  const bad = join(out, "bad.sarif");
  writeFileSync(bad, JSON.stringify(log));
  const r = await runCli(["catalog", "--validate-sarif", bad]);
  assert.equal(r.code, 2);
  assert.match(r.stderr.trim(), /^error: SARIF_INVALID: /);
  assert.equal(r.stderr.trim().split("\n").length, 1);
  assert.ok(!r.stderr.includes("/abs/path/secret.ts"));
  const missing = await runCli(["catalog", "--validate-sarif", join(out, "nope.sarif")]);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /^error: SARIF_INVALID: /);
});

test("[LLM-07] the garbage fixture degrades: LLM_DEGRADED warnings, deterministic findings, exit 1", async (t) => {
  const out = tmpDir(t);
  const r = await runCli(["scan", FIXTURE, "--llm", "fake", "--llm-fixture", "tests/fixtures/llm/garbage-output.json", "--json", "--out", out]);
  assert.equal(r.code, 1, r.stderr);
  const res = scanResultSchema.parse(JSON.parse(r.stdout));
  assert.deepEqual(res.warnings.filter((w) => w.code === "LLM_DEGRADED").map((w) => [w.file, w.line]), [["prisma/schema.prisma", 17], ["prisma/schema.prisma", 27]]);
  assert.ok(res.warnings.every((w) => w.code !== "LLM_DEGRADED" || /LLM_OUTPUT_INVALID/.test(w.message)));
  assert.deepEqual([res.provider, res.summary.error, res.summary.warning, res.summary.note], ["fake", 5, 10, 2]);
  assert.deepEqual(res.llm, { calls: 2, degraded: 2, repaired: 0, fieldsClassified: 0, narrativeSections: 0, simulated: true });
  assert.ok(res.findings.every((f) => f.origin === "deterministic"));
  const trace = readFileSync(join(out, "llm-trace.jsonl"), "utf8").trimEnd().split("\n").map((l) => JSON.parse(l) as { outcome: string; simulated?: boolean });
  assert.deepEqual(trace.map((l) => [l.outcome, l.simulated]), [["degraded", true], ["degraded", true]]);
  const table = await runCli(["scan", FIXTURE, "--llm", "fake", "--llm-fixture", "tests/fixtures/llm/garbage-output.json", "--format", "table", "--out", tmpDir(t)]);
  assert.match(table.stdout, /llm: 2 calls · 0 fields labeled · 0 repaired · 2 degraded \(simulated by the scripted fake\)/);
  assert.match(table.stdout, /provider: fake \(scripted\)/);
});

test("[LLM-11] a copy named telehealth-clinic scanned with LLM_PROVIDER=fake and no fixture exits by the rules with one LLM_FIXTURE_MISSING", async (t) => {
  const dir = join(tmpDir(t), "telehealth-clinic");
  cpSync(DEMO_FIXTURE_DIR, dir, { recursive: true });
  const r = await runCli(["scan", dir, "--json", "--out", tmpDir(t)], { env: { LLM_PROVIDER: "fake" } });
  assert.equal(r.code, 1, r.stderr);
  const res = JSON.parse(r.stdout) as { warnings: { code: string }[]; provider: string };
  assert.deepEqual(res.warnings.filter((w) => w.code === "LLM_FIXTURE_MISSING").length, 1);
  assert.equal(res.provider, "none");
  assert.doesNotMatch(r.stderr, /UNSCRIPTED_LLM_CALL/);
});

test("[LLM-03] an existing fixture without a turn for a field exits 2 with UNSCRIPTED_LLM_CALL; a stale hash exits 2 with FIXTURE_PROMPT_DRIFT", async (t) => {
  const dir = tmpDir(t);
  const demo = JSON.parse(readFileSync("fixtures/llm/telehealth-clinic.json", "utf8")) as { turns: unknown[]; promptHashes: Record<string, string> };
  const partial = join(dir, "partial.json");
  writeFileSync(partial, JSON.stringify({ ...demo, turns: demo.turns.slice(0, 1) }));
  const r = await runCli(["scan", FIXTURE, "--llm", "fake", "--llm-fixture", partial, "--out", tmpDir(t)]);
  assert.equal(r.code, 2);
  assert.match(r.stderr.trim(), /^error: UNSCRIPTED_LLM_CALL: no unconsumed turn for label-field\.v1 with entity=Appointment, field=extra; consumed: classify-patient-obs; known: classify-patient-obs$/);
  const stale = join(dir, "stale.json");
  writeFileSync(stale, JSON.stringify({ ...demo, promptHashes: { ...demo.promptHashes, "label-field.v1": "sha256:00" } }));
  const s = await runCli(["scan", FIXTURE, "--llm", "fake", "--llm-fixture", stale, "--out", tmpDir(t)]);
  assert.equal(s.code, 2);
  assert.match(s.stderr.trim(), /^error: FIXTURE_PROMPT_DRIFT: .*label-field\.v1.*npm run fixtures:rehash/);
  assert.equal(s.stderr.trim().split("\n").length, 1);
});

test("[LLM-08] with openai-compatible and a key-shaped LLM_API_KEY, the degraded scan prints and writes the key nowhere", async (t) => {
  const key = "sk-or-v1-" + "k".repeat(40);
  const out = tmpDir(t);
  const r = await runCli(["scan", FIXTURE, "--llm", "openai-compatible", "--out", out, "--format", "json,sarif,md,table"], { env: { LLM_API_KEY: key, LLM_MODEL: "test/model", LOG_LEVEL: "debug" } });
  assert.equal(r.code, 1, r.stderr); // the network guard makes every call fail: degraded
  assert.match(r.stdout, /provider: openai-compatible \(test\/model\)/);
  assert.match(r.stdout, /llm: 2 calls · 0 fields labeled · 0 repaired · 2 degraded\n/);
  assert.match(r.stderr, /"event":"llm.degraded"/);
  const files = readdirSync(out).sort();
  assert.deepEqual(files, ["findings.json", "findings.sarif", "inventory.json", "inventory.md", "llm-trace.jsonl"]);
  const findings = JSON.parse(readFileSync(join(out, "findings.json"), "utf8")) as { warnings: { code: string; message: string }[] };
  assert.deepEqual(findings.warnings.filter((w) => w.code === "LLM_DEGRADED").map((w) => /LLM_NETWORK/.test(w.message)), [true, true]);
  for (const text of [r.stdout, r.stderr, ...files.map((f) => readFileSync(join(out, f), "utf8"))]) assert.ok(!text.includes(key) && !text.includes("k".repeat(40)));
});

test("openai-compatible without LLM_API_KEY or LLM_MODEL is a usage error", async (t) => {
  const r = await runCli(["scan", FIXTURE, "--llm", "openai-compatible", "--out", tmpDir(t)], { env: { LLM_MODEL: "test/model" } });
  assert.equal(r.code, 2);
  assert.match(r.stderr.trim(), /^error: USAGE: --llm openai-compatible needs LLM_API_KEY and LLM_MODEL/);
});
