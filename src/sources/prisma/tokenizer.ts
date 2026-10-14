export type PrismaTokenKind = "word" | "string" | "punct" | "attr" | "blockAttr" | "docComment" | "newline";

/** `column` is 1-based (UTF-16 units), like `Loc`. */
export type PrismaToken = { kind: PrismaTokenKind; text: string; start: number; line: number; column: number };

const WORD = /[A-Za-z0-9_]/;
const ATTR_NAME = /^@@?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/;

/**
 * Tokens of a Prisma schema: `//` comments are dropped, `///` lines are kept as `docComment`,
 * strings keep their quotes and escapes, `@x`/`@db.X` are `attr`, `@@x` is `blockAttr`, and the
 * contents of parentheses are tokenized like the rest. `\r` and a BOM are whitespace; only `\n`
 * makes a `newline` token, so a CRLF file keeps the LF twin's lines and columns.
 */
export function tokenizePrisma(text: string): PrismaToken[] {
  const out: PrismaToken[] = [];
  let line = 1;
  let lineStart = 0;
  const push = (kind: PrismaTokenKind, start: number, end: number) => out.push({ kind, text: text.slice(start, end), start, line, column: start - lineStart + 1 });
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "\n") {
      push("newline", i, i + 1);
      i++;
      line++;
      lineStart = i;
    } else if (c === " " || c === "\t" || c === "\r" || c === "\f" || c === "﻿") {
      i++;
    } else if (c === "/" && text[i + 1] === "/") {
      let end = text.indexOf("\n", i);
      if (end < 0) end = text.length;
      let contentEnd = end;
      while (contentEnd > i && (text[contentEnd - 1] === "\r" || text[contentEnd - 1] === " " || text[contentEnd - 1] === "\t")) contentEnd--;
      if (text[i + 2] === "/") push("docComment", i, contentEnd);
      i = end;
    } else if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"' && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      const end = text[j] === '"' ? j + 1 : Math.min(j, text.length);
      push("string", i, end);
      i = end;
    } else if (c === "@") {
      const m = ATTR_NAME.exec(text.slice(i, i + 200));
      if (m) {
        push(m[0].startsWith("@@") ? "blockAttr" : "attr", i, i + m[0].length);
        i += m[0].length;
      } else {
        push("punct", i, i + 1);
        i++;
      }
    } else if (WORD.test(c)) {
      let j = i + 1;
      while (j < text.length && WORD.test(text[j]!)) j++;
      push("word", i, j);
      i = j;
    } else {
      push("punct", i, i + 1);
      i++;
    }
  }
  return out;
}
