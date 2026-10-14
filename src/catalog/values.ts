import type { Category } from "../contracts/catalog.ts";
import { LIMITS } from "../contracts/limits.ts";
import type { Checksum, LiteralBinding, ValueHit } from "../contracts/source-model.ts";
import { maskBoundLiteral, maskValue } from "../infra/mask.ts";
import { VALIDATORS } from "../validators/index.ts";
import { matchTerms, tokenizeFreeText, type TermIndex } from "./terms.ts";

export type DetectContext = {
  path: string;
  literalBindings: readonly LiteralBinding[];
  termIndex: TermIndex;
  categories: readonly Category[];
};

export type MaskContext = { valueHits: readonly ValueHit[]; literalBindings: readonly LiteralBinding[]; termIndex: TermIndex };

const EMAIL = "contact.email";
const DIGITS_ONLY = /^\d+$/;
const COMPILED = new Map<string, RegExp>();

function compiled(source: string): RegExp {
  let re = COMPILED.get(source);
  if (!re) {
    re = new RegExp(source, "g");
    COMPILED.set(source, re);
  }
  return re;
}

/** The `valuePattern` sources of the catalog, in category order. */
export function VALUE_PATTERN_SOURCES(catalog: { categories: readonly Category[] }): string[] {
  return catalog.categories.flatMap((c) => (c.valuePattern === undefined ? [] : [c.valuePattern]));
}

// ---------------------------------------------------------------------------------------------
// Static shape lint (VAL-05)

type Frame = { lookaround: boolean; start: number; lastUnbounded: boolean; anyAltEndsUnbounded: boolean; containsUnbounded: boolean };

type Quantifier = { length: number; unbounded: boolean; repeats: boolean };

function readQuantifier(source: string, at: number): Quantifier | null {
  const c = source[at];
  let q: Quantifier | null = null;
  if (c === "+" || c === "*") q = { length: 1, unbounded: true, repeats: true };
  else if (c === "?") q = { length: 1, unbounded: false, repeats: false };
  else if (c === "{") {
    const m = /^\{(\d+)(,(\d*))?\}/.exec(source.slice(at));
    if (m) {
      const max = m[2] === undefined ? Number(m[1]) : m[3] === "" ? Infinity : Number(m[3]);
      q = { length: m[0].length, unbounded: max === Infinity, repeats: max > 1 };
    }
  }
  if (q && source[at + q.length] === "?") q = { ...q, length: q.length + 1 };
  return q;
}

/**
 * Problems in a regex source: a repeated group whose body (any alternative) ends with an unbounded
 * quantifier (`(a+)+`, `(x\d{2,})*`), and a lookaround containing an unbounded quantifier (`(?=.*x)`).
 */
