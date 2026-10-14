import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCatalog } from "../src/catalog/load.ts";
import { promptHash } from "../src/llm/trace.ts";
import { createPrompts } from "../src/prompts/index.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The fixture files whose `promptHashes` follow the prompts (spec 7.2). */
export function fixtureFiles(root: string): string[] {
  const inDir = (rel: string) => {
    const dir = join(root, rel);
    return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => join(dir, f)) : [];
  };
  const evalFixture = join(root, "evals", "ambiguous-fields.fake.json");
  return [...inDir("fixtures/llm"), ...inDir("tests/fixtures/llm"), ...(existsSync(evalFixture) ? [evalFixture] : [])];
}

/** Rewrites `promptHashes` of every fixture that has the key; returns the relative paths it changed. */
export function rehash(root: string): string[] {
  const prompts = createPrompts(loadCatalog().categories.map((c) => c.id));
  const hashes = Object.fromEntries(prompts.all.map((p) => [p.name, promptHash(p)]));
  const changed: string[] = [];
  for (const file of fixtureFiles(root)) {
    const text = readFileSync(file, "utf8");
    const json = JSON.parse(text) as Record<string, unknown>;
    if (!("promptHashes" in json)) continue;
    const next = `${JSON.stringify({ ...json, promptHashes: hashes }, null, 2)}\n`;
    if (next !== text) {
      writeFileSync(file, next);
      changed.push(relative(root, file));
    }
  }
  return changed;
}

if (import.meta.main) {
  const changed = rehash(ROOT);
  process.stdout.write(changed.length === 0 ? "fixtures: prompt hashes already current\n" : `fixtures: rehashed ${changed.join(", ")}\n`);
}
