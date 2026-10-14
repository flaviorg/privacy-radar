import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXIT_CODE,
  FixturePromptDriftError,
  PrivacyRadarError,
  UnscriptedLlmCallError,
  exitCodeOf,
} from "../../src/infra/errors.ts";

test("[OUT-08] exit codes follow the error contract of spec 5.13", () => {
  for (const code of ["USAGE", "CONFIG_INVALID", "CATALOG_INVALID", "SARIF_INVALID", "PR_TOO_LARGE", "UNSCRIPTED_LLM_CALL", "FIXTURE_PROMPT_DRIFT"] as const) {
    assert.equal(EXIT_CODE[code], 2, code);
  }
  for (const code of ["TARGET_NOT_FOUND", "NO_SUPPORTED_FILES", "GIT_ERROR", "OUT_NOT_WRITABLE"] as const) {
    assert.equal(EXIT_CODE[code], 3, code);
  }
});

test("PrivacyRadarError carries code and exitCode; subclasses keep their own codes", () => {
  const e = new PrivacyRadarError("GIT_ERROR", "bad ref");
  assert.equal(e.code, "GIT_ERROR");
  assert.equal(e.exitCode, 3);
  assert.equal(e.name, "PrivacyRadarError");
  const u = new UnscriptedLlmCallError("turn missing");
  assert.equal(u.code, "UNSCRIPTED_LLM_CALL");
  assert.equal(u.exitCode, 2);
  assert.ok(u instanceof PrivacyRadarError);
  const d = new FixturePromptDriftError("hash differs");
  assert.equal(d.code, "FIXTURE_PROMPT_DRIFT");
  assert.equal(d.exitCode, 2);
});

test("exitCodeOf maps unknown errors to 3", () => {
  assert.equal(exitCodeOf(new PrivacyRadarError("USAGE", "x")), 2);
  assert.equal(exitCodeOf(new Error("x")), 3);
  assert.equal(exitCodeOf("x"), 3);
});
