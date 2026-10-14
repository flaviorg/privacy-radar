import { createHash } from "node:crypto";
import type { Finding } from "../contracts/findings.ts";
import { normalizeLine } from "../engine/fingerprint.ts";

// The PR finding diff (spec 4.4, PR-02). Keys ignore the line number, so a moved but unchanged line
// stays unchanged; counts are compared per key (multiset semantics). Pure apart from hashing.

export type FindingKey = string;

/** `ruleId | categories | sink kind or - | vendor or - | file | sha256(normalized masked snippet)[0..16]`. */
export function findingKey(f: Finding): FindingKey {
  const snippet = createHash("sha256").update(normalizeLine(f.location.snippet), "utf8").digest("hex").slice(0, 16);
  return [f.ruleId, f.categories.join(","), f.sink?.kind ?? "-", f.sink?.vendor ?? "-", f.location.file, snippet].join("|");
}

const counted = (f: Finding) => f.origin === "deterministic" && !f.belowThreshold && !f.suppressed;

function groupByKey(findings: readonly Finding[]): Map<FindingKey, Finding[]> {
  const groups = new Map<FindingKey, Finding[]>();
  for (const f of findings) {
    const k = findingKey(f);
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  return groups;
}

/**
 * For each key, n = count in head - count in base: n > 0 adds the last n head findings of that key,
 * n < 0 resolves the last |n| base findings; unchanged is the sum of the smaller counts. Only
 * deterministic, at-or-above-threshold, non-suppressed findings take part. Outputs keep input order.
 */
export function diffFindings(base: readonly Finding[], head: readonly Finding[]): { added: Finding[]; resolved: Finding[]; unchanged: number } {
  const b = base.filter(counted);
  const h = head.filter(counted);
  const baseGroups = groupByKey(b);
  const headGroups = groupByKey(h);
  const added = new Set<Finding>();
  const resolved = new Set<Finding>();
  let unchanged = 0;
  for (const key of new Set([...baseGroups.keys(), ...headGroups.keys()])) {
    const inBase = baseGroups.get(key) ?? [];
    const inHead = headGroups.get(key) ?? [];
    unchanged += Math.min(inBase.length, inHead.length);
    const n = inHead.length - inBase.length;
    if (n > 0) for (const f of inHead.slice(inHead.length - n)) added.add(f);
    if (n < 0) for (const f of inBase.slice(inBase.length + n)) resolved.add(f);
  }
  return { added: h.filter((f) => added.has(f)), resolved: b.filter((f) => resolved.has(f)), unchanged };
}
