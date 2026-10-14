import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DraftNarrativeInput, DraftNarrativeOutput } from "../../src/contracts/llm.ts";
import { checkNarrative, expandCitation, extractCitations, SPELLED_OUT } from "../../src/llm/narrative-checks.ts";
import { PROJECT_ROOT_FOR_TESTS } from "../helpers/child-node-args.ts";

const expand = expandCitation;

const FORMS: [string, string[]][] = [
  ["art. 5", ["5"]],
  ["Articles 9 and 10", ["9", "10"]],
  ["arts. 5 and 9", ["5", "9"]],
  ["artigos 5 e 9", ["5", "9"]],
  ["Arts. 44 to 49", ["44", "45", "46", "47", "48", "49"]],
  ["articles 44-49", ["44", "45", "46", "47", "48", "49"]],
  ["LGPD 11 and GDPR 9", ["11", "9"]],
  ["§ 1", ["1"]],
  ["artigo nº 46", ["46"]],
  ["considerando 75", ["75"]],
  ["Art. 30(1)(c)", ["30(1)(c)"]],
  ["arts. 44–46", ["44", "45", "46"]],
];
for (const [s, nums] of FORMS) {
  test(`[DOC-05] citation form "${s}" extracts ${nums.join(",")}`, () => assert.deepEqual(extractCitations(s).flatMap(expand), nums));
}
for (const s of ["the 3 entities", "smart 5 devices", "partner 9", "a startup with 7 apps"]) {
  test(`[DOC-05] "${s}" is not a citation`, () => assert.deepEqual(extractCitations(s), []));
}

test("[DOC-05] the regime of a citation comes from an LGPD, GDPR or RGPD prefix", () => {
  assert.deepEqual(extractCitations("LGPD 11 and GDPR 9 and RGPD 32").map((c) => c.regime), ["lgpd", "gdpr", "gdpr"]);
  assert.deepEqual(extractCitations("art. 46").map((c) => c.regime), [null]);
  assert.deepEqual(extractCitations("recital 38").map((c) => c.recital), [true]);
});

const input = (allowed: { lgpd: string[]; gdpr: string[] }, counts: Partial<DraftNarrativeInput["facts"]["counts"]> = {}): DraftNarrativeInput => ({
  document: "ropa",
  section: "purposes",
  language: "en",
  facts: {
    controller: "Clinic",
    entities: [{ name: "Patient", categories: ["special.health"], sensitiveCount: 3, retentionSignal: null }],
    sinks: [],
    transfers: [],
    counts: { error: 5, warning: 10, note: 3, entities: 3, fields: 24, vendors: 2, ...counts },
    allowedArticles: allowed,
  },
});
const out = (text: string, ids: string[] = []): DraftNarrativeOutput => ({ paragraphs: [text], citedFindingIds: ids });
const ALLOWED = { lgpd: ["6 VII", "46", "33 II", "11"], gdpr: ["5(1)(f)", "32", "30(1)", "recital 38", "44", "45", "46"] };
const none = new Set<string>();

test("[DOC-05] numbers from the facts and allowed citations pass", () => {
  assert.deepEqual(checkNarrative(out("The scan found 3 entities and 24 fields; see art. 46 and art. 33 and GDPR 32 and recital 38."), input(ALLOWED), none), { ok: true });
  assert.deepEqual(checkNarrative(out("Arts. 44 to 46 apply to the 2 vendors; Art. 30(1)(c) and art. 5(1)(f) too."), input(ALLOWED), none), { ok: true });
});

test("[DOC-05] a structural prefix in either direction is allowed: 5 names 5(1)(f), 30(1)(c) names 30(1)", () => {
  assert.deepEqual(checkNarrative(out("There are 5 errors under art. 5 of the regulation."), input(ALLOWED), none), { ok: true });
});

test("[DOC-05] a cited article outside the section list is article-drift even when the facts hold the same number", () => {
  const NARROW = { lgpd: ["6 VII", "46", "33 II", "11"], gdpr: ["32", "30(1)", "recital 38", "44", "45", "46"] };
  assert.deepEqual(checkNarrative(out("There are 5 errors under art. 5 of the regulation."), input(NARROW), none), { ok: false, reason: "article-drift" });
  for (const text of ["Articles 9 and 10 apply here, says the summary.", "arts. 5 and 9 apply here, says the summary.", "artigos 5 e 9 se aplicam aqui, diz o texto.", "Arts. 44 to 49 apply to the transfers here.", "LGPD 11 and GDPR 9 apply to the health data.", "Under § 1 the controller must act on this.", "LGPD 46 and GDPR 6 apply to the processing."]) {
    assert.deepEqual(checkNarrative(out(text), input(NARROW, { error: 9, warning: 10, note: 5, entities: 44, fields: 49, vendors: 1 }), none), { ok: false, reason: "article-drift" }, text);
  }
});

test("[DOC-05] a number absent from the facts is numbers-drift; a spelled-out number too", () => {
  assert.deepEqual(checkNarrative(out("The clinic shares data with 7 vendors in total."), input(ALLOWED), none), { ok: false, reason: "numbers-drift" });
  assert.deepEqual(checkNarrative(out("The clinic stores three entities with personal data."), input(ALLOWED), none), { ok: false, reason: "numbers-drift" });
  assert.deepEqual(checkNarrative(out("A clínica guarda dezenas de campos com dados pessoais."), input(ALLOWED), none), { ok: false, reason: "numbers-drift" });
  assert.ok(SPELLED_OUT.includes("twelve") && SPELLED_OUT.includes("doze") && SPELLED_OUT.includes("hundreds") && SPELLED_OUT.includes("centenas"));
  assert.deepEqual(checkNarrative(out("Its network of partners was reviewed twice."), input(ALLOWED), none), { ok: true });
});

test("[DOC-05] an unknown cited finding id is rejected first", () => {
  assert.deepEqual(checkNarrative(out("Finding PRF-0123456789ab cites art. 5 with 99 fields.", ["PRF-0123456789ab"]), input(ALLOWED), none), { ok: false, reason: "unknown-finding-id" });
  const known = new Set(["PRF-0123456789ab"]);
  assert.deepEqual(checkNarrative(out("Finding PRF-0123456789ab covers the 3 entities.", ["PRF-0123456789ab"]), input(ALLOWED), known), { ok: true });
});

test("[DOC-05] every narrative turn of article-drift.json and numbers-drift.json is rejected with its planned reason", () => {
  const load = (name: string) =>
    (JSON.parse(readFileSync(join(PROJECT_ROOT_FOR_TESTS, "tests", "fixtures", "llm", name), "utf8")) as { turns: { id: string; prompt: string; output: DraftNarrativeOutput }[] }).turns.filter((t) => t.prompt === "draft-narrative.v1");
  const facts = input({ lgpd: ["6 VII", "46"], gdpr: ["32"] }, { error: 5, warning: 10, note: 9, entities: 44, fields: 49, vendors: 1 });
  const cite = load("article-drift.json");
  assert.equal(cite.length, 8);
  assert.deepEqual(cite.map((t) => checkNarrative(t.output, facts, none)), [...Array(7).fill({ ok: false, reason: "article-drift" }), { ok: false, reason: "numbers-drift" }]);
  const numbers = load("numbers-drift.json");
  assert.equal(numbers.length, 8);
  for (const t of numbers) assert.deepEqual(checkNarrative(t.output, facts, none), { ok: false, reason: "numbers-drift" }, t.id);
});
