import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join, sep } from "node:path";
import { PrivacyRadarError } from "./errors.ts";

/**
 * The environment of every Git child: only `PATH` and `HOME` from this process, no global or system
 * configuration, plus `extra`. Git never sees the caller's identity, hooks path or credentials.
 */
export function hermeticGitEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const path = process.env.PATH;
  const home = process.env.HOME;
  if (path !== undefined) env.PATH = path;
  if (home !== undefined) env.HOME = home;
  return { ...env, ...extra };
}

/** Absolute top-level of the work tree that holds `dir`, or `null` outside a work tree or without Git. */
export function toplevel(dir: string): string | null {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir, env: hermeticGitEnv(), encoding: "utf8" });
  if (r.error || r.status !== 0) return null;
  const out = r.stdout.trim();
  return out === "" ? null : out;
}

/** The identity of every commit the tool makes (demo and test repositories); never the user's. */
export const HERMETIC_IDENTITY: readonly string[] = ["-c", "user.name=privacy-radar", "-c", "user.email=demo@example.invalid", "-c", "commit.gpgsign=false"];

/**
 * Runs one Git command in `repo` without a shell, with the hermetic environment plus `extra`.
 * A spawn failure or a non-zero exit is `GIT_ERROR` naming the subcommand only: Git's stderr can
 * echo paths of other repositories, so it never reaches the message.
 */
function git(repo: string, args: readonly string[], extra: Record<string, string> = {}): Buffer {
  const r = spawnSync("git", [...args], { cwd: repo, env: hermeticGitEnv(extra), encoding: "buffer" });
  const sub = args.find((a, i) => !a.startsWith("-") && args[i - 1] !== "-c") ?? "git";
  if (r.error || r.status !== 0) throw new PrivacyRadarError("GIT_ERROR", `git ${sub} failed`);
  return r.stdout;
}

/**
 * The commit SHA of `ref` (PR-06). A ref that is empty or starts with `-` is rejected before any Git
 * call, so it can never be parsed as an option; otherwise `rev-parse --verify --end-of-options <ref>^{commit}`.
 */
export function validateRef(repo: string, ref: string): string {
  if (ref === "" || ref.startsWith("-")) throw new PrivacyRadarError("GIT_ERROR", 'invalid ref: a ref must not start with "-" or be empty');
  let out: Buffer;
  try {
    out = git(repo, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]);
  } catch {
    throw new PrivacyRadarError("GIT_ERROR", "git rev-parse failed: the ref does not resolve to a commit");
  }
  const sha = out.toString("utf8").trim();
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(sha)) throw new PrivacyRadarError("GIT_ERROR", "git rev-parse failed: the ref does not resolve to a commit");
  return sha;
}

/** Files added, copied, modified or renamed between `base` and `head` (spec 4.4, PR-01); paths POSIX, unquoted. */
export function changedFiles(repo: string, base: string, head: string): string[] {
  const b = validateRef(repo, base);
  const h = validateRef(repo, head);
  const out = git(repo, ["-c", "core.quotePath=false", "diff", "-z", "--name-only", "--diff-filter=ACMR", `${b}...${h}`]);
  return out.toString("utf8").split("\0").filter((p) => p !== "");
}

/** Writes the full tree of `rev` into `dir/tree/` through a private index (`dir/index`); the work tree and `git status` stay untouched. */
export function exportTree(repo: string, rev: string, dir: string): void {
  const sha = validateRef(repo, rev);
  const tree = join(dir, "tree");
  mkdirSync(tree, { recursive: true });
  const env = { GIT_INDEX_FILE: join(dir, "index") };
  git(repo, ["read-tree", sha], env);
  git(repo, ["checkout-index", "-a", `--prefix=${tree}${sep}`], env);
  rmSync(join(dir, "index"), { force: true });
}

/** `git init -b main` in `dir` (scripts and test repositories). */
export function initRepo(dir: string): void {
  git(dir, ["init", "-q", "-b", "main"]);
}

/** Stages everything and commits with the hermetic identity and `isoDate` as both dates; returns the commit SHA. */
export function commitAll(dir: string, message: string, isoDate: string): string {
  git(dir, ["add", "-A"]);
  git(dir, [...HERMETIC_IDENTITY, "commit", "-q", "--no-verify", "--allow-empty", "-m", message], { GIT_AUTHOR_DATE: isoDate, GIT_COMMITTER_DATE: isoDate });
  return git(dir, ["rev-parse", "HEAD"]).toString("utf8").trim();
}
