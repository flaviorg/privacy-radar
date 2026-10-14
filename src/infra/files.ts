import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join, matchesGlob, resolve, sep } from "node:path";
import { LIMITS } from "../contracts/limits.ts";
import type { ScanWarning } from "../contracts/source-model.ts";

export type FileEntry = { rel: string; abs: string; size: number };

export type WalkOptions = {
  /** extra glob patterns from the project config, matched against POSIX paths relative to the target */
  ignore: readonly string[];
  maxFiles: number;
  /** files the scan wants (by relative path); others are not counted against any limit */
  accept?: (rel: string) => boolean;
};

/** Directory names never entered, at any depth (spec 4.2). */
export const DEFAULT_IGNORED_DIRS: ReadonlySet<string> = new Set(["node_modules", ".git", "dist", "build", "coverage", "artifacts"]);

const numberFormat = new Intl.NumberFormat("en-US");

function inside(root: string, real: string): boolean {
  return real === root || real.startsWith(root.endsWith(sep) ? root : root + sep);
}

/**
 * Lists the files of a target (SRC-02, SRC-07): never follows a symbolic link (file or directory),
 * skips anything whose real path is outside the target, skips files over the size limit, and stops
 * at the file-count or total-size limit with `truncated`. Paths are POSIX, relative, sorted.
 */
export function walkTarget(target: string, opts: WalkOptions): { files: FileEntry[]; warnings: ScanWarning[]; truncated: boolean } {
  const root = realpathSync(target);
  const files: FileEntry[] = [];
  const warnings: ScanWarning[] = [];
  let totalBytes = 0;
  let truncated = false;
  const ignored = (rel: string) => opts.ignore.some((glob) => matchesGlob(rel, glob));

  const visit = (absDir: string, relDir: string): void => {
    let names: string[];
    try {
      names = readdirSync(absDir).sort();
    } catch (err) {
      if (relDir === "") throw err; // the target itself: the caller reports it
      // guardrail 12: an unreadable folder is a warning (relative path only), never a crash
      warnings.push({ file: relDir, code: "PARSE_ERROR", message: "folder could not be read; skipped" });
      return;
    }
    for (const name of names) {
      if (truncated) return;
      const abs = join(absDir, name);
      const rel = relDir === "" ? name : `${relDir}/${name}`;
      let stat: ReturnType<typeof lstatSync>;
      try {
        stat = lstatSync(abs);
      } catch {
        warnings.push({ file: rel, code: "PARSE_ERROR", message: "path could not be read; skipped" });
        continue;
      }
      if (stat.isSymbolicLink()) {
        warnings.push({ file: rel, code: "SYMLINK_SKIPPED", message: "symbolic link skipped (never followed)" });
        continue;
      }
      if (stat.isDirectory()) {
        if (DEFAULT_IGNORED_DIRS.has(name)) continue;
        visit(abs, rel);
        continue;
      }
      if (!stat.isFile() || ignored(rel) || (opts.accept && !opts.accept(rel))) continue;
      if (!inside(root, realpathSync(abs))) {
        warnings.push({ file: rel, code: "SYMLINK_SKIPPED", message: "path resolves outside the target; skipped" });
        continue;
      }
      if (stat.size > LIMITS.maxFileBytes) {
        warnings.push({ file: rel, code: "FILE_TOO_LARGE", message: `file larger than ${numberFormat.format(LIMITS.maxFileBytes)} bytes skipped` });
        continue;
      }
      if (files.length >= opts.maxFiles || totalBytes + stat.size > LIMITS.maxTotalBytes) {
        truncated = true;
        const limit = files.length >= opts.maxFiles ? `${numberFormat.format(opts.maxFiles)} files` : `${numberFormat.format(LIMITS.maxTotalBytes)} bytes`;
        warnings.push({ file: rel, code: "FILE_LIMIT", message: `scan stopped at the limit of ${limit}; the remaining files were not scanned` });
        return;
      }
      totalBytes += stat.size;
      files.push({ rel, abs, size: stat.size });
    }
  };
  visit(resolve(target), "");
  files.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return { files, warnings, truncated };
}

/** UTF-8 text with one leading BOM removed. */
export function readText(abs: string): string {
  const text = readFileSync(abs, "utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
