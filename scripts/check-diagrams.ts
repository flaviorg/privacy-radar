// diagrams:check (Task 50): renders every `docs/diagrams/*.mmd` and every ```mermaid block of README.md and
// docs/**/*.md with mermaid-cli 12.0.0 into a folder under os.tmpdir() (CI runs Ubuntu, where the macOS private temp folder does not
// exist). Exit 1 when any diagram fails to render. Prints one line per diagram.
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { PROJECT_ROOT } from "../src/infra/paths.ts";

export const MERMAID_CLI = "@mermaid-js/mermaid-cli@12.0.0";

export type Diagram = { source: string; label: string; text: string };

function listFiles(dir: string, ext: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) listFiles(path, ext, out);
    else if (entry.isFile() && entry.name.endsWith(ext)) out.push(path);
  }
  return out;
}

/** The Mermaid blocks of one Markdown text, in order. */
export function markdownBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/^```mermaid\n([\s\S]*?)^```/gm)].map((m) => m[1]!);
}

/** Every diagram of the repository: `.mmd` files first, then the Markdown blocks of README.md and docs/**. */
export function collectDiagrams(root: string = PROJECT_ROOT): Diagram[] {
  const rel = (p: string) => relative(root, p).split(sep).join("/");
  const out: Diagram[] = [];
  for (const f of listFiles(join(root, "docs", "diagrams"), ".mmd").sort()) out.push({ source: rel(f), label: rel(f), text: readFileSync(f, "utf8") });
  const markdown = [join(root, "README.md"), ...listFiles(join(root, "docs"), ".md")].sort();
  for (const f of markdown) {
    let text: string;
    try {
      text = readFileSync(f, "utf8");
    } catch {
      continue; // README.md may not exist yet
    }
    markdownBlocks(text).forEach((block, i) => out.push({ source: rel(f), label: `${rel(f)} block ${i + 1}`, text: block }));
  }
  return out;
}

export function renderAll(diagrams: readonly Diagram[], root: string = PROJECT_ROOT): { label: string; ok: boolean; svg: string }[] {
  const dir = join(tmpdir(), "privacy-radar-diagrams");
  mkdirSync(dir, { recursive: true });
  return diagrams.map((d, n) => {
    const input = join(dir, `${n}.mmd`);
    const svg = join(dir, `${n}.svg`);
    writeFileSync(input, d.text);
    const r = spawnSync("npx", ["-y", MERMAID_CLI, "-p", join(root, "puppeteer.json"), "-i", input, "-o", svg], { cwd: root, encoding: "utf8", timeout: 180_000 });
    return { label: d.label, ok: r.status === 0, svg };
  });
}

if (import.meta.main) {
  const diagrams = collectDiagrams();
  if (diagrams.length === 0) {
    process.stderr.write("diagrams:check: no diagram found\n");
    process.exitCode = 1;
  } else {
    const results = renderAll(diagrams);
    for (const r of results) process.stdout.write(`${r.ok ? "ok    " : "FAILED"} ${r.label}${r.ok ? ` -> ${r.svg}` : ""}\n`);
    const failed = results.filter((r) => !r.ok).length;
    process.stdout.write(`diagrams:check: ${results.length - failed} of ${results.length} rendered\n`);
    if (failed > 0) process.exitCode = 1;
  }
}
