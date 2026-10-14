import type { Loc } from "../contracts/source-model.ts";

/** Spec 4.4: lower-cased, `_` and `-` removed, one trailing `s` removed. */
export function normalizeEntityName(name: string): string {
  return name.toLowerCase().replace(/[_-]/g, "").replace(/s$/, "");
}

export type LineTable = { locOf(offset: number): Loc };

/** Offset → 1-based line and column (UTF-16 units). Lines break on `\n` only, so a CRLF file keeps the LF twin's positions. */
export function lineTable(text: string): LineTable {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return {
    locOf(offset: number): Loc {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid]! <= offset) lo = mid;
        else hi = mid - 1;
      }
      return { line: lo + 1, column: offset - starts[lo]! + 1 };
    },
  };
}
