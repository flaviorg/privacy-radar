import { before, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PrivacyRadarError } from "../../src/infra/errors.ts";
import { changedFiles, commitAll, exportTree, hermeticGitEnv, initRepo, validateRef } from "../../src/infra/git.ts";
import { DEMO_CLOCK_ISO } from "../../src/infra/clock.ts";
import { makeRepo, writeFiles, type TestRepo } from "../helpers/git-repo.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";

const git = (dir: string, args: string[]) => {
  const r = spawnSync("git", args, { cwd: dir, env: hermeticGitEnv(), encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const isGitError = (e: unknown) => e instanceof PrivacyRadarError && e.code === "GIT_ERROR" && e.exitCode === 3;

let repo: TestRepo;

before((hook) => {
  const t = hook as TestContext; // a hook receives a TestContext at run time
  repo = makeRepo(t, { "src/a.ts": "export const a = 1;\n", "README.md": "# demo\n" });
  repo.commit({ "src/relatório.ts": "export const r = 2;\n" }, "add a non-ASCII path");
});

test("[PR-06] refs starting with - are rejected with GIT_ERROR before any Git call", () => {
  for (const r of ["-x", "--output=/tmp/x", "-"]) {
    assert.throws(() => validateRef(repo.dir, r), (e: unknown) => isGitError(e) && /must not start with "-"/.test((e as Error).message));
    // a folder that is not a repository proves Git is never reached: the message is still the ref check
    assert.throws(() => validateRef("/nonexistent-privacy-radar", r), (e: unknown) => isGitError(e) && /must not start with "-"/.test((e as Error).message));
  }
  assert.throws(() => validateRef(repo.dir, ""), isGitError);
  assert.ok(!existsSync("/tmp/x^{commit}"));
});

test("[PR-06] a ref that is not a commit is GIT_ERROR; HEAD~1 resolves", () => {
  assert.throws(() => validateRef(repo.dir, "nope"), isGitError);
  const blob = git(repo.dir, ["rev-parse", "HEAD:README.md"]);
  assert.match(blob, /^[0-9a-f]{40}$/);
  assert.throws(() => validateRef(repo.dir, blob), isGitError);
  assert.match(validateRef(repo.dir, "HEAD~1"), /^[0-9a-f]{40}$/);
  assert.equal(validateRef(repo.dir, "HEAD~1"), repo.first);
});

test("[PR-06] the error message never carries Git's stderr", () => {
  try {
    validateRef(repo.dir, "nope");
    assert.fail("expected a throw");
  } catch (e) {
    assert.ok(isGitError(e));
    assert.doesNotMatch((e as Error).message, /fatal|Needed a single revision/);
  }
});

test("changedFiles returns a non-ASCII path unquoted", () => {
  assert.deepEqual(changedFiles(repo.dir, "HEAD~1", "HEAD"), ["src/relatório.ts"]);
  assert.deepEqual(changedFiles(repo.dir, "HEAD", "HEAD"), []);
  assert.throws(() => changedFiles(repo.dir, "-x", "HEAD"), isGitError);
});

test("exportTree writes the full tree and leaves git status clean", (t) => {
  const out = tmpDir(t);
  exportTree(repo.dir, "HEAD~1", out);
  assert.deepEqual(readdirSync(join(out, "tree")).sort(), ["README.md", "src"]);
  assert.deepEqual(readdirSync(join(out, "tree", "src")), ["a.ts"]);
  const head = tmpDir(t);
  exportTree(repo.dir, "HEAD", head);
  assert.deepEqual(readdirSync(join(head, "tree", "src")).sort(), ["a.ts", "relatório.ts"]);
  assert.equal(readFileSync(join(head, "tree", "src", "relatório.ts"), "utf8"), "export const r = 2;\n");
  assert.equal(git(repo.dir, ["status", "--porcelain"]), "");
});

test("commitAll with the same date and content gives the same SHA in two fresh repositories", (t) => {
  const shas = [tmpDir(t), tmpDir(t)].map((dir) => {
    initRepo(dir);
    writeFiles(dir, { "x.ts": "export const x = 1;\n" });
    return commitAll(dir, "same", DEMO_CLOCK_ISO);
  });
  assert.equal(shas[0], shas[1]);
  assert.match(shas[0]!, /^[0-9a-f]{40}$/);
  assert.match(git(tmpDir(t), ["--version"]), /^git version/);
});

test("[RF-1] git helpers work in a repository whose path contains a space", (t) => {
  const spaced = makeRepo(t, { "src/a.ts": "export const a = 1;\n" }, { dirName: "with space" });
  spaced.commit({ "src/b.ts": "export const b = 2;\n" }, "second");
  assert.ok(spaced.dir.includes("with space"));
  assert.deepEqual(changedFiles(spaced.dir, "HEAD~1", "HEAD"), ["src/b.ts"]);
  const out = join(tmpDir(t), "out with space");
  exportTree(spaced.dir, "HEAD", out);
  assert.deepEqual(readdirSync(join(out, "tree", "src")).sort(), ["a.ts", "b.ts"]);
});

test("[RF-4] refs origin/main, feature/x and a 40-char SHA are accepted", () => {
  git(repo.dir, ["branch", "feature/x"]);
  git(repo.dir, ["update-ref", "refs/remotes/origin/main", "HEAD~1"]);
  const head = git(repo.dir, ["rev-parse", "HEAD"]);
  assert.equal(validateRef(repo.dir, "feature/x"), head);
  assert.equal(validateRef(repo.dir, "origin/main"), repo.first);
  assert.equal(validateRef(repo.dir, head), head);
  assert.deepEqual(changedFiles(repo.dir, "origin/main", "feature/x"), ["src/relatório.ts"]);
});

test("[PR-05] Git helpers on a folder that is not a repository throw GIT_ERROR", (t) => {
  const plain = tmpDir(t);
  assert.throws(() => validateRef(plain, "HEAD"), isGitError);
  assert.throws(() => changedFiles(plain, "HEAD~1", "HEAD"), isGitError);
});
