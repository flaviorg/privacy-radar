import { articleKey, type RegimeOption } from "../contracts/catalog.ts";
import type { Finding, ScanResult } from "../contracts/findings.ts";
import { compressKeys } from "../engine/messages.ts";
import { DISCLAIMER_EN } from "./disclaimer.ts";

export const BANNER_FIRST = "DRAFTS, NOT LEGAL ADVICE: findings and documents are starting points for a DPO review.";
export const BANNER_LAST = "DRAFTS, NOT LEGAL ADVICE.";

/** The widest line the console table prints (asserted on the table and on the README block). */
export const MAX_LINE = 100;

const SEVERITY_WIDTH = 8;
/** The longest rule id (`PR-PLAINTEXT-SENSITIVE`), so the columns stay aligned. */
const RULE_WIDTH = 22;
const LOCATION_WIDTH = 26;
const INDENT = 1 + SEVERITY_WIDTH + 1;

const numberFormat = new Intl.NumberFormat("en-US");
const n = (x: number) => numberFormat.format(x);

/** Cuts a line to `MAX_LINE` columns, ending with an ellipsis when it was longer. */
export function fit(line: string, width = MAX_LINE): string {
  return line.length <= width ? line : `${line.slice(0, width - 1)}…`;
}

const GROUP_PRIORITY = ["special", "criminal", "children", "identifier", "financial", "name", "contact", "demographic", "online"];

/** `identifier.cpf` → `cpf`; two or fewer in full, else the most sensitive group's first and "+ N more". */
function shortCategories(categories: readonly string[]): string {
  const strip = (id: string) => id.split(".").slice(1).join(".") || id;
  if (categories.length <= 2) return categories.map(strip).join(", ");
  const rank = (id: string) => {
    const i = GROUP_PRIORITY.indexOf(id.split(".")[0] ?? "");
    return i < 0 ? GROUP_PRIORITY.length : i;
  };
  const ordered = [...categories].sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
  return `${strip(ordered[0]!)} + ${ordered.length - 1} more`;
}

function whatOf(f: Finding): string {
  const cats = shortCategories(f.categories);
  const sink = f.sink;
  switch (f.ruleId) {
    case "PR-TRANSFER":
      return `${sink?.vendor ?? sink?.host ?? "unknown destination"}${sink?.hqCountry ? ` (${sink.hqCountry})` : ""}: verify mechanism`;
    case "PR-URL-QUERY": {
      const param = /URL query parameter "([^"]+)"/.exec(f.message)?.[1];
      return `${cats} → query param${param ? ` "${param}"` : ""}`;
    }
    case "PR-LOG":
    case "PR-FILE":
    case "PR-ANALYTICS":
    case "PR-THIRD-PARTY":
      return sink ? `${cats} → ${sink.callee}${sink.hqCountry ? ` (${sink.hqCountry})` : sink.host ? ` ${sink.host}` : ""}` : cats;
    case "PR-HARDCODED-VALUE":
      return `${f.evidence.length} hardcoded value${f.evidence.length === 1 ? "" : "s"}, masked`;
    case "PR-PARSE":
      return f.message;
    case "PR-RETENTION":
      return `${f.entity?.name ?? "entity"}: no retention signal`;
    case "PR-CHILD":
      return `${f.entity?.name ?? "entity"}: children indicator`;
    case "PR-AMBIGUOUS":
      return `${f.entity ? `${f.entity.name}.${f.entity.field}` : "field"}: ${cats} (LLM, advisory)`;
    default:
      return f.entity ? `${f.entity.name}${f.entity.field === "" ? "" : `.${f.entity.field}`}: ${cats}` : f.message;
  }
}

function articleLine(f: Finding, regime: RegimeOption): string {
  const lgpd = compressKeys(f.articles.lgpd.map(articleKey));
  const gdpr = compressKeys(f.articles.gdpr.map(articleKey));
  let body: string;
  if (regime === "lgpd") body = lgpd || "-";
  else if (regime === "gdpr") body = gdpr || "-";
  else body = lgpd === "" && gdpr === "" ? "-" : `${lgpd || "-"} · ${gdpr || "-"}`;
  return fit(`${" ".repeat(INDENT)}${body}`);
}

/**
 * The two-line row of spec 10.2: severity (8), rule (19), `file:line:column` (26) and a short "what"
 * on the first line; the articles `LGPD · GDPR` compressed on the second. Each line is at most 100 columns.
 */
export function formatFindingRows(f: Finding, regime: RegimeOption): [string, string] {
  const loc = `${f.location.file}:${f.location.line}:${f.location.column}`;
  const prefix = ` ${f.severity.padEnd(SEVERITY_WIDTH)} ${f.ruleId.padEnd(RULE_WIDTH)} ${loc.padEnd(LOCATION_WIDTH)} `;
  const what = whatOf(f) + (f.suppressed ? " [suppressed]" : "");
  const room = Math.max(MAX_LINE - prefix.length, 0);
  const shown = what.length <= room ? what : `${what.slice(0, Math.max(room - 1, 0))}…`;
  return [fit(`${prefix}${shown}`.trimEnd()), articleLine(f, regime)];
}

/** The console output of `--format table`: banner, provider line, every finding above the threshold, summary, disclaimer, banner. */
export function renderTable(result: ScanResult, opts: { regime: RegimeOption; providerLabel: string }): string {
  const lines: string[] = [BANNER_FIRST];
  lines.push(fit(`${result.tool.name} ${result.tool.version} · provider: ${opts.providerLabel} · regime: ${opts.regime}`));
  const s = result.target.sources;
  lines.push(fit(`target: ${result.target.path} (${n(result.target.files)} files: ${n(s.ts)} ts, ${n(s.sql)} sql, ${n(s.prisma)} prisma)`));
  lines.push("");
  const shown = result.findings.filter((f) => !f.belowThreshold);
  if (shown.length === 0) lines.push("no findings");
  else {
    lines.push("findings (articles on the second line: LGPD · GDPR)");
    for (const f of shown) lines.push(...formatFindingRows(f, opts.regime));
  }
  lines.push("");
  const llmNotes = shown.filter((f) => f.origin === "llm" && f.severity === "note" && !f.suppressed).length;
  const m = result.summary;
  lines.push(
    fit(`summary: ${n(m.error)} error · ${n(m.warning)} warning · ${n(m.note)} note${llmNotes > 0 ? ` (${n(llmNotes)} from the LLM)` : ""} · ${n(m.suppressed)} suppressed · ${n(shown.length)} results`),
  );
  const llm = result.llm;
  if (llm.calls > 0) {
    const sim = llm.simulated && llm.repaired + llm.degraded > 0 ? " (simulated by the scripted fake)" : "";
    lines.push(fit(`llm: ${n(llm.calls)} calls · ${n(llm.fieldsClassified)} fields labeled · ${n(llm.repaired)} repaired · ${n(llm.degraded)} degraded${sim}`));
  }
  if (result.warnings.length > 0) lines.push(fit(`warnings: ${n(result.warnings.length)} (${[...new Set(result.warnings.map((w) => w.code))].join(", ")})`));
  lines.push(DISCLAIMER_EN, "", BANNER_LAST);
  return `${lines.join("\n")}\n`;
}
