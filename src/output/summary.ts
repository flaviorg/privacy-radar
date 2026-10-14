import type { RegimeOption } from "../contracts/catalog.ts";
import type { Finding, ScanResult } from "../contracts/findings.ts";
import type { Inventory } from "../contracts/inventory.ts";
import { prSentence } from "../pr/comment.ts";
import { DISCLAIMER_EN } from "./disclaimer.ts";
import { codeSpan, escapeMd, tableCell } from "./markdown.ts";
import { BANNER_FIRST, BANNER_LAST, MAX_LINE, fit, formatFindingRows } from "./table.ts";
import { compressKeys } from "../engine/messages.ts";
import { articleKey } from "../contracts/catalog.ts";

// The hero block of the demo (spec 10.2): console and Markdown variants of the same lines. Every
// line is at most 100 columns and no wall-clock value is ever printed here. Pure.

export type HeroPr = { baseShort: string; headShort: string; changed: number; added: Finding[]; resolved: Finding[]; unchanged: number; exitCode: number };

export type HeroInput = {
  version: string;
  clockIso: string;
  providerLabel: string;
  regime: RegimeOption;
  pr: HeroPr | null;
  scan: ScanResult;
  inventory: Inventory;
  sarif: { results: number; rules: number } | null;
  documents: { names: string[]; wp248: number; ripdIndicators: number } | null;
  scanExitCode: number;
  /** the demo's own exit code (0 when every count equals spec 5.10) */
  demoExitCode: number;
};

const numberFormat = new Intl.NumberFormat("en-US");
const n = (x: number) => numberFormat.format(x);
const TOP = 5;

/** Greedy word wrap at `width`, continuation lines prefixed with `indent`. */
function wrap(text: string, first: string, indent: string, width = MAX_LINE): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = first;
  let empty = true;
  for (const w of words) {
    const candidate = empty ? `${line}${w}` : `${line} ${w}`;
    if (candidate.length > width && !empty) {
      lines.push(line);
      line = `${indent}${w}`;
    } else line = candidate;
    empty = false;
  }
  lines.push(line);
  return lines.map((l) => fit(l, width));
}

/** Items joined with " · " and wrapped under a label, continuation aligned after the label. */
function itemLines(label: string, items: readonly string[]): string[] {
  const indent = " ".repeat(label.length);
  const lines: string[] = [];
  let line = label;
  let count = 0;
  for (const item of items) {
    const candidate = count === 0 ? `${line}${item}` : `${line} · ${item}`;
    if (candidate.length > MAX_LINE && count > 0) {
      lines.push(line);
      line = `${indent}${item}`;
    } else line = candidate;
    count++;
  }
  lines.push(line);
  return lines.map((l) => fit(l));
}

/** The top findings of spec 10.2: the first five shown findings plus the first PR-HARDCODED-VALUE when it is not among them. */
export function topFindings(findings: readonly Finding[]): Finding[] {
  const shown = findings.filter((f) => !f.belowThreshold && f.origin === "deterministic");
  const top = shown.slice(0, TOP);
  const hardcoded = shown.find((f) => f.ruleId === "PR-HARDCODED-VALUE");
  if (hardcoded && !top.includes(hardcoded)) top.push(hardcoded);
  return top;
}

const scripted = (label: string) => label.startsWith("fake");

function llmRow(f: Finding, providerLabel: string): string {
  const tag = scripted(providerLabel) ? "(LLM, scripted)" : "(LLM, advisory)";
  const what = `${f.entity ? `${f.entity.name}.${f.entity.field}` : f.location.file} → ${f.categories.join(", ")} ${f.confidence.toFixed(2)}`;
  return fit(` ${f.severity.padEnd(8)} ${f.ruleId} ${tag}  ${f.location.file}:${f.location.line}:${f.location.column}  ${what}`);
}

function prHeader(pr: HeroPr): string {
  return `PR mode on a two-commit copy (base ${pr.baseShort} → head ${pr.headShort}, ${n(pr.changed)} file${pr.changed === 1 ? "" : "s"} changed):`;
}

