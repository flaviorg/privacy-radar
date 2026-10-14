import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadCatalog } from "../../src/catalog/load.ts";
import { LIMITS } from "../../src/contracts/limits.ts";
import { PROJECT_ROOT } from "../../src/infra/paths.ts";
import {
  evalClassifier,
  evalLabeler,
  isRowAmbiguous,
  loadAmbiguousRows,
  loadFieldRows,
  modelSlug,
  renderClassifierTable,
  renderLabelerTable,
  type FieldRow,
} from "../../scripts/eval.ts";
import { createFakeProvider } from "../../src/llm/fake-provider.ts";
import { createPrompts } from "../../src/prompts/index.ts";
import { assertGolden, replaceMarkedBlock } from "../helpers/golden.ts";

const catalog = loadCatalog();
const rows = loadFieldRows(join(PROJECT_ROOT, "evals", "field-names.jsonl"));

test("[EVAL-03] the dataset has at least 200 rows, 50 per language, 60 hard negatives, unique ids and catalog labels", () => {
  assert.ok(rows.length >= LIMITS.evalFieldRowsMin, `${rows.length} rows`);
  for (const lang of ["en", "pt", "es"] as const) {
    assert.ok(rows.filter((r) => r.lang === lang).length >= LIMITS.evalFieldRowsPerLang, lang);
  }
  assert.ok(rows.filter((r) => r.expected === "not-personal").length >= LIMITS.evalHardNegativesMin);
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, "unique ids");
  for (const r of rows) assert.ok(r.expected === "not-personal" || catalog.categoryById.has(r.expected), `${r.id}: ${r.expected}`);
  assert.ok(rows.some((r) => r.entity === "Server" && r.field === "address" && r.expected === "not-personal"));
  assert.ok(rows.some((r) => r.entity === "Company" && r.field === "name" && r.expected === "not-personal"));
});

test("[EVAL-03] the per-group table equals tests/golden/evals/classifier.md", () => {
  const table = renderClassifierTable(evalClassifier(rows, catalog, 0.5), { date: "2026-10-08", catalogCheckedOn: catalog.adequacy.checkedOn });
  assertGolden("evals/classifier.md", table);
  if (process.env.UPDATE_GOLDEN === "1") replaceMarkedBlock(join(PROJECT_ROOT, "README.md"), "classifier", table);
  assert.ok(table.split("\n").every((line) => line.length <= 100), "every table line fits the README block");
});

test("[EVAL-03] precision and recall are computed as TP/(TP+FP) and TP/(TP+FN) on a three-row toy set", () => {
  const toy: FieldRow[] = [
    { id: "t-1", lang: "en", entity: "User", field: "email", rawType: "String", expected: "contact.email" },
    { id: "t-2", lang: "en", entity: "Customer", field: "phone", rawType: "String", expected: "contact.phone" },
    { id: "t-3", lang: "en", entity: "Server", field: "address", rawType: "String", expected: "not-personal" },
  ];
  const r = evalClassifier(toy, catalog, 0.5);
  assert.equal(r.rows, 3);
  const contact = r.groups.find((g) => g.group === "contact")!;
  // email and phone are both predicted in the group "contact": 2 TP; Server.address is predicted "contact.address"? It is not: the entity penalty drops it below 0.50
  assert.deepEqual([contact.tp, contact.fp, contact.fn], [2, 0, 0]);
  assert.equal(contact.precision, 1);
  assert.equal(contact.recall, 1);
  const none = r.groups.find((g) => g.group === "not-personal")!;
  assert.deepEqual([none.tp, none.fp, none.fn], [1, 0, 0]);
  // a threshold above every confidence turns every prediction into not-personal: contact loses all recall
  const strict = evalClassifier(toy, catalog, 0.99);
  const contactStrict = strict.groups.find((g) => g.group === "contact")!;
  assert.deepEqual([contactStrict.tp, contactStrict.fp, contactStrict.fn], [0, 0, 2]);
  assert.equal(contactStrict.precision, null);
  assert.equal(contactStrict.recall, 0);
  const noneStrict = strict.groups.find((g) => g.group === "not-personal")!;
  assert.deepEqual([noneStrict.tp, noneStrict.fp, noneStrict.fn], [1, 2, 0]);
  assert.equal(noneStrict.precision, 1 / 3);
});

