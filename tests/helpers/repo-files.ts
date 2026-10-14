import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { PROJECT_ROOT_FOR_TESTS } from "./child-node-args.ts";

const SKIP_DIRS = new Set(["node_modules", ".git", "artifacts", "coverage", "privacy-radar-out"]);
const MAX_TEXT_BYTES = 4 * 1024 * 1024;

function looksLikeText(abs: string): boolean {
  const size = statSync(abs).size;
  if (size > MAX_TEXT_BYTES) return false;
  const fd = openSync(abs, "r");
  try {
    const buf = Buffer.alloc(Math.min(size, 8192));
    readSync(fd, buf, 0, buf.length, 0);
    return !buf.includes(0);
  } finally {
    closeSync(fd);
  }
}

/** POSIX paths relative to the project root; skips build and dependency folders; text files only. */
export function listRepoFiles(): string[] {
  const out: string[] = [];
  const walk = (relDir: string): void => {
    const absDir = relDir === "" ? PROJECT_ROOT_FOR_TESTS : join(PROJECT_ROOT_FOR_TESTS, relDir);
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(rel);
      } else if (entry.isFile() && looksLikeText(join(PROJECT_ROOT_FOR_TESTS, rel))) {
        out.push(rel);
      }
    }
  };
  walk("");
  return out.sort();
}

export function readRepoFile(rel: string): string {
  return readFileSync(join(PROJECT_ROOT_FOR_TESTS, rel), "utf8");
}

const STATIC_IMPORT = /(?:^|[\s;{}])(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\sfrom\s*)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/** Module specifiers in source order: static imports, `export ... from` and `import("x")`. */
export function importSpecifiers(source: string): string[] {
  const found: { index: number; spec: string }[] = [];
  for (const m of source.matchAll(STATIC_IMPORT)) found.push({ index: m.index ?? 0, spec: m[1] ?? "" });
  for (const m of source.matchAll(DYNAMIC_IMPORT)) found.push({ index: m.index ?? 0, spec: m[1] ?? "" });
  return found.sort((a, b) => a.index - b.index).map((f) => f.spec);
}

/** Resolves a relative specifier against the importing file (both POSIX, relative to the project root). */
export function resolveImport(fromRel: string, spec: string): string {
  return posix.normalize(posix.join(posix.dirname(fromRel), spec));
}

/** Specifiers of a file with relative ones resolved to project-relative paths. */
export function resolvedImports(rel: string): string[] {
  return importSpecifiers(readRepoFile(rel)).map((s) => (s.startsWith(".") ? resolveImport(rel, s) : s));
}

/** Lines of `source` outside any template literal that starts with `const SYSTEM = \``. */
export function linesOutsideSystemLiteral(source: string): string[] {
  const out: string[] = [];
  let inside = false;
  for (const line of source.split("\n")) {
    if (inside) {
      if (line.includes("`")) inside = false;
      continue;
    }
    const start = line.indexOf("const SYSTEM = `");
    if (start >= 0) {
      const rest = line.slice(start + "const SYSTEM = `".length);
      if (!rest.includes("`")) inside = true;
      continue;
    }
    out.push(line);
  }
  return out;
}
