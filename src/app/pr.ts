import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Catalog } from "../catalog/load.ts";
import type { RegimeOption } from "../contracts/catalog.ts";
import type { Finding, Severity } from "../contracts/findings.ts";
import { LIMITS } from "../contracts/limits.ts";
import type { Clock } from "../infra/clock.ts";
import { PrivacyRadarError } from "../infra/errors.ts";
import { changedFiles, validateRef } from "../infra/git.ts";
import type { Logger } from "../infra/logger.ts";
import { toFindingsJson } from "../output/json.ts";
import { renderPrComment } from "../pr/comment.ts";
import { diffFindings } from "../pr/diff.ts";
import { withSnapshots } from "../pr/snapshot.ts";
import { detectKind } from "../sources/index.ts";
import { displayTarget, exitCodeFor, scan, writeArtifacts, type ScanOutcome } from "./scan.ts";

export type PrFormat = "md" | "json" | "sarif";

export type PrOptions = {
  repo: string;
  base: string;
  head: string;
  regime: RegimeOption;
  formats: readonly PrFormat[];
  out: string | null;
  failOn: Severity | "none";
  catalog: Catalog;
  clock: Clock;
  logger: Logger;
  minConfidence: number;
  maxFiles?: number;
};

export type PrOutcome = {
  comment: string;
  diff: { added: Finding[]; resolved: Finding[]; unchanged: number };
  baseSha: string;
  headSha: string;
  changed: string[];
  skipped: boolean;
  configChanged: boolean;
  head: ScanOutcome | null;
  written: string[];
  exitCode: 0 | 1;
};

const CONFIG_FILE = "privacy-radar.config.json";

/**
 * PR mode (spec 4.4, PR-01 to PR-06): validate both refs, list the changed files, skip when none is
 * supported, else export both full trees and scan each with deterministic rules only, diff the
 * findings, render the comment and write the requested artifacts. Both trees are scanned with the
 * BASE revision's config, so a pull request cannot silence its own findings by adding suppressions
 * or ignore globs; a config change is named in the comment and takes effect after merge. The exit
 * code counts added findings at or above `failOn` (Spec delta 11). No LLM is ever called.
 */
export async function runPr(opts: PrOptions): Promise<PrOutcome> {
  const baseSha = validateRef(opts.repo, opts.base);
  const headSha = validateRef(opts.repo, opts.head);
  const changed = changedFiles(opts.repo, baseSha, headSha);
  if (changed.length > LIMITS.prMaxChangedFiles) {
    throw new PrivacyRadarError("PR_TOO_LARGE", `${changed.length} changed files exceed the PR cap of ${LIMITS.prMaxChangedFiles}`);
  }
  const skipped = !changed.some((p) => detectKind(p) !== null);
  const configChanged = changed.includes(CONFIG_FILE);
  let head: ScanOutcome | null = null;
  let diff: PrOutcome["diff"] = { added: [], resolved: [], unchanged: 0 };
  if (!skipped) {
    const wantsSarif = opts.formats.includes("sarif");
    [diff, head] = await withSnapshots(opts.repo, baseSha, headSha, async (dirs) => {
      const baseConfig = join(dirs.base, "tree", CONFIG_FILE);
      const configPath = existsSync(baseConfig) ? baseConfig : null;
      const scanTree = (dir: string, sarif: boolean) => {
        const tree = join(dir, "tree");
        return scan({
          target: tree,
          out: null,
          formats: sarif ? ["json", "sarif"] : ["json"],
          regime: opts.regime,
          minConfidence: opts.minConfidence,
          configPath,
          docs: [],
          reportLang: "en",
          llm: { provider: null, label: "none", warnings: [], fake: null },
          maxLlmFields: null,
          maxFiles: opts.maxFiles ?? LIMITS.maxFiles,
          clock: opts.clock,
          catalog: opts.catalog,
          logger: opts.logger,
          deterministicOnly: true,
          uriPrefix: "",
        });
      };
      const baseScan = await scanTree(dirs.base, false);
      const headScan = await scanTree(dirs.head, wantsSarif);
      // the head scan's target is the repository as given, never the temporary snapshot folder
      const shown: ScanOutcome = { ...headScan, result: { ...headScan.result, target: { ...headScan.result.target, path: displayTarget(opts.repo) } } };
      return [diffFindings(baseScan.result.findings, headScan.result.findings), shown] as const;
    });
  }
  opts.logger.info("pr.diff", { changed: changed.length, skipped, added: diff.added.length, resolved: diff.resolved.length, unchanged: diff.unchanged });
  const comment = renderPrComment({ ...diff, baseSha, headSha, changed: changed.length, skipped, configChanged, regime: opts.regime });

  const files = new Map<string, string>();
  if (opts.formats.includes("md")) files.set("pr-comment.md", comment);
  if (head && opts.formats.includes("json")) files.set("findings.json", toFindingsJson(head.result));
  if (head?.sarif && opts.formats.includes("sarif")) files.set("findings.sarif", `${JSON.stringify(head.sarif, null, 2)}\n`);
  // the same writer as scan: owned artifact names this run does not write are removed from a reused --out
  const written = opts.out === null ? [] : writeArtifacts(opts.out, files);
  return { comment, diff, baseSha, headSha, changed, skipped, configChanged, head, written, exitCode: skipped ? 0 : exitCodeFor(diff.added, opts.failOn) };
}
