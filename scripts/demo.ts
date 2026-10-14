import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { resolveLlm } from "../src/app/llm.ts";
import { runPr } from "../src/app/pr.ts";
import { exitCodeFor, scan } from "../src/app/scan.ts";
import { loadCatalog } from "../src/catalog/load.ts";
import { LIMITS } from "../src/contracts/limits.ts";
import { DEMO_CLOCK_ISO, clockFromEnv, fixedClock } from "../src/infra/clock.ts";
import { loadEnv } from "../src/infra/config.ts";
import { formatCliError } from "../src/infra/errors.ts";
import { commitAll, initRepo } from "../src/infra/git.ts";
import { createLogger, silentLogger } from "../src/infra/logger.ts";
import { DEMO_BASE_DIR, DEMO_FIXTURE_DIR, DEMO_LLM_FIXTURE, PROJECT_ROOT, toPosix } from "../src/infra/paths.ts";
import { createRedactor } from "../src/infra/redact.ts";
import { TOOL_VERSION } from "../src/infra/version.ts";
import { buildDocumentFacts, detectRipdIndicators, detectWp248 } from "../src/output/documents/sections.ts";
import { renderHero, type HeroInput } from "../src/output/summary.ts";
import type { FakeProvider } from "../src/llm/fake-provider.ts";
import { createPrompts } from "../src/prompts/index.ts";

/** The counts of spec 5.10 the demo must reproduce; any difference makes the demo exit 1. */
export const EXPECTED_COUNTS = Object.freeze({
  error: 5,
  warning: 10,
  note: 3,
  results: 18,
  personal: 14,
  fields: 24,
  valuesMasked: 16,
  prAdded: 2,
  prResolved: 1,
  prUnchanged: 15,
});

export type DemoOptions = {
  live: boolean;
  env: Readonly<Record<string, string | undefined>>;
  outDir: string;
  clockIso: string;
  write: (s: string) => void;
  writeErr?: (s: string) => void;
};

export type DemoResult = { exitCode: 0 | 1; hero: HeroInput; artifacts: string[]; fake: FakeProvider | null; prComment: string };

/**
 * `npm run demo` (spec 5.16, DEMO-01, DEMO-02): the demo pull request on a two-commit copy of the
 * fixture (base overlay first, then the fixture; hermetic identity and the demo clock, so the SHAs
 * are stable), then the full scan of the fixture with the scripted fake (the real provider only with
 * `--live`), documents in pt-BR, artifacts in `outDir`, and the hero. Exits 0 only when every count
 * equals spec 5.10.
 */
