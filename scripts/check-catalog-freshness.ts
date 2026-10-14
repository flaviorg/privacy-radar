import type { Catalog } from "../src/catalog/load.ts";
import { loadCatalog } from "../src/catalog/load.ts";
import { clockFromEnv, systemClock } from "../src/infra/clock.ts";
import { LIMITS } from "../src/contracts/limits.ts";

const DAY_MS = 86_400_000;

/** Whole UTC days between an ISO date and `today`. */
function ageInDays(isoDate: string, today: Date): number {
  return Math.floor((today.getTime() - Date.parse(`${isoDate}T00:00:00Z`)) / DAY_MS);
}

/**
 * REP-06: one warning per catalog file whose `checkedOn` is older than the freshness limit
 * (`vendors.json`, `adequacy.json`); exit code 1 only when `strict` and something is stale.
 */
export function checkFreshness(catalog: Pick<Catalog, "vendorsCheckedOn" | "adequacy">, today: Date, strict: boolean): { warnings: string[]; exitCode: 0 | 1 } {
  const dated: [string, string][] = [
    ["vendors.json", catalog.vendorsCheckedOn],
    ["adequacy.json", catalog.adequacy.checkedOn],
  ];
  const warnings = dated
    .filter(([, checkedOn]) => ageInDays(checkedOn, today) > LIMITS.freshnessDays)
    .map(([file, checkedOn]) => `warning: ${file} checkedOn ${checkedOn} is older than ${LIMITS.freshnessDays} days`);
  return { warnings, exitCode: strict && warnings.length > 0 ? 1 : 0 };
}

if (import.meta.main) {
  const strict = process.argv.slice(2).includes("--strict");
  const today = clockFromEnv(process.env.PRIVACY_RADAR_CLOCK, systemClock)();
  const result = checkFreshness(loadCatalog(), today, strict);
  for (const w of result.warnings) process.stderr.write(`${w}\n`);
  if (result.warnings.length === 0) process.stdout.write(`catalog freshness ok (limit ${LIMITS.freshnessDays} days)\n`);
  process.exitCode = result.exitCode;
}
