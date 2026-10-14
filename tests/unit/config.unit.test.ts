import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ENV_KEYS, loadEnv, loadProjectConfig } from "../../src/infra/config.ts";
import { PrivacyRadarError } from "../../src/infra/errors.ts";
import { PROJECT_ROOT } from "../../src/infra/paths.ts";
import { projectConfigSchema } from "../../src/contracts/config.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";

const fx = (name: string) => join(PROJECT_ROOT, "tests", "fixtures", name);

test("[ENG-07] a suppression without a reason of at least 10 characters is CONFIG_INVALID", () => {
  assert.throws(
    () => loadProjectConfig(fx("config/suppression-without-reason.json")),
    (e: unknown) => e instanceof PrivacyRadarError && e.code === "CONFIG_INVALID" && /suppressions\.0\.reason/.test(e.message),
  );
});

test("[OUT-08] config errors name the path, never the value", (t) => {
  const dir = tmpDir(t);
  const f = join(dir, "c.json");
  writeFileSync(f, JSON.stringify({ schemaVersion: 1, controller: { name: "secret-value-123" }, unknownKey: "other-secret-456" }));
  assert.throws(
    () => loadProjectConfig(f),
    (e: unknown) =>
      e instanceof PrivacyRadarError &&
      e.code === "CONFIG_INVALID" &&
      !e.message.includes("secret-value-123") &&
      !e.message.includes("other-secret-456") &&
      /unknownKey/.test(e.message),
  );
});

test("[OUT-08] a wrong value type does not echo the value and a missing file is CONFIG_INVALID", (t) => {
  const dir = tmpDir(t);
  const f = join(dir, "c.json");
  writeFileSync(f, JSON.stringify({ schemaVersion: 1, reportLanguage: "klingon-secret-789" }));
  assert.throws(() => loadProjectConfig(f), (e: unknown) => e instanceof PrivacyRadarError && !e.message.includes("klingon-secret-789") && /reportLanguage/.test(e.message));
  assert.throws(() => loadProjectConfig(join(dir, "missing.json")), (e: unknown) => e instanceof PrivacyRadarError && e.code === "CONFIG_INVALID");
  writeFileSync(f, "{ not json");
  assert.throws(() => loadProjectConfig(f), (e: unknown) => e instanceof PrivacyRadarError && e.code === "CONFIG_INVALID");
});

test("valid config parses and the vendor mechanism enum holds", () => {
  const cfg = loadProjectConfig(fx("config/valid.json"));
  assert.equal(cfg.schemaVersion, 1);
  assert.equal(cfg.controller?.country, "BR");
  assert.equal(cfg.suppressions?.length, 2);
  assert.equal(cfg.llm?.maxFields, 20);
  assert.equal(loadProjectConfig(fx("config/vendor-mechanism.json")).vendors?.["api.mixpanel.com"]?.mechanism, "scc");
  const bad = projectConfigSchema.safeParse({ schemaVersion: 1, vendors: { "a.example": { mechanism: "magic" } } });
  assert.equal(bad.success, false);
});

test("a null path gives the minimal config and only schemaVersion is required", () => {
  assert.deepEqual(loadProjectConfig(null), { schemaVersion: 1 });
  assert.equal(projectConfigSchema.safeParse({}).success, false);
  assert.equal(projectConfigSchema.safeParse({ schemaVersion: 2 }).success, false);
  assert.equal(projectConfigSchema.safeParse({ schemaVersion: 1 }).success, true);
});

test("a suppression needs a fingerprint or rule + file + line, a reason and an author", () => {
  const ok = (s: unknown) => projectConfigSchema.safeParse({ schemaVersion: 1, suppressions: [s] }).success;
  assert.equal(ok({ fingerprint: "abc", reason: "long enough reason", by: "me" }), true);
  assert.equal(ok({ rule: "PR-LOG", file: "a.ts", line: 3, reason: "long enough reason", by: "me", until: "2027-01-01" }), true);
  assert.equal(ok({ rule: "PR-LOG", reason: "long enough reason", by: "me" }), false);
  assert.equal(ok({ fingerprint: "abc", reason: "long enough reason" }), false);
  assert.equal(ok({ fingerprint: "abc", reason: "long enough reason", by: "me", until: "01/01/2027" }), false);
});

test("loadEnv applies the defaults of spec 5.12", () => {
  const env = loadEnv({});
  assert.equal(env.LLM_PROVIDER, "fake");
  assert.equal(env.LLM_BASE_URL, "https://openrouter.ai/api/v1");
  assert.equal(env.LLM_TIMEOUT_MS, 30000);
  assert.equal(env.PRIVACY_RADAR_MAX_FILES, 5000);
  assert.equal(env.LOG_LEVEL, "info");
  assert.equal(env.LLM_API_KEY, undefined);
});

test("loadEnv treats empty strings as unset, coerces numbers and rejects bad values without echoing them", () => {
  const env = loadEnv({ LLM_API_KEY: "", LLM_TIMEOUT_MS: "1500", LLM_PROVIDER: "none" });
  assert.equal(env.LLM_API_KEY, undefined);
  assert.equal(env.LLM_TIMEOUT_MS, 1500);
  assert.equal(env.LLM_PROVIDER, "none");
  assert.throws(
    () => loadEnv({ LLM_PROVIDER: "weird-secret-value" }),
    (e: unknown) => e instanceof PrivacyRadarError && e.code === "CONFIG_INVALID" && /LLM_PROVIDER/.test(e.message) && !e.message.includes("weird-secret-value"),
  );
  assert.equal(loadEnv({ LLM_PROVIDER: "anthropic" }).LLM_PROVIDER, "anthropic");
});

test("ENV_KEYS lists every variable the schema reads", () => {
  assert.deepEqual(
    [...ENV_KEYS].sort(),
    ["LLM_API_KEY", "LLM_BASE_URL", "LLM_FIXTURE", "LLM_MODEL", "LLM_PROVIDER", "LLM_TIMEOUT_MS", "LOG_LEVEL", "PRIVACY_RADAR_CLOCK", "PRIVACY_RADAR_MAX_FILES", "PROPERTY_SEED"],
  );
});
