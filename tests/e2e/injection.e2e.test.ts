import { before, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { resolveLlm } from "../../src/app/llm.ts";
import { exitCodeFor, type ScanOutcome } from "../../src/app/scan.ts";
import { loadCatalog } from "../../src/catalog/load.ts";
import type { ScanResult } from "../../src/contracts/findings.ts";
import { loadEnv } from "../../src/infra/config.ts";
import { createPrompts } from "../../src/prompts/index.ts";
import { runScanInProcess } from "../helpers/run-scan.ts";

const prompts = createPrompts(loadCatalog().categories.map((c) => c.id));
const fake = (fixturePath: string) => resolveLlm({ choice: "fake", fixturePath, env: loadEnv({}), prompts, redact: (s) => s });

let demo: ScanOutcome & { outDir: string };
let injected: ScanOutcome & { outDir: string };

before(async (hook) => {
  const t = hook as TestContext; // a hook receives a TestContext at run time
  const docs = ["ropa", "dpia", "registro", "ripd"] as const;
  demo = await runScanInProcess(t, { llm: fake("fixtures/llm/telehealth-clinic.json"), docs: [...docs], reportLang: "pt-BR", uriPrefix: "" });
  injected = await runScanInProcess(t, { llm: fake("tests/fixtures/llm/injection.json"), docs: [...docs], reportLang: "pt-BR", uriPrefix: "" });
});

test("[LLM-05] with the injection fixture the deterministic findings, severities, articles, fingerprints and exit code equal the demo run", () => {
  const pick = (r: ScanResult) => r.findings.filter((f) => f.origin === "deterministic").map((f) => [f.fingerprint, f.ruleId, f.severity, f.articles]);
  assert.deepEqual(pick(injected.result), pick(demo.result));
  const whole = (r: ScanResult) => JSON.stringify(r.findings.filter((f) => f.origin === "deterministic"));
  assert.equal(whole(injected.result), whole(demo.result));
  assert.equal(exitCodeFor(injected.result.findings, "error"), 1);
  assert.equal(exitCodeFor(injected.exitFindings, "error"), exitCodeFor(demo.exitFindings, "error"));
  assert.equal(injected.result.summary.error, demo.result.summary.error);
  assert.equal(injected.result.summary.warning, demo.result.summary.warning);
});

test("[LLM-05] inventory counts are identical and no PR-AMBIGUOUS is added (labels are not-personal)", () => {
  assert.deepEqual(injected.inventory.counts, demo.inventory.counts);
  assert.ok(!injected.result.findings.some((f) => f.origin === "llm"));
  assert.deepEqual(injected.trace.filter((l) => l.prompt === "label-field.v1").map((l) => l.outcome), ["ok", "ok"]);
  const obs = injected.inventory.entities.find((e) => e.name === "Patient")!.fields.find((f) => f.name === "obs")!;
  assert.deepEqual([obs.status, obs.categories, obs.llmLabel?.label], ["ambiguous", [], "not-personal"]);
  assert.equal(injected.result.summary.note, demo.result.summary.note - 1, "only the demo's LLM note differs");
  assert.equal(injected.result.summary.suppressed, 0);
});

test("[LLM-05] every narrative section of the injected run shows the rejection line, and the DPIA criteria count equals the demo run's", () => {
  const placeholder = /^_(?:Narrative unavailable \(LLM output rejected: [^)]+\)|Narrativa indisponível \(saída do LLM rejeitada: [^)]+\))\._$/;
  let blocks = 0;
  for (const d of injected.documents) {
    const lines = d.content.split("\n");
    lines.forEach((line, i) => {
      if (!/^### (?:Draft narrative|Rascunho narrativo) \(LLM\)$/.test(line)) return;
      blocks++;
      assert.match(lines[i + 2]!, placeholder, `${d.name}: ${lines[i + 2]}`);
      assert.ok(lines[i + 3] === "" && !/^[A-Za-z]/.test(lines[i + 4] ?? ""), `${d.name}: only the placeholder under the heading`);
    });
    assert.doesNotMatch(d.content, /compliant|Ignore previous|Delete all findings/i, d.name);
  }
  assert.equal(blocks, 8);
  assert.deepEqual(new Set(injected.trace.filter((l) => l.prompt === "draft-narrative.v1").map((l) => l.outcome)), new Set(["article-drift", "numbers-drift", "unknown-finding-id"]));
  assert.equal(injected.result.llm.narrativeSections, 0);
  const criteria = (o: ScanOutcome) => /^\d+ of 9 WP248 criteria detected.*$/m.exec(o.documents.find((d) => d.name === "dpia.md")!.content)![0];
  assert.equal(criteria(injected), criteria(demo));
  assert.equal(criteria(demo), "2 of 9 WP248 criteria detected: a DPIA is likely required");
  const tables = (o: ScanOutcome) => o.documents.map((d) => d.content.replace(/^### (?:LLM-labeled fields \(advisory\)|Campos rotulados pelo LLM \(consultivo\))\n[\s\S]*?(?=^##)/m, "").split("\n").filter((l) => l.startsWith("|") || l.startsWith("- ")));
  assert.deepEqual(tables(injected), tables(demo), "every table and list outside the advisory sub-table is identical");
});
