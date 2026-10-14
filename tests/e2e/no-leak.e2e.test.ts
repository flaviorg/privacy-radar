import { before, test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ScanOutcome } from "../../src/app/scan.ts";
import { resolveLlm } from "../../src/app/llm.ts";
import { loadCatalog } from "../../src/catalog/load.ts";
import { loadEnv } from "../../src/infra/config.ts";
import { createPrompts } from "../../src/prompts/index.ts";
import { ALL_FIXTURE_SECRETS, FIXTURE_ADDRESS, FIXTURE_EMAILS, FIXTURE_IDENTIFIERS, FIXTURE_NAMES } from "../helpers/fixture-values.ts";
import { runCli } from "../helpers/run-cli.ts";
import { runScanInProcess } from "../helpers/run-scan.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import { makeDemoRepo } from "../helpers/git-repo.ts";

const FIXTURE = "fixtures/telehealth-clinic";
let outcome: ScanOutcome & { outDir: string };
let outDir: string;
let jsonCapture: string;
let logCapture: string;
let tableCapture: string;
let fakeOut: string;
let fakeCapture: string;

before(async (hook) => {
  const t = hook as TestContext; // a hook receives a TestContext at run time
  outcome = await runScanInProcess(t);
  outDir = tmpDir(t);
  const all = await runCli(["scan", FIXTURE, "--llm", "none", "--format", "table,json,sarif,md", "--docs", "all", "--report-lang", "en", "--json", "--out", outDir], { env: { LOG_LEVEL: "debug" } });
  assert.equal(all.code, 1, all.stderr);
  jsonCapture = all.stdout;
  logCapture = all.stderr;
  const table = await runCli(["scan", FIXTURE, "--llm", "none", "--format", "table", "--out", tmpDir(t)], { env: { LOG_LEVEL: "debug" } });
  tableCapture = table.stdout;
  logCapture += table.stderr;
  fakeOut = tmpDir(t);
  const fake = await runCli(["scan", FIXTURE, "--llm", "fake", "--llm-fixture", "fixtures/llm/telehealth-clinic.json", "--format", "table,json,sarif,md", "--docs", "all", "--report-lang", "pt-BR", "--out", fakeOut], { env: { LOG_LEVEL: "debug" } });
  assert.equal(fake.code, 1, fake.stderr);
  fakeCapture = fake.stdout;
  logCapture += fake.stderr;
});

const kindOf = (value: string) => [...FIXTURE_IDENTIFIERS, ...FIXTURE_EMAILS, ...FIXTURE_NAMES, ...FIXTURE_ADDRESS].find((v) => v.raw === value || v.raw.replace(/[^0-9A-Za-z]/g, "") === value)?.kind ?? "value";

test("[OUT-06] the 14 fixture identifiers are detected at the files and lines of spec 5.10, masked", () => {
  const hits = outcome.inventory.valueHits;
  for (const id of FIXTURE_IDENTIFIERS) {
    assert.ok(hits.some((h) => h.file === id.file && h.line === id.line && h.checksum === "valid"), `${id.kind} ${id.file}:${id.line}`);
  }
  assert.equal(hits.filter((h) => h.checksum === "valid").length, 14);
  assert.equal(hits.length, 16, "14 checksum-valid identifiers and 2 e-mails");
  for (const e of FIXTURE_EMAILS) assert.ok(hits.some((h) => h.file === e.file && h.line === e.line && h.categories.includes("contact.email")), e.raw);
});

test("[OUT-06] no artifact contains a fixture identifier, e-mail, name or address", () => {
  const files = readdirSync(outDir).sort();
  assert.deepEqual(files, ["dpia.md", "findings.json", "findings.sarif", "inventory.json", "inventory.md", "registro.md", "ripd.md", "ropa.md"]);
  const texts = [
    ...files.map((f) => readFileSync(join(outDir, f), "utf8")),
    ...readdirSync(outcome.outDir).map((f) => readFileSync(join(outcome.outDir, f), "utf8")),
    tableCapture,
    jsonCapture,
    fakeCapture,
    ...readdirSync(fakeOut).map((f) => readFileSync(join(fakeOut, f), "utf8")),
    logCapture,
    JSON.stringify(outcome.result),
    JSON.stringify(outcome.inventory),
    JSON.stringify(outcome.sarif),
  ];
  assert.ok(logCapture.includes('"event":"scan.file"'), "the debug log was captured");
  assert.ok(logCapture.includes('"event":"llm.call"'), "the LLM debug log was captured");
  assert.deepEqual(readdirSync(fakeOut).sort(), ["dpia.md", "findings.json", "findings.sarif", "inventory.json", "inventory.md", "llm-trace.jsonl", "registro.pt-BR.md", "ripd.pt-BR.md", "ropa.md"]);
  for (const v of ALL_FIXTURE_SECRETS) for (const text of texts) assert.ok(!text.includes(v), `leak of a ${kindOf(v)}`);
});

