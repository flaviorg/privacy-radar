import { before, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Finding } from "../../src/contracts/findings.ts";
import { hermeticGitEnv } from "../../src/infra/git.ts";
import { DISCLAIMER_EN } from "../../src/output/disclaimer.ts";
import { makeDemoRepo, writeFiles, type TestRepo } from "../helpers/git-repo.ts";
import { runCli } from "../helpers/run-cli.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";

const git = (dir: string, args: string[]) => {
  const r = spawnSync("git", args, { cwd: dir, env: hermeticGitEnv({ GIT_AUTHOR_DATE: "2026-10-08T12:00:00.000Z", GIT_COMMITTER_DATE: "2026-10-08T12:00:00.000Z" }), encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};

let repo: TestRepo;
let shaBase: string;
let shaHead: string;
let shaNoGender: string;
let shaGender: string;
let shaReadme: string;
let shaSelfSuppress: string;
let startedAt: number;

before((hook) => {
  const t = hook as TestContext; // a hook receives a TestContext at run time
  startedAt = Date.now();
  const demo = makeDemoRepo(t);
  const head = demo.head;
  repo = demo.repo;
  shaBase = demo.shaBase;
  shaHead = demo.shaHead;
  // The SQL migration already holds diagnosis, so the schema-only commit adds a new Prisma field
  // (gender) instead: it changes the categories the type-hinted PR-LOG at patients.ts:14 carries.
  shaNoGender = shaHead;
  const schema = head["prisma/schema.prisma"]!;
  shaGender = repo.commit({ "prisma/schema.prisma": schema.replace("  guardianName ", "  gender       String?\n  guardianName ") }, "schema only: add gender");
  shaReadme = repo.commit({ "README.md": `${head["README.md"]}\nOne more line.\n` }, "README only");
  git(repo.dir, ["checkout", "-q", "-b", "big", shaReadme]);
  const many: Record<string, string> = {};
  for (let i = 0; i < 501; i++) many[`notes/n${String(i).padStart(3, "0")}.md`] = `note ${i}\n`;
  writeFiles(repo.dir, many);
  git(repo.dir, ["add", "-A"]);
  git(repo.dir, ["-c", "user.name=privacy-radar", "-c", "user.email=demo@example.invalid", "commit", "-q", "-m", "501 files"]);
  git(repo.dir, ["checkout", "-q", "main"]);
  // A pull request that also adds a config ignoring the file it changes and suppressing its own findings.
  git(repo.dir, ["checkout", "-q", "-b", "self-suppress", shaHead]);
  const selfConfig = {
    schemaVersion: 1,
    ignore: ["src/analytics.ts"],
    suppressions: [{ rule: "PR-ANALYTICS", file: "src/analytics.ts", line: 9, reason: "added by the same pull request", by: "pr-author" }],
  };
  shaSelfSuppress = repo.commit({ "privacy-radar.config.json": `${JSON.stringify(selfConfig, null, 2)}\n` }, "head: suppress its own findings");
  git(repo.dir, ["checkout", "-q", "main"]);
});

const rows = (fs: Finding[]) => fs.map((f) => [f.ruleId, f.location.file, f.location.line]);

test("[PR-04] the demo pair reports two added at analytics.ts:9, one resolved at patients.ts:24, 15 unchanged, exit 1", async () => {
  const r = await runCli(["pr", "--base", shaBase, "--head", shaHead, "--repo", repo.dir, "--json"]);
  assert.equal(r.code, 1, r.stderr);
  const j = JSON.parse(r.stdout) as { added: Finding[]; resolved: Finding[]; unchanged: number; changed: string[]; skipped: boolean; baseSha: string; headSha: string };
  assert.deepEqual(rows(j.added).sort(), [["PR-ANALYTICS", "src/analytics.ts", 9], ["PR-TRANSFER", "src/analytics.ts", 9]]);
  assert.deepEqual(rows(j.resolved), [["PR-FILE", "src/patients.ts", 24]]);
  assert.equal(j.unchanged, 15);
  assert.deepEqual(j.changed.sort(), ["src/analytics.ts", "src/patients.ts"]);
  assert.equal(j.skipped, false);
  assert.deepEqual([j.baseSha, j.headSha], [shaBase, shaHead]);
  for (const f of j.added) assert.deepEqual(f.categories, ["identifier.cpf", "special.health"]);
  assert.equal(j.added.find((f) => f.ruleId === "PR-ANALYTICS")!.sink?.vendor, "Mixpanel");
});

test("[PR-04] the comment carries two introduces sentences and one removes sentence", async (t) => {
  const out = tmpDir(t);
  const r = await runCli(["pr", "--base", shaBase, "--head", shaHead, "--repo", repo.dir, "--format", "md,json,sarif", "--out", out]);
  assert.equal(r.code, 1, r.stderr);
  const comment = readFileSync(join(out, "pr-comment.md"), "utf8");
  assert.equal(r.stdout, comment);
  const lines = comment.split("\n");
  assert.equal(lines.filter((l) => l.startsWith("- This PR introduces")).length, 2);
  assert.equal(lines.filter((l) => l.startsWith("- This PR removes")).length, 1);
  assert.ok(comment.includes("This PR introduces a new flow of identifier.cpf and special.health to analytics vendor Mixpanel \\(US\\) at src/analytics.ts:9"), comment);
  assert.ok(comment.includes("This PR removes the flow of identifier.cpf to a file \\(fs.appendFileSync\\) at src/patients.ts:24"), comment);
  assert.match(comment, /2 added · 1 resolved · 15 unchanged/);
  assert.ok(comment.trimEnd().endsWith(DISCLAIMER_EN));
  assert.ok(!comment.includes(tmpdir()) && !comment.includes("privacy-radar-pr-"));
  assert.deepEqual(readdirSync(out).sort(), ["findings.json", "findings.sarif", "pr-comment.md"]);
  const json = JSON.parse(readFileSync(join(out, "findings.json"), "utf8")) as { target: { path: string }; findings: Finding[]; provider: string };
  assert.equal(json.findings.filter((f) => !f.belowThreshold).length, 17, "the head scan");
  assert.equal(json.provider, "none");
  assert.ok(!json.target.path.includes("privacy-radar-pr-"), json.target.path);
  const sarif = readFileSync(join(out, "findings.sarif"), "utf8");
  assert.ok(!sarif.includes("privacy-radar-pr-") && !sarif.includes(tmpdir()));
  assert.match(sarif, /"uri": "src\/analytics\.ts"/);
});

test("[PR-01] no LLM call: no fixture present and no LLM warning", async (t) => {
  const out = tmpDir(t);
  const r = await runCli(["pr", "--base", shaBase, "--head", shaHead, "--repo", repo.dir, "--format", "json", "--out", out], { env: { LLM_PROVIDER: "fake", LLM_FIXTURE: "fixtures/llm/telehealth-clinic.json" } });
  assert.equal(r.code, 1, r.stderr);
  const json = JSON.parse(readFileSync(join(out, "findings.json"), "utf8")) as { warnings: { code: string }[]; llm: { calls: number }; findings: Finding[] };
  assert.equal(json.llm.calls, 0);
  assert.ok(!json.warnings.some((w) => w.code.startsWith("LLM_")));
  assert.ok(!json.findings.some((f) => f.origin === "llm"));
  assert.ok(!readdirSync(out).includes("llm-trace.jsonl"));
  const help = await runCli(["pr", "--base", shaBase, "--llm", "fake", "--repo", repo.dir]);
  assert.equal(help.code, 2, "pr takes no --llm option");
  assert.match(help.stderr, /^error: USAGE: /);
});

test("[PR-01] --base equal to --head exits 0 with nothing added", async () => {
  const r = await runCli(["pr", "--base", shaHead, "--head", shaHead, "--repo", repo.dir, "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const j = JSON.parse(r.stdout) as { added: Finding[]; resolved: Finding[]; skipped: boolean; changed: string[] };
  assert.deepEqual([j.added.length, j.resolved.length, j.changed.length, j.skipped], [0, 0, 0, true]);
});

test("[PR-01] adding gender to the Prisma model alone changes the PR-LOG at patients.ts:14 (one added, one resolved)", async () => {
  const r = await runCli(["pr", "--base", shaNoGender, "--head", shaGender, "--repo", repo.dir, "--json"]);
  const j = JSON.parse(r.stdout) as { added: Finding[]; resolved: Finding[]; changed: string[] };
  assert.deepEqual(j.changed, ["prisma/schema.prisma"]);
  const log = (fs: Finding[]) => fs.filter((f) => f.ruleId === "PR-LOG" && f.location.file === "src/patients.ts" && f.location.line === 14);
  assert.equal(log(j.added).length, 1, JSON.stringify(rows(j.added)));
  assert.equal(log(j.resolved).length, 1, JSON.stringify(rows(j.resolved)));
  assert.ok(log(j.added)[0]!.categories.includes("demographic.gender"));
  assert.ok(!log(j.resolved)[0]!.categories.includes("demographic.gender"));
  assert.equal(r.code, 1, "the added PR-LOG is an error");
});

test("[PR-01] a PR touching only README.md skips both scans and says so", async (t) => {
  const out = tmpDir(t);
  const r = await runCli(["pr", "--base", shaGender, "--head", shaReadme, "--repo", repo.dir, "--format", "md,json", "--out", out]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /No supported file changed: both scans were skipped\./);
  assert.deepEqual(readdirSync(out), ["pr-comment.md"], "no head scan, so no findings.json");
});

test("[PR-01] pr reusing a scan's --out removes the owned artifacts it does not write and keeps other files", async (t) => {
  const out = tmpDir(t);
  const scanned = await runCli(["scan", repo.dir, "--llm", "none", "--fail-on", "none", "--format", "json,sarif,md", "--docs", "all", "--out", out]);
  assert.equal(scanned.code, 0, scanned.stderr);
  assert.ok(readdirSync(out).includes("findings.sarif"), "the scan wrote findings.sarif");
  writeFileSync(join(out, "notes.txt"), "mine");
  // a README-only PR skips both scans, so only the comment is written
  const r = await runCli(["pr", "--base", shaGender, "--head", shaReadme, "--repo", repo.dir, "--format", "md,json,sarif", "--out", out]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(readdirSync(out).sort(), ["notes.txt", "pr-comment.md"]);
});

test("[PR-01] a narrower --format into the same --out removes the previous run's findings.json and findings.sarif", async (t) => {
  const out = tmpDir(t);
  const wide = await runCli(["pr", "--base", shaBase, "--head", shaHead, "--repo", repo.dir, "--format", "md,json,sarif", "--out", out]);
  assert.equal(wide.code, 1, wide.stderr);
  assert.deepEqual(readdirSync(out).sort(), ["findings.json", "findings.sarif", "pr-comment.md"]);
  const narrow = await runCli(["pr", "--base", shaBase, "--head", shaHead, "--repo", repo.dir, "--format", "md", "--out", out]);
  assert.equal(narrow.code, 1, narrow.stderr);
  assert.deepEqual(readdirSync(out), ["pr-comment.md"]);
  // a skipped run with --format json writes nothing, and still leaves no stale artifact behind
  const skipped = await runCli(["pr", "--base", shaGender, "--head", shaReadme, "--repo", repo.dir, "--format", "json", "--out", out]);
  assert.equal(skipped.code, 0, skipped.stderr);
  assert.deepEqual(readdirSync(out), []);
});

test("[PR-01] the snapshot folder is removed afterwards", () => {
  const left = readdirSync(tmpdir()).filter((n) => n.startsWith("privacy-radar-pr-")).filter((n) => statSync(join(tmpdir(), n)).mtimeMs >= startedAt);
  assert.deepEqual(left, []);
});

test("[PR-05] more than 500 changed files exits 2 with PR_TOO_LARGE", async () => {
  const r = await runCli(["pr", "--base", shaReadme, "--head", "big", "--repo", repo.dir]);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /^error: PR_TOO_LARGE: 501 changed files exceed the PR cap of 500\n$/);
});

test("[PR-05] a Git failure exits 3 with GIT_ERROR", async (t) => {
  const plain = tmpDir(t);
  const r = await runCli(["pr", "--base", "HEAD~1", "--repo", plain]);
  assert.equal(r.code, 3);
  assert.match(r.stderr, /^error: GIT_ERROR: /);
  const dash = await runCli(["pr", "--base", "--output=/tmp/x", "--repo", repo.dir]);
  assert.equal(dash.code === 2 || dash.code === 3, true, "parseArgs may read --output as an unknown flag (2) or the ref check rejects it (3)");
  const dash2 = await runCli(["pr", "--base=-x", "--repo", repo.dir]);
  assert.equal(dash2.code, 3);
  assert.match(dash2.stderr, /^error: GIT_ERROR: invalid ref/);
});

test("[PR-04] a pull request cannot silence its own findings: both revisions use the base revision's config", async (t) => {
  const out = tmpDir(t);
  const r = await runCli(["pr", "--base", shaBase, "--head", shaSelfSuppress, "--repo", repo.dir, "--format", "md,json", "--out", out]);
  assert.equal(r.code, 1, r.stderr);
  const comment = readFileSync(join(out, "pr-comment.md"), "utf8");
  assert.match(comment, /2 added · 1 resolved · 15 unchanged/);
  assert.match(comment, /This PR changes `privacy-radar\.config\.json`: both revisions were scanned with the base revision's config/);
  const j = await runCli(["pr", "--base", shaBase, "--head", shaSelfSuppress, "--repo", repo.dir, "--json"]);
  const parsed = JSON.parse(j.stdout) as { added: Finding[]; configChanged: boolean };
  assert.deepEqual(rows(parsed.added).sort(), [["PR-ANALYTICS", "src/analytics.ts", 9], ["PR-TRANSFER", "src/analytics.ts", 9]]);
  assert.equal(parsed.configChanged, true);
});

test("[PR-04] the base revision's config applies to both scans", async () => {
  // base = the self-suppressing commit (its config ignores src/analytics.ts), head = that commit plus one line
  git(repo.dir, ["checkout", "-q", "self-suppress"]);
  const shaNext = repo.commit({ "src/analytics.ts": `${readFileSync(join(repo.dir, "src", "analytics.ts"), "utf8")}\n` }, "touch analytics");
  git(repo.dir, ["checkout", "-q", "main"]);
  const r = await runCli(["pr", "--base", shaSelfSuppress, "--head", shaNext, "--repo", repo.dir, "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const j = JSON.parse(r.stdout) as { added: Finding[]; resolved: Finding[]; configChanged: boolean };
  assert.deepEqual([j.added.length, j.resolved.length, j.configChanged], [0, 0, false]);
});
