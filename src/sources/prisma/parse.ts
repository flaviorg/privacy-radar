import { LIMITS } from "../../contracts/limits.ts";
import type { Entity, Field, LiteralBinding, ScanWarning, SourceFile, TextRange } from "../../contracts/source-model.ts";
import { normalizeEntityName } from "../names.ts";
import { tokenizePrisma, type PrismaToken } from "./tokenizer.ts";

type Cursor = { toks: readonly PrismaToken[]; i: number };

const peek = (c: Cursor, k = 0): PrismaToken | undefined => c.toks[c.i + k];

/** Index just past the `)` that closes the `(` at `open` (or the end of the line when unbalanced). */
function closeParen(toks: readonly PrismaToken[], open: number): number {
  let depth = 0;
  for (let j = open; j < toks.length; j++) {
    const t = toks[j]!;
    if (t.kind === "newline" && depth > 0) return j;
    if (t.kind === "punct" && (t.text === "(" || t.text === "[" || t.text === "{")) depth++;
    else if (t.kind === "punct" && (t.text === ")" || t.text === "]" || t.text === "}")) {
      depth--;
      if (depth === 0) return j + 1;
    }
  }
  return toks.length;
}

/** Index of the `}` that closes the block whose `{` is at `open`, or the last token. */
function closeBrace(toks: readonly PrismaToken[], open: number): number {
  let depth = 0;
  for (let j = open; j < toks.length; j++) {
    const t = toks[j]!;
    if (t.kind !== "punct") continue;
    if (t.text === "{") depth++;
    else if (t.text === "}") {
      depth--;
      if (depth === 0) return j;
    }
  }
  return toks.length;
}

const endOf = (t: PrismaToken) => t.start + t.text.length;
const unquote = (s: string) => (s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1).replace(/\\(.)/g, "$1") : s);

function docText(comments: readonly PrismaToken[]): { comment: string | null; commentRange: TextRange | null } {
  const first = comments[0];
  const last = comments[comments.length - 1];
  if (!first || !last) return { comment: null, commentRange: null };
  const comment = comments
    .map((t) => t.text.replace(/^\/\/\/\s?/, "").trim())
    .filter((s) => s.length > 0)
    .join(" ");
  return { comment: comment === "" ? null : comment, commentRange: { start: first.start + 3, end: endOf(last) } };
}

type Line = { toks: PrismaToken[]; docs: PrismaToken[] };

/** Splits a block body into lines, attaching the `///` lines right above each line. */
function linesOf(toks: readonly PrismaToken[]): Line[] {
  const out: Line[] = [];
  let docs: PrismaToken[] = [];
  let current: PrismaToken[] = [];
  let blankRun = false;
  const flush = () => {
    if (current.length > 0) {
      out.push({ toks: current, docs });
      docs = [];
    }
    current = [];
  };
  for (const t of toks) {
    if (t.kind === "newline") {
      if (current.length === 0 && blankRun) docs = [];
      blankRun = current.length === 0;
      flush();
    } else if (t.kind === "docComment") {
      if (current.length > 0) flush();
      docs.push(t);
      blankRun = false;
    } else {
      current.push(t);
    }
  }
  flush();
  return out;
}

type ModelResult = { entity: Entity; bindings: LiteralBinding[]; warnings: ScanWarning[] };

