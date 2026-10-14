// Field, value-hit and finding confidence (spec 5.6). Pure.
import type { Evidence } from "../contracts/findings.ts";
import type { ValueHit } from "../contracts/source-model.ts";

export type { Evidence, EvidenceKind } from "../contracts/findings.ts";

/** Evidence weights other than the term weights, which come from the term hit. */
export const WEIGHTS = Object.freeze({
  typeHint: 0.1,
  attribute: 0.05,
  valuePattern: 0.2,
  checksumValid: 0.35,
  checksumInvalid: -0.15,
  entityContext: -0.3,
  testPath: -0.2,
});

/** Two decimals, avoiding binary drift (0.6 + 0.1 + 0.05 = 0.75). */
export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Σ weights, clamped to [0, 1], two decimals. */
export function fieldConfidence(evidence: readonly Evidence[]): number {
  return round2(clamp01(evidence.reduce((sum, e) => sum + e.weight, 0)));
}

export function levelOf(c: number): "high" | "medium" | "low" {
  return c >= 0.8 ? "high" : c >= 0.5 ? "medium" : "low";
}

const TEST_DIR = /(^|\/)(test|tests|__tests__|spec|fixtures?|mocks?)(\/|$)/;

/** A path relative to the scan target that looks like test code or test data (spec 5.6). */
export function isTestPath(rel: string): boolean {
  return TEST_DIR.test(rel) || rel.endsWith(".test.ts") || rel.endsWith(".spec.ts");
}

const EMAIL = "contact.email";

/** Spec 5.6: 0.90 for a checksum-valid hit that is formatted or corroborated, 0.80 for an e-mail match, else 0. */
export function valueHitConfidence(hit: ValueHit): number {
  if (hit.checksum === "valid" && hit.corroborated && hit.categories.length > 0) return 0.9;
  if (hit.categories.includes(EMAIL)) return 0.8;
  return 0;
}

export type FindingFamily = "sink" | "plaintext" | "retention" | "child" | "hardcoded" | "ambiguous" | "parse";

const AMBIGUOUS_CAP = 0.79;

/**
 * Finding confidence (ENG-11): the maximum of the contributions; `hardcoded` then takes the
 * test-path penalty; `ambiguous` is capped at 0.79 (never high); `parse` is 1.0.
 */
export function findingConfidence(input: { family: FindingFamily; contributions: readonly number[]; testPath?: boolean }): number {
  if (input.family === "parse") return 1;
  let c = input.contributions.reduce((m, x) => Math.max(m, x), 0);
  if (input.family === "hardcoded" && input.testPath) c += WEIGHTS.testPath;
  if (input.family === "ambiguous") c = Math.min(c, AMBIGUOUS_CAP);
  return round2(clamp01(c));
}
