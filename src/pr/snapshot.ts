import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportTree } from "../infra/git.ts";

/**
 * Exports the full trees of `baseSha` and `headSha` into `os.tmpdir()/privacy-radar-pr-<random>/{base,head}`
 * (each with its files under `tree/`), runs `fn`, and always removes the folder afterwards (PR-01).
 */
export async function withSnapshots<T>(repo: string, baseSha: string, headSha: string, fn: (dirs: { base: string; head: string }) => Promise<T>): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "privacy-radar-pr-"));
  try {
    const base = join(root, "base");
    const head = join(root, "head");
    exportTree(repo, baseSha, base);
    exportTree(repo, headSha, head);
    return await fn({ base, head });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
