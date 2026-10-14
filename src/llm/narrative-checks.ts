import type { DraftNarrativeInput, DraftNarrativeOutput } from "../contracts/llm.ts";

// Checks on an LLM narrative (spec 5.3, DOC-05). This module rejects legal citations; it never
// produces one. Pure.

export type CitationRegime = "lgpd" | "gdpr";

const NUM = String.raw`\d{1,3}(?:\([a-z0-9]+\))*`;
const RANGE_WORDS = ["to", "a", "through"];
const SEP = String.raw`\s*(?:[,;\-–—]|\b(?:and|e|or|ou|to|a|through)\b)\s*`;
const PREFIX = String.raw`(?:(?<![\p{L}\p{N}])(?:arts?|artigos?|articles?|recitals?|considerandos?|lgpd|gdpr|rgpd)\.?|§§?)`;

/** Every citation form of spec 5.3: a citation word or `§`, an optional `nº`, then numbers joined by separators. */
export const CITATION = new RegExp(String.raw`${PREFIX}\s*(?:n[ºo°]\.?\s*)?(${NUM}(?:${SEP}${NUM})*)`, "giu");

const NUM_RE = new RegExp(NUM, "gu");

export type Citation = { regime: CitationRegime | null; recital: boolean; numbers: string[]; ranges: [string, string][]; start: number; end: number };

function isRangeSeparator(sep: string): boolean {
  const s = sep.trim().toLowerCase();
  return s === "-" || s === "–" || s === "—" || RANGE_WORDS.includes(s);
}

/** The citations of a text, with the numbers and ranges each one names. */
export function extractCitations(text: string): Citation[] {
  const out: Citation[] = [];
  for (const m of text.matchAll(CITATION)) {
    const whole = m[0];
    const list = m[1] ?? "";
    const head = whole.slice(0, whole.length - list.length).toLowerCase();
    const regime: CitationRegime | null = head.startsWith("lgpd") ? "lgpd" : head.startsWith("gdpr") || head.startsWith("rgpd") ? "gdpr" : null;
    const recital = head.startsWith("recital") || head.startsWith("considerando");
    const tokens: { value: string; sepBefore: string }[] = [];
    let last = 0;
    for (const n of list.matchAll(NUM_RE)) {
      const at = n.index ?? 0;
      tokens.push({ value: n[0], sepBefore: list.slice(last, at) });
      last = at + n[0].length;
    }
    const numbers: string[] = [];
    const ranges: [string, string][] = [];
    for (let i = 0; i < tokens.length; i++) {
      const next = tokens[i + 1];
      if (next && isRangeSeparator(next.sepBefore)) {
        ranges.push([tokens[i]!.value, next.value]);
        i++;
      } else {
        numbers.push(tokens[i]!.value);
      }
    }
    const start = m.index ?? 0;
    out.push({ regime, recital, numbers, ranges, start, end: start + whole.length });
  }
  return out;
}

/** The numbers a citation names, ranges expanded to every integer between their ends. */
export function expandCitation(c: Pick<Citation, "numbers" | "ranges">): string[] {
  const out = [...c.numbers];
  for (const [a, b] of c.ranges) {
    const from = Number.parseInt(a, 10);
    const to = Number.parseInt(b, 10);
    if (to < from || to - from > 999) out.push(a, b);
    else for (let n = from; n <= to; n++) out.push(String(n));
  }
  return out;
}

/** The closed list of spelled-out numbers (en and pt) the narrative must not use. */
export const SPELLED_OUT: readonly string[] = [
  "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "dozens", "hundreds",
  "dois", "duas", "três", "tres", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "dezenas", "centenas",
];
const SPELLED_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${SPELLED_OUT.join("|")})(?![\\p{L}\\p{N}])`, "iu");

/** `a` names `b` or a part of it: `33` and `33 II`, `30(1)` and `30(1)(c)`. */
function structuralPrefix(a: string, b: string): boolean {
  return b === a || b.startsWith(`${a} `) || b.startsWith(`${a}(`);
}

function allowedKeys(input: DraftNarrativeInput, regime: CitationRegime | null): string[] {
  const { lgpd, gdpr } = input.facts.allowedArticles;
  return regime === "lgpd" ? lgpd : regime === "gdpr" ? gdpr : [...lgpd, ...gdpr];
}

function citationAllowed(c: Citation, input: DraftNarrativeInput): boolean {
  const keys = allowedKeys(input, c.regime);
  const recitalKeys = keys.filter((k) => k.startsWith("recital ")).map((k) => k.slice("recital ".length));
  const plainKeys = keys.filter((k) => !k.startsWith("recital "));
  const pool = c.recital ? recitalKeys : plainKeys;
  return expandCitation(c).every((n) => pool.some((k) => structuralPrefix(n, k) || structuralPrefix(k, n)));
}

function numbersIn(value: unknown, into: Set<number>): Set<number> {
  if (typeof value === "number") into.add(value);
  else if (Array.isArray(value)) for (const v of value) numbersIn(v, into);
  else if (value !== null && typeof value === "object") for (const v of Object.values(value)) numbersIn(v, into);
  return into;
}

const FINDING_ID = /PRF-[0-9a-f]{12}/g;

export type NarrativeCheck = { ok: true } | { ok: false; reason: "unknown-finding-id" | "article-drift" | "numbers-drift" };

/** DOC-05, in order: cited finding ids exist; every citation names an allowed key; every other number comes from the facts and none is spelled out. */
export function checkNarrative(output: DraftNarrativeOutput, input: DraftNarrativeInput, knownFindingIds: ReadonlySet<string>): NarrativeCheck {
  if (output.citedFindingIds.some((id) => !knownFindingIds.has(id))) return { ok: false, reason: "unknown-finding-id" };
  const text = output.paragraphs.join("\n");
  const citations = extractCitations(text);
  if (citations.some((c) => !citationAllowed(c, input))) return { ok: false, reason: "article-drift" };
  let rest = text;
  for (const c of [...citations].sort((a, b) => b.start - a.start)) rest = `${rest.slice(0, c.start)} ${rest.slice(c.end)}`;
  rest = rest.replace(FINDING_ID, " ");
  if (SPELLED_RE.test(rest)) return { ok: false, reason: "numbers-drift" };
  const facts = numbersIn(input.facts, new Set<number>());
  for (const token of rest.match(/\d+(?:\.\d+)?/g) ?? []) if (!facts.has(Number(token))) return { ok: false, reason: "numbers-drift" };
  return { ok: true };
}
