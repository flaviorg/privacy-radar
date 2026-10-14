import { test } from "node:test";
import assert from "node:assert/strict";
import { createRedactor, redactSecrets } from "../../src/infra/redact.ts";
import { PrivacyRadarError, formatCliError } from "../../src/infra/errors.ts";

test("[LLM-08] redactSecrets masks every key shape and the configured key", () => {
  const keys = ["sk-or-v1-" + "a".repeat(40), "sk-ant-" + "b".repeat(30), "sk-" + "c".repeat(30), "AIza" + "d".repeat(35)];
  for (const k of keys) assert.equal(redactSecrets(`x ${k} y`), "x [REDACTED] y");
  assert.equal(redactSecrets("token=custom-key-value-123", ["custom-key-value-123"]), "token=[REDACTED]");
});

test("[LLM-08] redactSecrets does not touch words that merely end in sk- or AIza", () => {
  for (const text of ["disk-encryption-configuration-enabled", "risk-assessment-engine-configuration-v2", "task-runner-background-worker-queue", "xAIza" + "d".repeat(35)]) {
    assert.equal(redactSecrets(text), text);
  }
  assert.equal(redactSecrets(`Bearer sk-${"a".repeat(24)}.`), "Bearer [REDACTED].");
  assert.equal(redactSecrets(`key="AIza${"b".repeat(35)}"`), 'key="[REDACTED]"');
});

test("[LLM-08] redactSecrets ignores short or empty extra values and regex metacharacters", () => {
  assert.equal(redactSecrets("a b c", ["", "b"]), "a b c");
  assert.equal(redactSecrets("key=a.b*c+d?e(f)", ["a.b*c+d?e(f)"]), "key=[REDACTED]");
  assert.equal(redactSecrets("axb*c+d?e(f)", ["a.b*c+d?e(f)"]), "axb*c+d?e(f)");
});

test("[LLM-08] createRedactor masks the configured key and key shapes", () => {
  const redact = createRedactor("my-secret-api-key");
  assert.equal(redact("Authorization: my-secret-api-key"), "Authorization: [REDACTED]");
  assert.equal(redact("plain text"), "plain text");
  assert.equal(createRedactor(undefined)("sk-" + "z".repeat(25)), "[REDACTED]");
});

test("[OUT-08] formatCliError prints one line with the code and no stack", () => {
  const line = formatCliError(new PrivacyRadarError("CONFIG_INVALID", "suppressions.0.reason: too_small"), (s) => s);
  assert.equal(line, "error: CONFIG_INVALID: suppressions.0.reason: too_small");
});

test("[OUT-08] formatCliError labels unknown errors INTERNAL, keeps one line and redacts", () => {
  const key = "sk-" + "q".repeat(30);
  const line = formatCliError(new Error(`boom ${key}\n    at somewhere`), (s) => redactSecrets(s));
  assert.equal(line, "error: INTERNAL: boom [REDACTED]");
  assert.equal(formatCliError("just a string", (s) => s), "error: INTERNAL: just a string");
});
