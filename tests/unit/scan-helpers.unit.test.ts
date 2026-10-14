import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveLlm } from "../../src/app/llm.ts";
import { loadCatalog } from "../../src/catalog/load.ts";
import { loadEnv } from "../../src/infra/config.ts";
import { createPrompts } from "../../src/prompts/index.ts";
import { OWNED_ARTIFACTS, displayTarget, exitCodeFor } from "../../src/app/scan.ts";
import { prOptionsSchema, scanOptionsSchema } from "../../src/contracts/cli.ts";
import { finding } from "../helpers/builders.ts";
import { runScanInProcess } from "../helpers/run-scan.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import { PrivacyRadarError } from "../../src/infra/errors.ts";

const prompts = createPrompts(loadCatalog().categories.map((c) => c.id));

test("[OUT-07] exitCodeFor counts only deterministic, non-suppressed findings at or above the threshold and --fail-on", () => {
  const error = finding({ severity: "error" });
  const warning = finding({ severity: "warning" });
  const note = finding({ severity: "note" });
  assert.equal(exitCodeFor([], "error"), 0);
  assert.equal(exitCodeFor([error], "error"), 1);
  assert.equal(exitCodeFor([warning, note], "error"), 0);
  assert.equal(exitCodeFor([warning], "warning"), 1);
  assert.equal(exitCodeFor([note], "warning"), 0);
  assert.equal(exitCodeFor([note], "note"), 1);
  assert.equal(exitCodeFor([error], "none"), 0);
  assert.equal(exitCodeFor([finding({ severity: "error", suppressed: { reason: "fixture data", by: "x" } })], "error"), 0);
  assert.equal(exitCodeFor([finding({ severity: "error", belowThreshold: true })], "error"), 0);
  assert.equal(exitCodeFor([finding({ severity: "error", origin: "llm" })], "error"), 0, "LLM findings never raise the exit code");
});

test("displayTarget is POSIX, never absolute and never resolved upward", () => {
  assert.equal(displayTarget("fixtures/telehealth-clinic"), "fixtures/telehealth-clinic");
  assert.equal(displayTarget("fixtures/telehealth-clinic/"), "fixtures/telehealth-clinic");
  assert.equal(displayTarget("./src"), "./src");
  assert.equal(displayTarget("."), ".");
  assert.equal(displayTarget("a\\b"), "a/b");
  assert.equal(displayTarget(join(process.cwd(), "fixtures", "telehealth-clinic")), "fixtures/telehealth-clinic");
  assert.equal(displayTarget("/somewhere/else/outside/my repo"), "my repo");
});

test("a scan deletes only the artifact names it owns and does not write, never another file", async (t) => {
  const out = tmpDir(t);
  for (const name of OWNED_ARTIFACTS) writeFileSync(join(out, name), "stale");
  writeFileSync(join(out, "notes.txt"), "mine");
  mkdirSync(join(out, "findings.sarif.d"));
  await runScanInProcess(t, { out, formats: ["json"] });
  assert.equal(readFileSync(join(out, "notes.txt"), "utf8"), "mine");
  for (const name of OWNED_ARTIFACTS.filter((n) => n !== "findings.json")) assert.throws(() => readFileSync(join(out, name)), { code: "ENOENT" }, name);
  assert.notEqual(readFileSync(join(out, "findings.json"), "utf8"), "stale");
});

test("a table-only scan creates no output folder", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "pr-notouch-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const out = join(base, "never-created");
  const outcome = await runScanInProcess(t, { out, formats: ["table"] });
  assert.deepEqual(outcome.written, []);
  assert.throws(() => readFileSync(join(out, "findings.json")), { code: "ENOENT" });
});

