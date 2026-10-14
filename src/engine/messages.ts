// Finding message templates (spec 5.1, 5.5). Messages carry category ids, callees, hosts and
// article numbers, never a scanned value. Pure.
import { articleKey, type ArticleRef, type RegimeOption } from "../contracts/catalog.ts";
import type { FileSink } from "./model.ts";
import type { TransferAssessment } from "./transfer.ts";

type Parsed = { kind: "int"; n: number; raw: string } | { kind: "roman"; art: string; n: number; roman: string; raw: string } | { kind: "letter"; prefix: string; letter: string; raw: string } | { kind: "other"; raw: string };

const ROMAN: Readonly<Record<string, number>> = { I: 1, V: 5, X: 10, L: 50, C: 100 };

function romanValue(s: string): number {
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]!] ?? 0;
    const next = ROMAN[s[i + 1] ?? ""] ?? 0;
    total += v < next ? -v : v;
  }
  return total;
}

function parseKey(raw: string): Parsed {
  if (/^\d+$/.test(raw)) return { kind: "int", n: Number(raw), raw };
  const roman = /^(\d+(?:-[A-Z])?) ([IVXLC]+)$/.exec(raw);
  if (roman) return { kind: "roman", art: roman[1]!, roman: roman[2]!, n: romanValue(roman[2]!), raw };
  const letter = /^(\d+(?:\([a-z0-9]+\))*)\(([a-z])\)$/.exec(raw);
  if (letter) return { kind: "letter", prefix: letter[1]!, letter: letter[2]!, raw };
  return { kind: "other", raw };
}

/** Runs of at least this many consecutive numbers or roman items are shown as a range. */
const MIN_RANGE = 3;

/**
 * Display form of a key list (spec 5.1): consecutive numbers `44, 45, 46` → `44-46`; consecutive
 * roman items of one article `6 I, 6 II, 6 III` → `6 I-III`; adjacent letter items of one prefix
 * `5(1)(b), 5(1)(c)` → `5(1)(b)(c)`. Runs shorter than three stay as they are. Display only.
 */
export function compressKeys(keys: readonly string[]): string {
  const parsed = keys.map(parseKey);
  const out: string[] = [];
  let i = 0;
  while (i < parsed.length) {
    const p = parsed[i]!;
    let j = i + 1;
    if (p.kind === "int") {
      while (j < parsed.length) {
        const q = parsed[j]!;
        const prev = parsed[j - 1]! as { n: number };
        if (q.kind !== "int" || q.n !== prev.n + 1) break;
        j++;
      }
      const last = parsed[j - 1]! as { raw: string };
      out.push(...(j - i >= MIN_RANGE ? [`${p.raw}-${last.raw}`] : parsed.slice(i, j).map((x) => x.raw)));
    } else if (p.kind === "roman") {
      while (j < parsed.length) {
        const q = parsed[j]!;
        const prev = parsed[j - 1]! as { n: number };
        if (q.kind !== "roman" || q.art !== p.art || q.n !== prev.n + 1) break;
        j++;
      }
      const last = parsed[j - 1]! as { roman: string };
      out.push(...(j - i >= MIN_RANGE ? [`${p.art} ${p.roman}-${last.roman}`] : parsed.slice(i, j).map((x) => x.raw)));
    } else if (p.kind === "letter") {
      while (j < parsed.length) {
        const q = parsed[j]!;
        if (q.kind !== "letter" || q.prefix !== p.prefix) break;
        j++;
      }
      const run = parsed.slice(i, j) as { letter: string }[];
      out.push(run.length >= 2 ? `${p.prefix}${run.map((x) => `(${x.letter})`).join("")}` : p.raw);
    } else {
      out.push(p.raw);
    }
    i = j;
  }
  return out.join(", ");
}

/** `(LGPD 6 VII, 46; GDPR 5(1)(f), 32)`; only the selected regimes with at least one article; empty when none. */
export function articleSuffix(articles: { lgpd: readonly ArticleRef[]; gdpr: readonly ArticleRef[] }, regime: RegimeOption): string {
  const parts: string[] = [];
  if (regime !== "gdpr" && articles.lgpd.length > 0) parts.push(`LGPD ${compressKeys(articles.lgpd.map(articleKey))}`);
  if (regime !== "lgpd" && articles.gdpr.length > 0) parts.push(`GDPR ${compressKeys(articles.gdpr.map(articleKey))}`);
  return parts.length > 0 ? `(${parts.join("; ")})` : "";
}

/** `a`, `a and b`, `a, b and c`, `a, b, c and 8 more`. */
export function categoryList(categories: readonly string[]): string {
  if (categories.length <= 1) return categories.join("");
  if (categories.length <= 3) return `${categories.slice(0, -1).join(", ")} and ${categories[categories.length - 1]}`;
  return `${categories.slice(0, 3).join(", ")} and ${categories.length - 3} more`;
}

function sentence(body: string, suffix: string): string {
  return suffix === "" ? `${body}.` : `${body} ${suffix}.`;
}