function prCounts(pr: HeroPr): string {
  const blocking = pr.added.filter((f) => f.severity === "error").length;
  return fit(`${n(pr.added.length)} added · ${n(pr.resolved.length)} resolved · ${n(pr.unchanged)} unchanged · ${n(blocking)} new findings at or above "error" → PR check exit ${pr.exitCode}`);
}

function prSentences(pr: HeroPr, regime: RegimeOption): { sign: "+" | "-"; text: string }[] {
  return [...pr.added.map((f) => ({ sign: "+" as const, text: prSentence(f, "added", regime) })), ...pr.resolved.map((f) => ({ sign: "-" as const, text: prSentence(f, "resolved", regime) }))];
}

/** Everything after the PR block: target, inventory, top findings, summary, llm, documents, exit codes. */
function bodyLines(input: HeroInput): string[] {
  const { scan, inventory } = input;
  const c = inventory.counts;
  const s = scan.target.sources;
  const lines: string[] = [];
  lines.push(fit(`target: ${scan.target.path} (${n(scan.target.files)} files: ${n(s.ts)} ts, ${n(s.sql)} sql, ${n(s.prisma)} prisma)`));
  const notPersonal = inventory.entities.flatMap((e) => e.fields.filter((f) => f.status === "not-personal").map((f) => f.name));
  const notPersonalText = notPersonal.length > 0 && notPersonal.length <= 3 ? ` (${notPersonal.join(", ")})` : "";
  lines.push(fit(`inventory: ${n(c.entities)} entities · ${n(c.fields)} fields · ${n(c.personal)} personal (${n(c.sensitive)} sensitive, ${n(c.childrenIndicators)} children indicators)`));
  lines.push(fit(`           ${n(c.notPersonal)} not personal${notPersonalText} · ${n(c.belowThreshold)} below threshold · ${n(c.ambiguous)} ambiguous → LLM · ${n(c.valuesMasked)} values masked`));
  lines.push("");
  lines.push("top findings (articles on the second line: LGPD · GDPR)");
  const top = topFindings(scan.findings);
  for (const f of top) lines.push(...formatFindingRows(f, input.regime));
  const shown = scan.findings.filter((f) => !f.belowThreshold);
  const rest = shown.filter((f) => !top.includes(f));
  const restLlm = rest.filter((f) => f.origin === "llm").length;
  if (rest.length > 0) lines.push(fit(` … ${n(rest.length)} more in DEMO.md (${n(rest.length - restLlm)} deterministic, ${n(restLlm)} LLM)`));
  for (const f of shown.filter((x) => x.origin === "llm")) lines.push(llmRow(f, input.providerLabel));
  lines.push("");
  const m = scan.summary;
  const llmNotes = shown.filter((f) => f.origin === "llm" && f.severity === "note" && !f.suppressed).length;
  lines.push(fit(`summary: ${n(m.error)} error · ${n(m.warning)} warning · ${n(m.note)} note${llmNotes > 0 ? ` (${n(llmNotes)} from the LLM)` : ""} · ${n(m.suppressed)} suppressed · ${n(shown.length)} results`));
  const llm = scan.llm;
  const unknown = inventory.entities.flatMap((e) => e.fields).filter((f) => f.llmLabel?.label === "unknown").length;
  const sim = llm.simulated ? " (simulated by the scripted fake)" : "";
  const llmParts = [`${n(llm.fieldsClassified)} fields labeled${unknown > 0 ? ` (${n(unknown)} unknown)` : ""}`];
  llmParts.push(input.documents ? `${n(llm.narrativeSections)} narrative sections` : "documents: not in this version");
  if (llm.repaired > 0) llmParts.push(`${n(llm.repaired)} repair${llm.repaired === 1 ? "" : "s"}${sim}`);
  if (llm.degraded > 0) llmParts.push(`${n(llm.degraded)} degraded${sim}`);
  lines.push(fit(`llm: ${llmParts.join(" · ")}`));
  const sarifItem = input.sarif ? `sarif: ${n(input.sarif.results)} results, ${n(input.sarif.rules)} rules, fingerprints ok` : null;
  if (input.documents) {
    const d = input.documents;
    const items = d.names.map((name) => {
      if (name === "dpia.md") return `dpia.md (${n(d.wp248)} of 9 WP248 criteria${d.wp248 >= 2 ? " → likely required" : ""})`;
      if (name.startsWith("ripd")) return `${name} (${n(d.ripdIndicators)} high-risk indicators)`;
      return name;
    });
    lines.push(...itemLines("documents: ", sarifItem ? [...items, sarifItem] : items));
  } else if (sarifItem) lines.push(fit(sarifItem));
  const meaning = input.scanExitCode === 1 ? "errors found" : input.scanExitCode === 0 ? "nothing at or above fail-on" : "failed";
  lines.push(fit(`scan exit code ${input.scanExitCode} (${meaning}) · demo exit ${input.demoExitCode}`));
  return lines;
}