test("resolveLlm: none is silent; fake without an existing fixture is none plus one LLM_FIXTURE_MISSING warning", () => {
  const base = { env: loadEnv({}), prompts, redact: (s: string) => s };
  assert.deepEqual(resolveLlm({ ...base, choice: "none", fixturePath: null }), { provider: null, label: "none", warnings: [], fake: null });
  const missing = resolveLlm({ ...base, choice: "fake", fixturePath: null });
  assert.equal(missing.provider, null);
  assert.equal(missing.label, "none (fake fixture not found: none given)");
  assert.deepEqual(missing.warnings.map((w) => w.code), ["LLM_FIXTURE_MISSING"]);
  const named = resolveLlm({ ...base, choice: "fake", fixturePath: "fixtures/llm/missing.json" });
  assert.equal(named.label, "none (fake fixture not found: fixtures/llm/missing.json)");
  const demo = resolveLlm({ ...base, choice: "fake", fixturePath: "fixtures/llm/telehealth-clinic.json" });
  assert.deepEqual([demo.provider?.name, demo.label, demo.warnings, demo.fake === demo.provider], ["fake", "fake (scripted)", [], true]);
});

test("resolveLlm: openai-compatible needs LLM_API_KEY and LLM_MODEL; anthropic is a usage error", () => {
  const base = { prompts, redact: (s: string) => s, fixturePath: null };
  const usage = (e: unknown) => e instanceof PrivacyRadarError && e.code === "USAGE";
  assert.throws(() => resolveLlm({ ...base, choice: "openai-compatible", env: loadEnv({ LLM_MODEL: "m" }) }), usage);
  assert.throws(() => resolveLlm({ ...base, choice: "openai-compatible", env: loadEnv({ LLM_API_KEY: "k".repeat(12) }) }), usage);
  assert.throws(() => resolveLlm({ ...base, choice: "anthropic", env: loadEnv({}) }), usage);
  const real = resolveLlm({ ...base, choice: "openai-compatible", env: loadEnv({ LLM_API_KEY: "k".repeat(12), LLM_MODEL: "test/model" }) });
  assert.deepEqual([real.provider?.name, real.label, real.fake], ["openai-compatible", "openai-compatible (test/model)", null]);
});

test("scan options: defaults, lists, docs shortcuts and ranges", () => {
  const d = scanOptionsSchema.parse({});
  assert.deepEqual([d.regime, d.format, d.docs, d["report-lang"], d["fail-on"], d["min-confidence"], d["max-llm-fields"], d.json], ["both", ["table", "json"], [], "en", "error", 0.5, 20, false]);
  assert.deepEqual(scanOptionsSchema.parse({ format: "json,sarif,md,table,json" }).format, ["json", "sarif", "md", "table"]);
  assert.deepEqual(scanOptionsSchema.parse({ docs: "all" }).docs, ["ropa", "dpia", "registro", "ripd"]);
  assert.deepEqual(scanOptionsSchema.parse({ docs: "none" }).docs, []);
  assert.deepEqual(scanOptionsSchema.parse({ docs: "ripd,ropa" }).docs, ["ripd", "ropa"]);
  assert.equal(scanOptionsSchema.parse({ "min-confidence": "0" })["min-confidence"], 0);
  assert.equal(scanOptionsSchema.parse({ "max-llm-fields": "100" })["max-llm-fields"], 100);
  assert.equal(scanOptionsSchema.parse({ "max-llm-fields": "0" })["max-llm-fields"], 0);
  for (const bad of [{ format: "pdf" }, { format: "" }, { format: "json," }, { docs: "all,ropa" }, { docs: "x" }, { "min-confidence": "2" }, { "min-confidence": "abc" }, { "max-llm-fields": "101" }, { "max-llm-fields": "1.5" }, { regime: "ccpa" }, { "fail-on": "fatal" }, { "report-lang": "fr" }, { llm: "anthropic" }]) {
    assert.equal(scanOptionsSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
});

test("pr options need a base and default the rest", () => {
  assert.equal(prOptionsSchema.safeParse({}).success, false);
  const p = prOptionsSchema.parse({ base: "origin/main" });
  assert.deepEqual([p.head, p.repo, p.regime, p.format, p["fail-on"]], ["HEAD", ".", "both", ["md", "json"], "error"]);
});