const PROCESSOR_ROLE = "art. 28 applies if the vendor acts as a processor; verify the vendor's role";

function destination(sink: FileSink): string {
  if (sink.kind === "analytics") return sink.vendor ? `${sink.vendor.vendor} (${sink.vendor.hqCountry})` : "an unknown vendor";
  if (sink.unresolved || sink.host === null) return "an unresolved host";
  if (sink.vendor) return `${sink.host} (${sink.vendor.vendor}, ${sink.vendor.hqCountry})`;
  return `${sink.host} (unknown destination)`;
}

/** Message of a sink rule (`PR-LOG`, `PR-THIRD-PARTY`, `PR-ANALYTICS`, `PR-FILE`, `PR-URL-QUERY`). */
export function sinkMessage(input: {
  categories: readonly string[];
  sink: FileSink;
  hop: { via: string } | null;
  transfer: readonly TransferAssessment[];
  articles: { lgpd: readonly ArticleRef[]; gdpr: readonly ArticleRef[] };
  regime: RegimeOption;
}): string {
  const { sink } = input;
  const verb = input.categories.length === 1 ? "reaches" : "reach";
  const what =
    sink.kind === "log"
      ? `the log call ${sink.callee}`
      : sink.kind === "file"
        ? `the file write ${sink.callee}`
        : sink.kind === "url-query"
          ? `the URL query parameter "${sink.queryParam ?? "?"}"`
          : sink.kind === "analytics"
            ? `the analytics call ${sink.callee} to ${destination(sink)}`
            : `the HTTP call ${sink.callee} to ${destination(sink)}`;
  let body = `${categoryList(input.categories)} ${verb} ${what}`;
  if (input.hop) body += ` through the local binding ${input.hop.via}`;
  if (sink.kind === "http" || sink.kind === "analytics") body += `; ${PROCESSOR_ROLE}`;
  const declared = input.transfer.find((t) => t.status === "mechanism-declared");
  if (declared) body += `; mechanism declared in config: ${declared.mechanism}; verify the contract`;
  return sentence(body, articleSuffix(input.articles, input.regime));
}

/** Message of `PR-TRANSFER`: the status per selected regime, dated and worded "verify". */
export function transferMessage(input: {
  categories: readonly string[];
  sink: FileSink;
  transfer: readonly TransferAssessment[];
  checkedOn: string;
  articles: { lgpd: readonly ArticleRef[]; gdpr: readonly ArticleRef[] };
  regime: RegimeOption;
}): string {
  const statuses = input.transfer.map((t) => `${t.regime.toUpperCase()} ${t.status}`).join(", ");
  const body = `International transfer of ${categoryList(input.categories)} to ${destination(input.sink)}: ${statuses}; status as of ${input.checkedOn}; verify`;
  return sentence(body, articleSuffix(input.articles, input.regime));
}

/** Message of an entity rule. */
export function entityMessage(input: {
  ruleId: "PR-PLAINTEXT-SENSITIVE" | "PR-RETENTION" | "PR-CHILD";
  entity: string;
  field: string | null;
  categories: readonly string[];
  articles: { lgpd: readonly ArticleRef[]; gdpr: readonly ArticleRef[] };
  regime: RegimeOption;
}): string {
  const cats = categoryList(input.categories);
  const body =
    input.ruleId === "PR-PLAINTEXT-SENSITIVE"
      ? `Field ${input.entity}.${input.field ?? ""} (${cats}) is stored as plain text; encrypt, hash or restrict it`
      : input.ruleId === "PR-RETENTION"
        ? `Entity ${input.entity} stores personal data (${cats}) with no retention signal (no deleted_at, expires_at, retention, purge or anonymized_at field and no config retention entry)`
        : `Entity ${input.entity} has children indicators (${cats}); minority is not asserted, verify whether children's data is processed`;
  return sentence(body, articleSuffix(input.articles, input.regime));
}

/** Spec 5.5: "<n> hard-coded personal values (<categories>); move them to a secret store or synthetic test data". */
export function hardcodedMessage(n: number, categories: readonly string[]): string {
  return `${n} hard-coded personal value${n === 1 ? "" : "s"} (${categories.join(", ")}); move them to a secret store or synthetic test data`;
}

/** Message of `PR-PARSE`. */
export function parseMessage(code: string, file: string): string {
  return `${file} was not fully analysed (${code}); findings for this file may be missing.`;
}

/** Message of `PR-AMBIGUOUS`: the label is advisory and never changes a deterministic finding. */
export function ambiguousMessage(input: {
  entity: string;
  field: string;
  label: string;
  confidence: number;
  articles: { lgpd: readonly ArticleRef[]; gdpr: readonly ArticleRef[] };
  regime: RegimeOption;
}): string {
  const body = `Ambiguous field ${input.entity}.${input.field} was labeled ${input.label} (${input.confidence.toFixed(2)}) by the LLM; advisory, review the field`;
  return sentence(body, articleSuffix(input.articles, input.regime));
}
