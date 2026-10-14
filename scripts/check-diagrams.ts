// diagrams:check (Task 50): renders every `docs/diagrams/*.mmd` and every ```mermaid block of README.md and
// docs/**/*.md with mermaid-cli 12.0.0 into a folder under os.tmpdir() (CI runs Ubuntu, where the macOS private temp folder does not
// exist). Exit 1 when any diagram fails to render. Prints one line per diagram; after a FAILED line it prints the last lines of the
// renderer's own output, indented, so that a failure names its cause (a missing browser, a syntax error, a timeout).
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { PROJECT_ROOT } from "../src/infra/paths.ts";

export const MERMAID_CLI = "@mermaid-js/mermaid-cli@12.0.0";

export type Diagram = { source: string; label: string; text: string };
export type RenderResult = { label: string; ok: boolean; svg: string; output: string };

/** How many lines of a failed render's output are printed under its FAILED line. */
export const FAILURE_TAIL_LINES = 15;
const FAILURE_INDENT = "    ";

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

/** The combined output of a child (stdout, then stderr) plus the spawn error, or a note when the child printed nothing. */
export function childOutput(r: { stdout?: string | null; stderr?: string | null; status?: number | null; signal?: string | null; error?: Error | undefined }): string {
  const parts = [r.stdout ?? "", r.stderr ?? ""];
  if (r.error) parts.push(`${r.error.message}\n`);
  const text = parts.join("");
  return text.trim() === "" ? `no output (exit status ${r.status ?? "none"}, signal ${r.signal ?? "none"})\n` : text;
}

/** The last `count` lines of a failed render's output, each indented, trailing blank lines dropped; one line when there is no output. */
export function failureTail(output: string, count: number = FAILURE_TAIL_LINES): string[] {
  const lines = output.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
  if (lines.length === 0 || count < 1) return [`${FAILURE_INDENT}(no output)`];
  return lines.slice(-count).map((l) => `${FAILURE_INDENT}${l}`.trimEnd());
}

export function renderAll(diagrams: readonly Diagram[], root: string = PROJECT_ROOT): RenderResult[] {
  const dir = join(tmpdir(), "privacy-radar-diagrams");
  mkdirSync(dir, { recursive: true });
  return diagrams.map((d, n) => {
    const input = join(dir, `${n}.mmd`);
    const svg = join(dir, `${n}.svg`);
    writeFileSync(input, d.text);
    const r = spawnSync("npx", ["-y", MERMAID_CLI, "-p", join(root, "puppeteer.json"), "-i", input, "-o", svg], { cwd: root, encoding: "utf8", timeout: 180_000 });
    const ok = r.status === 0;
    return { label: d.label, ok, svg, output: ok ? "" : childOutput(r) };
  });
}

if (import.meta.main) {
  const diagrams = collectDiagrams();
  if (diagrams.length === 0) {
    process.stderr.write("diagrams:check: no diagram found\n");
    process.exitCode = 1;
  } else {
    const results = renderAll(diagrams);
    for (const r of results) {
      process.stdout.write(`${r.ok ? "ok    " : "FAILED"} ${r.label}${r.ok ? ` -> ${r.svg}` : ""}\n`);
      if (!r.ok) for (const line of failureTail(r.output)) process.stdout.write(`${line}\n`);
    }
    const failed = results.filter((r) => !r.ok).length;
    process.stdout.write(`diagrams:check: ${results.length - failed} of ${results.length} rendered\n`);
    if (failed > 0) process.exitCode = 1;
  }
}
