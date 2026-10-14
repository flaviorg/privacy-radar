import { before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runDemo, type DemoResult } from "../../scripts/demo.ts";
import { DEMO_CLOCK_ISO } from "../../src/infra/clock.ts";
import { renderDemoMd, renderHero } from "../../src/output/summary.ts";
import { PROJECT_ROOT_FOR_TESTS } from "../helpers/child-node-args.ts";
import { ALL_FIXTURE_SECRETS } from "../helpers/fixture-values.ts";
import { GOLDEN_DIR, assertGolden, replaceMarkedBlock } from "../helpers/golden.ts";
import { runNodeScript, type CliRun } from "../helpers/run-cli.ts";

// This file is the only test that writes artifacts/demo/ in the project (spec 8.4).
const DEMO_DIR = join(PROJECT_ROOT_FOR_TESTS, "artifacts", "demo");
const GOLDEN_FILES = ["findings.json", "findings.sarif", "inventory.json", "inventory.md", "ropa.md", "dpia.md", "registro.pt-BR.md", "ripd.pt-BR.md", "pr-comment.md"];
const ARTIFACTS = [...GOLDEN_FILES, "llm-trace.jsonl"];

let spawned: CliRun;
let demo: DemoResult;
let captured = "";

before(async () => {
  spawned = await runNodeScript("scripts/demo.ts", { env: {} });
  demo = await runDemo({ live: false, env: {}, outDir: DEMO_DIR, clockIso: DEMO_CLOCK_ISO, write: (s) => void (captured += s) });
});

test("[DEMO-01] npm run demo exits 0 under the guard with PRIVACY_RADAR_CLOCK unset and writes the artifacts of spec 5.1", () => {
  assert.equal(spawned.code, 0, spawned.stderr);
  for (const f of ARTIFACTS) assert.ok(existsSync(join(DEMO_DIR, f)), f);
  assert.match(spawned.stdout, /provider: fake \(scripted\)/);
  assert.match(spawned.stdout, /clock 2026-10-08T12:00:00\.000Z/);
  assert.match(spawned.stdout, /^done in \d+\.\d s$/m);
  assert.equal(spawned.stderr, "", "no warning or log line at the default level");
  assert.equal(demo.exitCode, 0);
  assert.deepEqual(demo.artifacts, [...ARTIFACTS].sort());
});

test("[DEMO-01] artifacts equal the goldens and the summary block equals demo-summary.txt", () => {
  for (const f of GOLDEN_FILES) assertGolden(`demo/${f}`, readFileSync(join(DEMO_DIR, f), "utf8"));
  const summary = renderHero(demo.hero, "markdown");
  assertGolden("demo/demo-summary.txt", summary);
  const demoMd = renderDemoMd({ ...demo.hero, prComment: demo.prComment });
  const demoMdPath = join(PROJECT_ROOT_FOR_TESTS, "DEMO.md");
  if (process.env.UPDATE_GOLDEN === "1") {
    writeFileSync(demoMdPath, demoMd);
    replaceMarkedBlock(join(PROJECT_ROOT_FOR_TESTS, "README.md"), "demo", summary);
  } else {
    assert.ok(existsSync(demoMdPath), "DEMO.md is missing: run npm run regen");
    assert.equal(readFileSync(demoMdPath, "utf8"), demoMd, "DEMO.md differs: run npm run regen");
  }
  const consoleHero = renderHero(demo.hero, "console");
  assert.ok(captured.startsWith(consoleHero), "the demo prints the console hero first");
  assert.ok(spawned.stdout.startsWith(consoleHero), "the spawned demo prints the same hero");
});

test("[DEMO-01] counts: 14 personal, 24 fields, 16 values masked; 5 error, 10 warning, 3 note, 18 results; two introduces and one removes", () => {
  const golden = JSON.parse(readFileSync(join(GOLDEN_DIR, "demo", "findings.json"), "utf8")) as { summary: { error: number; warning: number; note: number }; findings: { belowThreshold: boolean }[] };
  const inv = demo.hero.inventory.counts;
  assert.deepEqual([inv.personal, inv.fields, inv.valuesMasked], [14, 24, 16]);
  const s = demo.hero.scan.summary;
  assert.deepEqual([s.error, s.warning, s.note], [5, 10, 3]);
  assert.deepEqual([golden.summary.error, golden.summary.warning, golden.summary.note], [5, 10, 3]);
  assert.equal(golden.findings.filter((f) => !f.belowThreshold).length, 18);
  assert.equal(demo.hero.sarif?.results, 18);
  assert.equal(demo.hero.sarif?.rules, 12);
  const lines = spawned.stdout.split("\n");
  assert.equal(lines.filter((l) => l.startsWith("+ This PR introduces")).length, 2);
  assert.equal(lines.filter((l) => l.startsWith("- This PR removes")).length, 1);
  assert.deepEqual([demo.hero.pr?.added.length, demo.hero.pr?.resolved.length, demo.hero.pr?.unchanged], [2, 1, 15]);
  assert.equal(demo.hero.documents?.wp248, 2);
  assert.equal(demo.hero.documents?.ripdIndicators, 3);
  assert.equal(demo.hero.scan.llm.narrativeSections, 8);
});

test("[DEMO-01] every fixture turn is consumed and the commit SHAs equal the golden ones", () => {
  assert.ok(demo.fake, "the demo uses the scripted fake");
  demo.fake.assertAllConsumed();
  assert.equal(demo.fake.consumedIds().length, 10);
  const golden = readFileSync(join(GOLDEN_DIR, "demo", "demo-summary.txt"), "utf8");
  assert.ok(golden.includes(`base ${demo.hero.pr!.baseShort} → head ${demo.hero.pr!.headShort}`), "stable SHAs under the demo clock");
  assert.match(spawned.stdout, new RegExp(`base ${demo.hero.pr!.baseShort} → head ${demo.hero.pr!.headShort}`));
});

test("[DEMO-02] with LLM_API_KEY set and no --live the demo still uses the fake", async () => {
  const key = "sk-or-v1-" + "z".repeat(40);
  const r = await runNodeScript("scripts/demo.ts", { env: { LLM_API_KEY: key, LLM_PROVIDER: "openai-compatible", LLM_MODEL: "some-model" } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /provider: fake \(scripted\)/);
  assert.ok(!r.stdout.includes("z".repeat(40)) && !r.stderr.includes("z".repeat(40)));
});

test("[DEMO-01] no fixture identifier, e-mail, name or address in the captured output", () => {
  for (const v of ALL_FIXTURE_SECRETS) for (const text of [spawned.stdout, spawned.stderr, captured]) assert.ok(!text.includes(v), "leak in the demo output");
});
