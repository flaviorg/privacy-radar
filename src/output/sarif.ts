import type { Log, ReportingDescriptor, Result } from "sarif";
import type { Catalog } from "../catalog/load.ts";
import { articleKey, type ArticleRef, type RegimeOption, type RuleId } from "../contracts/catalog.ts";
import type { Finding } from "../contracts/findings.ts";
import { LIMITS } from "../contracts/limits.ts";
import { SARIF_SCHEMA_URL } from "../contracts/sarif.ts";
import { DISCLAIMER_EN } from "./disclaimer.ts";

type Precision = "high" | "medium" | "low";
const PRECISION_RANK: Readonly<Record<Precision, number>> = { low: 0, medium: 1, high: 2 };

/** `high` for a valid checksum or an exact term plus a type hint, `low` for an LLM label, else `medium`. `very-high` is never used. */
export function precisionOf(f: Finding): Precision {
  if (f.origin === "llm") return "low";
  const checksum = f.evidence.some((e) => e.kind === "checksum" && e.weight > 0);
  const exactPlusType = f.evidence.some((e) => e.kind === "field-name" && e.detail.startsWith("exact term")) && f.evidence.some((e) => e.kind === "type-hint");
  return checksum || exactPlusType ? "high" : "medium";
}

const sarifKey = (ref: ArticleRef): string => {
  const key = articleKey(ref);
  return /^recital\b/.test(key) ? key : `art. ${key}`;
};

function withDisclaimer(text: string): string {
  return text.includes(DISCLAIMER_EN) ? text : `${text.trimEnd()}\n\n${DISCLAIMER_EN}`;
}

export type SarifInput = {
  findings: readonly Finding[];
  catalog: Pick<Catalog, "rules">;
  regime: RegimeOption;
  toolVersion: string;
  /** `""` or a repository-relative folder with a trailing slash (the scan target relative to the Git top-level) */
  uriPrefix: string;
  informationUri: string;
};

/** A POSIX relative path as an RFC 3986 URI reference: each segment percent-encoded, `/` kept. */
export function encodeUriPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * The SARIF 2.1.0 log of a scan (spec 5.7): one run, the twelve rules of `rules.json` in file order
 * (so `ruleIndex` is stable), results for findings at or above the threshold (suppressed ones carry
 * `suppressions`), capped at `LIMITS.sarifMaxResults` with `run.properties.truncated`.
 */
export function buildSarif(input: SarifInput): Log {
  const eligible = input.findings.filter((f) => !f.belowThreshold);
  const truncated = eligible.length > LIMITS.sarifMaxResults;
  const kept = truncated ? eligible.slice(0, LIMITS.sarifMaxResults) : eligible;
  const indexOf = new Map<RuleId, number>(input.catalog.rules.map((r, i) => [r.id, i]));

  const rulePrecision = new Map<RuleId, Precision>();
  for (const f of kept) {
    const p = precisionOf(f);
    const prev = rulePrecision.get(f.ruleId);
    if (prev === undefined || PRECISION_RANK[p] > PRECISION_RANK[prev]) rulePrecision.set(f.ruleId, p);
  }

  const rules: ReportingDescriptor[] = input.catalog.rules.map((r) => ({
    id: r.id,
    name: r.title,
    shortDescription: { text: r.shortDescription },
    fullDescription: { text: `${r.fullDescription.trimEnd()} ${DISCLAIMER_EN}` },
    help: { text: withDisclaimer(r.helpMarkdown), markdown: withDisclaimer(r.helpMarkdown) },
    defaultConfiguration: { level: r.sarifLevel },
    properties: { tags: [...r.tags], precision: rulePrecision.get(r.id) ?? "medium", "security-severity": r.securitySeverity },
  }));

  const results: Result[] = kept.map((f) => {
    const region: NonNullable<NonNullable<Result["locations"]>[number]["physicalLocation"]>["region"] = { startLine: f.location.line, startColumn: f.location.column };
    if (f.location.endLine !== undefined) region.endLine = f.location.endLine;
    const result: Result = {
      ruleId: f.ruleId,
      ruleIndex: indexOf.get(f.ruleId) ?? 0,
      level: f.severity,
      message: { text: f.message },
      locations: [{ physicalLocation: { artifactLocation: { uri: encodeUriPath(`${input.uriPrefix}${f.location.file}`), uriBaseId: "%SRCROOT%" }, region } }],
      partialFingerprints: { primaryLocationLineHash: f.fingerprint },
      properties: {
        articles: { lgpd: f.articles.lgpd.map(sarifKey), gdpr: f.articles.gdpr.map(sarifKey) },
        confidence: f.confidence,
        origin: f.origin,
        categories: [...f.categories],
        precision: precisionOf(f),
      },
    };
    if (f.suppressed) result.suppressions = [{ kind: "external", justification: f.suppressed.reason }];
    return result;
  });

  return {
    version: "2.1.0",
    $schema: SARIF_SCHEMA_URL,
    runs: [
      {
        tool: {
          driver: {
            name: "privacy-radar",
            version: input.toolVersion,
            informationUri: input.informationUri,
            fullDescription: { text: `Finds personal data in a Node/TypeScript repository and the flows that carry it into risky sinks, mapped to LGPD and GDPR articles. ${DISCLAIMER_EN}` },
            rules,
          },
        },
        results,
        ...(truncated ? { properties: { truncated: true } } : {}),
      },
    ],
  };
}
