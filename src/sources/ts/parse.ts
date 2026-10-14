import { parse, type ParseResult, type ParserPlugin } from "@babel/parser";
import type { Loc, ScanWarning } from "../../contracts/source-model.ts";
import type { AnyNode } from "./walk.ts";

/** Plugin set per extension (spec 4.2, SRC-01): no single set parses both `<T>x` casts and JSX. */
export function pluginsFor(path: string): ParserPlugin[] {
  const ext = /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
  if (ext === "ts" || ext === "mts" || ext === "cts") return ["typescript", "decorators-legacy"];
  if (ext === "tsx") return ["typescript", "decorators-legacy", "jsx"];
  return ["jsx", "decorators-legacy"];
}

/** Babel location (1-based line, 0-based column) to the model's 1-based line and column. */
export function toLoc(node: { loc?: { start: { line: number; column: number } } | null }): Loc {
  const start = node.loc?.start;
  return start ? { line: start.line, column: start.column + 1 } : { line: 1, column: 1 };
}

type BabelError = { reasonCode?: unknown; code?: unknown; loc?: { line?: unknown; column?: unknown } | null };

/** Reason code and position only: a Babel message can quote source text, which may hold a value. */
function describe(err: BabelError): { message: string; line: number | undefined } {
  const reason = typeof err.reasonCode === "string" ? err.reasonCode : typeof err.code === "string" ? err.code : "SyntaxError";
  const line = typeof err.loc?.line === "number" ? err.loc.line : undefined;
  const column = typeof err.loc?.column === "number" ? err.loc.column + 1 : undefined;
  const where = line !== undefined ? ` at ${line}:${column ?? 1}` : "";
  return { message: `${reason}${where}`, line };
}

function warning(path: string, code: "PARSE_ERROR" | "DEPTH_LIMIT", message: string, line?: number): ScanWarning {
  return line === undefined ? { file: path, code, message } : { file: path, code, message, line };
}

/**
 * Parses TS/JS with `errorRecovery`. Each recovered error is one `PARSE_ERROR`; a `RangeError`
 * (nesting deeper than Babel's own stack) is one `DEPTH_LIMIT`; any other exception is one
 * `PARSE_ERROR` with its line. Never throws. The only importer of `@babel/parser`.
 */
export function parseTs(path: string, text: string): { ast: AnyNode | null; warnings: ScanWarning[] } {
  let result: ParseResult;
  try {
    result = parse(text, { sourceType: "module", plugins: pluginsFor(path), errorRecovery: true });
  } catch (err) {
    if (err instanceof RangeError) return { ast: null, warnings: [warning(path, "DEPTH_LIMIT", "nesting deeper than the parser can handle")] };
    const { message, line } = describe((err ?? {}) as BabelError);
    return { ast: null, warnings: [warning(path, "PARSE_ERROR", message, line)] };
  }
  const warnings = result.errors.map((e) => {
    const { message, line } = describe(e as unknown as BabelError);
    return warning(path, "PARSE_ERROR", message, line);
  });
  return { ast: result as unknown as AnyNode, warnings };
}
