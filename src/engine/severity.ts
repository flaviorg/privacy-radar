import type { Category, RegimeOption, RuleId, SinkKind } from "../contracts/catalog.ts";
import type { Severity } from "../contracts/findings.ts";
import type { TransferStatus } from "../contracts/flows.ts";
import { sensitivityFor } from "./classify-field.ts";
import { isRiskyStatus } from "./transfer.ts";

export type SensitivityClass = "sensitive" | "identifier-financial" | "other-personal" | "children";

/**
 * The highest class present (spec 6.1 columns): a category sensitive under the regime; else a
 * personal category of group `identifier` or `financial`; else any personal category; else
 * children-indicator alone.
 */
export function classOf(categories: readonly string[], categoryById: ReadonlyMap<string, Category>, regime: RegimeOption): SensitivityClass {
  const cats = categories.flatMap((id) => categoryById.get(id) ?? []);
  const sens = cats.map((c) => ({ c, s: sensitivityFor(c, regime) }));
  if (sens.some((x) => x.s === "sensitive")) return "sensitive";
  if (sens.some((x) => x.s === "personal" && (x.c.group === "identifier" || x.c.group === "financial"))) return "identifier-financial";
  if (sens.some((x) => x.s === "personal")) return "other-personal";
  return "children";
}

type Row = Readonly<Record<SensitivityClass, Severity>>;

const MATRIX: Readonly<Record<"log" | "http-safe" | "http-risky" | "analytics" | "file" | "url-query", Row>> = {
  log: { sensitive: "error", "identifier-financial": "error", "other-personal": "warning", children: "note" },
  "http-safe": { sensitive: "warning", "identifier-financial": "warning", "other-personal": "note", children: "note" },
  "http-risky": { sensitive: "error", "identifier-financial": "warning", "other-personal": "warning", children: "note" },
  analytics: { sensitive: "error", "identifier-financial": "warning", "other-personal": "warning", children: "note" },
  file: { sensitive: "warning", "identifier-financial": "warning", "other-personal": "note", children: "note" },
  "url-query": { sensitive: "error", "identifier-financial": "error", "other-personal": "warning", children: "note" },
};

/**
 * The severity matrix of spec 6.1 (ENG-02). The `http` row is chosen by the worst transfer status
 * across the selected regimes (no status: the adequate row); an unresolved host is always `note`.
 */
export function sinkSeverity(kind: SinkKind, cls: SensitivityClass, worst: TransferStatus | null, unresolved: boolean): Severity {
  if (unresolved) return "note";
  if (kind === "http") return MATRIX[worst !== null && isRiskyStatus(worst) ? "http-risky" : "http-safe"][cls];
  return MATRIX[kind][cls];
}

/** Rules whose severity never varies (spec 5.5). */
export const FIXED_SEVERITY: Readonly<Partial<Record<RuleId, Severity>>> = Object.freeze({
  "PR-PLAINTEXT-SENSITIVE": "warning",
  "PR-CHILD": "note",
  "PR-HARDCODED-VALUE": "warning",
  "PR-AMBIGUOUS": "note",
  "PR-PARSE": "note",
});

/** `PR-TRANSFER`: error when a sensitive category reaches the sink, else warning. */
export function transferSeverity(cls: SensitivityClass): Severity {
  return cls === "sensitive" ? "error" : "warning";
}

/** `PR-RETENTION`: warning when the entity has a sensitive field, else note. */
export function retentionSeverity(hasSensitive: boolean): Severity {
  return hasSensitive ? "warning" : "note";
}
