import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import * as z from "zod";
import type { Catalog } from "../src/catalog/load.ts";
import { loadCatalog } from "../src/catalog/load.ts";
import { LIMITS } from "../src/contracts/limits.ts";
import type { Field } from "../src/contracts/source-model.ts";
import { classifyField, sensitivityFor } from "../src/engine/classify-field.ts";
import { clockFromEnv, DEMO_CLOCK_ISO, fixedClock } from "../src/infra/clock.ts";
import { PrivacyRadarError, formatCliError } from "../src/infra/errors.ts";
import { PROJECT_ROOT } from "../src/infra/paths.ts";
import { describeIssues } from "../src/infra/zod-issues.ts";
import { normalizeEntityName } from "../src/sources/names.ts";
import { resolveLlm } from "../src/app/llm.ts";
import { NOT_PERSONAL_LABEL, UNKNOWN_LABEL, type AmbiguousField, type LabelFieldInput, type LabelFieldOutput, type PromptSpec } from "../src/contracts/llm.ts";
import { isAmbiguous } from "../src/engine/ambiguous.ts";
import { loadEnv } from "../src/infra/config.ts";
import { createRedactor } from "../src/infra/redact.ts";
import { createFakeProvider } from "../src/llm/fake-provider.ts";
import type { LlmProvider } from "../src/llm/provider.ts";
import { labelAmbiguousField } from "../src/llm/tasks.ts";
import { createTrace } from "../src/llm/trace.ts";
import { createPrompts } from "../src/prompts/index.ts";

export const NOT_PERSONAL = "not-personal";

/** One labeled field of `evals/field-names.jsonl`: `expected` is a catalog category id or `not-personal`. */
export const fieldRowSchema = z
  .object({
    id: z.string().min(1),
    lang: z.enum(["en", "pt", "es"]),
    entity: z.string().min(1),
    field: z.string().min(1),
    rawType: z.string().min(1),
    expected: z.string().min(1),
  })
  .strict();
export type FieldRow = z.infer<typeof fieldRowSchema>;

/** Reads a JSON Lines file of field rows; a bad line is a `CONFIG_INVALID` error naming the line, never its content. */
export function loadFieldRows(path: string): FieldRow[] {
  const rows: FieldRow[] = [];
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (line.trim() === "") return;
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch {
        throw new PrivacyRadarError("CONFIG_INVALID", `${path}:${i + 1}: not valid JSON`);
      }
      const parsed = fieldRowSchema.safeParse(json);
      if (!parsed.success) throw new PrivacyRadarError("CONFIG_INVALID", `${path}:${i + 1}: ${describeIssues(parsed.error)}`);
      rows.push(parsed.data);
    });
  return rows;
}

export type GroupScore = { group: string; tp: number; fp: number; fn: number; precision: number | null; recall: number | null };
export type ClassifierEval = { groups: GroupScore[]; overall: GroupScore; rows: number; minConfidence: number };

const ratio = (num: number, den: number): number | null => (den === 0 ? null : num / den);
const score = (group: string, tp: number, fp: number, fn: number): GroupScore => ({ group, tp, fp, fn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn) });

/**
 * Runs the rows through the deterministic classifier (no provider, no network). A prediction is the
 * group of the top candidate at or above `minConfidence` when its category is personal under both
 * regimes' reading, else `not-personal`; the expected group is the group of the labeled category.
 * Per group: TP when both agree, FP for the predicted group and FN for the expected group when they
 * differ. `overall` sums the personal groups (not-personal is the negative class). The siblings of
 * a field are the other rows of its entity and language (the PT/ES `nif` disambiguation reads them).
 */
