import { test } from "node:test";
import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { join } from "node:path";
import { ENV_KEYS } from "../../src/infra/config.ts";
import { DISCLAIMER_EN, DISCLAIMER_PT_BR } from "../../src/output/disclaimer.ts";
import { scanText } from "../../scripts/check-secrets.ts";
import { collectDiagrams, markdownBlocks } from "../../scripts/check-diagrams.ts";
import { PROJECT_ROOT_FOR_TESTS } from "../helpers/child-node-args.ts";
import { importSpecifiers, linesOutsideSystemLiteral, listRepoFiles, readRepoFile, resolveImport, resolvedImports } from "../helpers/repo-files.ts";

const src = (dir: string) => listRepoFiles().filter((f) => f.startsWith(dir) && f.endsWith(".ts"));
const importsOf = (f: string) => resolvedImports(f);
const PURE = ["src/validators/", "src/catalog/terms.ts", "src/catalog/values.ts", "src/catalog/index.ts", "src/flows/", "src/engine/", "src/output/"];
const isPure = (f: string) => PURE.some((p) => f === p || (p.endsWith("/") && f.startsWith(p)));
const allSrc = () => listRepoFiles().filter((f) => f.startsWith("src/") && f.endsWith(".ts"));
const stripImports = (source: string) => source.replace(/^\s*(?:import|export)\b[^;'"]*?\bfrom\s*["'][^"']+["'];?/gm, "");

test("[REP-04] scanners find static, re-export and dynamic imports", () => {
  assert.deepEqual(
    importSpecifiers('import { a } from "../x.ts";\nexport * from "./y.ts";\nawait import("./z.ts");\nimport type { T } from "zod";'),
    ["../x.ts", "./y.ts", "./z.ts", "zod"],
  );
  assert.deepEqual(importSpecifiers('import {\n  a,\n  b,\n} from "./multi.ts";\nimport "./side-effect.ts";\nexport const x = 1;'), ["./multi.ts", "./side-effect.ts"]);
  assert.equal(resolveImport("src/engine/rules/a.ts", "../model.ts"), "src/engine/model.ts");
  assert.equal(resolveImport("src/cli.ts", "./infra/errors.ts"), "src/infra/errors.ts");
});

test("[REP-04] the repository scanner lists project files with POSIX paths and skips dependencies", () => {
  const files = listRepoFiles();
  assert.ok(files.includes("package.json"));
  assert.ok(files.includes("tests/helpers/repo-files.ts"));
  assert.ok(!files.some((f) => f.startsWith("node_modules/") || f.startsWith(".git/")));
  assert.ok(!files.some((f) => f.includes("\\")));
  assert.match(readRepoFile("package.json"), /"privacy-radar"/);
});

test("[REP-04] the SYSTEM literal scanner drops the lines inside the template literal", () => {
  const sample = ["const a = 1;", "const SYSTEM = `", "Never cite an article.", "`;", "const b = 2;", "const ONE = 1; const SYSTEM = `one line article`;"].join("\n");
  assert.deepEqual(linesOutsideSystemLiteral(sample), ["const a = 1;", "const b = 2;"]);
});

test("[REP-04] rule 1: src/contracts imports only zod and contracts; src/shared imports nothing", () => {
  for (const f of src("src/contracts/")) {
    for (const spec of importsOf(f)) {
      assert.ok(spec === "zod" || spec.startsWith("src/contracts/"), `${f} imports ${spec}`);
    }
  }
  for (const f of src("src/shared/")) assert.deepEqual(importsOf(f), [], f);
});

test("[REP-04] rule 2: pure layers import no node:fs, node:child_process, src/llm or src/app and never read process.env", () => {
  for (const f of allSrc().filter(isPure)) {
    const imports = importsOf(f);
    for (const spec of imports) {
      if (f === "src/engine/fingerprint.ts" && spec === "node:crypto") continue;
      assert.ok(!spec.startsWith("node:") && !/^(fs|child_process|path|os|crypto)$/.test(spec), `${f} imports ${spec}`);
      assert.ok(!spec.startsWith("src/llm/") && !spec.startsWith("src/app/") && !spec.startsWith("src/prompts/"), `${f} imports ${spec}`);
    }
    assert.doesNotMatch(readRepoFile(f), /process\.env/, `${f} reads process.env`);
  }
});

test("[REP-04] src/catalog/index.ts re-exports only terms.ts and values.ts, never load.ts", () => {
  if (!listRepoFiles().includes("src/catalog/index.ts")) return;
  for (const spec of importsOf("src/catalog/index.ts")) {
    assert.ok(spec === "src/catalog/terms.ts" || spec === "src/catalog/values.ts", `src/catalog/index.ts imports ${spec}`);
  }
});

test("[REP-04] rule 3: src/sources imports only its parser library and src/contracts", () => {
  const parserOwner: Record<string, string> = { "@babel/parser": "src/sources/ts/parse.ts", "pgsql-ast-parser": "src/sources/sql/parse.ts" };
  for (const f of src("src/sources/")) {
    for (const spec of importsOf(f)) {
      if (spec in parserOwner) {
        assert.equal(f, parserOwner[spec], `${spec} may only be imported by ${parserOwner[spec]}, found in ${f}`);
      } else {
        assert.ok(spec.startsWith("src/sources/") || spec.startsWith("src/contracts/"), `${f} imports ${spec}`);
      }
    }
  }
});

test("[REP-04] rule 4: src/llm and src/prompts never import src/engine, src/output, src/sources or src/app", () => {
  for (const f of [...src("src/llm/"), ...src("src/prompts/")]) {
    for (const spec of importsOf(f)) {
      assert.ok(!/^src\/(engine|output|sources|app)\//.test(spec), `${f} imports ${spec}`);
    }
  }
});

test("[REP-04] rule 5: only the allowed modules read catalog/ and the target, and only app, cli and scripts write files", () => {
  const CATALOG_READERS = new Set(["src/catalog/load.ts", "src/infra/paths.ts"]);
  const WRITERS = (f: string) => f.startsWith("src/app/") || f === "src/cli.ts" || f === "src/infra/git.ts" || f === "src/pr/snapshot.ts";
  const WRITE_CALL = /\b(writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|mkdtemp|mkdtempSync|rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|copyFile|copyFileSync|cp|cpSync|rename|renameSync|createWriteStream)\s*\(/;
  for (const f of allSrc()) {
    const body = stripImports(readRepoFile(f));
    if (!CATALOG_READERS.has(f)) {
      assert.doesNotMatch(body, /\bCATALOG_DIR\b/, `${f} uses CATALOG_DIR`);
      assert.doesNotMatch(body, /["'`](?:\.\.?\/)*catalog\//, `${f} builds a catalog/ path`);
    }
    if (!WRITERS(f)) assert.doesNotMatch(body, WRITE_CALL, `${f} writes files`);
  }
});

test("[REP-04] rule 6: process.env is read only by src/cli.ts, src/infra/config.ts, src/infra/git.ts (PATH and HOME of Git children), scripts and tests", () => {
  for (const f of allSrc()) {
    if (f === "src/cli.ts" || f === "src/infra/config.ts" || f === "src/infra/git.ts") continue;
    assert.doesNotMatch(readRepoFile(f), /process\s*(?:\.\s*env\b|\[\s*["']env["']\s*\])/, `${f} reads process.env`);
  }
});

test("[REP-04] src/prompts imports only src/contracts and src/prompts, and there is at least one prompt file to scan", () => {
  const prompts = src("src/prompts/");
  assert.ok(prompts.includes("src/prompts/v1/label-field.ts") && prompts.includes("src/prompts/v1/draft-narrative.ts"));
  for (const f of prompts) {
    for (const spec of importsOf(f)) assert.ok(spec.startsWith("src/contracts/") || spec.startsWith("src/prompts/"), `${f} imports ${spec}`);
  }
});

test("[REP-04] rule 7: no article word in src/llm and src/prompts outside narrative-checks.ts and the SYSTEM literals", () => {
  for (const f of [...src("src/llm/"), ...src("src/prompts/")]) {
    if (f === "src/llm/narrative-checks.ts") continue;
    for (const line of linesOutsideSystemLiteral(readRepoFile(f))) {
      assert.doesNotMatch(line, /\b(arts?|articles?)\b/i, `${f}: ${line.trim()}`);
    }
  }
});

test("[REP-04] no console.log/info/debug in src/** (stdout only through src/cli.ts writeOut)", () => {
  for (const f of allSrc()) {
    assert.doesNotMatch(readRepoFile(f), /\bconsole\s*\.\s*(log|info|debug)\s*\(/, `${f} writes to the console`);
  }
});

test("[ACT-04] action.yml captures the CLI exit code, exits with it after the outputs and declares the comment-file output", () => {
  const y = readRepoFile("action.yml");
  for (const s of ["|| code=$?", 'exit "$code"', "comment-file:"]) assert.ok(y.includes(s), s);
  assert.ok(y.indexOf('echo "code=$code" >> "$GITHUB_OUTPUT"') < y.indexOf('exit "$code"'), "the code is written before the step exits");
});

// Task 48: repository specs and the EARS coverage check (REP-05 and the spec-to-test links).
const ALLOWLIST: Record<string, string> = {
  "LLM-10": "tests/live/real-provider.live.ts",
  "ACT-01": ".github/workflows/ci.yml",
  "ACT-02": ".github/workflows/ci.yml",
  "ACT-03": "docs/github-action.md",
};
const specIds = () => [...new Set(listRepoFiles().filter((f) => /^specs\/\d{3}-[^/]+\/spec\.md$/.test(f)).flatMap((f) => [...readRepoFile(f).matchAll(/^- \*\*([A-Z]{2,4}-\d{2})\*\* /gm)].map((m) => m[1]!)))];
const testNames = () => listRepoFiles().filter((f) => f.startsWith("tests/") && f.endsWith(".ts")).map(readRepoFile).join("\n");

test("every EARS id in specs/ appears as [ID] in a test name or in its allowlisted file", () => {
  const ids = specIds();
  assert.equal(ids.length, 97);
  const text = testNames();
  assert.deepEqual(ids.filter((id) => !text.includes(`[${id}]`) && !(id in ALLOWLIST && readRepoFile(ALLOWLIST[id]!).includes(`[${id}]`))), []);
});

test("every [ID] cited in a test name is defined in a spec", () => {
  const defined = new Set(specIds());
  const cited = [...testNames().matchAll(/test\(\s*[`"]\[([A-Z]{2,4}-\d{2})\]/g)].map((m) => m[1]!);
  assert.deepEqual([...new Set(cited.filter((id) => !defined.has(id)))], []);
});

test("seven feature specs and a constitution exist, each spec marked implemented, the constitution within 60 lines", () => {
  const files = listRepoFiles();
  const specs = files.filter((f) => /^specs\/\d{3}-[^/]+\/spec\.md$/.test(f));
  assert.deepEqual(specs, [
    "specs/001-catalog-and-validators/spec.md",
    "specs/002-code-source-and-flows/spec.md",
    "specs/003-schema-sources/spec.md",
    "specs/004-engine-and-outputs/spec.md",
    "specs/005-llm-boundary/spec.md",
    "specs/006-documents/spec.md",
    "specs/007-pr-action-demo/spec.md",
  ]);
  for (const f of specs) {
    const t = readRepoFile(f);
    assert.match(t, /^Status: implemented$/m, f);
    for (const h of ["## Context", "## Acceptance criteria", "## Non-goals", "## Resolved questions", "## Checklist"]) assert.ok(t.includes(`\n${h}\n`), `${f} lacks ${h}`);
  }
  assert.ok(files.includes("specs/constitution.md"));
  assert.ok(readRepoFile("specs/constitution.md").split("\n").length <= 60);
});

test("each spec holds the EARS ids of its prefix group (spec 4.6)", () => {
  const groups: Record<string, string[]> = {
    "001-catalog-and-validators": ["CAT", "VAL"],
    "002-code-source-and-flows": ["SRC", "FLOW"],
    "003-schema-sources": ["SCH"],
    "004-engine-and-outputs": ["ENG", "OUT"],
    "005-llm-boundary": ["LLM", "EVAL"],
    "006-documents": ["DOC"],
    "007-pr-action-demo": ["PR", "ACT", "DEMO", "REP"],
  };
  for (const [dir, prefixes] of Object.entries(groups)) {
    const ids = [...readRepoFile(`specs/${dir}/spec.md`).matchAll(/^- \*\*([A-Z]{2,4})-\d{2}\*\* /gm)].map((m) => m[1]!);
    assert.ok(ids.length > 0, dir);
    assert.deepEqual([...new Set(ids)].sort(), [...prefixes].sort(), dir);
  }
});

// Task 49: repository files, REP-01, REP-02 and REP-05.
test("[REP-01] AGENTS.md has at most 100 lines", () => {
  assert.ok(readRepoFile("AGENTS.md").split("\n").length <= 100);
});

test("[REP-02] .env.example lists every variable envSchema reads", () => {
  const keys = [...readRepoFile(".env.example").matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1]).sort();
  assert.deepEqual(keys, [...ENV_KEYS].sort());
  assert.match(readRepoFile(".env.example"), /^LLM_API_KEY=$/m, "the key line is empty");
});

// The words are built by concatenation so this file does not match its own scan.
const UPPER_MARKERS = new RegExp(["\\bTO" + "DO\\b", "\\bTB" + "D\\b", "\\bFIX" + "ME\\b"].join("|"));
const PHRASE_MARKERS = new RegExp(["lorem " + "ipsum", "fill" + " in"].join("|"), "i");
const hasMarker = (text: string) => UPPER_MARKERS.test(text) || PHRASE_MARKERS.test(text);

test("[REP-05] no pending markers, lorem ipsum or fill-in text outside the allowlist", () => {
  const offenders: string[] = [];
  for (const f of listRepoFiles()) {
    if (f.startsWith("tests/") || f === "privacy-radar.config.example.json") continue;
    let text = readRepoFile(f);
    if (f === "README.md") text = text.replace(/<!-- excerpt:start -->[\s\S]*?<!-- excerpt:end -->/g, "");
    // The spec of this very rule quotes the markers it forbids.
    if (/^specs\/\d{3}-[^/]+\/spec\.md$/.test(f)) text = text.split("\n").filter((l) => !l.startsWith("- **REP-05** ")).join("\n");
    text.split("\n").forEach((line, i) => {
      if (hasMarker(line)) offenders.push(`${f}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test("[REP-05] the marker scan itself catches each forbidden word", () => {
  for (const w of ["TO" + "DO", "TB" + "D", "FIX" + "ME", "Lorem " + "Ipsum", "fill" + " in"]) assert.ok(hasMarker(`x ${w} y`), w);
  assert.ok(!hasMarker("metodologia de coleta; todo o resto"), "ordinary words that contain the letters are fine");
});

test("[REP-05] no key-shaped string outside tests/", () => {
  const hits = listRepoFiles().filter((f) => !f.startsWith("tests/")).flatMap((f) => scanText(readRepoFile(f), f));
  assert.deepEqual(hits, []);
});

test("[REP-05] the pre-commit hook exists, is executable and runs typecheck, unit tests and check:secrets", () => {
  const hook = ".githooks/pre-commit";
  assert.ok(statSync(join(PROJECT_ROOT_FOR_TESTS, hook)).mode & 0o111, "executable bit");
  const text = readRepoFile(hook);
  assert.ok(text.startsWith("#!/bin/sh\n"));
  for (const s of ["set -e", 'cd "$(dirname "$0")/.."', "npm run --silent typecheck", "npm run --silent test:unit", "npm run --silent check:secrets"]) assert.ok(text.includes(s), s);
});

test("[REP-05] every template carries its locale's disclaimer sentence", () => {
  const templates = listRepoFiles().filter((f) => /^templates\/[^/]+\/[^/]+\.md$/.test(f));
  assert.ok(templates.length >= 6);
  for (const f of templates) {
    const expected = f.startsWith("templates/pt-BR/") ? DISCLAIMER_PT_BR : DISCLAIMER_EN;
    assert.ok(readRepoFile(f).includes(expected), `${f} lacks its disclaimer`);
  }
});

test("[REP-05] the table output module carries the disclaimer", () => {
  assert.ok(readRepoFile("src/output/table.ts").includes("DISCLAIMER_EN") || readRepoFile("src/output/table.ts").includes(DISCLAIMER_EN));
});

test("LICENSE is MIT, package.json agrees, and the config example parses with the project schema", async () => {
  assert.match(readRepoFile("LICENSE"), /^MIT License/);
  assert.match(readRepoFile("LICENSE"), /Copyright \(c\) 2026 Flavio Gouveia/);
  assert.equal((JSON.parse(readRepoFile("package.json")) as { license: string }).license, "MIT");
  const { projectConfigSchema } = await import("../../src/contracts/config.ts");
  const parsed = projectConfigSchema.safeParse(JSON.parse(readRepoFile("privacy-radar.config.example.json")));
  assert.ok(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues.map((i) => [i.code, i.path])));
});

test("package.json scripts include check:secrets and setup:hooks", () => {
  const scripts = (JSON.parse(readRepoFile("package.json")) as { scripts: Record<string, string> }).scripts;
  assert.equal(scripts["check:secrets"], "node scripts/check-secrets.ts");
  assert.equal(scripts["setup:hooks"], "git config core.hooksPath .githooks");
});

// Task 50: CI, the diagram check and verify.
test("[ACT-01] ci.yml runs the action on itself twice and validates each SARIF", () => {
  const y = readRepoFile(".github/workflows/ci.yml");
  for (const s of ["uses: ./", "fail-on: none", "fail-on: error", "continue-on-error: true", "catalog --validate-sarif", "upload-sarif@v4", "category: fixture", "security-events: write", "path: fixtures/telehealth-clinic", "[ACT-01]", "[ACT-02]"]) assert.ok(y.includes(s), s);
  assert.ok(y.includes("steps.b.outputs.exit-code") && y.includes("steps.a.outputs.sarif-file") && y.includes("steps.b.outputs.sarif-file"));
  assert.ok(y.includes("github.event_name == 'push' && github.ref == 'refs/heads/main'"), "the upload runs only on push to main");
  assert.ok(!/secrets\./.test(y), "no secret is referenced");
  assert.match(y, /^permissions:\n  contents: read$/m, "least privilege at the top level");
});

test("CI runs typecheck, tests, check:secrets, catalog checks, diagrams and eval:fake with checkout@v7 and setup-node@v7", () => {
  const y = readRepoFile(".github/workflows/ci.yml");
  assert.match(y, /^name: CI$/m);
  for (const t of ["push:", "pull_request:", "workflow_dispatch:"]) assert.ok(y.includes(`  ${t}`), t);
  assert.ok(y.includes("runs-on: ubuntu-latest") && y.includes("timeout-minutes: 10"));
  assert.ok(y.includes("actions/checkout@v7") && y.includes("actions/setup-node@v7"));
  assert.ok(y.includes("node-version-file: .nvmrc") && y.includes("cache: npm"));
  const order = ["npm ci", "npm run typecheck", "npm test", "npm run check:secrets", "npm run catalog:validate", "npm run catalog:freshness", "npm run diagrams:check", "npm run eval:fake"].map((c) => y.indexOf(`run: ${c}`));
  assert.ok(order.every((i) => i >= 0), `a step is missing: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "steps run in the documented order");
  assert.ok(y.includes('PROPERTY_SEED: "20261008"'));
  assert.ok(y.includes("needs: verify"));
});

test("verify, diagrams:check and the mermaid-cli pin match spec 4.7", () => {
  const scripts = (JSON.parse(readRepoFile("package.json")) as { scripts: Record<string, string> }).scripts;
  assert.equal(scripts["verify"], "npm run typecheck && npm test && npm run check:secrets && npm run catalog:validate && npm run catalog:freshness && npm run diagrams:check && npm run eval:fake");
  assert.equal(scripts["diagrams:check"], "node scripts/check-diagrams.ts");
  assert.ok(readRepoFile("scripts/check-diagrams.ts").includes("@mermaid-js/mermaid-cli@12.0.0"));
  assert.deepEqual(JSON.parse(readRepoFile("puppeteer.json")), { args: ["--no-sandbox"] });
});

/** Flowchart node labels: after `id[`, `id(` or `id{` (and the double forms) the label must open with a double quote. */
function unquotedFlowLabels(diagram: string): string[] {
  if (!/^\s*(flowchart|graph)\b/.test(diagram)) return [];
  const bad: string[] = [];
  for (const line of diagram.split("\n")) {
    const blanked = line.replace(/"[^"]*"/g, '""');
    for (const m of blanked.matchAll(/\b[A-Za-z_]\w*(?:\[\[|\[\(|\(\(|\{\{|\[|\(|\{)(.?)/g)) if (m[1] !== '"') bad.push(line.trim());
  }
  return bad;
}

test("flowchart node labels are quoted in every Mermaid block and .mmd file", () => {
  const diagrams = collectDiagrams();
  assert.ok(diagrams.length >= 2, "at least the two diagrams of docs/diagrams");
  for (const d of diagrams) assert.deepEqual(unquotedFlowLabels(d.text), [], d.label);
  assert.deepEqual(unquotedFlowLabels('flowchart LR\n  A[/path] --> B["ok"]'), ["A[/path] --> B[\"ok\"]"], "the checker catches an unquoted label");
});

test("sequence-diagram participant aliases carry no literal quote characters (the renderer would print them)", () => {
  for (const d of collectDiagrams()) {
    if (!/^\s*sequenceDiagram\b/.test(d.text)) continue;
    assert.deepEqual(d.text.split("\n").filter((l) => /^\s*participant\b.*"/.test(l)), [], d.label);
  }
});

test("docs/diagrams hold the architecture and the demo flow, and Markdown blocks are extracted in order", () => {
  const labels = collectDiagrams().map((d) => d.label);
  assert.ok(labels.includes("docs/diagrams/architecture.mmd") && labels.includes("docs/diagrams/demo-flow.mmd"));
  assert.deepEqual(markdownBlocks("a\n```mermaid\nflowchart LR\n  A[\"x\"]\n```\ntext\n```mermaid\nsequenceDiagram\n```\n"), ['flowchart LR\n  A["x"]\n', "sequenceDiagram\n"]);
});

// Task 51: docs, ADRs and the field-study protocol.
test("[EVAL-02] docs/field-study.md has the protocol and D-21 headings and a results section only with repositories, SHAs and a date", () => {
  const t = readRepoFile("docs/field-study.md");
  assert.match(t, /^## Protocol$/m);
  assert.match(t, /^## Disclosure rule \(D-21\)$/m);
  if (/^## Results/m.test(t)) {
    assert.match(t, /[0-9a-f]{40}/, "a results section names commit SHAs");
    assert.match(t, /\d{4}-\d{2}-\d{2}/, "and a date");
  }
});

test("every ADR has Status, Context, Decision, Consequences and Alternatives and at most 40 lines", () => {
  const adrs = listRepoFiles().filter((f) => /^docs\/adr\/\d{4}-[a-z0-9-]+\.md$/.test(f));
  assert.equal(adrs.length, 10);
  assert.deepEqual(adrs.map((f) => f.slice(9, 13)), ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008", "0009", "0010"]);
  for (const f of adrs) {
    const t = readRepoFile(f);
    assert.match(t, /^Status: /m, f);
    for (const h of ["## Context", "## Decision", "## Consequences", "## Alternatives"]) assert.ok(t.includes(`\n${h}\n`), `${f} lacks ${h}`);
    assert.ok(t.split("\n").length <= 41, `${f} is longer than 40 lines`);
  }
});

test("docs/threat-model.md lists the 14 risks of spec 6.3 plus risk 15 (self-suppressing PR) and every test file it cites exists", () => {
  const t = readRepoFile("docs/threat-model.md");
  const rows = t.split("\n").filter((l) => /^\| \d+ \|/.test(l));
  assert.deepEqual(rows.map((r) => Number(/^\| (\d+) \|/.exec(r)![1])), Array.from({ length: 15 }, (_, i) => i + 1));
  const files = new Set(listRepoFiles());
  const cited = [...t.matchAll(/`(tests\/[a-z0-9/.-]+\.ts)`/g)].map((m) => m[1]!);
  assert.ok(cited.length >= 14);
  assert.deepEqual([...new Set(cited)].filter((f) => !files.has(f)), []);
});

test("docs/architecture.md embeds docs/diagrams/architecture.mmd and the who-decides table", () => {
  const t = readRepoFile("docs/architecture.md");
  assert.ok(t.includes(readRepoFile("docs/diagrams/architecture.mmd").trimEnd()), "the diagram is the .mmd file");
  assert.ok(t.includes("| Decision | Deterministic code | LLM | Criteria |"));
  for (const rule of ["1.", "7.", "8."]) assert.ok(t.includes(`\n${rule} `), rule);
});

test("docs/comparison.md carries the seven rows of spec 10.3 with a 2026-10-08 date per source", () => {
  const t = readRepoFile("docs/comparison.md");
  for (const tool of ["Bearer CLI 2.1.1", "HoundDog.ai", "Privado 1.3.91", "Microsoft Presidio 2.2.364", "Ethyca Fides", "Enterprise data-mapping suites", "Semgrep/CodeQL custom rules"]) assert.ok(t.includes(tool), tool);
  const sources = t.split("## Sources and dates")[1]!.split("\n").filter((l) => /^\| (?!Tool|---)/.test(l));
  assert.equal(sources.length, 7);
  for (const row of sources) assert.ok(row.includes("2026-10-08"), row);
});

test("docs/fake-provider.md and docs/flow-model.md cover their sections; docs/evals and docs/images exist", () => {
  const fake = readRepoFile("docs/fake-provider.md");
  for (const h of ["## Organization", "## Fixture format", "## Scenarios", "## What the fake proves and what it does not"]) assert.ok(fake.includes(`\n${h}\n`), h);
  const flow = readRepoFile("docs/flow-model.md");
  for (const h of ["## Sources", "## Sinks", "## What is detected", "## What is not detected"]) assert.ok(flow.includes(`\n${h}\n`), h);
  const files = listRepoFiles();
  assert.ok(files.includes("docs/evals/.gitkeep") && files.includes("docs/images/.gitkeep"));
});

// Task 52: the README claims only what exists.
const block = (text: string, name: string): string => {
  const a = text.indexOf(`<!-- ${name}:start -->`);
  const b = text.indexOf(`<!-- ${name}:end -->`);
  assert.ok(a >= 0 && b > a, `README markers ${name}`);
  return text.slice(a + `<!-- ${name}:start -->`.length, b).replace(/^\n/, "").replace(/\n$/, "");
};

test("[DEMO-03] the README demo block equals tests/golden/demo/demo-summary.txt and its counts equal findings.json", () => {
  const demo = block(readRepoFile("README.md"), "demo");
  assert.equal(demo, readRepoFile("tests/golden/demo/demo-summary.txt").trimEnd());
  const m = /summary: (\d+) error · (\d+) warning · (\d+) note[^\n]*· (\d+) suppressed · (\d+) results/.exec(demo);
  assert.ok(m, "the summary line is in the block");
  const golden = JSON.parse(readRepoFile("tests/golden/demo/findings.json")) as { summary: { error: number; warning: number; note: number; suppressed: number }; findings: { belowThreshold: boolean }[] };
  assert.deepEqual(m!.slice(1, 5).map(Number), [golden.summary.error, golden.summary.warning, golden.summary.note, golden.summary.suppressed]);
  assert.equal(Number(m![5]), golden.findings.filter((f) => !f.belowThreshold).length);
});

test("[EVAL-02] the README classifier block equals tests/golden/evals/classifier.md", () => {
  assert.equal(block(readRepoFile("README.md"), "classifier"), readRepoFile("tests/golden/evals/classifier.md").trimEnd());
});

test("[EVAL-02] no 'not run' phrasing, and a live-eval table only when docs/evals/*.md exists", () => {
  const readme = readRepoFile("README.md");
  assert.doesNotMatch(readme, /not run\b|not yet run|has not been run|never run/i);
  const liveFiles = listRepoFiles().filter((f) => /^docs\/evals\/[^/]+\.md$/.test(f));
  if (liveFiles.length === 0) {
    assert.doesNotMatch(readme, /LLM labeling evaluation/i, "no live table without a docs/evals file");
    assert.doesNotMatch(readme, /\|\s*Accuracy\s*\|/i);
  }
  const study = readRepoFile("docs/field-study.md");
  if (!/^## Results/m.test(study)) assert.doesNotMatch(readme, /field[- ]study (results|table)/i, "no field-study table without a results section");
});

test("every line of the README hero block is at most 100 columns", () => {
  for (const l of block(readRepoFile("README.md"), "demo").split("\n")) assert.ok([...l].length <= 100, `${[...l].length} columns: ${l}`);
});

test("every image the README references exists", () => {
  const readme = readRepoFile("README.md");
  const files = new Set(listRepoFiles());
  const refs = [...readme.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g), ...readme.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]!);
  for (const ref of refs) if (!/^https?:/.test(ref)) assert.ok(files.has(ref) || files.has(ref.replace(/^\.\//, "")), `${ref} does not exist`);
});

test("README carries the disclaimer, the who-decides-what table and the fourteen sections of spec 10.1", () => {
  const readme = readRepoFile("README.md");
  assert.ok(readme.includes(DISCLAIMER_EN));
  assert.ok(readme.includes("### Who decides what"));
  const h2 = [...readme.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(h2, [
    "The problem",
    "Run it",
    "What you get",
    "How it works",
    "Both regimes, verified sources",
    "Honesty",
    "Using it on your repository",
    "Outputs reference",
    "Comparison with existing tools",
    "Limits",
    "Tests and process",
    "Sources that shaped the design",
    "License",
  ]);
  assert.match(readme, /^# privacy-radar$/m);
  assert.ok(readme.includes("tests/unit/merge-findings.unit.test.ts") && readme.includes("tests/e2e/injection.e2e.test.ts"));
});

test("README excerpts are real lines of the generated goldens", () => {
  const readme = readRepoFile("README.md");
  const corpus = new Set(
    listRepoFiles()
      .filter((f) => f.startsWith("tests/golden/demo/"))
      .flatMap((f) => readRepoFile(f).split("\n").map((l) => l.trim())),
  );
  const blocks = [...readme.matchAll(/<!-- excerpt:start -->\n([\s\S]*?)<!-- excerpt:end -->/g)].map((m) => m[1]!);
  assert.ok(blocks.length >= 5, "excerpts for ropa, registro, ripd, SARIF and the PR comment");
  for (const b of blocks) {
    for (const raw of b.split("\n")) {
      const l = raw.replace(/^> ?/, "").trim();
      if (l === "" || l === "…" || l.startsWith("```")) continue;
      assert.ok(corpus.has(l), `not a line of a golden: ${l}`);
    }
  }
});

test("README names only commands and files that exist", () => {
  const readme = readRepoFile("README.md");
  const scripts = (JSON.parse(readRepoFile("package.json")) as { scripts: Record<string, string> }).scripts;
  for (const m of readme.matchAll(/npm run ([a-z:-]+)/g)) assert.ok(m[1]! in scripts, `npm run ${m[1]}`);
  const files = new Set(listRepoFiles());
  for (const m of readme.matchAll(/\]\(((?!https?:|#)[^)\s#]+)(?:#[^)]*)?\)/g)) {
    const target = m[1]!.replace(/\/$/, "");
    assert.ok(files.has(target) || [...files].some((f) => f.startsWith(`${target}/`)), `link target ${target}`);
  }
});

test("docs/api-notes.md records the measured suite and demo times and no unfilled placeholder line", () => {
  const t = readRepoFile("docs/api-notes.md");
  assert.match(t, /^## Measured times/m);
  assert.match(t, /\| `npm test` \([0-9]+ tests\) \| [0-9.]+ s wall clock \|/);
  assert.match(t, /\| `npm run demo` \| [0-9.]+ s wall clock/);
  assert.doesNotMatch(t, /filled in Task/i);
});
