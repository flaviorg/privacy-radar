import type { TestContext } from "node:test";
import { loadCatalog } from "../../src/catalog/load.ts";
import { scan, type ScanOptions, type ScanOutcome } from "../../src/app/scan.ts";
import { DEMO_CLOCK_ISO, fixedClock } from "../../src/infra/clock.ts";
import { silentLogger } from "../../src/infra/logger.ts";
import { tmpDir } from "./tmp-dir.ts";

let catalog: ReturnType<typeof loadCatalog> | null = null;

/** The scan options every in-process test starts from; `overrides` replace any of them. */
export function defaultScanOptions(outDir: string | null, overrides: Partial<ScanOptions> = {}): ScanOptions {
  catalog ??= loadCatalog();
  return {
    target: "fixtures/telehealth-clinic",
    out: outDir,
    formats: ["json", "sarif", "md"],
    regime: "both",
    minConfidence: 0.5,
    configPath: null,
    docs: [],
    reportLang: "en",
    llm: { provider: null, label: "none", warnings: [], fake: null },
    maxLlmFields: 20,
    maxFiles: 5000,
    clock: fixedClock(DEMO_CLOCK_ISO),
    catalog,
    logger: silentLogger,
    ...overrides,
  };
}

/**
 * One scan in this process (tests run from the project root, so the fixture is given relative) into
 * its own temporary `--out`, removed when the test ends.
 */
export async function runScanInProcess(t: TestContext, overrides: Partial<ScanOptions> = {}): Promise<ScanOutcome & { outDir: string }> {
  const outDir = overrides.out ?? tmpDir(t);
  const outcome = await scan(defaultScanOptions(outDir, overrides));
  return { ...outcome, outDir };
}
