import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GUARD_URL, PROJECT_ROOT_FOR_TESTS } from "../helpers/child-node-args.ts";
import { makeDemoRepo } from "../helpers/git-repo.ts";
import { readRepoFile } from "../helpers/repo-files.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";

const indentOf = (line: string) => line.length - line.trimStart().length;

/** The body of every `run:` key: block scalars (`run: |`) by indentation, plus single-line values. No YAML dependency. */
function runBlocks(yaml: string): string[] {
  const lines = yaml.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(lines[i]!);
    if (!m) continue;
    const rest = m[2]!.trim();
    if (rest !== "|" && rest !== "|-" && rest !== ">") {
      out.push(rest);
      continue;
    }
    const keyIndent = indentOf(lines[i]!);
    const body: string[] = [];
    let blockIndent = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]!;
      if (l.trim() === "") {
        body.push("");
        continue;
      }
      if (indentOf(l) <= keyIndent) break;
      if (blockIndent < 0) blockIndent = indentOf(l);
      body.push(l.slice(blockIndent));
    }
    out.push(body.join("\n").trimEnd());
  }
  return out;
}

/** The script of the step with `id: run` (the last block scalar of the file). */
function runStepScript(yaml: string): string {
  const blocks = runBlocks(yaml).filter((b) => b.includes("\n"));
  assert.equal(blocks.length, 1, "one multi-line run block");
  return blocks[0]!;
}

function runStep(env: Record<string, string>): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("bash", ["-c", runStepScript(readRepoFile("action.yml"))], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NODE_OPTIONS: `--import=${GUARD_URL}`, GITHUB_ACTION_PATH: PROJECT_ROOT_FOR_TESTS, PRIVACY_RADAR_CLOCK: "2026-10-08T12:00:00.000Z", LOG_LEVEL: "warn", ...env },
    cwd: PROJECT_ROOT_FOR_TESTS,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("runBlocks extracts block scalars by indentation and single-line run values", () => {
  const blocks = runBlocks(["steps:", "  - run: npm ci", "    shell: bash", "  - id: x", "    run: |", "      echo a", "", "      echo b", "    shell: bash"].join("\n"));
  assert.deepEqual(blocks, ["npm ci", "echo a\n\necho b"]);
});

test("[ACT-02] action.yml runs the CLI from $GITHUB_ACTION_PATH with --llm none and pins Node through .nvmrc", () => {
  const y = readRepoFile("action.yml");
  assert.match(y, /node "\$GITHUB_ACTION_PATH\/src\/cli\.ts" scan .*--llm none/);
  assert.match(y, /node-version-file: "\$\{\{ github\.action_path \}\}\/\.nvmrc"/);
  assert.match(y, /using: composite/);
  assert.match(y, /npm ci --omit=dev --prefix "\$GITHUB_ACTION_PATH"/);
});

