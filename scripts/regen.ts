import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// `npm run regen` (Spec delta 8): reruns the golden-writing tests with UPDATE_GOLDEN=1 under the
// no-network guard, then prints which generated files changed. Goldens are never typed by hand.
// Changes are found by hashing the watched files before and after, so the report is right with or
// without Git (a ZIP download, or a repository whose files are all untracked).

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GUARD = pathToFileURL(join(ROOT, "tests", "setup", "no-network.ts")).href;
const TESTS = ["tests/e2e/demo.e2e.test.ts", "tests/unit/catalog.unit.test.ts", "tests/unit/eval-harness.unit.test.ts"];
const WATCHED = ["tests/golden", "DEMO.md", "README.md", "docs/legal-sources.md"];

/** sha256 of every file under the watched paths (files or folders), keyed by POSIX path relative to `root`. */
export function snapshotFiles(root: string, watched: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const visit = (rel: string) => {
    const abs = join(root, rel);
    if (!existsSync(abs)) return;
    if (statSync(abs).isDirectory()) {
      for (const name of readdirSync(abs).sort()) visit(`${rel}/${name}`);
      return;
    }
    out.set(rel, createHash("sha256").update(readFileSync(abs)).digest("hex"));
  };
  for (const w of watched) visit(w);
  return out;
}

/** `A path`, `M path` or `D path` for each added, modified or removed file, sorted by path. */
export function changedPaths(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const lines: string[] = [];
  for (const p of paths) {
    const b = before.get(p);
    const a = after.get(p);
    if (b === undefined) lines.push(`A ${p}`);
    else if (a === undefined) lines.push(`D ${p}`);
    else if (a !== b) lines.push(`M ${p}`);
  }
  return lines;
}

if (import.meta.main) {
  const env: NodeJS.ProcessEnv = { ...process.env, UPDATE_GOLDEN: "1" };
  delete env.PRIVACY_RADAR_CLOCK; // the demo and the test helpers default to the demo clock
  delete env.LLM_API_KEY;
  const before = snapshotFiles(ROOT, WATCHED);
  const run = spawnSync(process.execPath, ["--import", GUARD, "--test", ...TESTS], { cwd: ROOT, env, stdio: "inherit" });
  if (run.status !== 0) {
    process.stderr.write(`regen: the golden tests failed (exit ${run.status ?? "signal"})\n`);
    process.exitCode = 1;
  } else {
    const changed = changedPaths(before, snapshotFiles(ROOT, WATCHED));
    process.stdout.write(changed.length === 0 ? "regen: no generated file changed\n" : `regen: changed files\n${changed.join("\n")}\n`);
  }
}