export function evalClassifier(rows: readonly FieldRow[], catalog: Catalog, minConfidence: number): ClassifierEval {
  const siblings = new Map<string, string[]>();
  for (const r of rows) {
    const key = `${r.lang}\u0000${r.entity}`;
    siblings.set(key, [...(siblings.get(key) ?? []), r.field]);
  }
  const groupOf = (category: string): string => catalog.categoryById.get(category)?.group ?? NOT_PERSONAL;
  const counts = new Map<string, { tp: number; fp: number; fn: number }>();
  const bump = (group: string) => {
    let c = counts.get(group);
    if (!c) {
      c = { tp: 0, fp: 0, fn: 0 };
      counts.set(group, c);
    }
    return c;
  };
  for (const row of rows) {
    const field: Field = {
      name: row.field,
      rawName: row.field,
      type: row.rawType,
      rawType: row.rawType,
      optional: false,
      array: false,
      loc: { line: 1, column: 1 },
      attributes: [],
      comment: null,
      commentRange: null,
      defaultValue: null,
      defaultRange: null,
      declarationText: "",
    };
    const entity = { name: row.entity, normalizedName: normalizeEntityName(row.entity), fieldNames: siblings.get(`${row.lang}\u0000${row.entity}`) ?? [] };
    const top = classifyField(field, entity, { termIndex: catalog.termIndex, categoryById: catalog.categoryById, regime: "both", file: `src/${row.entity}.ts`, valueHits: [] })[0];
    const personal = top !== undefined && top.confidence >= minConfidence && sensitivityFor(catalog.categoryById.get(top.category)!, "both") !== "not-personal";
    const predicted = personal ? groupOf(top.category) : NOT_PERSONAL;
    const expected = row.expected === NOT_PERSONAL ? NOT_PERSONAL : groupOf(row.expected);
    if (predicted === expected) bump(expected).tp++;
    else {
      bump(predicted).fp++;
      bump(expected).fn++;
    }
  }
  const order = [...catalog.categories.map((c) => c.group), NOT_PERSONAL];
  const names = [...new Set(order)].filter((g) => counts.has(g));
  const groups = names.map((g) => score(g, counts.get(g)!.tp, counts.get(g)!.fp, counts.get(g)!.fn));
  const personalGroups = groups.filter((g) => g.group !== NOT_PERSONAL);
  const overall = score(
    "overall (personal groups)",
    personalGroups.reduce((s, g) => s + g.tp, 0),
    personalGroups.reduce((s, g) => s + g.fp, 0),
    personalGroups.reduce((s, g) => s + g.fn, 0),
  );
  return { groups, overall, rows: rows.length, minConfidence };
}

const fmt = (x: number | null) => (x === null ? "n/a" : x.toFixed(2));

/** The Markdown table of `eval:classifier` and `tests/golden/evals/classifier.md`: two decimals, row counts per group. */
export function renderClassifierTable(r: ClassifierEval, meta: { date: string; catalogCheckedOn: string }): string {
  const lines = [
    "### Deterministic classifier evaluation",
    "",
    `Dataset: \`evals/field-names.jsonl\`, ${r.rows} labeled fields; threshold ${r.minConfidence.toFixed(2)}.`,
    `Run on ${meta.date}; catalog data checked on ${meta.catalogCheckedOn}.`,
    "A prediction is the top candidate at or above the threshold, else `not-personal`;",
    "the score is per category group.",
    "",
    "| Group | Rows | TP | FP | FN | Precision | Recall |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];
  for (const g of [...r.groups, r.overall]) lines.push(`| ${g.group} | ${g.tp + g.fn} | ${g.tp} | ${g.fp} | ${g.fn} | ${fmt(g.precision)} | ${fmt(g.recall)} |`);
  return `${lines.join("\n")}\n`;
}


// ---------------------------------------------------------------------------------------------
// LLM labeling eval (spec 8.5, EVAL-01)

/** One row of `evals/ambiguous-fields.jsonl`: a field the engine marks ambiguous and its expected label. */
export const ambiguousRowSchema = z
  .object({
    id: z.string().min(1),
    entity: z.string().min(1),
    field: z.string().min(1),
    declarationText: z.string().min(1).max(LIMITS.declarationChars),
    comment: z.string().max(LIMITS.llmCommentChars).nullable(),
    entityFields: z.array(z.string().min(1)).max(LIMITS.llmEntityFields),
    expected: z.string().min(1),
  })
  .strict();
export type AmbiguousRow = z.infer<typeof ambiguousRowSchema>;

/** Reads the labeling dataset; a bad line is a `CONFIG_INVALID` error naming the line, never its content. */
export function loadAmbiguousRows(path: string): AmbiguousRow[] {
  const rows: AmbiguousRow[] = [];
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (line.trim() === "") return;
      let json: unknown;
      try {
        json = JSON.parse(line);
      } catch {
        throw new PrivacyRadarError("CONFIG_INVALID", `${path}:${i + 1}: not valid JSON`);
      }
      const parsed = ambiguousRowSchema.safeParse(json);
      if (!parsed.success) throw new PrivacyRadarError("CONFIG_INVALID", `${path}:${i + 1}: ${describeIssues(parsed.error)}`);
      rows.push(parsed.data);
    });
  return rows;
}

