import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog } from "../../src/catalog/load.ts";
import { findingSchema } from "../../src/contracts/findings.ts";
import type { ValueHit } from "../../src/contracts/source-model.ts";
import { classifyField } from "../../src/engine/classify-field.ts";
import { fieldConfidence, findingConfidence, isTestPath, levelOf, valueHitConfidence, WEIGHTS } from "../../src/engine/confidence.ts";
import { ent, field } from "../helpers/builders.ts";

test("field confidence sums evidence weights, clamps to [0, 1] and rounds to two decimals", () => {
  assert.equal(fieldConfidence([{ kind: "field-name", detail: "x", weight: 0.6 }, { kind: "type-hint", detail: "x", weight: WEIGHTS.typeHint }, { kind: "attribute", detail: "x", weight: WEIGHTS.attribute }]), 0.75);
  assert.equal(fieldConfidence([{ kind: "field-name", detail: "x", weight: 0.35 }, { kind: "entity-context", detail: "x", weight: WEIGHTS.entityContext }, { kind: "test-path", detail: "x", weight: WEIGHTS.testPath }]), 0);
  assert.equal(fieldConfidence([{ kind: "field-name", detail: "x", weight: 0.6 }, { kind: "checksum", detail: "x", weight: WEIGHTS.checksumValid }, { kind: "value-pattern", detail: "x", weight: WEIGHTS.valuePattern }]), 1);
  assert.equal(fieldConfidence([]), 0);
});

test("levels: high at 0.80, medium at 0.50, else low", () => {
  assert.deepEqual([0.8, 0.79, 0.5, 0.49, 0].map(levelOf), ["high", "medium", "medium", "low", "low"]);
});

test("[ENG-03] isTestPath matches test folders and .test/.spec files only", () => {
  for (const p of ["test/a.ts", "tests/a.ts", "src/__tests__/a.ts", "spec/a.ts", "fixture/a.sql", "fixtures/a.sql", "mock/a.ts", "mocks/x/a.ts", "src/a.test.ts", "src/a.spec.ts"]) assert.equal(isTestPath(p), true, p);
  for (const p of ["src/a.ts", "contest/a.ts", "src/latest.ts", "testing/a.ts", "src/spec.ts.bak", "src/mocked.ts"]) assert.equal(isTestPath(p), false, p);
});

const hit = (over: Partial<ValueHit>): ValueHit => ({ categories: ["identifier.cpf"], checksum: "valid", corroborated: true, masked: "***", line: 1, column: 1, length: 3, start: 0, end: 3, ...over });

test("[ENG-11] value-hit confidence: 0.90 valid and corroborated, 0.80 e-mail, else 0", () => {
  assert.equal(valueHitConfidence(hit({})), 0.9);
  assert.equal(valueHitConfidence(hit({ categories: ["contact.email"], checksum: "n/a" })), 0.8);
  assert.equal(valueHitConfidence(hit({ checksum: "invalid" })), 0);
  assert.equal(valueHitConfidence(hit({ categories: [], checksum: "n/a", corroborated: false })), 0);
  assert.equal(valueHitConfidence(hit({ categories: ["contact.phone"], checksum: "n/a" })), 0);
});

test("[ENG-11] finding confidence per family: max of contributions, hardcoded test-path penalty, ambiguous capped at 0.79, parse 1.0", () => {
  assert.equal(findingConfidence({ family: "sink", contributions: [0.6, 0.75, 0.5] }), 0.75);
  assert.equal(findingConfidence({ family: "plaintext", contributions: [0.6] }), 0.6);
  assert.equal(findingConfidence({ family: "hardcoded", contributions: [0.9, 0.8] }), 0.9);
  assert.equal(findingConfidence({ family: "hardcoded", contributions: [0.9, 0.8], testPath: true }), 0.7);
  assert.equal(findingConfidence({ family: "sink", contributions: [0.6], testPath: true }), 0.6, "the test-path penalty is already in field confidences");
  assert.equal(findingConfidence({ family: "ambiguous", contributions: [0.95] }), 0.79);
  assert.equal(findingConfidence({ family: "parse", contributions: [] }), 1);
  assert.equal(findingConfidence({ family: "retention", contributions: [] }), 0);
});

test("[ENG-11] the demo's lowest values: PR-RETENTION on Appointment 0.50 and PR-URL-QUERY on nifPt 0.60", () => {
  const catalog = loadCatalog();
  const ctx = { termIndex: catalog.termIndex, categoryById: catalog.categoryById, regime: "both" as const, file: "prisma/schema.prisma", valueHits: [] };
  const appointmentFields = ["id", "patientId", "scheduledAt", "reminderPhone", "extra"];
  const personal = appointmentFields.flatMap((name) => classifyField(field({ name, type: "String" }), ent("Appointment"), ctx).filter((c) => c.sensitivity !== "not-personal"));
  assert.equal(findingConfidence({ family: "retention", contributions: personal.map((c) => c.confidence) }), 0.5);
  const nif = classifyField(field({ name: "nifPt", type: "String" }), ent("Patient"), ctx)[0]!;
  assert.equal(findingConfidence({ family: "sink", contributions: [nif.confidence] }), 0.6);
});

test("findingSchema rejects an extra key and a severity outside the enum", () => {
  const ok = {
    id: "PRF-0123456789ab",
    fingerprint: "0123456789abcdef0123456789abcdef",
    ruleId: "PR-LOG",
    origin: "deterministic",
    categories: ["identifier.cpf"],
    sensitivity: "personal",
    severity: "error",
    confidence: 0.6,
    confidenceLevel: "medium",
    location: { file: "src/a.ts", line: 2, column: 3, snippet: "console.log(patient.cpf);" },
    evidence: [{ kind: "field-name", detail: "exact term", weight: 0.6 }],
    articles: { lgpd: [], gdpr: [] },
    message: "identifier.cpf reaches console.log",
    belowThreshold: false,
  };
  assert.equal(findingSchema.safeParse(ok).success, true);
  assert.equal(findingSchema.safeParse({ ...ok, extra: 1 }).success, false);
  assert.equal(findingSchema.safeParse({ ...ok, severity: "critical" }).success, false);
  assert.equal(findingSchema.safeParse({ ...ok, categories: [] }).success, false);
  assert.equal(findingSchema.safeParse({ ...ok, location: { ...ok.location, snippet: "x".repeat(161) } }).success, false);
});
