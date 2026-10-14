import type { TermFile } from "../contracts/catalog.ts";

export type TermMode = "exact" | "token" | "suffix";

export type TermHit = { category: string; lang: string; mode: TermMode; term: string; weight: number; reviewed: boolean };

/** A token term may span several tokens (`phone_number`); it matches a contiguous run of tokens. */
type TokenEntry = { hit: TermHit; tokens: readonly string[] };

export type TermIndex = {
  /** joined name -> hits */
  exact: ReadonlyMap<string, TermHit[]>;
  /** first token of the term -> entries */
  token: ReadonlyMap<string, readonly TokenEntry[]>;
  /** suffix terms; a term written with a leading separator (`_mae`) keeps `_` so it matches on a token boundary */
  suffix: readonly TermHit[];
  nonPersonEntities: ReadonlySet<string>;
  minorTerms: ReadonlySet<string>;
};

export const DEFAULT_TERM_WEIGHTS: Readonly<Record<TermMode, number>> = Object.freeze({ exact: 0.6, token: 0.5, suffix: 0.4 });

const MINOR_CATEGORY = "children.minor-flag";
const COMBINING_MARKS = /\p{M}+/gu;
const LOWER_OR_DIGIT_THEN_UPPER = /([\p{Ll}\p{N}])(\p{Lu})/gu;
const UPPER_RUN_THEN_WORD = /(\p{Lu})(\p{Lu}\p{Ll})/gu;
const NON_ALNUM = /[^\p{L}\p{N}]+/u;
const DIGITS = /\p{N}+/gu;

/**
 * Splits camelCase, snake_case, kebab-case, spaces and dots; lower-cases; strips diacritics
 * (NFD, combining marks removed) and digits; drops empty tokens. `joined` is `tokens.join("_")`.
 */
export function normalizeName(raw: string): { tokens: string[]; joined: string } {
  const stripped = raw.normalize("NFD").replace(COMBINING_MARKS, "");
  const split = stripped.replace(LOWER_OR_DIGIT_THEN_UPPER, "$1 $2").replace(UPPER_RUN_THEN_WORD, "$1 $2");
  const tokens = split
    .split(NON_ALNUM)
    .map((t) => t.toLowerCase().replace(DIGITS, ""))
    .filter((t) => t.length > 0);
  return { tokens, joined: tokens.join("_") };
}

/** Free text (a comment, a SQL line): split on every non-alphanumeric, then `normalizeName` per piece. */
export function tokenizeFreeText(text: string): string[] {
  return text.split(NON_ALNUM).flatMap((piece) => (piece === "" ? [] : normalizeName(piece).tokens));
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function suffixKey(raw: string): string {
  const joined = normalizeName(raw).joined;
  if (joined === "") return "";
  return /^[^\p{L}\p{N}]/u.test(raw) ? `_${joined}` : joined;
}

/** Builds the lookup tables; every term is normalized with `normalizeName` here, once. */
export function buildTermIndex(files: readonly TermFile[]): TermIndex {
  const exact = new Map<string, TermHit[]>();
  const token = new Map<string, TokenEntry[]>();
  const suffix: TermHit[] = [];
  const nonPersonEntities = new Set<string>();
  const minorTerms = new Set<string>();

  for (const file of files) {
    for (const name of file.nonPersonEntities) {
      const joined = normalizeName(name).joined;
      if (joined !== "") nonPersonEntities.add(joined);
    }
    for (const entry of file.terms) {
      const make = (mode: TermMode, term: string): TermHit => ({
        category: entry.category,
        lang: file.lang,
        mode,
        term,
        weight: entry.weight ?? DEFAULT_TERM_WEIGHTS[mode],
        reviewed: file.reviewed,
      });
      for (const raw of entry.exact) {
        const joined = normalizeName(raw).joined;
        if (joined === "") continue;
        push(exact, joined, make("exact", joined));
        if (entry.category === MINOR_CATEGORY) minorTerms.add(joined);
      }
      for (const raw of entry.token) {
        const tokens = normalizeName(raw).tokens;
        const first = tokens[0];
        if (first === undefined) continue;
        const joined = tokens.join("_");
        push(token, first, { hit: make("token", joined), tokens });
        if (entry.category === MINOR_CATEGORY) minorTerms.add(joined);
      }
      for (const raw of entry.suffix) {
        const key = suffixKey(raw);
        if (key !== "") suffix.push(make("suffix", key));
      }
    }
  }
  return { exact, token, suffix, nonPersonEntities, minorTerms };
}

function containsRun(tokens: readonly string[], run: readonly string[], from: number): boolean {
  if (from + run.length > tokens.length) return false;
  for (let i = 0; i < run.length; i++) if (tokens[from + i] !== run[i]) return false;
  return true;
}

const MODE_ORDER: Readonly<Record<TermMode, number>> = { exact: 0, token: 1, suffix: 2 };

function compareHits(a: TermHit, b: TermHit): number {
  if (a.weight !== b.weight) return b.weight - a.weight;
  if (a.category !== b.category) return a.category < b.category ? -1 : 1;
  if (a.lang !== b.lang) return a.lang < b.lang ? -1 : 1;
  if (a.mode !== b.mode) return MODE_ORDER[a.mode] - MODE_ORDER[b.mode];
  return a.term < b.term ? -1 : a.term > b.term ? 1 : 0;
}

/**
 * Hits for a name: `exact` (joined name equals the term), `token` (a token, or a contiguous run of
 * tokens, equals the term), `suffix` (joined name ends with the term). Sorted by weight descending,
 * then category; one hit per (category, lang, mode, term).
 */
export function matchTerms(name: string, index: TermIndex): TermHit[] {
  const { tokens, joined } = normalizeName(name);
  if (joined === "") return [];
  const out = new Map<string, TermHit>();
  const add = (h: TermHit) => out.set(`${h.category}\u0000${h.lang}\u0000${h.mode}\u0000${h.term}`, h);

  for (const h of index.exact.get(joined) ?? []) add(h);
  tokens.forEach((t, i) => {
    for (const entry of index.token.get(t) ?? []) if (containsRun(tokens, entry.tokens, i)) add(entry.hit);
  });
  for (const h of index.suffix) if (joined.endsWith(h.term)) add(h);
  return [...out.values()].sort(compareHits);
}