/** `obs Json?` → `Json`: the rows are Prisma-style declarations (name, type, optional marker). */
function rawTypeOf(declaration: string): string | null {
  const token = declaration.trim().split(/\s+/)[1];
  return token === undefined ? null : token.replace(/[?[\]]/g, "") || null;
}

function rowField(row: AmbiguousRow): Field {
  const rawType = rawTypeOf(row.declarationText);
  return {
    name: row.field,
    rawName: row.field,
    type: rawType,
    rawType,
    optional: row.declarationText.includes("?"),
    array: row.declarationText.includes("[]"),
    loc: { line: 1, column: 1 },
    attributes: [],
    comment: row.comment,
    commentRange: null,
    defaultValue: null,
    defaultRange: null,
    declarationText: row.declarationText,
  };
}

/** ENG-01 on a dataset row: the deterministic classifier finds no term hit and the name is generic. */
export function isRowAmbiguous(row: AmbiguousRow, catalog: Catalog): boolean {
  const field = rowField(row);
  const entity = { name: row.entity, normalizedName: normalizeEntityName(row.entity), fieldNames: row.entityFields };
  const candidates = classifyField(field, entity, { termIndex: catalog.termIndex, categoryById: catalog.categoryById, regime: "both", file: `evals/${row.entity}.prisma`, valueHits: [] });
  return isAmbiguous(field, candidates);
}

function rowToAmbiguousField(row: AmbiguousRow): AmbiguousField {
  const field = rowField(row);
  const input: LabelFieldInput = {
    field: {
      name: row.field,
      rawType: field.rawType,
      optional: field.optional,
      array: field.array,
      entity: row.entity,
      declarationText: row.declarationText,
      entityFields: row.entityFields,
      sourceKind: "prisma",
      file: `evals/${row.entity}.prisma`,
      line: 1,
    },
    candidateCategories: [],
    maskedSamples: [],
    comment: row.comment,
  };
  return { entity: row.entity, field: row.field, entityKind: "model", file: input.field.file, line: 1, column: 1, sensitiveEntity: false, input };
}

export type LabelerEval = { rows: number; accuracy: number; evidenceMismatch: number; numbersDrift: number | null };

/**
 * Runs every row through `labelAmbiguousField` in process (EVAL-01). Accuracy: the accepted label
 * equals `expected`; a dropped label counts as wrong. Evidence mismatch: the share of rows whose label
 * the evidence check dropped. The dataset has no narrative rows, so numbers drift is `null`.
 */
export async function evalLabeler(
  rows: readonly AmbiguousRow[],
  provider: LlmProvider,
  prompt: PromptSpec<LabelFieldInput, LabelFieldOutput>,
  ctx: { redact: (s: string) => string },
): Promise<LabelerEval> {
  const trace = createTrace();
  let correct = 0;
  for (const row of rows) {
    const label = await labelAmbiguousField(provider, prompt, rowToAmbiguousField(row), { trace, redact: ctx.redact });
    if (label !== null && label.label === row.expected) correct++;
  }
  const mismatches = trace.lines().filter((l) => l.outcome === "evidence-mismatch").length;
  const n = rows.length;
  return { rows: n, accuracy: n === 0 ? 0 : correct / n, evidenceMismatch: n === 0 ? 0 : mismatches / n, numbersDrift: null };
}

/** `openai/gpt-4o-mini:free` → `openai-gpt-4o-mini-free` (the file name of `--write auto`). */
export function modelSlug(model: string): string {
  return model.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "model";
}

/** The Markdown result of `eval:fake` / `eval:live` (spec 8.5). */
export function renderLabelerTable(r: LabelerEval, meta: { model: string; baseUrlHost: string; date: string }): string {
  const lines = [
    "# LLM labeling evaluation",
    "",
    `Dataset: \`evals/ambiguous-fields.jsonl\`, ${r.rows} rows of fields the engine marks ambiguous.`,
    `Model: ${meta.model}; base URL host: ${meta.baseUrlHost}; date: ${meta.date}; temperature: 0.`,
    "Accuracy: the accepted label equals the expected one (a dropped label counts as wrong).",
    "Evidence mismatch: labels dropped because the quoted evidence is not in the field context.",
    "",
    "| Metric | Value |",
    "|---|---:|",
    `| Accuracy | ${r.accuracy.toFixed(2)} |`,
    `| Evidence mismatch | ${r.evidenceMismatch.toFixed(2)} |`,
    `| Numbers drift | ${r.numbersDrift === null ? "n/a" : r.numbersDrift.toFixed(2)} |`,
    `| Rows | ${r.rows} |`,
  ];
  return `${lines.join("\n")}\n`;
}