function parseModel(rel: string, text: string, nameTok: PrismaToken, body: readonly PrismaToken[]): ModelResult {
  const fields: Field[] = [];
  const bindings: LiteralBinding[] = [];
  let mapped: string | null = null;
  for (const { toks, docs } of linesOf(body)) {
    const head = toks[0]!;
    if (head.kind === "blockAttr") {
      if (head.text === "@@map" && toks[1]?.text === "(" && toks[2]?.kind === "string") mapped = unquote(toks[2].text);
      continue;
    }
    if (head.kind !== "word" || toks[1]?.kind !== "word") continue;
    const typeTok = toks[1];
    let j = 2;
    let typeEnd = endOf(typeTok);
    if (toks[j]?.text === "(") {
      j = closeParen(toks, j);
      typeEnd = endOf(toks[j - 1]!);
    }
    let optional = false;
    let array = false;
    for (;;) {
      const t = toks[j];
      if (t?.kind === "punct" && t.text === "?") {
        optional = true;
        j++;
      } else if (t?.kind === "punct" && t.text === "[" && toks[j + 1]?.text === "]") {
        array = true;
        j += 2;
      } else break;
    }
    const attributes: string[] = [];
    let defaultValue: string | null = null;
    let defaultRange: TextRange | null = null;
    while (j < toks.length) {
      const t = toks[j]!;
      if (t.kind !== "attr") {
        j++;
        continue;
      }
      let end = j + 1;
      if (toks[end]?.text === "(") end = closeParen(toks, end);
      const last = toks[end - 1]!;
      attributes.push(text.slice(t.start, endOf(last)));
      if (t.text === "@default" && end - j >= 3) {
        const open = toks[j + 1]!;
        const close = toks[end - 1]!;
        const inner = close.text === ")" ? close.start : endOf(close);
        defaultRange = { start: endOf(open), end: inner };
        defaultValue = text.slice(defaultRange.start, defaultRange.end).trim();
        for (let k = j + 2; k < end; k++) {
          const s = toks[k]!;
          if (s.kind === "string") bindings.push({ bindingName: head.text, start: s.start, end: endOf(s), line: s.line, column: s.column });
        }
      }
      j = end;
    }
    const type = text.slice(typeTok.start, typeEnd);
    fields.push({
      name: head.text,
      rawName: head.text,
      type,
      rawType: type,
      optional,
      array,
      loc: { line: head.line, column: head.column },
      attributes,
      ...docText(docs),
      defaultValue,
      defaultRange,
      declarationText: "",
    });
  }
  const warnings: ScanWarning[] = [];
  let kept = fields;
  if (fields.length > LIMITS.entityFields) {
    kept = fields.slice(0, LIMITS.entityFields);
    warnings.push({ file: rel, line: nameTok.line, code: "ENTITY_TOO_LARGE", message: `entity ${nameTok.text} has ${fields.length} fields; kept the first ${LIMITS.entityFields}` });
  }
  const entity: Entity = {
    name: nameTok.text,
    normalizedName: normalizeEntityName(mapped ?? nameTok.text),
    kind: "model",
    loc: { line: nameTok.line, column: nameTok.column },
    fields: kept,
    protectionHints: [],
  };
  return { entity, bindings, warnings };
}

/**
 * Prisma adapter (SCH-04): `model` blocks become entities with exact field positions, attributes as
 * their source text, `///` comments, `@@map` feeding `normalizedName`, and one literal binding per
 * `@default("…")` string named by the field. `enum`, `type`, `view`, `generator` and `datasource`
 * blocks are skipped. Never throws on malformed input.
 */
export function parsePrismaSource(rel: string, text: string): SourceFile {
  const toks = tokenizePrisma(text);
  const c: Cursor = { toks, i: 0 };
  const entities: Entity[] = [];
  const literalBindings: LiteralBinding[] = [];
  const warnings: ScanWarning[] = [];
  while (c.i < toks.length) {
    const t = peek(c)!;
    const name = peek(c, 1);
    const open = peek(c, 2);
    const isBlock = t.kind === "word" && name?.kind === "word" && open?.kind === "punct" && open.text === "{";
    if (!isBlock) {
      c.i++;
      continue;
    }
    const close = closeBrace(toks, c.i + 2);
    // enum, type, view, generator, datasource and unknown block keywords are skipped
    if (t.text === "model") {
      const r = parseModel(rel, text, name, toks.slice(c.i + 3, close));
      entities.push(r.entity);
      literalBindings.push(...r.bindings);
      warnings.push(...r.warnings);
    }
    c.i = close + 1;
  }
  return { path: rel, kind: "prisma", entities, functions: [], literalBindings, warnings };
}