export function lintRegexShape(source: string): string[] {
  const problems: string[] = [];
  const root: Frame = { lookaround: false, start: -1, lastUnbounded: false, anyAltEndsUnbounded: false, containsUnbounded: false };
  const stack: Frame[] = [root];
  const top = () => stack[stack.length - 1]!;
  const afterAtom = (frame: Frame, at: number): number => {
    const q = readQuantifier(source, at);
    frame.lastUnbounded = q?.unbounded ?? false;
    if (q?.unbounded) frame.containsUnbounded = true;
    return at + (q?.length ?? 0);
  };
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === "\\") {
      i = afterAtom(top(), i + 2);
    } else if (c === "[") {
      let j = i + 1;
      if (source[j] === "^") j++;
      if (source[j] === "]") j++;
      while (j < source.length && source[j] !== "]") j += source[j] === "\\" ? 2 : 1;
      i = afterAtom(top(), j + 1);
    } else if (c === "(") {
      const rest = source.slice(i);
      const lookaround = /^\(\?(?:=|!|<=|<!)/.test(rest);
      const prefix = /^\(\?(?:=|!|<=|<!|:|<[A-Za-z_$][\w$]*>)/.exec(rest)?.[0] ?? "(";
      stack.push({ lookaround, start: i, lastUnbounded: false, anyAltEndsUnbounded: false, containsUnbounded: false });
      i += prefix.length;
    } else if (c === "|") {
      const f = top();
      f.anyAltEndsUnbounded ||= f.lastUnbounded;
      f.lastUnbounded = false;
      i++;
    } else if (c === ")" && stack.length > 1) {
      const f = stack.pop()!;
      const parent = top();
      const endsUnbounded = f.anyAltEndsUnbounded || f.lastUnbounded;
      if (f.lookaround && f.containsUnbounded) problems.push(`unbounded quantifier inside a lookaround at ${f.start}`);
      const q = readQuantifier(source, i + 1);
      if (q?.repeats && endsUnbounded) problems.push(`repeated group ending with an unbounded quantifier at ${f.start}`);
      if (f.containsUnbounded) parent.containsUnbounded = true;
      i = afterAtom(parent, i + 1);
    } else {
      i = afterAtom(top(), i + 1);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Detection

type Span = { start: number; end: number; categories: Category[] };
type Evaluated = { start: number; end: number; categories: string[]; checksum: Checksum; corroborated: boolean; rank: number };

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

/** 1-based line of an offset (binary search over line starts). */
function lineOf(starts: readonly number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

const STRONG_MODES = new Set(["exact", "token"]);

function strongCategories(name: string, index: TermIndex, cache: Map<string, ReadonlySet<string>>): ReadonlySet<string> {
  let set = cache.get(name);
  if (!set) {
    set = new Set(matchTerms(name, index).flatMap((h) => (STRONG_MODES.has(h.mode) ? [h.category] : [])));
    cache.set(name, set);
  }
  return set;
}

function sortedBindings(bindings: readonly LiteralBinding[]): LiteralBinding[] {
  return [...bindings].sort((a, b) => a.start - b.start || b.end - a.end);
}

/** The binding whose literal contains [start, end): literals never nest, so it is the last one starting at or before `start`. */
function containingBinding(sorted: readonly LiteralBinding[], start: number, end: number): LiteralBinding | null {
  let lo = 0;
  let hi = sorted.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]!.start <= start) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  for (let i = found; i >= 0 && i > found - 4; i--) {
    const b = sorted[i]!;
    if (b.start <= start && end <= b.end) return b;
  }
  return null;
}

type Corroborator = (span: Span) => ReadonlySet<string>;

function makeCorroborator(text: string, ctx: DetectContext): Corroborator {
  const starts = lineStartsOf(text);
  const bindings = sortedBindings(ctx.literalBindings);
  const nameCache = new Map<string, ReadonlySet<string>>();
  const windowCache = new Map<number, ReadonlySet<string>>();
  return (span) => {
    const b = containingBinding(bindings, span.start, span.end);
    if (b && b.bindingName !== "*") return strongCategories(b.bindingName, ctx.termIndex, nameCache);
    const line = lineOf(starts, span.start);
    const cached = windowCache.get(line);
    if (cached) return cached;
    const from = starts[Math.max(1, line - LIMITS.corroborationLines) - 1]!;
    const to = line < starts.length ? starts[line]! : text.length;
    const set = new Set<string>();
    for (const token of new Set(tokenizeFreeText(text.slice(from, to)))) for (const c of strongCategories(token, ctx.termIndex, nameCache)) set.add(c);
    windowCache.set(line, set);
    return set;
  };
}

function evaluate(text: string, span: Span, corroborate: Corroborator): Evaluated {
  const value = text.slice(span.start, span.end);
  const passing: string[] = [];
  const failing: string[] = [];
  const regexOnly: string[] = [];
  for (const c of span.categories) {
    if (c.validator === undefined) regexOnly.push(c.id);
    else if (VALIDATORS[c.validator](value)) passing.push(c.id);
    else failing.push(c.id);
  }
  const base = { start: span.start, end: span.end };
  const result = (categories: string[], checksum: Checksum, corroborated: boolean, rank: number): Evaluated => ({
    ...base,
    categories: [...new Set(categories)].sort(),
    checksum,
    corroborated,
    rank,
  });
  if (!DIGITS_ONLY.test(value)) {
    if (passing.length > 0) return result(passing, "valid", true, 0);
    if (regexOnly.length > 0) return result(regexOnly, "n/a", true, 1);
    return result(failing, "invalid", true, 2);
  }
  const terms = corroborate(span);
  const keep = (ids: string[]) => ids.filter((id) => terms.has(id));
  if (keep(passing).length > 0) return result(keep(passing), "valid", true, 0);
  if (keep(regexOnly).length > 0) return result(keep(regexOnly), "n/a", true, 1);
  if (keep(failing).length > 0) return result(keep(failing), "invalid", true, 2);
  return result([], "n/a", false, 3);
}

/**
 * Value candidates from every category's `valuePattern`, then the validators and the corroboration
 * rule of spec 4.2 (VAL-06) and Spec delta 3. Candidates with the same span merge (union of passing
 * categories); overlapping spans keep the longest, then the best-ranked. Every hit comes back masked.
 */
export function detectValues(text: string, ctx: DetectContext): ValueHit[] {
  const spans = new Map<string, Span>();
  for (const category of ctx.categories) {
    if (category.valuePattern === undefined) continue;
    for (const m of text.matchAll(compiled(category.valuePattern))) {
      if (m[0].length === 0) continue;
      const key = `${m.index}:${m.index + m[0].length}`;
      const span = spans.get(key);
      if (span) span.categories.push(category);
      else spans.set(key, { start: m.index, end: m.index + m[0].length, categories: [category] });
    }
  }
  if (spans.size === 0) return [];

  const corroborate = makeCorroborator(text, ctx);
  const evaluated = [...spans.values()]
    .map((s) => evaluate(text, s, corroborate))
    .sort((a, b) => b.end - b.start - (a.end - a.start) || a.rank - b.rank || a.start - b.start);

  const taken = new Uint8Array(text.length);
  const accepted: Evaluated[] = [];
  for (const e of evaluated) {
    let free = true;
    for (let i = e.start; i < e.end; i++) {
      if (taken[i]) {
        free = false;
        break;
      }
    }
    if (!free) continue;
    taken.fill(1, e.start, e.end);
    accepted.push(e);
  }

  const starts = lineStartsOf(text);
  return accepted
    .sort((a, b) => a.start - b.start)
    .map((e) => {
      const line = lineOf(starts, e.start);
      const maskAs = e.categories.includes(EMAIL) ? EMAIL : (e.categories[0] ?? "");
      return {
        categories: e.categories,
        checksum: e.checksum,
        corroborated: e.corroborated,
        masked: maskValue(text.slice(e.start, e.end), maskAs),
        line,
        column: e.start - starts[line - 1]! + 1,
        length: e.end - e.start,
        start: e.start,
        end: e.end,
      };
    });
}

// ---------------------------------------------------------------------------------------------
// Masking

const QUOTES = new Set(["'", '"', "`"]);

/** The part of a literal that is masked: inside its quotes when it has them (also SQL `E'...'`). */
function innerRange(text: string, b: LiteralBinding): [number, number] {
  const first = text[b.start] ?? "";
  const last = text[b.end - 1] ?? "";
  if (b.end - b.start >= 2 && QUOTES.has(first) && last === first) return [b.start + 1, b.end - 1];
  if (b.end - b.start >= 3 && (first === "E" || first === "e") && text[b.start + 1] === "'" && last === "'") return [b.start + 2, b.end - 1];
  return [b.start, b.end];
}

function markMasked(marks: Uint8Array, original: string, masked: string, offset: number): void {
  for (let i = 0; i < masked.length && i < original.length; i++) {
    if (masked[i] !== original[i]) marks[offset + i] = 1;
  }
}

/**
 * The same text with every value hit masked and every literal masked whose binding name classifies
 * (or is `"*"`), delimiters kept. Length-preserving: same length, same line breaks.
 */
export function maskText(text: string, ctx: MaskContext): string {
  const marks = new Uint8Array(text.length);
  const classifies = new Map<string, boolean>();
  for (const b of ctx.literalBindings) {
    let should = b.bindingName === "*";
    if (!should) {
      const known = classifies.get(b.bindingName);
      should = known ?? matchTerms(b.bindingName, ctx.termIndex).length > 0;
      classifies.set(b.bindingName, should);
    }
    if (!should || b.start < 0 || b.end > text.length || b.end <= b.start) continue;
    const [from, to] = innerRange(text, b);
    const original = text.slice(from, to);
    markMasked(marks, original, maskBoundLiteral(original), from);
  }
  for (const h of ctx.valueHits) {
    if (h.start < 0 || h.end > text.length) continue;
    markMasked(marks, text.slice(h.start, h.end), h.masked, h.start);
  }
  let out = "";
  let runStart = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || marks[i]) {
      out += text.slice(runStart, i);
      if (i < text.length) {
        let j = i;
        while (j < text.length && marks[j]) j++;
        out += "*".repeat(j - i);
        runStart = j;
        i = j - 1;
      }
    }
  }
  return out;
}