const FAKE_EVAL_FIXTURE = join(PROJECT_ROOT, "evals", "ambiguous-fields.fake.json");

async function labelerMain(values: { provider?: string; write?: string }, env: Record<string, string | undefined>, date: string): Promise<number> {
  const catalog = loadCatalog();
  const prompts = createPrompts(catalog.categories.map((c) => c.id));
  const rows = loadAmbiguousRows(join(PROJECT_ROOT, "evals", "ambiguous-fields.jsonl"));
  const redact = createRedactor(env.LLM_API_KEY);
  const choice = values.provider ?? "fake";
  let provider: LlmProvider;
  let meta: { model: string; baseUrlHost: string };
  if (choice === "fake") {
    const fake = createFakeProvider({ fixturePath: FAKE_EVAL_FIXTURE, prompts: prompts.all });
    if (fake === null) throw new PrivacyRadarError("USAGE", "evals/ambiguous-fields.fake.json is missing");
    provider = fake;
    meta = { model: "fake-scripted", baseUrlHost: "none (scripted fake)" };
  } else if (choice === "openai-compatible") {
    const parsedEnv = loadEnv(env);
    const setup = resolveLlm({ choice: "openai-compatible", fixturePath: null, env: parsedEnv, prompts, redact });
    provider = setup.provider!;
    meta = { model: redact(parsedEnv.LLM_MODEL ?? "unknown"), baseUrlHost: new URL(parsedEnv.LLM_BASE_URL).host };
  } else {
    throw new PrivacyRadarError("USAGE", "--provider must be fake or openai-compatible");
  }
  const table = renderLabelerTable(await evalLabeler(rows, provider, prompts.label, { redact }), { ...meta, date });
  if (values.write === undefined) process.stdout.write(table);
  else {
    const path = values.write === "auto" ? join(PROJECT_ROOT, "docs", "evals", `${date}-${modelSlug(meta.model)}.md`) : values.write;
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, table);
    process.stdout.write(`wrote ${values.write === "auto" ? `docs/evals/${date}-${modelSlug(meta.model)}.md` : path}\n`);
  }
  return 0;
}

export async function main(argv: string[], env: Record<string, string | undefined>): Promise<number> {
  try {
    const { values } = parseArgs({
      args: argv,
      options: { target: { type: "string" }, provider: { type: "string" }, write: { type: "string" }, "min-confidence": { type: "string" } },
      strict: true,
    });
    if (values.target === "labeler") {
      const clock = clockFromEnv(env.PRIVACY_RADAR_CLOCK, fixedClock(DEMO_CLOCK_ISO));
      return await labelerMain(values, env, clock().toISOString().slice(0, 10));
    }
    if (values.target !== "classifier") throw new PrivacyRadarError("USAGE", "--target must be classifier or labeler");
    const minConfidence = values["min-confidence"] === undefined ? LIMITS.minConfidenceDefault : Number(values["min-confidence"]);
    if (!(minConfidence >= 0 && minConfidence <= 1)) throw new PrivacyRadarError("USAGE", "--min-confidence must be a number between 0 and 1");
    const catalog = loadCatalog();
    const rows = loadFieldRows(join(PROJECT_ROOT, "evals", "field-names.jsonl"));
    const clock = clockFromEnv(env.PRIVACY_RADAR_CLOCK, fixedClock(DEMO_CLOCK_ISO));
    const table = renderClassifierTable(evalClassifier(rows, catalog, minConfidence), { date: clock().toISOString().slice(0, 10), catalogCheckedOn: catalog.adequacy.checkedOn });
    if (values.write !== undefined) writeFileSync(values.write, table);
    else process.stdout.write(table);
    return 0;
  } catch (err) {
    const wrapped = err instanceof Error && !(err instanceof PrivacyRadarError) && "code" in err && String((err as { code: unknown }).code).startsWith("ERR_PARSE_ARGS")
      ? new PrivacyRadarError("USAGE", err.message)
      : err;
    process.stderr.write(`${formatCliError(wrapped, (s) => s)}\n`);
    return wrapped instanceof PrivacyRadarError ? wrapped.exitCode : 3;
  }
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2), process.env);
