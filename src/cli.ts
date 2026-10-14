import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { resolveLlm } from "./app/llm.ts";
import { runPr } from "./app/pr.ts";
import { exitCodeFor, scan } from "./app/scan.ts";
import { loadCatalog } from "./catalog/load.ts";
import { prOptionsSchema, scanOptionsSchema } from "./contracts/cli.ts";
import { LIMITS } from "./contracts/limits.ts";
import { validateSarifInvariants } from "./contracts/sarif.ts";
import { clockFromEnv, systemClock } from "./infra/clock.ts";
import { loadEnv } from "./infra/config.ts";
import { PrivacyRadarError, exitCodeOf, formatCliError } from "./infra/errors.ts";
import { createLogger } from "./infra/logger.ts";
import { createRedactor } from "./infra/redact.ts";
import { TOOL_NAME, TOOL_VERSION } from "./infra/version.ts";
import { describeIssues } from "./infra/zod-issues.ts";
import { toFindingsJson } from "./output/json.ts";
import { renderTable } from "./output/table.ts";
import { createPrompts } from "./prompts/index.ts";

export type CliIo = {
  env: Readonly<Record<string, string | undefined>>;
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
};

const HELP = `${TOOL_NAME} ${TOOL_VERSION}: personal-data inventory and risky flows, mapped to LGPD and GDPR articles.

Usage:
  privacy-radar scan <dir> [--regime lgpd|gdpr|both] [--format json,sarif,md,table] [--out <dir>] [--min-confidence 0.5]
                           [--config <file>] [--docs ropa,dpia,registro,ripd|all|none] [--report-lang en|pt-BR]
                           [--llm fake|openai-compatible|none] [--llm-fixture <file>] [--max-llm-fields 20]
                           [--fail-on error|warning|note|none] [--json]
  privacy-radar pr --base <ref> [--head HEAD] [--repo .] [--regime both] [--format md,json,sarif] [--out <dir>]
                   [--fail-on error] [--json]
  privacy-radar catalog [--validate] [--validate-sarif <file>] [--print categories|vendors|articles|adequacy]
  privacy-radar --version | --help

Output: scan writes to ./privacy-radar-out when --out is not given; pr writes files only with --out.
Exit codes: 0 nothing at or above --fail-on; 1 findings at or above --fail-on; 2 usage, config or catalog error; 3 scan error.
This is not legal advice and not a complete assessment.
`;

const PRINTABLE = ["categories", "vendors", "articles", "adequacy"] as const;
type Printable = (typeof PRINTABLE)[number];

const numberFormat = new Intl.NumberFormat("en-US");

/** `parseArgs` throws plain errors with `ERR_PARSE_ARGS_*` codes; they are usage errors. */
function asUsage<T>(run: () => T): T {
  try {
    return run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new PrivacyRadarError("USAGE", message);
  }
}

function validateSarifFile(path: string, out: (text: string) => void): number {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new PrivacyRadarError("SARIF_INVALID", `${path}: file not found or not readable`);
  }
  let log: unknown;
  try {
    log = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    throw new PrivacyRadarError("SARIF_INVALID", `${path}: not valid JSON`);
  }
  const problems = validateSarifInvariants(log);
  if (problems.length > 0) {
    const shown = problems.slice(0, 20).join("; ");
    throw new PrivacyRadarError("SARIF_INVALID", `${path}: ${problems.length} problem(s): ${shown}${problems.length > 20 ? "; ..." : ""}`);
  }
  const run = (log as { runs: { results: unknown[]; tool: { driver: { rules: unknown[] } } }[] }).runs[0]!;
  out(`sarif ok: ${numberFormat.format(run.results.length)} results · ${numberFormat.format(run.tool.driver.rules.length)} rules · fingerprints ok\n`);
  return 0;
}

function catalogCommand(args: string[], out: (text: string) => void): number {
  const { values, positionals } = asUsage(() =>
    parseArgs({ args, options: { validate: { type: "boolean" }, "validate-sarif": { type: "string" }, print: { type: "string" } }, allowPositionals: true, strict: true }),
  );
  if (positionals.length > 0) throw new PrivacyRadarError("USAGE", `unexpected argument for catalog: ${positionals[0]}`);
  if (values["validate-sarif"] !== undefined) return validateSarifFile(values["validate-sarif"], out);
  const print = values.print;
  if (print !== undefined && !(PRINTABLE as readonly string[]).includes(print)) {
    throw new PrivacyRadarError("USAGE", `--print must be one of ${PRINTABLE.join(", ")}`);
  }
  const catalog = loadCatalog();
  if (print !== undefined) {
    const data: Record<Printable, unknown> = {
      categories: catalog.categories,
      vendors: catalog.vendors,
      articles: catalog.articles,
      adequacy: catalog.adequacy,
    };
    out(`${JSON.stringify(data[print as Printable], null, 2)}\n`);
    return 0;
  }
  const n = (x: number) => numberFormat.format(x);
  out(
    `catalog ok: ${n(catalog.categories.length)} categories · ${n(catalog.terms.length)} term files · ${n(catalog.vendors.length)} vendors · ` +
      `${n(catalog.articles.lgpd.length)} LGPD and ${n(catalog.articles.gdpr.length)} GDPR articles · ${n(catalog.rules.length)} rules\n`,
  );
  return 0;
}

const SCAN_OPTIONS = {
  regime: { type: "string" },
  format: { type: "string" },
  out: { type: "string" },
  "min-confidence": { type: "string" },
  config: { type: "string" },
  docs: { type: "string" },
  "report-lang": { type: "string" },
  llm: { type: "string" },
  "llm-fixture": { type: "string" },
  "max-llm-fields": { type: "string" },
  "fail-on": { type: "string" },
  json: { type: "boolean" },
} as const;