function headLines(input: HeroInput): string[] {
  const network = scripted(input.providerLabel) || input.providerLabel.startsWith("none") ? " · no network" : "";
  return [fit(`privacy-radar ${input.version} · demo · provider: ${input.providerLabel}${network} · regime: ${input.regime}`), `clock ${input.clockIso}`, BANNER_FIRST];
}

/**
 * The hero of spec 10.2. `console`: banner, the PR block (`+`/`-` sentences wrapped with a two-space
 * continuation), the body and the closing banner. `markdown` (the README block and
 * `demo-summary.txt`): the PR block as a blockquote first, then the rest inside a `text` fence.
 * `pr: null` and `documents: null` give the M5 variant.
 */
export function renderHero(input: HeroInput, format: "console" | "markdown"): string {
  if (format === "console") {
    const lines = [...headLines(input), ""];
    if (input.pr) {
      lines.push(fit(prHeader(input.pr)));
      for (const s of prSentences(input.pr, input.regime)) lines.push(...wrap(s.text, `${s.sign} `, "  "));
      lines.push(prCounts(input.pr), "");
    }
    lines.push(...bodyLines(input), "", BANNER_LAST);
    return `${lines.join("\n")}\n`;
  }
  const md: string[] = [];
  if (input.pr) {
    md.push(...wrap(escapeMd(prHeader(input.pr)), "> ", "> "), ">");
    for (const s of prSentences(input.pr, input.regime)) md.push(...wrap(escapeMd(s.text), `> ${s.sign === "+" ? "+" : "-"} `, ">   "));
    md.push(">", ...wrap(escapeMd(prCounts(input.pr)), "> ", "> "), "");
  }
  md.push("```text", ...headLines(input), "", ...bodyLines(input), "", BANNER_LAST, "```");
  return `${md.join("\n")}\n`;
}

/** `DEMO.md`: the Markdown hero, every finding of the demo scan, and the PR comment. */
export function renderDemoMd(input: HeroInput & { prComment: string | null }): string {
  const out: string[] = [
    "# privacy-radar demo output",
    "",
    `Generated by \`npm run regen\` from \`npm run demo\` with the clock ${input.clockIso} and the provider ${escapeMd(input.providerLabel)}. ${DISCLAIMER_EN}`,
    "",
    "## Summary",
    "",
    renderHero(input, "markdown").trimEnd(),
    "",
    "## Every finding of the demo scan",
    "",
    "| # | Severity | Rule | Origin | Location | Categories | LGPD | GDPR |",
    "|---|---|---|---|---|---|---|---|",
  ];
  input.scan.findings
    .filter((f) => !f.belowThreshold)
    .forEach((f, i) => {
      const loc = codeSpan(`${f.location.file}:${f.location.line}:${f.location.column}`);
      const cats = f.categories.map((c) => codeSpan(c)).join(", ");
      const lgpd = compressKeys(f.articles.lgpd.map(articleKey)) || "-";
      const gdpr = compressKeys(f.articles.gdpr.map(articleKey)) || "-";
      out.push(`| ${i + 1} | ${f.severity} | ${f.ruleId} | ${f.origin} | ${tableCell(loc)} | ${tableCell(cats)} | ${tableCell(escapeMd(lgpd))} | ${tableCell(escapeMd(gdpr))} |`);
    });
  out.push("");
  if (input.prComment !== null) {
    out.push("## The PR comment of the demo pull request", "", input.prComment.trimEnd().replace(/^## /m, "### "), "");
  }
  return `${out.join("\n")}\n`;
}
