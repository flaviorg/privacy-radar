import { LIMITS } from "../contracts/limits.ts";
import type { Field, FunctionModel, SourceFile, TextRange } from "../contracts/source-model.ts";
import { collapseWs } from "../shared/text.ts";

/** Comment text from a raw comment slice: `///`, `//`, `/*`, `/**`, `*\/` and leading `*` removed, whitespace collapsed. */
export function cleanComment(raw: string): string | null {
  const text = raw
    .split("\n")
    .map((line) =>
      line
        .trim()
        .replace(/^\/\*+|^\/\/+/, "")
        .replace(/\*+\/$/, "")
        .replace(/^\s*\*+(?!\/)/, "")
        .trim(),
    )
    .filter((line) => line.length > 0)
    .join(" ");
  const out = collapseWs(text);
  return out.length > 0 ? out : null;
}

/** URL text in the adapters' form (string contents, template interpolations as `${}`) from a masked literal slice. */
function urlFromSlice(slice: string): string {
  const q = slice[0];
  if (q === "`") return slice.slice(1, slice.endsWith("`") ? -1 : undefined).replace(/\$\{[^}]*\}/g, "${}");
  if ((q === '"' || q === "'") && slice.endsWith(q)) return slice.slice(1, -1);
  const inner = /^new\s+URL\s*\(\s*([\s\S]*?)\s*\)$/.exec(slice);
  return inner ? urlFromSlice(inner[1]!) : slice;
}

const sliceOf = (masked: string, r: TextRange) => masked.slice(r.start, r.end);

/**
 * A copy of `source` whose every text comes from the masked text (Spec delta 2): each field's
 * `declarationText` is the collapsed masked line of its declaration (at most
 * `LIMITS.declarationChars`), comments and defaults are re-sliced from their ranges, binding
 * initializers and call URLs likewise. `masked` has the raw text's length and line breaks. Pure.
 */
export function applyMaskedText(source: SourceFile, masked: string): SourceFile {
  const lines = masked.split("\n");
  const field = (f: Field): Field => ({
    ...f,
    attributes: [...f.attributes],
    declarationText: collapseWs(lines[f.loc.line - 1] ?? "").slice(0, LIMITS.declarationChars),
    comment: f.commentRange ? cleanComment(sliceOf(masked, f.commentRange)) : f.comment,
    defaultValue: f.defaultRange ? sliceOf(masked, f.defaultRange).trim() : f.defaultValue,
  });
  const fn = (m: FunctionModel): FunctionModel => ({
    ...m,
    bindings: m.bindings.map((b) => ({ ...b, initializerText: sliceOf(masked, b.initRange) })),
    calls: m.calls.map((c) => ({ ...c, urlText: c.urlRange && c.urlText !== null ? urlFromSlice(sliceOf(masked, c.urlRange)) : c.urlText })),
  });
  return {
    ...source,
    entities: source.entities.map((e) => ({ ...e, fields: e.fields.map(field), protectionHints: [...e.protectionHints] })),
    functions: source.functions.map(fn),
    literalBindings: source.literalBindings.map((b) => ({ ...b })),
    warnings: source.warnings.map((w) => ({ ...w })),
  };
}