test("[OUT-06] a literal bound to a classified name is masked in snippets, messages and evidence", () => {
  const text = JSON.stringify(outcome.result.findings);
  for (const raw of ["Joana", "Prates", "Voorbeeld", "Amostras", "Lisboa", "example.invalid"]) {
    if (raw === "example.invalid") continue; // the unknown vendor host sms.example-vendor.invalid is a URL host, not an e-mail
    assert.ok(!text.includes(raw), raw);
  }
  assert.ok(!/@example\.invalid/.test(`${text}${jsonCapture}${tableCapture}`), "e-mail domains are masked except the TLD");
});

test("[OUT-06] the first PR-HARDCODED-VALUE of server.ts counts 9 qualifying hits and 001_init.sql counts 6", () => {
  const pick = (file: string) => outcome.result.findings.find((f) => f.ruleId === "PR-HARDCODED-VALUE" && f.location.file === file)!;
  assert.match(pick("src/server.ts").message, /^9 hard-coded personal values /);
  assert.match(pick("migrations/001_init.sql").message, /^6 hard-coded personal values /);
  assert.equal(pick("src/server.ts").evidence.length, 9);
  assert.equal(pick("migrations/001_init.sql").evidence.length, 6);
});

test("[OUT-06] the prompt-injection comment of server.ts is not echoed into any finding or log", () => {
  const isDoc = (f: string) => /^(?:ropa|dpia|registro|ripd)\./.test(f);
  const docNames = new Set([...readdirSync(fakeOut).filter(isDoc), ...readdirSync(outDir).filter(isDoc)]);
  assert.equal(docNames.size, 6, "the six document files of both locales");
  const docs = [...readdirSync(fakeOut).filter(isDoc).map((f) => join(fakeOut, f)), ...readdirSync(outDir).filter(isDoc).map((f) => join(outDir, f))].map((p) => readFileSync(p, "utf8"));
  for (const text of [JSON.stringify(outcome.result), logCapture, tableCapture, fakeCapture, readFileSync(join(fakeOut, "llm-trace.jsonl"), "utf8"), ...docs]) assert.ok(!/ignore previous instructions/i.test(text));
});

test("[OUT-06] no fixture value reaches a message sent to the LLM", async (t) => {
  const prompts = createPrompts(loadCatalog().categories.map((c) => c.id));
  const setup = resolveLlm({ choice: "fake", fixturePath: "fixtures/llm/telehealth-clinic.json", env: loadEnv({}), prompts, redact: (s) => s });
  const sent: string[] = [];
  const inner = setup.provider!;
  const spy = { name: inner.name, complete: (call: Parameters<typeof inner.complete>[0]) => (sent.push(...call.messages.map((m) => m.content)), inner.complete(call)) };
  await runScanInProcess(t, { llm: { ...setup, provider: spy }, docs: ["ropa", "dpia", "registro", "ripd"], reportLang: "pt-BR", uriPrefix: "" });
  assert.equal(sent.length, 22, "system and user message for obs, extra, 8 narrative sections and 1 repair");
  for (const v of ALL_FIXTURE_SECRETS) for (const text of sent) assert.ok(!text.includes(v), `leak of a ${kindOf(v)} to the LLM`);
  for (const text of sent) assert.ok(!/ignore previous instructions/i.test(text));
});

test("[OUT-06] the PR comment and the PR artifacts of the demo pair contain no fixture value", async (t) => {
  const demo = makeDemoRepo(t);
  const out = tmpDir(t);
  const r = await runCli(["pr", "--base", demo.shaBase, "--head", demo.shaHead, "--repo", demo.repo.dir, "--format", "md,json,sarif", "--out", out], { env: { LOG_LEVEL: "debug" } });
  assert.equal(r.code, 1, r.stderr);
  const texts = [r.stdout, r.stderr, ...readdirSync(out).map((f) => readFileSync(join(out, f), "utf8"))];
  assert.ok(readdirSync(out).includes("pr-comment.md"));
  assert.ok(r.stderr.includes('"event":"pr.diff"'), "the PR log was captured");
  for (const v of ALL_FIXTURE_SECRETS) for (const text of texts) assert.ok(!text.includes(v), `leak of a ${kindOf(v)} in PR mode`);
  for (const text of texts) assert.ok(!/ignore previous instructions/i.test(text));
});
