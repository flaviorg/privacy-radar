import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readText, walkTarget } from "../../src/infra/files.ts";
import { LIMITS } from "../../src/contracts/limits.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";

function put(root: string, rel: string, content = "export {};\n"): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content);
}

test("[SRC-07] a symlink to a file outside the target is neither read nor named", (t) => {
  const outside = tmpDir(t);
  const target = tmpDir(t);
  writeFileSync(join(outside, "secret.ts"), "export const k = 'outside-value';");
  writeFileSync(join(target, "a.ts"), "export {};");
  symlinkSync(join(outside, "secret.ts"), join(target, "link.ts"));
  const r = walkTarget(target, { ignore: [], maxFiles: 5000 });
  assert.deepEqual(r.files.map((f) => f.rel), ["a.ts"]);
  assert.deepEqual(r.warnings.map((w) => w.code), ["SYMLINK_SKIPPED"]);
  assert.equal(r.warnings[0]!.file, "link.ts");
  assert.doesNotMatch(JSON.stringify(r), /secret|outside/);
});

test("[SRC-07] a symlinked directory is skipped", (t) => {
  const outside = tmpDir(t);
  const target = tmpDir(t);
  put(outside, "inner/x.ts");
  put(target, "src/a.ts");
  symlinkSync(join(outside, "inner"), join(target, "src", "linked"));
  const r = walkTarget(target, { ignore: [], maxFiles: 5000 });
  assert.deepEqual(r.files.map((f) => f.rel), ["src/a.ts"]);
  assert.deepEqual(r.warnings.map((w) => [w.code, w.file]), [["SYMLINK_SKIPPED", "src/linked"]]);
});

test("[SRC-02] a file over 1 MiB yields FILE_TOO_LARGE and is skipped", (t) => {
  const target = tmpDir(t);
  put(target, "big.ts", "x".repeat(LIMITS.maxFileBytes + 1));
  put(target, "ok.ts");
  const r = walkTarget(target, { ignore: [], maxFiles: 5000 });
  assert.deepEqual(r.files.map((f) => f.rel), ["ok.ts"]);
  assert.deepEqual(r.warnings.map((w) => [w.code, w.file]), [["FILE_TOO_LARGE", "big.ts"]]);
  assert.equal(r.truncated, false);
});

test("ignore list and config globs drop node_modules, .git, dist, build, coverage, artifacts and **/generated/**", (t) => {
  const target = tmpDir(t);
  for (const rel of ["node_modules/p/i.ts", ".git/hooks/h.ts", "dist/a.js", "build/b.js", "coverage/c.js", "artifacts/d.ts", "src/generated/client.ts", "packages/x/node_modules/y.ts", "src/a.ts", "src/b.sql"]) put(target, rel);
  const r = walkTarget(target, { ignore: ["**/generated/**"], maxFiles: 5000 });
  assert.deepEqual(r.files.map((f) => f.rel), ["src/a.ts", "src/b.sql"]);
  assert.deepEqual(r.warnings, []);
});

test("FILE_LIMIT stops the walk and marks truncated", (t) => {
  const target = tmpDir(t);
  for (const rel of ["a.ts", "b.ts", "c.ts"]) put(target, rel);
  const r = walkTarget(target, { ignore: [], maxFiles: 2 });
  assert.deepEqual(r.files.map((f) => f.rel), ["a.ts", "b.ts"]);
  assert.equal(r.truncated, true);
  assert.deepEqual(r.warnings.map((w) => w.code), ["FILE_LIMIT"]);
});

test("accept filters files before limits apply; results are sorted with POSIX paths and sizes", (t) => {
  const target = tmpDir(t, "pr test with space-");
  for (const rel of ["z.ts", "README.md", "a/b.prisma", "a-b/c.ts"]) put(target, rel, "x");
  const r = walkTarget(target, { ignore: [], maxFiles: 3, accept: (rel) => !rel.endsWith(".md") });
  assert.deepEqual(r.files.map((f) => [f.rel, f.size]), [["a-b/c.ts", 1], ["a/b.prisma", 1], ["z.ts", 1]]);
  assert.equal(r.truncated, false);
  assert.ok(r.files[0]!.abs.startsWith(target));
});

test("readText strips a leading BOM only", (t) => {
  const target = tmpDir(t);
  writeFileSync(join(target, "a.ts"), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("x﻿y")]));
  assert.equal(readText(join(target, "a.ts")), "x﻿y");
});

test("an unreadable folder inside the target is a PARSE_ERROR warning with its relative path, not a crash", (t) => {
  if (process.getuid?.() === 0) return t.skip("root can read a chmod 000 folder");
  const target = tmpDir(t);
  put(target, "a.ts");
  put(target, "src/locked/b.ts");
  chmodSync(join(target, "src", "locked"), 0o000);
  let r: ReturnType<typeof walkTarget>;
  try {
    r = walkTarget(target, { ignore: [], maxFiles: 5000 });
  } finally {
    chmodSync(join(target, "src", "locked"), 0o755); // so the temporary folder can be removed
  }
  assert.deepEqual(r.files.map((f) => f.rel), ["a.ts"]);
  assert.deepEqual(r.warnings, [{ file: "src/locked", code: "PARSE_ERROR", message: "folder could not be read; skipped" }]);
  assert.ok(!JSON.stringify(r.warnings).includes(target), "no absolute path");
});
