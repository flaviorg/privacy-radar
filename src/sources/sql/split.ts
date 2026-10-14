import type { TextRange } from "../../contracts/source-model.ts";

export type SqlStatement = {
  /** the statement text without its terminating `;`, starting at its first significant character */
  text: string;
  start: number;
  end: number;
  /** single-quoted literals of the statement (an `E` prefix included), in file offsets */
  quoteRanges: TextRange[];
};

const IDENT = /[A-Za-z0-9_$]/;
const DOLLAR_TAG = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/;

/** \r, \t, \n, space, form feed and a BOM are whitespace. */
function isSpace(c: string): boolean {
  return c === " " || c === "\n" || c === "\r" || c === "\t" || c === "\f" || c === "﻿";
}

/** End (exclusive) of a single-quoted literal starting at the quote `q`; backslash escapes only for `E''`. */
function endOfQuote(sql: string, q: number, escapes: boolean): number {
  let i = q + 1;
  while (i < sql.length) {
    const c = sql[i];
    if (escapes && c === "\\") {
      i += 2;
      continue;
    }
    if (c === "'") {
      if (sql[i + 1] === "'") {
        i += 2;
        continue;
      }
      return i + 1;
    }
    i++;
  }
  return sql.length;
}

function endOfBlockComment(sql: string, at: number): number {
  let depth = 0;
  let i = at;
  while (i < sql.length) {
    if (sql.startsWith("/*", i)) {
      depth++;
      i += 2;
    } else if (sql.startsWith("*/", i)) {
      depth--;
      i += 2;
      if (depth === 0) return i;
    } else i++;
  }
  return sql.length;
}

/**
 * Splits SQL into statements on `;` outside single quotes (`''` doubling, `E''` with backslash
 * escapes), double-quoted identifiers, `$tag$...$tag$` dollar quoting, `--` line comments and
 * nested `/* *\/` block comments (SCH-01). Empty statements are dropped.
 */
export function splitStatements(sql: string): SqlStatement[] {
  const out: SqlStatement[] = [];
  let start = -1;
  let quotes: TextRange[] = [];
  const begin = (i: number) => {
    if (start < 0) start = i;
  };
  const flush = (end: number) => {
    if (start >= 0) out.push({ text: sql.slice(start, end), start, end, quoteRanges: quotes });
    start = -1;
    quotes = [];
  };

  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    if (isSpace(c)) {
      i++;
    } else if (c === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl < 0 ? sql.length : nl + 1;
    } else if (c === "/" && sql[i + 1] === "*") {
      i = endOfBlockComment(sql, i);
    } else if (c === ";") {
      flush(i);
      i++;
    } else if (c === "'") {
      const prev = sql[i - 1] ?? "";
      const prefixed = (prev === "E" || prev === "e") && !IDENT.test(sql[i - 2] ?? "");
      const from = prefixed ? i - 1 : i;
      begin(from);
      const end = endOfQuote(sql, i, prefixed);
      quotes.push({ start: from, end });
      i = end;
    } else if (c === '"') {
      begin(i);
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      i = Math.max(j, i + 1);
    } else if (c === "$" && !IDENT.test(sql[i - 1] ?? "")) {
      begin(i);
      const tag = DOLLAR_TAG.exec(sql.slice(i, i + 66))?.[0];
      if (tag === undefined) {
        i++;
      } else {
        const close = sql.indexOf(tag, i + tag.length);
        i = close < 0 ? sql.length : close + tag.length;
      }
    } else {
      begin(i);
      i++;
    }
  }
  flush(sql.length);
  return out;
}