test("[ACT-04] action.yml captures the exit code, declares comment-file and never interpolates inputs into run", () => {
  const y = readRepoFile("action.yml");
  for (const s of ["|| code=$?", 'exit "$code"', "comment-file:", "exit-code:", "sarif-file:"]) assert.ok(y.includes(s), s);
  assert.doesNotMatch(runBlocks(y).join("\n"), /\$\{\{\s*inputs\./);
  for (const name of ["PATH", "REGIME", "FAIL_ON", "MIN_CONFIDENCE", "BASE"]) assert.match(y, new RegExp(`INPUT_${name}: \\$\\{\\{ inputs\\.`), name);
});

test("[ACT-03] docs/github-action.md has the upload-sarif@v4 workflow with security-events: write", () => {
  const d = readRepoFile("docs/github-action.md");
  for (const s of ["<!-- [ACT-03] -->", "github/codeql-action/upload-sarif@v4", "security-events: write", "pull-requests: write", "actions/checkout@v7", "fetch-depth: 0", "base: ${{ github.event.pull_request.base.sha }}", "if: always()", "gh pr comment", "--body-file", "comment-file", "--llm none", "node_modules"]) {
    assert.ok(d.includes(s), s);
  }
});

test("[ACT-04] the run step writes sarif, code and the step summary when the CLI exits 1", (t) => {
  const tmp = tmpDir(t);
  const outFile = join(tmp, "out.txt");
  const summary = join(tmp, "summary.md");
  const r = runStep({ RUNNER_TEMP: tmp, GITHUB_OUTPUT: outFile, GITHUB_STEP_SUMMARY: summary, INPUT_PATH: "fixtures/telehealth-clinic", INPUT_REGIME: "both", INPUT_FAIL_ON: "error", INPUT_MIN_CONFIDENCE: "0.5", INPUT_BASE: "" });
  assert.equal(r.status, 1, r.stderr);
  const o = readFileSync(outFile, "utf8");
  assert.match(o, /^code=1$/m);
  assert.match(o, /^sarif=.+findings\.sarif$/m);
  assert.doesNotMatch(o, /^comment=/m, "no comment in a full scan");
  assert.ok(existsSync(join(tmp, "privacy-radar", "findings.sarif")));
  assert.match(r.stdout, /DRAFTS, NOT LEGAL ADVICE/, "the table is printed in the job log");
  assert.match(r.stdout, /provider: none/);
});

test("[ACT-04] with fail-on none the step exits 0 and still exposes the SARIF file", (t) => {
  const tmp = tmpDir(t);
  const outFile = join(tmp, "out.txt");
  const r = runStep({ RUNNER_TEMP: tmp, GITHUB_OUTPUT: outFile, GITHUB_STEP_SUMMARY: join(tmp, "s.md"), INPUT_PATH: "fixtures/telehealth-clinic", INPUT_REGIME: "both", INPUT_FAIL_ON: "none", INPUT_MIN_CONFIDENCE: "0.5", INPUT_BASE: "" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(readFileSync(outFile, "utf8"), /^code=0$/m);
  assert.match(readFileSync(outFile, "utf8"), /^sarif=/m);
});

test("[ACT-04] in PR mode the step appends pr-comment.md to the step summary and exposes comment", (t) => {
  const demo = makeDemoRepo(t);
  const tmp = tmpDir(t);
  const outFile = join(tmp, "out.txt");
  const summary = join(tmp, "summary.md");
  const r = runStep({ RUNNER_TEMP: tmp, GITHUB_OUTPUT: outFile, GITHUB_STEP_SUMMARY: summary, INPUT_PATH: demo.repo.dir, INPUT_REGIME: "both", INPUT_FAIL_ON: "error", INPUT_MIN_CONFIDENCE: "0.5", INPUT_BASE: demo.shaBase });
  assert.equal(r.status, 1, r.stderr);
  const o = readFileSync(outFile, "utf8");
  assert.match(o, /^code=1$/m);
  assert.match(o, /^comment=.+pr-comment\.md$/m);
  assert.match(o, /^sarif=.+findings\.sarif$/m);
  const s = readFileSync(summary, "utf8");
  assert.equal(s, readFileSync(join(tmp, "privacy-radar", "pr-comment.md"), "utf8"));
  assert.match(s, /This PR introduces a new flow of identifier\.cpf and special\.health/);
});

test("[ACT-04] a usage error (exit 2) leaves no sarif output, and the code is still written", (t) => {
  const tmp = tmpDir(t);
  const outFile = join(tmp, "out.txt");
  const r = runStep({ RUNNER_TEMP: tmp, GITHUB_OUTPUT: outFile, GITHUB_STEP_SUMMARY: join(tmp, "s.md"), INPUT_PATH: "fixtures/telehealth-clinic", INPUT_REGIME: "neither", INPUT_FAIL_ON: "error", INPUT_MIN_CONFIDENCE: "0.5", INPUT_BASE: "" });
  assert.equal(r.status, 2);
  const o = readFileSync(outFile, "utf8");
  assert.match(o, /^code=2$/m);
  assert.doesNotMatch(o, /^sarif=/m);
});

test("[ACT-04] a reused $RUNNER_TEMP folder never exposes a previous step's findings.sarif or pr-comment.md", (t) => {
  const tmp = tmpDir(t);
  const outFile = join(tmp, "out.txt");
  const summary = join(tmp, "s.md");
  mkdirSync(join(tmp, "privacy-radar"));
  writeFileSync(join(tmp, "privacy-radar", "findings.sarif"), "stale");
  writeFileSync(join(tmp, "privacy-radar", "pr-comment.md"), "stale comment");
  // a usage error exits before any artifact is written, so only the cleanup can remove the old files
  const r = runStep({ RUNNER_TEMP: tmp, GITHUB_OUTPUT: outFile, GITHUB_STEP_SUMMARY: summary, INPUT_PATH: "fixtures/telehealth-clinic", INPUT_REGIME: "neither", INPUT_FAIL_ON: "error", INPUT_MIN_CONFIDENCE: "0.5", INPUT_BASE: "" });
  assert.equal(r.status, 2);
  const o = readFileSync(outFile, "utf8");
  assert.match(o, /^code=2$/m);
  assert.doesNotMatch(o, /^sarif=/m);
  assert.doesNotMatch(o, /^comment=/m);
  assert.equal(existsSync(summary), false, "nothing is appended to the step summary");
  assert.equal(existsSync(join(tmp, "privacy-radar", "findings.sarif")), false);
});
