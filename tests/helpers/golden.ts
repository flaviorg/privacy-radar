import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PROJECT_ROOT_FOR_TESTS } from "./child-node-args.ts";

export const GOLDEN_DIR: string = join(PROJECT_ROOT_FOR_TESTS, "tests", "golden");

/** Compares `actual` with `tests/golden/<rel>` byte for byte; with `UPDATE_GOLDEN=1` writes it and passes. */
export function assertGolden(rel: string, actual: string): void {
  const path = join(GOLDEN_DIR, rel);
  if (process.env.UPDATE_GOLDEN === "1") {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, actual);
    return;
  }
  assert.ok(existsSync(path), `golden ${rel} is missing: run npm run regen`);
  assert.equal(actual, readFileSync(path, "utf8"), `golden ${rel} differs: review the change, then run npm run regen`);
}

/**
 * Replaces the text between `<!-- name:start -->` and `<!-- name:end -->` in `file`.
 * Returns false when the file does not exist; throws when the markers are missing.
 */
export function replaceMarkedBlock(file: string, name: string, content: string): boolean {
  if (!existsSync(file)) return false;
  const text = readFileSync(file, "utf8");
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const a = text.indexOf(start);
  const b = text.indexOf(end);
  if (a < 0 || b < a) throw new Error(`markers ${name} not found in ${file}`);
  const next = `${text.slice(0, a + start.length)}\n${content.trimEnd()}\n${text.slice(b)}`;
  if (next !== text) writeFileSync(file, next);
  return true;
}
