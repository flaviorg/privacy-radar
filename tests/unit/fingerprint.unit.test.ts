import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprint, normalizeLine } from "../../src/engine/fingerprint.ts";
import { compareFindings, finalizeFindings } from "../../src/engine/finalize.ts";
import { applyRules, type RawFinding } from "../../src/engine/rules/index.ts";
import type { ProjectConfig } from "../../src/contracts/config.ts";
import { buildModelFromTexts } from "../helpers/builders.ts";

const TODAY = new Date("2026-10-08T12:00:00.000Z");
const CONFIG: ProjectConfig = { schemaVersion: 1 };

function finalized(text: string, path = "src/a.ts") {
  const model = buildModelFromTexts({ [path]: text });
  return finalizeFindings(applyRules(model), { maskedLines: model.maskedLines, minConfidence: model.minConfidence, config: CONFIG, today: TODAY });
}
const fpOf = (text: string, rule = "PR-LOG") => finalized(text).find((f) => f.ruleId === rule)!.fingerprint;

test("fingerprint is the first 32 hex chars of SHA-256 over rule, categories, file, normalized masked line and occurrence", () => {
  const fp = fingerprint({ ruleId: "PR-LOG", categories: ["identifier.cpf"], file: "src/a.ts", maskedLine: "  console.log(patient.cpf);  ", occurrence: 0 });
  assert.match(fp, /^[0-9a-f]{32}$/);
  assert.equal(fp, fingerprint({ ruleId: "PR-LOG", categories: ["identifier.cpf"], file: "src/a.ts", maskedLine: "console.log(patient.cpf);", occurrence: 0 }));
  assert.notEqual(fp, fingerprint({ ruleId: "PR-LOG", categories: ["identifier.cpf"], file: "src/a.ts", maskedLine: "console.log(patient.cpf);", occurrence: 1 }));
  assert.equal(normalizeLine("  a \t  b  "), "a b");
});

test("[OUT-03] the fingerprint is stable across runs and across unrelated lines inserted above", () => {
  const a = fpOf("const x = 1;\nconsole.log(patient.cpf);\n");
  const b = fpOf("// new line\nconst x = 1;\nconsole.log(patient.cpf);\n");
  assert.equal(a, b);
  assert.equal(a, fpOf("const x = 1;\nconsole.log(patient.cpf);\n"));
});

test("[OUT-03] the fingerprint changes when the finding's own line text changes", () => {
  assert.notEqual(fpOf("console.log(patient.cpf);\n"), fpOf("console.info(patient.cpf);\n"));
});

test("[OUT-03] two lines that differ only in the CPF digits give the same fingerprint (masked line)", () => {
  // two synthetic checksum-valid CPFs; masking keeps only the last two digits, which they share
  const one = finalized('export const seed = { cpf: "371.604.228-56" };\n').find((f) => f.ruleId === "PR-HARDCODED-VALUE")!;
  const two = finalized('export const seed = { cpf: "371.604.732-56" };\n').find((f) => f.ruleId === "PR-HARDCODED-VALUE")!;
  assert.equal(one.fingerprint, two.fingerprint);
  assert.equal(one.location.snippet, two.location.snippet);
  assert.doesNotMatch(one.location.snippet, /371|228|732/);
  // any other CPF ending in the same two digits masks to the same line
  const three = finalized('export const seed = { cpf: "245.452.155-56" };\n').find((f) => f.ruleId === "PR-HARDCODED-VALUE")!;
  assert.equal(three.fingerprint, one.fingerprint);
});

test("identical findings on identical lines get distinct occurrence indexes and fingerprints", () => {
  const f = finalized("console.log(patient.cpf);\nconsole.log(patient.cpf);\n").filter((x) => x.ruleId === "PR-LOG");
  assert.equal(f.length, 2);
  assert.notEqual(f[0]!.fingerprint, f[1]!.fingerprint);
  assert.equal(f[0]!.id, `PRF-${f[0]!.fingerprint.slice(0, 12)}`);
});

test("[ENG-03] a finding below --min-confidence is kept with belowThreshold true", () => {
  const f = finalized("console.log(rg);\n").find((x) => x.ruleId === "PR-LOG")!;
  assert.deepEqual([f.confidence, f.belowThreshold], [0.35, true]);
  assert.equal(finalized("console.log(patient.cpf);\n").find((x) => x.ruleId === "PR-LOG")!.belowThreshold, false);
});

const raw = (over: Partial<RawFinding>): RawFinding => ({
  ruleId: "PR-LOG",
  origin: "deterministic",
  categories: ["identifier.cpf"],
  sensitivity: "personal",
  severity: "warning",
  confidence: 0.6,
  confidenceLevel: "medium",
  location: { file: "src/a.ts", line: 1, column: 1, snippet: "" },
  evidence: [],
  articles: { lgpd: [], gdpr: [] },
  message: "m.",
  ...over,
});

test("finalizeFindings orders by severity, file, line, column and rule", () => {
  const input = [
    raw({ severity: "note", location: { file: "a.ts", line: 1, column: 1, snippet: "" } }),
    raw({ ruleId: "PR-TRANSFER", location: { file: "b.ts", line: 2, column: 5, snippet: "" } }),
    raw({ ruleId: "PR-ANALYTICS", location: { file: "b.ts", line: 2, column: 5, snippet: "" } }),
    raw({ location: { file: "b.ts", line: 2, column: 1, snippet: "" } }),
    raw({ location: { file: "b.ts", line: 1, column: 9, snippet: "" } }),
    raw({ location: { file: "a.ts", line: 9, column: 1, snippet: "" } }),
    raw({ severity: "error", location: { file: "z.ts", line: 1, column: 1, snippet: "" } }),
  ];
  const out = finalizeFindings(input, { maskedLines: new Map(), minConfidence: 0.5, config: CONFIG, today: TODAY });
  assert.deepEqual(out.map((f) => [f.severity, f.location.file, f.location.line, f.location.column, f.ruleId]), [
    ["error", "z.ts", 1, 1, "PR-LOG"],
    ["warning", "a.ts", 9, 1, "PR-LOG"],
    ["warning", "b.ts", 1, 9, "PR-LOG"],
    ["warning", "b.ts", 2, 1, "PR-LOG"],
    ["warning", "b.ts", 2, 5, "PR-ANALYTICS"],
    ["warning", "b.ts", 2, 5, "PR-TRANSFER"],
    ["note", "a.ts", 1, 1, "PR-LOG"],
  ]);
  assert.ok(compareFindings(out[0]!, out[1]!) < 0);
  // the order does not depend on the input order
  const again = finalizeFindings([...input].reverse(), { maskedLines: new Map(), minConfidence: 0.5, config: CONFIG, today: TODAY });
  assert.deepEqual(again, out);
});