test("the overall line sums the personal groups only (not-personal is the negative class)", () => {
  const r = evalClassifier(rows, catalog, 0.5);
  const personal = r.groups.filter((g) => g.group !== "not-personal");
  assert.equal(r.overall.tp, personal.reduce((s, g) => s + g.tp, 0));
  assert.equal(r.overall.fp, personal.reduce((s, g) => s + g.fp, 0));
  assert.equal(r.overall.fn, personal.reduce((s, g) => s + g.fn, 0));
  assert.equal(r.rows, rows.length);
  assert.equal(r.groups.reduce((s, g) => s + g.tp + g.fn, 0), rows.length);
});

test("loadFieldRows rejects a row with an unknown key or a missing field", () => {
  assert.throws(() => loadFieldRows(join(PROJECT_ROOT, "tests", "fixtures", "config", "valid.json")));
});

const prompts = createPrompts(catalog.categories.map((c) => c.id));
const ambiguousRows = loadAmbiguousRows(join(PROJECT_ROOT, "evals", "ambiguous-fields.jsonl"));
const fakeFor = (rel: string) => createFakeProvider({ fixturePath: join(PROJECT_ROOT, rel), prompts: prompts.all })!;

test("[EVAL-01] eval:fake reports exactly the planted rates", async () => {
  const fake = fakeFor("evals/ambiguous-fields.fake.json");
  const r = await evalLabeler(ambiguousRows, fake, prompts.label, { redact: (s) => s });
  assert.equal(r.rows, ambiguousRows.length);
  assert.equal(r.accuracy, (r.rows - 4) / r.rows);
  assert.equal(r.evidenceMismatch, 1 / r.rows);
  assert.equal(r.numbersDrift, null);
  fake.assertAllConsumed();
});

test("[EVAL-01] the dataset has at least 24 rows with unique ids and labels from the catalog enum, not-personal or unknown", () => {
  assert.ok(ambiguousRows.length >= LIMITS.evalAmbiguousRowsMin, `${ambiguousRows.length} rows`);
  assert.equal(new Set(ambiguousRows.map((r) => r.id)).size, ambiguousRows.length);
  for (const r of ambiguousRows) assert.ok(r.expected === "not-personal" || r.expected === "unknown" || catalog.categoryById.has(r.expected), `${r.id}: ${r.expected}`);
  assert.ok(ambiguousRows.some((r) => r.expected === "not-personal") && ambiguousRows.some((r) => r.expected === "unknown"));
});

test("[EVAL-01] every row is a field the engine marks ambiguous", () => {
  for (const r of ambiguousRows) assert.ok(isRowAmbiguous(r, catalog), r.id);
});

test("[EVAL-01] the labeler table names the model, the base URL host, the date, temperature 0, the metrics and the row count", () => {
  const t = renderLabelerTable({ rows: 26, accuracy: 22 / 26, evidenceMismatch: 1 / 26, numbersDrift: null }, { model: "fake-scripted", baseUrlHost: "none (scripted fake)", date: "2026-10-08" });
  for (const s of ["fake-scripted", "none (scripted fake)", "2026-10-08", "temperature: 0", "| Accuracy | 0.85 |", "| Evidence mismatch | 0.04 |", "| Numbers drift | n/a |", "26 rows"]) assert.ok(t.includes(s), s);
  assert.ok(t.split("\n").every((l) => l.length <= 100));
  assert.equal(modelSlug("openai/gpt-4o-mini:free"), "openai-gpt-4o-mini-free");
});
