import { createHash } from "node:crypto";
import { collapseWs } from "../shared/text.ts";

/** Trim and collapse whitespace (the masked line as the fingerprint hashes it). */
export function normalizeLine(masked: string): string {
  return collapseWs(masked);
}

/**
 * Spec 4.2: SHA-256 of `ruleId \n categories.join(",") \n file \n normalizedMaskedLine \n occurrence`,
 * first 32 hex chars. The line comes from the masked text, so the hash never encodes a value.
 */
export function fingerprint(input: { ruleId: string; categories: readonly string[]; file: string; maskedLine: string; occurrence: number }): string {
  const payload = [input.ruleId, input.categories.join(","), input.file, normalizeLine(input.maskedLine), String(input.occurrence)].join("\n");
  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 32);
}
