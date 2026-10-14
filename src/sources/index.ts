import type { SourceFile, SourceKind } from "../contracts/source-model.ts";
import { parsePrismaSource } from "./prisma/parse.ts";
import { parseSqlSource } from "./sql/parse.ts";
import { parseTsSource } from "./ts/index.ts";

const TS_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;

/** Source kind by file name: every `*.prisma`, `*.sql`, the TS/JS family (never `*.d.ts`). */
export function detectKind(rel: string): SourceKind | null {
  const lower = rel.toLowerCase();
  if (lower.endsWith(".prisma")) return "prisma";
  if (lower.endsWith(".sql")) return "sql";
  if (lower.endsWith(".d.ts") || lower.endsWith(".d.mts") || lower.endsWith(".d.cts")) return null;
  return TS_EXTENSIONS.test(lower) ? "ts" : null;
}

function emptySource(rel: string, kind: SourceKind): SourceFile {
  return { path: rel, kind, entities: [], functions: [], literalBindings: [], warnings: [] };
}

/** Dispatches one file to its adapter. Never throws: any exception becomes one PARSE_ERROR. */
export function parseSource(rel: string, text: string): SourceFile {
  const kind = detectKind(rel) ?? "ts";
  try {
    switch (kind) {
      case "ts":
        return parseTsSource(rel, text);
      case "sql":
        return parseSqlSource(rel, text);
      case "prisma":
        return parsePrismaSource(rel, text);
    }
  } catch (err) {
    const name = err instanceof Error ? err.name : "Error";
    return { ...emptySource(rel, kind), warnings: [{ file: rel, code: "PARSE_ERROR", message: `adapter failed (${name}); file skipped` }] };
  }
}
