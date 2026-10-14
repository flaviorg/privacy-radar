import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { CHILD_NODE_ARGS, PROJECT_ROOT_FOR_TESTS } from "../helpers/child-node-args.ts";
import { GOLDEN_DIR } from "../helpers/golden.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";

function runEval(args: string[], env: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...CHILD_NODE_ARGS, join(PROJECT_ROOT_FOR_TESTS, "scripts", "eval.ts"), ...args], {
      cwd: PROJECT_ROOT_FOR_TESTS,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

test("[EVAL-03] eval:classifier prints the table of tests/golden/evals/classifier.md", async () => {
  const r = await runEval(["--target", "classifier"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, readFileSync(join(GOLDEN_DIR, "evals", "classifier.md"), "utf8"));
});

test("eval --write puts the table in a file, and a bad --target or --min-confidence is a usage error", async (t) => {
  const file = join(tmpDir(t), "table.md");
  const ok = await runEval(["--target", "classifier", "--write", file]);
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(readFileSync(file, "utf8"), readFileSync(join(GOLDEN_DIR, "evals", "classifier.md"), "utf8"));
  for (const args of [["--target", "nothing"], ["--target", "labeler", "--provider", "nope"], ["--target", "classifier", "--min-confidence", "2"], ["--bogus"]]) {
    const r = await runEval(args);
    assert.equal(r.code, 2, args.join(" "));
    assert.match(r.stderr.trim(), /^error: USAGE: /);
  }
});

test("[EVAL-01] eval --target labeler --provider fake prints the planted rates under the guard, with no network", async () => {
  const r = await runEval(["--target", "labeler", "--provider", "fake"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^\| Accuracy \| 0\.85 \|$/m);
  assert.match(r.stdout, /^\| Evidence mismatch \| 0\.04 \|$/m);
  assert.match(r.stdout, /^\| Rows \| 26 \|$/m);
  assert.match(r.stdout, /Model: fake-scripted; base URL host: none \(scripted fake\); date: 2026-10-08; temperature: 0\./);
});
