import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { Log } from "sarif";
import type { Catalog } from "../catalog/load.ts";
import { detectValues, maskText } from "../catalog/values.ts";
import type { RegimeOption } from "../contracts/catalog.ts";
import type { DocId, Finding, Locale, ScanResult, Severity } from "../contracts/findings.ts";
import type { Inventory } from "../contracts/inventory.ts";
import type { ScanWarning, SourceFile, ValueHit } from "../contracts/source-model.ts";
import { applyMaskedText } from "../engine/masked-source.ts";
import { buildScanModel } from "../engine/model.ts";
import { applyRules } from "../engine/rules/index.ts";
import { finalizeFindings } from "../engine/finalize.ts";
import type { Clock } from "../infra/clock.ts";
import { PrivacyRadarError } from "../infra/errors.ts";
import { readText, walkTarget, type FileEntry } from "../infra/files.ts";
import { toplevel } from "../infra/git.ts";
import { loadProjectConfig } from "../infra/config.ts";
import type { Logger } from "../infra/logger.ts";
import { toPosix } from "../infra/paths.ts";
import { REPOSITORY_URL, TOOL_NAME, TOOL_VERSION } from "../infra/version.ts";
import { buildInventory, renderInventoryMd } from "../output/inventory.ts";
import { toFindingsJson } from "../output/json.ts";
import { buildSarif } from "../output/sarif.ts";
import { detectKind, parseSource } from "../sources/index.ts";
import type { AmbiguousField, LlmLabel, TraceLine } from "../contracts/llm.ts";
import { LIMITS } from "../contracts/limits.ts";
import { ambiguousFields, selectAmbiguous } from "../engine/ambiguous.ts";
import { mergeFindings } from "../engine/merge-findings.ts";
import { labelAmbiguousField } from "../llm/tasks.ts";
import { createTrace } from "../llm/trace.ts";
import { createPrompts } from "../prompts/index.ts";
import { buildDocumentFacts } from "../output/documents/sections.ts";
import { generateDocuments } from "./documents.ts";
import type { LlmSetup } from "./llm.ts";

export type OutputFormat = "json" | "sarif" | "md" | "table";

export type { LlmSetup } from "./llm.ts";
export type { TraceLine } from "../contracts/llm.ts";

export type ScanOptions = {
  target: string;
  /** folder for the artifacts, or `null` to write nothing */
  out: string | null;
  formats: readonly OutputFormat[];
  regime: RegimeOption;
  minConfidence: number;
  configPath: string | null;
  docs: readonly DocId[];
  /** `null`: the config's `reportLanguage`, else `en` */
  reportLang: Locale | null;
  llm: LlmSetup;
  /** `null`: the config's `llm.maxFields`, else the default of spec 6.1 */
  maxLlmFields: number | null;
  maxFiles: number;
  clock: Clock;
  catalog: Catalog;
  logger: Logger;
  /** applied to every trace line and LLM warning before it leaves the scan (the CLI passes `redactSecrets` with the API key) */
  redact?: (s: string) => string;
  deterministicOnly?: boolean;
  uriPrefix?: string;
  /** test seam: permutes the processing order only; every output is sorted regardless (SRC-05) */
  orderFiles?: (files: FileEntry[]) => FileEntry[];
};

export type ScanOutcome = {
  result: ScanResult;
  inventory: Inventory;
  sarif: Log | null;
  documents: { name: string; content: string }[];
  trace: TraceLine[];
  written: string[];
  /** deterministic, non-suppressed findings at or above the threshold: what the exit code counts */
  exitFindings: Finding[];
};

/** Every artifact name a scan owns in `--out`: a run deletes the ones it does not write, and nothing else. */
export const OWNED_ARTIFACTS: readonly string[] = [
  "findings.json",
  "findings.sarif",
  "inventory.json",
  "inventory.md",
  "ropa.md",
  "dpia.md",
  "registro.md",
  "registro.pt-BR.md",
  "ripd.md",
  "ripd.pt-BR.md",
  "llm-trace.jsonl",
  "pr-comment.md",
];

const SEVERITY_RANK: Readonly<Record<Severity, number>> = { error: 0, warning: 1, note: 2 };

/** 0 or 1 (OUT-07): any deterministic, non-suppressed, at-or-above-threshold finding with severity at or above `failOn`. */
export function exitCodeFor(findings: readonly Finding[], failOn: Severity | "none"): 0 | 1 {
  if (failOn === "none") return 0;
  const limit = SEVERITY_RANK[failOn];
  return findings.some((f) => f.origin === "deterministic" && !f.suppressed && !f.belowThreshold && SEVERITY_RANK[f.severity] <= limit) ? 1 : 0;
}

/** The target as findings.json shows it: POSIX, never absolute (an absolute path becomes relative to the working folder, else its last segment). */
export function displayTarget(target: string): string {
  const posix = toPosix(target).replace(/\/+$/, "") || ".";
  if (!isAbsolute(target)) return posix;
  const rel = toPosix(relative(process.cwd(), resolve(target)));
  if (rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)) return rel;
  return basename(resolve(target)) || ".";
}

