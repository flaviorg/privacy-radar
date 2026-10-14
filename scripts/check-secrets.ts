// check:secrets (REP-05): walks the project tree looking for key-shaped strings. It does not use `git ls-files`
// (the folder may have no commit yet); Git is asked only whether a local `.env` is tracked. Runs in the pre-commit
// hook and in CI. It never prints a value: only the path, the line and the name of the pattern.
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { SECRET_PATTERNS } from "../src/infra/redact.ts";
import { PROJECT_ROOT } from "../src/infra/paths.ts";

/** The patterns of `redactSecrets` plus an `LLM_API_KEY=` assignment with a value of 8 or more characters. */
const PATTERNS: readonly { name: string; source: string }[] = [
  ...SECRET_PATTERNS.map((p) => ({ name: `${p.name} key`, source: p.re.source })),
  // Built by concatenation so that this file does not match its own pattern.
  { name: "LLM_API_KEY with a value", source: "LLM_API_KEY" + "=\\S{8,}" },
];

export type SecretFinding = { path: string; line: number; pattern: string };

export function scanText(text: string, path: string): SecretFinding[] {
  const out: SecretFinding[] = [];
  text.split("\n").forEach((content, i) => {
    // Several patterns can match the same string (an `sk-or-v1-` key is also `sk-` shaped): one finding per start offset.
    const seen = new Set<number>();
    for (const p of PATTERNS) {
      for (const m of content.matchAll(new RegExp(p.source, "g"))) {
        const at = m.index ?? 0;
        if (seen.has(at)) continue;
        seen.add(at);
        out.push({ path, line: i + 1, pattern: p.name });
      }
    }
  });
  return out;
}

const IGNORED_DIRS = new Set(["node_modules", ".git", "artifacts", "coverage"]);
/** A local environment file is ignored by `.gitignore`; it is scanned only when Git tracks it. */
const LOCAL_ENV_FILES = new Set([".env"]);

export type ScanOptions = {
  /** Says whether a root-relative POSIX path is tracked by Git. Default: `git ls-files --error-unmatch`. */
  isTracked?: (rel: string) => boolean;
};

function trackedByGit(root: string, rel: string): boolean {
  const r = spawnSync("git", ["ls-files", "--error-unmatch", "--", rel], { cwd: root, stdio: "ignore" });
  return r.status === 0;
}

export function listProjectFiles(root: string, opts: ScanOptions = {}): string[] {
  const isTracked = opts.isTracked ?? ((rel: string) => trackedByGit(root, rel));
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const rel = relative(root, path).split(sep).join("/");
      const st = statSync(path);
      if (st.isDirectory()) {
        if (!IGNORED_DIRS.has(name)) walk(path);
      } else if (st.isFile()) {
        if (LOCAL_ENV_FILES.has(name) && !isTracked(rel)) continue;
        out.push(path);
      }
    }
  };
  walk(root);
  return out;
}

function readText(path: string): string | null {
  const buf = readFileSync(path);
  return buf.subarray(0, 8192).includes(0) ? null : buf.toString("utf8");
}

export function scanProject(root: string = PROJECT_ROOT, opts: ScanOptions = {}): { files: number; findings: SecretFinding[] } {
  const findings: SecretFinding[] = [];
  let files = 0;
  for (const file of listProjectFiles(root, opts)) {
    const text = readText(file);
    if (text === null) continue;
    files += 1;
    findings.push(...scanText(text, relative(root, file).split(sep).join("/")));
  }
  return { files, findings };
}

if (import.meta.main) {
  const { files, findings } = scanProject();
  if (findings.length > 0) {
    for (const f of findings) process.stderr.write(`${f.path}:${f.line}: possible secret (${f.pattern}); value omitted\n`);
    process.stderr.write(`check:secrets: ${findings.length} finding(s) in ${files} text file(s)\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`check:secrets: no secrets in ${files} text file(s)\n`);
  }
}
