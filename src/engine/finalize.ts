import type { ProjectConfig } from "../contracts/config.ts";
import type { Finding, Severity } from "../contracts/findings.ts";
import { fingerprint, normalizeLine } from "./fingerprint.ts";
import type { RawFinding } from "./rules/index.ts";
import { applySuppressions } from "./suppressions.ts";

const SEVERITY_RANK: Readonly<Record<Severity, number>> = { error: 0, warning: 1, note: 2 };
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The stable order of every output: severity (error, warning, note), file, line, column, rule id;
 * then categories, entity field and message so that the order never depends on the input order.
 */
export function compareFindings(a: Pick<Finding, "severity" | "location" | "ruleId" | "categories" | "message" | "entity">, b: typeof a): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    cmp(a.location.file, b.location.file) ||
    a.location.line - b.location.line ||
    a.location.column - b.location.column ||
    cmp(a.ruleId, b.ruleId) ||
    cmp(a.categories.join(","), b.categories.join(",")) ||
    cmp(a.entity?.field ?? "", b.entity?.field ?? "") ||
    cmp(a.message, b.message)
  );
}

export type FinalizeContext = { maskedLines: ReadonlyMap<string, readonly string[]>; minConfidence: number; config: ProjectConfig; today: Date };

/**
 * Orders the raw findings, numbers the occurrences of each `(ruleId, categories, file, normalized
 * masked line)` in that order, adds `fingerprint`, `id = "PRF-" + fingerprint.slice(0, 12)` and
 * `belowThreshold`, then applies the config suppressions.
 */
export function finalizeFindings(raw: readonly RawFinding[], ctx: FinalizeContext): Finding[] {
  const sorted = [...raw].sort(compareFindings);
  const seen = new Map<string, number>();
  const out: Finding[] = sorted.map((f) => {
    const maskedLine = ctx.maskedLines.get(f.location.file)?.[f.location.line - 1] ?? f.location.snippet;
    const key = [f.ruleId, f.categories.join(","), f.location.file, normalizeLine(maskedLine)].join("\u0000");
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    const fp = fingerprint({ ruleId: f.ruleId, categories: f.categories, file: f.location.file, maskedLine, occurrence });
    return { id: `PRF-${fp.slice(0, 12)}`, fingerprint: fp, ...f, belowThreshold: f.confidence < ctx.minConfidence };
  });
  return applySuppressions(out, ctx.config, ctx.today);
}