function uriPrefixFor(target: string): string {
  const top = toplevel(target);
  if (top === null) return "";
  try {
    const rel = toPosix(relative(realpathSync(top), realpathSync(target)));
    return rel === "" || rel.startsWith("..") ? "" : `${rel}/`;
  } catch {
    return "";
  }
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const compareWarnings = (a: ScanWarning, b: ScanWarning) => cmp(a.file, b.file) || (a.line ?? 0) - (b.line ?? 0) || cmp(a.code, b.code) || cmp(a.message, b.message);

function outNotWritable(err: unknown): PrivacyRadarError {
  const code = err instanceof Error && "code" in err ? String((err as NodeJS.ErrnoException).code) : "ERROR";
  return new PrivacyRadarError("OUT_NOT_WRITABLE", `cannot write the output folder (${code})`);
}

/**
 * One scan (Task 26): target and config, file walk, then per file parse, value detection, masking and
 * the masked re-slicing; the scan model, the twelve rules, de-duplication, finalization; inventory and
 * SARIF; finally the requested artifacts in `out`. Nothing here logs or returns an unmasked value.
 */
export async function scan(opts: ScanOptions): Promise<ScanOutcome> {
  const { logger, catalog } = opts;
  const target = resolve(opts.target);
  let isDir = false;
  try {
    isDir = statSync(target).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) throw new PrivacyRadarError("TARGET_NOT_FOUND", `target is not a readable folder: ${displayTarget(opts.target)}`);

  const config = loadProjectConfig(opts.configPath);
  const shownTarget = displayTarget(opts.target);
  logger.info("scan.start", { target: shownTarget, regime: opts.regime, formats: [...opts.formats] });

  const walked = walkTarget(target, { ignore: config.ignore ?? [], maxFiles: opts.maxFiles, accept: (rel) => detectKind(rel) !== null });
  if (walked.files.length === 0) throw new PrivacyRadarError("NO_SUPPORTED_FILES", `no .ts, .js, .sql or .prisma file under ${shownTarget}`);

  const warnings: ScanWarning[] = [...walked.warnings, ...opts.llm.warnings];
  const ordered = opts.orderFiles ? opts.orderFiles([...walked.files]) : walked.files;
  const sources: SourceFile[] = [];
  const valueHits: { file: string; hits: ValueHit[] }[] = [];
  const maskedTexts = new Map<string, string>();
  for (const entry of ordered) {
    let text: string;
    try {
      text = readText(entry.abs);
    } catch {
      warnings.push({ file: entry.rel, code: "PARSE_ERROR", message: "file could not be read; skipped" });
      continue;
    }
    const raw = parseSource(entry.rel, text);
    const hits = detectValues(text, { path: entry.rel, literalBindings: raw.literalBindings, termIndex: catalog.termIndex, categories: catalog.categories });
    const masked = maskText(text, { valueHits: hits, literalBindings: raw.literalBindings, termIndex: catalog.termIndex });
    sources.push(applyMaskedText(raw, masked));
    valueHits.push({ file: entry.rel, hits });
    maskedTexts.set(entry.rel, masked);
    logger.debug("scan.file", { file: entry.rel, kind: raw.kind });
  }
  for (const s of sources) warnings.push(...s.warnings);

  const model = buildScanModel({ files: sources, valueHits, maskedTexts, catalog, config, regime: opts.regime, minConfidence: opts.minConfidence });
  const deterministic = finalizeFindings(applyRules(model), { maskedLines: model.maskedLines, minConfidence: opts.minConfidence, config, today: opts.clock() });

  const redact = opts.redact ?? ((s: string) => s);
  const provider = opts.deterministicOnly ? null : opts.llm.provider;
  const trace = createTrace();
  const labels: LlmLabel[] = [];
  let selected: AmbiguousField[] = [];
  if (provider) {
    const prompts = createPrompts(catalog.categories.map((c) => c.id));
    selected = selectAmbiguous(ambiguousFields(model), opts.maxLlmFields ?? config.llm?.maxFields ?? LIMITS.maxLlmFields);
    for (const field of selected) {
      const onDegraded = (reason: string) => {
        warnings.push({ file: field.file, line: field.line, code: "LLM_DEGRADED", message: redact(`${field.entity}.${field.field}: label-field.v1 degraded (${reason}); kept the deterministic result`) });
        logger.warn("llm.degraded", { prompt: "label-field.v1", file: field.file, reason });
      };
      const label = await labelAmbiguousField(provider, prompts.label, field, { trace, redact, onDegraded });
      const last = trace.lines().at(-1);
      logger.debug("llm.call", { prompt: "label-field.v1", file: field.file, outcome: last?.outcome ?? "none" });
      if (label) labels.push(label);
    }
  }
  const findings = mergeFindings(deterministic, labels, selected, { catalog, regime: opts.regime, maskedLines: model.maskedLines, minConfidence: opts.minConfidence });
  const inventory = buildInventory(model, findings, labels);

  let documents: { name: string; content: string }[] = [];
  let narrativeSections = 0;
  if (opts.docs.length > 0) {
    const facts = buildDocumentFacts({ target: { path: shownTarget }, regime: opts.regime, findings }, inventory, config, catalog);
    const generated = await generateDocuments({
      docs: opts.docs,
      reportLang: opts.reportLang ?? config.reportLanguage ?? "en",
      facts,
      knownFindingIds: new Set(findings.map((f) => f.id)),
      catalog,
      provider,
      prompt: createPrompts(catalog.categories.map((c) => c.id)).narrative,
      trace,
      redact,
      logger,
      version: TOOL_VERSION,
      date: opts.clock().toISOString().slice(0, 10),
      providerLabel: provider ? opts.llm.label : "none",
      warn: (w) => warnings.push(w),
    });
    documents = generated.documents;
    narrativeSections = generated.narrativeSections;
  }
  const traceLines: TraceLine[] = trace.lines();

  const sorted = [...warnings].sort(compareWarnings);
  for (const w of sorted) logger.warn("scan.warning", { file: w.file, code: w.code });
  const uriPrefix = opts.uriPrefix ?? uriPrefixFor(target);
  const wantsSarif = opts.formats.includes("sarif");
  const sarif = wantsSarif
    ? buildSarif({ findings, catalog, regime: opts.regime, toolVersion: TOOL_VERSION, uriPrefix, informationUri: REPOSITORY_URL })
    : null;
  if (sarif?.runs[0]?.properties?.["truncated"] === true) logger.warn("scan.warning", { code: "SARIF_TRUNCATED" });

  const active = findings.filter((f) => !f.belowThreshold && !f.suppressed);
  const kinds = { ts: 0, sql: 0, prisma: 0 };
  for (const s of sources) kinds[s.kind]++;
  const result: ScanResult = {
    schemaVersion: 1,
    tool: { name: TOOL_NAME, version: TOOL_VERSION },
    target: { path: shownTarget, files: sources.length, sources: kinds },
    regime: opts.regime,
    provider: provider ? provider.name : "none",
    generatedAt: opts.clock().toISOString(),
    summary: {
      error: active.filter((f) => f.severity === "error").length,
      warning: active.filter((f) => f.severity === "warning").length,
      note: active.filter((f) => f.severity === "note").length,
      suppressed: findings.filter((f) => f.suppressed && !f.belowThreshold).length,
      llmLabeled: active.filter((f) => f.origin === "llm").length,
      belowThreshold: findings.filter((f) => f.belowThreshold).length,
    },
    findings,
    warnings: sorted,
    llm: {
      calls: traceLines.length,
      degraded: traceLines.filter((l) => l.outcome === "degraded").length,
      repaired: traceLines.filter((l) => l.outcome === "repaired").length,
      fieldsClassified: labels.length,
      narrativeSections,
      simulated: traceLines.some((l) => l.simulated === true),
    },
  };

  const files = new Map<string, string>();
  if (opts.formats.includes("json")) files.set("findings.json", toFindingsJson(result));
  if (sarif) files.set("findings.sarif", `${JSON.stringify(sarif, null, 2)}\n`);
  if (opts.formats.includes("md")) {
    files.set("inventory.json", `${JSON.stringify(inventory, null, 2)}\n`);
    files.set("inventory.md", renderInventoryMd(inventory));
  }
  for (const d of documents) files.set(d.name, d.content);
  if (traceLines.length > 0) files.set("llm-trace.jsonl", traceLines.map((l) => `${redact(JSON.stringify(l))}\n`).join(""));

  const written = opts.out === null ? [] : writeArtifacts(opts.out, files);

  const exitFindings = findings.filter((f) => f.origin === "deterministic" && !f.suppressed && !f.belowThreshold);
  logger.info("scan.done", { files: sources.length, findings: findings.length, error: result.summary.error, warning: result.summary.warning, note: result.summary.note, written: written.length });
  return { result, inventory, sarif, documents, trace: traceLines, written, exitFindings };
}

/**
 * Writes `files` into `out` (created when needed), after deleting the owned artifact names that this
 * run does not write (Review focus 5); no other file is touched. Scan and PR mode both write through it.
 * Returns the written names, sorted.
 */
export function writeArtifacts(out: string, files: ReadonlyMap<string, string>): string[] {
  try {
    if (existsSync(out)) {
      for (const name of OWNED_ARTIFACTS) {
        const path = join(out, name);
        if (!files.has(name) && existsSync(path) && lstatSync(path).isFile()) rmSync(path);
      }
    }
    if (files.size === 0) return [];
    mkdirSync(out, { recursive: true });
    for (const [name, content] of files) writeFileSync(join(out, name), content);
  } catch (err) {
    throw outNotWritable(err);
  }
  return [...files.keys()].sort();
}