const DEFAULT_OUT = "privacy-radar-out";
const CONFIG_FILE = "privacy-radar.config.json";

async function scanCommand(args: string[], io: CliIo, out: (text: string) => void, redact: (s: string) => string): Promise<number> {
  const { values, positionals } = asUsage(() => parseArgs({ args, options: SCAN_OPTIONS, allowPositionals: true, strict: true }));
  if (positionals.length !== 1) throw new PrivacyRadarError("USAGE", "scan needs exactly one folder: privacy-radar scan <dir>");
  const parsed = scanOptionsSchema.safeParse(values);
  if (!parsed.success) throw new PrivacyRadarError("USAGE", `invalid option: ${describeIssues(parsed.error)}`);
  const o = parsed.data;
  const env = loadEnv(io.env);
  const clock = clockFromEnv(env.PRIVACY_RADAR_CLOCK, systemClock);
  const logger = createLogger({ level: env.LOG_LEVEL, write: (line) => void io.stderr.write(`${line}\n`), redact, clock });
  const target = positionals[0]!;
  const catalog = loadCatalog();
  // The fixture path is used as given: relative paths resolve against the current directory.
  const llm = resolveLlm({ choice: o.llm ?? env.LLM_PROVIDER, fixturePath: o["llm-fixture"] ?? env.LLM_FIXTURE ?? null, env, prompts: createPrompts(catalog.categories.map((c) => c.id)), redact });
  const implicitConfig = join(resolve(target), CONFIG_FILE);
  const outcome = await scan({
    target,
    out: o.out ?? DEFAULT_OUT,
    formats: o.format,
    regime: o.regime,
    minConfidence: o["min-confidence"],
    configPath: o.config ?? (existsSync(implicitConfig) ? implicitConfig : null),
    docs: o.docs,
    reportLang: values["report-lang"] === undefined ? null : o["report-lang"],
    llm,
    maxLlmFields: values["max-llm-fields"] === undefined ? null : o["max-llm-fields"],
    maxFiles: env.PRIVACY_RADAR_MAX_FILES,
    clock,
    catalog,
    logger,
    redact,
  });
  if (o.json) out(toFindingsJson(outcome.result));
  else if (o.format.includes("table")) out(renderTable(outcome.result, { regime: o.regime, providerLabel: llm.label }));
  return exitCodeFor(outcome.exitFindings, o["fail-on"]);
}

const PR_OPTIONS = {
  base: { type: "string" },
  head: { type: "string" },
  repo: { type: "string" },
  regime: { type: "string" },
  format: { type: "string" },
  out: { type: "string" },
  "fail-on": { type: "string" },
  json: { type: "boolean" },
} as const;

/** `pr` (spec 5.11): deterministic rules only, no `--llm`; prints the comment, or the diff as JSON with `--json`. */
async function prCommand(args: string[], io: CliIo, out: (text: string) => void, redact: (s: string) => string): Promise<number> {
  const { values, positionals } = asUsage(() => parseArgs({ args, options: PR_OPTIONS, allowPositionals: true, strict: true }));
  if (positionals.length > 0) throw new PrivacyRadarError("USAGE", `unexpected argument for pr: ${positionals[0]}`);
  if (values.base === undefined) throw new PrivacyRadarError("USAGE", "pr needs --base <ref>");
  const parsed = prOptionsSchema.safeParse(values);
  if (!parsed.success) throw new PrivacyRadarError("USAGE", `invalid option: ${describeIssues(parsed.error)}`);
  const o = parsed.data;
  const env = loadEnv(io.env);
  const clock = clockFromEnv(env.PRIVACY_RADAR_CLOCK, systemClock);
  const logger = createLogger({ level: env.LOG_LEVEL, write: (line) => void io.stderr.write(`${line}\n`), redact, clock });
  const outcome = await runPr({
    repo: o.repo,
    base: o.base,
    head: o.head,
    regime: o.regime,
    formats: o.format,
    out: o.out ?? null,
    failOn: o["fail-on"],
    catalog: loadCatalog(),
    clock,
    logger,
    minConfidence: LIMITS.minConfidenceDefault,
    maxFiles: env.PRIVACY_RADAR_MAX_FILES,
  });
  if (o.json) {
    const { baseSha, headSha, changed, skipped, configChanged, diff } = outcome;
    out(`${JSON.stringify({ baseSha, headSha, changed, skipped, configChanged, added: diff.added, resolved: diff.resolved, unchanged: diff.unchanged }, null, 2)}\n`);
  } else out(outcome.comment);
  return outcome.exitCode;
}

/** Runs one CLI invocation and returns its exit code. Every failure becomes one `error: <CODE>: <message>` line. */
export async function main(argv: string[], io: CliIo): Promise<number> {
  const redact = createRedactor(io.env.LLM_API_KEY);
  const writeOut = (text: string) => io.stdout.write(redact(text));
  try {
    const [command, ...rest] = argv;
    if (command === undefined || command === "--help" || command === "-h") {
      writeOut(HELP);
      return 0;
    }
    if (command === "--version" || command === "-v") {
      writeOut(`${TOOL_NAME} ${TOOL_VERSION}\n`);
      return 0;
    }
    switch (command) {
      case "catalog":
        return catalogCommand(rest, writeOut);
      case "scan":
        return await scanCommand(rest, io, writeOut, redact);
      case "pr":
        return await prCommand(rest, io, writeOut, redact);
      default:
        throw new PrivacyRadarError("USAGE", `unknown command: ${command} (try --help)`);
    }
  } catch (err) {
    io.stderr.write(`${formatCliError(err, redact)}\n`);
    return exitCodeOf(err);
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2), { env: process.env, stdout: process.stdout, stderr: process.stderr });
}
