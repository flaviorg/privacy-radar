import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import type { ProjectConfig } from "../../src/contracts/config.ts";
import { PrivacyRadarError } from "../../src/infra/errors.ts";
import { loadProjectConfig } from "../../src/infra/config.ts";
import { finalizeFindings } from "../../src/engine/finalize.ts";
import { applyRules } from "../../src/engine/rules/index.ts";
import { applySuppressions, isIgnored } from "../../src/engine/suppressions.ts";
import { buildModelFromTexts, finding } from "../helpers/builders.ts";
import { PROJECT_ROOT_FOR_TESTS } from "../helpers/child-node-args.ts";

const TODAY = new Date("2026-10-08T12:00:00.000Z");
const TEXT = "console.log(patient.cpf);\nconsole.info(patient.email);\n";

function run(config: ProjectConfig, today = TODAY) {
  const model = buildModelFromTexts({ "src/a.ts": TEXT });
  return finalizeFindings(applyRules(model), { maskedLines: model.maskedLines, minConfidence: 0.5, config, today });
}
const base = run({ schemaVersion: 1 });
const cpfLog = base.find((f) => f.categories.includes("identifier.cpf"))!;

test("[ENG-07] a suppression by fingerprint or by rule+file+line keeps the finding with suppressed set", () => {
  const byFp = run({ schemaVersion: 1, suppressions: [{ fingerprint: cpfLog.fingerprint, reason: "Test data, not production", by: "flavio", until: "2027-01-01" }] });
  assert.equal(byFp.length, base.length);
  assert.deepEqual(byFp.find((f) => f.id === cpfLog.id)!.suppressed, { reason: "Test data, not production", by: "flavio", until: "2027-01-01" });
  assert.equal(byFp.filter((f) => f.suppressed).length, 1);
  const byLine = run({ schemaVersion: 1, suppressions: [{ rule: "PR-LOG", file: "src/a.ts", line: 2, reason: "Reviewed: e-mail is pseudonymous", by: "dpo" }] });
  const email = byLine.find((f) => f.categories.includes("contact.email"))!;
  assert.deepEqual(email.suppressed, { reason: "Reviewed: e-mail is pseudonymous", by: "dpo" });
  assert.equal(byLine.find((f) => f.id === cpfLog.id)!.suppressed, undefined);
  // the rest of the finding is unchanged
  const { suppressed: _s, ...rest } = email;
  assert.deepEqual(rest, base.find((f) => f.id === email.id));
});

test("[ENG-07] an expired until does not suppress", () => {
  const expired = run({ schemaVersion: 1, suppressions: [{ fingerprint: cpfLog.fingerprint, reason: "Temporary waiver for the demo", by: "flavio", until: "2026-10-07" }] });
  assert.equal(expired.find((f) => f.id === cpfLog.id)!.suppressed, undefined);
  const lastDay = run({ schemaVersion: 1, suppressions: [{ fingerprint: cpfLog.fingerprint, reason: "Temporary waiver for the demo", by: "flavio", until: "2026-10-08" }] });
  assert.ok(lastDay.find((f) => f.id === cpfLog.id)!.suppressed, "until is inclusive");
  assert.deepEqual(applySuppressions(base, { schemaVersion: 1 }, TODAY), base);
});

test("[ENG-07] a suppression without a reason of at least 10 characters is a config error", () => {
  assert.throws(
    () => loadProjectConfig(join(PROJECT_ROOT_FOR_TESTS, "tests", "fixtures", "config", "suppression-without-reason.json")),
    (e: unknown) => e instanceof PrivacyRadarError && e.code === "CONFIG_INVALID",
  );
});

test("isIgnored matches config ignore globs on POSIX relative paths", () => {
  assert.equal(isIgnored("src/generated/a.ts", ["**/generated/**"]), true);
  assert.equal(isIgnored("generated/a.ts", ["**/generated/**"]), true);
  assert.equal(isIgnored("src/a.ts", ["**/generated/**"]), false);
  assert.equal(isIgnored("src/a.test.ts", ["src/*.test.ts"]), true);
  assert.equal(isIgnored("src/deep/a.test.ts", ["src/*.test.ts"]), false);
  assert.equal(isIgnored("a.sql", ["?.sql"]), true);
  assert.equal(isIgnored("a+b.ts", ["a+b.ts"]), true);
  assert.equal(isIgnored("anything", []), false);
});

test("applySuppressions accepts hand-built findings and leaves non-matching ones untouched", () => {
  const f = finding({ fingerprint: "a".repeat(32) });
  const out = applySuppressions([f, finding()], { schemaVersion: 1, suppressions: [{ fingerprint: "a".repeat(32), reason: "Known test fixture value", by: "flavio" }] }, TODAY);
  assert.deepEqual(out.map((x) => x.suppressed?.by ?? null), ["flavio", null]);
});
