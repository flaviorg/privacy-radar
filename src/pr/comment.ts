import type { RegimeOption, RuleId } from "../contracts/catalog.ts";
import type { Finding } from "../contracts/findings.ts";
import { articleSuffix } from "../engine/messages.ts";
import { DISCLAIMER_EN } from "../output/disclaimer.ts";
import { codeSpan, escapeMd, tableCell } from "../output/markdown.ts";

// The PR comment (spec 5.1, PR-03): one compliance sentence per added or resolved finding, a table,
// the counts and the disclaimer footer. Every derived string is escaped. Pure.

/** The rule titles of the catalog rules file (pr-comment.unit asserts they match). */
export const RULE_TITLES: Readonly<Record<RuleId, string>> = Object.freeze({
  "PR-LOG": "Personal data reaches a log call",
  "PR-THIRD-PARTY": "Personal data is sent to a third-party host",
  "PR-ANALYTICS": "Personal data reaches an analytics SDK",
  "PR-FILE": "Personal data is written to a file",
  "PR-URL-QUERY": "Personal data is placed in a URL query string",
  "PR-TRANSFER": "Personal data may be transferred internationally",
  "PR-PLAINTEXT-SENSITIVE": "Sensitive field stored without protection",
  "PR-RETENTION": "Storage entity has no retention signal",
  "PR-CHILD": "Possible children's data indicator",
  "PR-HARDCODED-VALUE": "Personal data value hard-coded in a file",
  "PR-AMBIGUOUS": "Ambiguous field labeled as personal data by the LLM",
  "PR-PARSE": "A file could not be fully parsed",
});

const SINK_RULES = new Set<RuleId>(["PR-LOG", "PR-THIRD-PARTY", "PR-ANALYTICS", "PR-FILE", "PR-URL-QUERY"]);

/** `a`, `a and b`, `a, b and c`: the full list, never abbreviated. */
function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function sinkDescription(f: Finding): string {
  const s = f.sink;
  if (!s) return "a sink";
  switch (s.kind) {
    case "log":
      return `a log (${s.callee})`;
    case "file":
      return `a file (${s.callee})`;
    case "url-query": {
      const param = /URL query parameter "([^"]+)"/.exec(f.message)?.[1];
      return param ? `a URL query string (parameter ${param})` : "a URL query string";
    }
    case "analytics":
      return s.vendor ? `analytics vendor ${s.vendor}${s.hqCountry ? ` (${s.hqCountry})` : ""}` : "an unknown analytics vendor";
    case "http":
      if (!s.host) return "an unresolved host";
      return `third party ${s.host} (${s.vendor ? `${s.vendor}${s.hqCountry ? ` (${s.hqCountry})` : ""}` : "unknown destination"})`;
  }
}

function destination(f: Finding): string {
  const s = f.sink;
  const who = s?.vendor ?? s?.host ?? "an unknown destination";
  return s?.hqCountry ? `${who} (${s.hqCountry})` : who;
}

function transferText(f: Finding, regime: RegimeOption): string {
  const entries = (f.transfer ?? []).filter((t) => regime === "both" || t.regime === regime);
  const statuses = entries.map((t) => `${t.regime.toUpperCase()} ${t.status}`).join(", ");
  const date = entries.map((t) => /status as of (\d{4}-\d{2}-\d{2})/.exec(t.text)?.[1]).find((d) => d !== undefined);
  return `${statuses || "status unknown"}${date ? `; status as of ${date}` : ""}; verify`;
}

function subject(f: Finding): string {
  if (f.entity) return f.entity.field === "" ? f.entity.name : `${f.entity.name}.${f.entity.field}`;
  return f.location.file;
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

function withSuffix(body: string, suffix: string): string {
  return suffix === "" ? `${body}.` : `${body} ${suffix}.`;
}

/** One PR-03 sentence (plain text; `renderPrComment` escapes it). */
export function prSentence(f: Finding, kind: "added" | "resolved", regime: RegimeOption): string {
  const where = `${f.location.file}:${f.location.line}`;
  const cats = joinAnd(f.categories);
  const suffix = articleSuffix(f.articles, regime);
  if (SINK_RULES.has(f.ruleId)) {
    const lead = kind === "added" ? "This PR introduces a new flow of" : "This PR removes the flow of";
    return withSuffix(`${lead} ${cats} to ${sinkDescription(f)} at ${where}`, suffix);
  }
  if (f.ruleId === "PR-TRANSFER") {
    if (kind === "added") return withSuffix(`This PR introduces an international transfer of ${cats} to ${destination(f)} at ${where}: ${transferText(f, regime)}`, suffix);
    return withSuffix(`This PR removes the international transfer of ${cats} to ${destination(f)} at ${where}`, suffix);
  }
  const lead = kind === "added" ? "This PR introduces" : "This PR removes";
  return withSuffix(`${lead} ${lowerFirst(RULE_TITLES[f.ruleId])} for ${subject(f)} at ${where}`, suffix);
}

export type PrCommentInput = {
  added: readonly Finding[];
  resolved: readonly Finding[];
  unchanged: number;
  baseSha: string;
  headSha: string;
  changed: number;
  skipped: boolean;
  /** The PR changes `privacy-radar.config.json` (both revisions were scanned with the base config). */
  configChanged?: boolean;
  regime: RegimeOption;
};

const short = (sha: string) => sha.slice(0, 7);
const numberFormat = new Intl.NumberFormat("en-US");
const n = (x: number) => numberFormat.format(x);

/** The Markdown comment of PR mode: heading, sentences, table, counts and the footer with the disclaimer. */
export function renderPrComment(input: PrCommentInput): string {
  const lines: string[] = ["## privacy-radar: compliance changes in this pull request", ""];
  lines.push(`Base ${codeSpan(short(input.baseSha))} → head ${codeSpan(short(input.headSha))} · ${n(input.changed)} file${input.changed === 1 ? "" : "s"} changed`, "");
  if (input.skipped) {
    lines.push("No supported file changed: both scans were skipped.", "");
  } else if (input.added.length === 0 && input.resolved.length === 0) {
    lines.push("No finding was added or resolved by this pull request.", "");
  } else {
    for (const f of input.added) lines.push(`- ${escapeMd(prSentence(f, "added", input.regime))}`);
    for (const f of input.resolved) lines.push(`- ${escapeMd(prSentence(f, "resolved", input.regime))}`);
    lines.push("", "| Change | Severity | Rule | Location | Categories |", "|---|---|---|---|---|");
    const row = (change: string, f: Finding) =>
      `| ${change} | ${f.severity} | ${f.ruleId} | ${tableCell(codeSpan(`${f.location.file}:${f.location.line}`))} | ${tableCell(f.categories.map((c) => codeSpan(c)).join(", "))} |`;
    for (const f of input.added) lines.push(row("added", f));
    for (const f of input.resolved) lines.push(row("resolved", f));
    lines.push("");
  }
  if (input.configChanged) {
    lines.push(`This PR changes ${codeSpan("privacy-radar.config.json")}: both revisions were scanned with the base revision's config, so its suppressions and ignore globs take effect only after merge.`, "");
  }
  if (!input.skipped) lines.push(`${n(input.added.length)} added · ${n(input.resolved.length)} resolved · ${n(input.unchanged)} unchanged`, "");
  lines.push("---", "", `Deterministic rules only; no language model was used for this comment. ${DISCLAIMER_EN}`);
  return `${lines.join("\n")}\n`;
}