export async function runDemo(opts: DemoOptions): Promise<DemoResult> {
  const started = performance.now();
  const env = loadEnv(opts.env);
  const redact = createRedactor(env.LLM_API_KEY);
  const level = opts.env.LOG_LEVEL ? env.LOG_LEVEL : "warn";
  const logger = opts.writeErr ? createLogger({ level, write: (line) => opts.writeErr!(`${line}\n`), redact, clock: fixedClock(opts.clockIso) }) : silentLogger;
  const clock = fixedClock(opts.clockIso);
  const catalog = loadCatalog();
  const tmp = mkdtempSync(join(tmpdir(), "privacy-radar-demo-"));
  try {
    const repo = join(tmp, "repo");
    cpSync(DEMO_FIXTURE_DIR, repo, { recursive: true });
    cpSync(DEMO_BASE_DIR, repo, { recursive: true, force: true });
    initRepo(repo);
    commitAll(repo, "base: the clinic before the pull request", opts.clockIso);
    cpSync(DEMO_FIXTURE_DIR, repo, { recursive: true, force: true });
    commitAll(repo, "head: the demo pull request", opts.clockIso);
    const pr = await runPr({ repo, base: "HEAD~1", head: "HEAD", regime: "both", formats: ["md"], out: null, failOn: "error", catalog, clock, logger, minConfidence: LIMITS.minConfidenceDefault });

    const prompts = createPrompts(catalog.categories.map((c) => c.id));
    const llm = opts.live
      ? resolveLlm({ choice: "openai-compatible", fixturePath: null, env, prompts, redact })
      : resolveLlm({ choice: "fake", fixturePath: DEMO_LLM_FIXTURE, env, prompts, redact });
    const target = toPosix(relative(process.cwd(), DEMO_FIXTURE_DIR)) || ".";
    const outcome = await scan({
      target: target.startsWith("..") ? DEMO_FIXTURE_DIR : target,
      out: opts.outDir,
      formats: ["json", "sarif", "md"],
      regime: "both",
      minConfidence: LIMITS.minConfidenceDefault,
      configPath: null,
      docs: ["ropa", "dpia", "registro", "ripd"],
      reportLang: "pt-BR",
      llm,
      maxLlmFields: null,
      maxFiles: LIMITS.maxFiles,
      clock,
      catalog,
      logger,
      redact,
      // the SARIF URIs resolve in this repository, wherever the copy lives and with or without .git
      uriPrefix: `${toPosix(relative(PROJECT_ROOT, DEMO_FIXTURE_DIR))}/`,
    });
    writeFileSync(join(opts.outDir, "pr-comment.md"), pr.comment);
    if (llm.fake) llm.fake.assertAllConsumed();

    const facts = buildDocumentFacts(outcome.result, outcome.inventory, { schemaVersion: 1 }, catalog);
    const scanExitCode = exitCodeFor(outcome.exitFindings, "error");
    const shown = outcome.result.findings.filter((f) => !f.belowThreshold);
    const s = outcome.result.summary;
    const c = outcome.inventory.counts;
    const actual = {
      error: s.error,
      warning: s.warning,
      note: s.note,
      results: shown.length,
      personal: c.personal,
      fields: c.fields,
      valuesMasked: c.valuesMasked,
      prAdded: pr.diff.added.length,
      prResolved: pr.diff.resolved.length,
      prUnchanged: pr.diff.unchanged,
    };
    const differing = (Object.keys(EXPECTED_COUNTS) as (keyof typeof EXPECTED_COUNTS)[]).filter((k) => actual[k] !== EXPECTED_COUNTS[k]);
    const exitCode: 0 | 1 = differing.length === 0 ? 0 : 1;
    const hero: HeroInput = {
      version: TOOL_VERSION,
      clockIso: opts.clockIso,
      providerLabel: llm.label,
      regime: "both",
      pr: { baseShort: pr.baseSha.slice(0, 7), headShort: pr.headSha.slice(0, 7), changed: pr.changed.length, added: pr.diff.added, resolved: pr.diff.resolved, unchanged: pr.diff.unchanged, exitCode: pr.exitCode },
      scan: outcome.result,
      inventory: outcome.inventory,
      sarif: outcome.sarif ? { results: outcome.sarif.runs[0]?.results?.length ?? 0, rules: outcome.sarif.runs[0]?.tool.driver.rules?.length ?? 0 } : null,
      documents: { names: outcome.documents.map((d) => d.name), wp248: detectWp248(facts).detected.length, ripdIndicators: detectRipdIndicators(facts).length },
      scanExitCode,
      demoExitCode: exitCode,
    };
    opts.write(renderHero(hero, "console"));
    if (differing.length > 0) {
      opts.write(`demo counts differ from spec 5.10: ${differing.map((k) => `${k} ${actual[k]} (expected ${EXPECTED_COUNTS[k]})`).join(", ")}\n`);
    }
    opts.write(`done in ${((performance.now() - started) / 1000).toFixed(1)} s\n`);
    const artifacts = existsSync(opts.outDir) ? readdirSync(opts.outDir).sort() : [];
    return { exitCode, hero, artifacts, fake: llm.fake, prComment: pr.comment };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const env = process.env;
  const redact = createRedactor(env.LLM_API_KEY);
  try {
    const { values } = parseArgs({ args: process.argv.slice(2), options: { live: { type: "boolean" }, out: { type: "string" } }, strict: true });
    const clockIso = clockFromEnv(env.PRIVACY_RADAR_CLOCK, fixedClock(DEMO_CLOCK_ISO))().toISOString();
    const r = await runDemo({
      live: values.live === true,
      env,
      outDir: values.out ?? join(PROJECT_ROOT, "artifacts", "demo"),
      clockIso,
      write: (s) => void process.stdout.write(redact(s)),
      writeErr: (s) => void process.stderr.write(redact(s)),
    });
    process.exitCode = r.exitCode;
  } catch (err) {
    process.stderr.write(`${formatCliError(err, redact)}\n`);
    process.exitCode = err instanceof Error && "exitCode" in err ? Number((err as { exitCode: number }).exitCode) : 1;
  }
}
