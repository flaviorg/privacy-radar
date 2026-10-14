import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { changedPaths, snapshotFiles } from "../../scripts/regen.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";

test("regen lists changed, added and removed generated files from content hashes, without Git", (t) => {
  const root = tmpDir(t);
  mkdirSync(join(root, "tests", "golden", "demo"), { recursive: true });
  writeFileSync(join(root, "tests", "golden", "demo", "a.txt"), "a\n");
  writeFileSync(join(root, "tests", "golden", "demo", "gone.txt"), "x\n");
  writeFileSync(join(root, "README.md"), "readme\n");
  const watched = ["tests/golden", "README.md", "DEMO.md"];
  const before = snapshotFiles(root, watched);
  assert.deepEqual(changedPaths(before, snapshotFiles(root, watched)), []);
  writeFileSync(join(root, "tests", "golden", "demo", "a.txt"), "a\ntampered\n");
  writeFileSync(join(root, "DEMO.md"), "new\n");
  rmSync(join(root, "tests", "golden", "demo", "gone.txt"));
  assert.deepEqual(changedPaths(before, snapshotFiles(root, watched)), ["A DEMO.md", "M tests/golden/demo/a.txt", "D tests/golden/demo/gone.txt"]);
});
