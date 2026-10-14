import type { TestContext } from "node:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { commitAll, initRepo } from "../../src/infra/git.ts";
import { DEMO_CLOCK_ISO } from "../../src/infra/clock.ts";
import { PROJECT_ROOT_FOR_TESTS } from "./child-node-args.ts";
import { tmpDir } from "./tmp-dir.ts";

export type TestRepo = { dir: string; commit(files: Record<string, string | null>, message: string): string; first: string };

/** Writes `files` under `dir` (`null` deletes a file). */
export function writeFiles(dir: string, files: Record<string, string | null>): void {
  for (const [rel, content] of Object.entries(files)) {
    const path = join(dir, rel);
    if (content === null) rmSync(path, { force: true });
    else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    }
  }
}

/**
 * A Git repository in a temporary folder (removed when the test ends) with one commit of `files`.
 * Commits use the hermetic identity and `PRIVACY_RADAR_CLOCK` (default the demo clock) as both dates.
 */
export function makeRepo(t: TestContext, files: Record<string, string>, opts: { dirName?: string } = {}): TestRepo {
  const root = tmpDir(t, "pr-repo-");
  const dir = opts.dirName ? join(root, opts.dirName) : root;
  mkdirSync(dir, { recursive: true });
  const date = process.env.PRIVACY_RADAR_CLOCK || DEMO_CLOCK_ISO;
  initRepo(dir);
  writeFiles(dir, files);
  const first = commitAll(dir, "initial", date);
  return {
    dir,
    first,
    commit(next, message) {
      writeFiles(dir, next);
      return commitAll(dir, message, date);
    },
  };
}

/** Every file under `dir`, keyed by its POSIX path relative to `dir`. */
export function readTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const abs = join(d, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else out[relative(dir, abs).split("\\").join("/")] = readFileSync(abs, "utf8");
    }
  };
  walk(dir);
  return out;
}

/** The demo pull request of spec 5.10: base = the fixture with the base overlay, head = the fixture. */
export function makeDemoRepo(t: TestContext): { repo: TestRepo; shaBase: string; shaHead: string; head: Record<string, string> } {
  const head = readTree(join(PROJECT_ROOT_FOR_TESTS, "fixtures", "telehealth-clinic"));
  const base = { ...head, ...readTree(join(PROJECT_ROOT_FOR_TESTS, "fixtures", "telehealth-clinic-base")) };
  const repo = makeRepo(t, base);
  const shaHead = repo.commit(head, "head: the demo pull request");
  return { repo, shaBase: repo.first, shaHead, head };
}
