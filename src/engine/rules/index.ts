import type { RuleId } from "../../contracts/catalog.ts";
import type { Finding } from "../../contracts/findings.ts";
import type { ScanModel } from "../model.ts";
import { rule as ambiguous } from "./ambiguous-field.ts";
import { rule as analytics } from "./analytics-sink.ts";
import { rule as child } from "./children-indicator.ts";
import { rule as file } from "./file-sink.ts";
import { rule as hardcoded } from "./hardcoded-value.ts";
import { rule as transfer } from "./international-transfer.ts";
import { rule as log } from "./log-sink.ts";
import { rule as retention } from "./missing-retention.ts";
import { rule as parse } from "./parse-warning.ts";
import { rule as plaintext } from "./plaintext-sensitive.ts";
import { rule as thirdParty } from "./third-party-sink.ts";
import { rule as urlQuery } from "./url-query-sink.ts";

export type RawFinding = Omit<Finding, "id" | "fingerprint" | "belowThreshold" | "suppressed">;

export type Rule = { id: RuleId; apply(model: ScanModel): RawFinding[] };

/** The rules in the order of spec 5.5 (rules.json order). */
export const RULES: readonly Rule[] = [log, thirdParty, analytics, file, urlQuery, transfer, plaintext, retention, child, hardcoded, ambiguous, parse];

const KIND_RANK = (file: string) => (file.endsWith(".prisma") ? 0 : file.endsWith(".sql") ? 1 : 2);

/**
 * SCH-03: findings with the same `(ruleId, entity.name, entity.field)` collapse into one, keeping
 * the location of the earliest source kind (prisma, sql, ts); the first such finding keeps its
 * place in the list. Findings without an entity pass through.
 */
export function dedupeFindings(raw: readonly RawFinding[]): RawFinding[] {
  const out: (RawFinding | null)[] = [];
  const slot = new Map<string, number>();
  for (const f of raw) {
    if (!f.entity) {
      out.push(f);
      continue;
    }
    const key = `${f.ruleId}\u0000${f.entity.name}\u0000${f.entity.field}`;
    const at = slot.get(key);
    if (at === undefined) {
      slot.set(key, out.length);
      out.push(f);
    } else if (KIND_RANK(f.location.file) < KIND_RANK(out[at]!.location.file)) {
      out[at] = f;
    }
  }
  return out.filter((f): f is RawFinding => f !== null);
}

/** Every rule on the model, in rule order, then `dedupeFindings`. */
export function applyRules(model: ScanModel): RawFinding[] {
  return dedupeFindings(RULES.flatMap((r) => r.apply(model)));
}
