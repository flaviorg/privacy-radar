import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listProjectFiles, scanProject, scanText } from "../../scripts/check-secrets.ts";

// Key-shaped values are built at run time so that no test file carries one.
const openRouterKey = () => "sk-or-v1-" + "a".repeat(40);
const googleKey = () => "AIza" + "B".repeat(35);

test("check-secrets finds a key-shaped string and never prints the value", () => {
  const found = scanText("const a = 1;\nx " + openRouterKey() + "\n", "src/f.ts");
  assert.equal(found.length, 1);
  assert.deepEqual(Object.keys(found[0]!).sort(), ["line", "path", "pattern"]);
  assert.equal(found[0]!.line, 2);
  assert.equal(found[0]!.path, "src/f.ts");
  assert.ok(!JSON.stringify(found).includes("aaaa"), "the value is not part of the finding");
});

test("check-secrets recognizes the Google-shaped key and an LLM_API_KEY assignment with a value, but not an empty one", () => {
  assert.equal(scanText(googleKey(), "f").length, 1);
  assert.equal(scanText("LLM_API_KEY" + "=" + "z".repeat(12), ".env.example").length, 1);
  assert.equal(scanText("LLM_API_KEY" + "=", ".env.example").length, 0);
  assert.equal(scanText("LLM_API_KEY" + "=short", ".env.example").length, 0);
  assert.equal(scanText("nothing to see here", "f").length, 0);
});

test("check-secrets walks a tree, skips node_modules and an untracked .env, and scans a tracked .env", () => {
  const root = mkdtempSync(join(tmpdir(), "privacy-radar-secrets-"));
  try {
    mkdirSync(join(root, "node_modules", "x"), { recursive: true });
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, "node_modules", "x", "k.txt"), openRouterKey());
    writeFileSync(join(root, "src", "ok.ts"), "export {};\n");
    writeFileSync(join(root, ".env"), "LLM_API_KEY" + "=" + "q".repeat(20) + "\n");
    const untracked = scanProject(root, { isTracked: () => false });
    assert.equal(untracked.findings.length, 0);
    assert.equal(listProjectFiles(root, { isTracked: () => false }).some((f) => f.endsWith(".env")), false);
    const tracked = scanProject(root, { isTracked: () => true });
    assert.deepEqual(tracked.findings.map((f) => [f.path, f.line]), [[".env", 1]]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("check-secrets skips binary files", () => {
  const root = mkdtempSync(join(tmpdir(), "privacy-radar-secrets-"));
  try {
    writeFileSync(join(root, "blob.bin"), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(openRouterKey())]));
    const r = scanProject(root, { isTracked: () => false });
    assert.equal(r.files, 0);
    assert.equal(r.findings.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
