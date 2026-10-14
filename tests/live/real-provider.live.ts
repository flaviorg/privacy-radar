// Live check against a real OpenAI-compatible provider (spec 7.4, LLM-10). Skipped without
// LLM_API_KEY; with it, asserts structure only (the model's quality is the job of eval:live).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveLlm } from "../../src/app/llm.ts";
import { ambiguousFields } from "../../src/engine/ambiguous.ts";
import { loadEnv } from "../../src/infra/config.ts";
import { createRedactor } from "../../src/infra/redact.ts";
import { draftNarrative, labelAmbiguousField } from "../../src/llm/tasks.ts";
import { createTrace } from "../../src/llm/trace.ts";
import { createPrompts } from "../../src/prompts/index.ts";
import { evidenceMatches, fieldContext } from "../../src/shared/text.ts";
import { buildModelFromTexts, testCatalog } from "../helpers/builders.ts";
import { PROJECT_ROOT_FOR_TESTS } from "../helpers/child-node-args.ts";

const KEY = process.env.LLM_API_KEY;

test("[LLM-10] the real provider labels obs and extra and drafts one narrative section (structure only)", { skip: KEY ? false : "skipped: no LLM_API_KEY" }, async () => {
  const env = loadEnv({ ...process.env, LLM_PROVIDER: "openai-compatible" });
  const catalog = testCatalog();
  const prompts = createPrompts(catalog.categories.map((c) => c.id));
  const redact = createRedactor(env.LLM_API_KEY);
  const { provider } = resolveLlm({ choice: "openai-compatible", fixturePath: null, env, prompts, redact });
  assert.ok(provider);
  const read = (rel: string) => readFileSync(join(PROJECT_ROOT_FOR_TESTS, "fixtures", "telehealth-clinic", rel), "utf8");
  const model = buildModelFromTexts({ "prisma/schema.prisma": read("prisma/schema.prisma"), "migrations/001_init.sql": read("migrations/001_init.sql") });
  const fields = ambiguousFields(model).filter((f) => ["obs", "extra"].includes(f.field));
  assert.equal(fields.length, 2);
  const trace = createTrace();
  const allowed = new Set([...catalog.categories.map((c) => c.id), "not-personal", "unknown"]);
  for (const field of fields) {
    const label = await labelAmbiguousField(provider, prompts.label, field, { trace, redact });
    if (label !== null) {
      assert.ok(allowed.has(label.label), label.label);
      assert.ok(evidenceMatches(label.evidence, fieldContext({ declarationText: field.input.field.declarationText, comment: field.input.comment, entityFields: field.input.field.entityFields })));
    }
  }
  const narrative = await draftNarrative(provider, prompts.narrative, prompts.narrative.sampleInput, new Set(), { trace, redact });
  if ("paragraphs" in narrative) assert.ok(narrative.paragraphs.length >= 1 && narrative.paragraphs.length <= 4);
  else assert.match(narrative.placeholder, /^_Narrative unavailable \(LLM output rejected: .+\)\._$/);
  assert.equal(trace.lines().length, 3);
  assert.ok(!JSON.stringify(trace.lines()).includes(env.LLM_API_KEY ?? "no key"));
});
