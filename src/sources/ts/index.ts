import type { SourceFile } from "../../contracts/source-model.ts";
import { extractEntities } from "./entities.ts";
import { extractFunctions, extractLiteralBindings } from "./functions.ts";
import { parseTs } from "./parse.ts";
import { walk } from "./walk.ts";

/** Parse + entities + functions + literal bindings of one TS/JS file. A file deeper than the walker cap is skipped with DEPTH_LIMIT. */
export function parseTsSource(rel: string, text: string): SourceFile {
  const empty: SourceFile = { path: rel, kind: "ts", entities: [], functions: [], literalBindings: [], warnings: [] };
  const { ast, warnings } = parseTs(rel, text);
  if (!ast) return { ...empty, warnings };
  if (walk(ast, () => undefined).depthExceeded) {
    return { ...empty, warnings: [...warnings, { file: rel, code: "DEPTH_LIMIT", message: "nesting deeper than the walker limit; file skipped" }] };
  }
  const entities = extractEntities(ast, text, rel);
  return {
    ...empty,
    entities: entities.entities,
    functions: extractFunctions(ast, text),
    literalBindings: extractLiteralBindings(ast),
    warnings: [...warnings, ...entities.warnings],
  };
}
