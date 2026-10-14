import * as z from "zod";
import { RULE_IDS, ruleIdSchema } from "./catalog.ts";
import { LIMITS } from "./limits.ts";

export const SARIF_SCHEMA_URL = "https://json.schemastore.org/sarif-2.1.0.json";

/** A repository-relative POSIX URI: no leading slash, no backslash, no scheme, no `..` segment, percent-encoded (RFC 3986). */
const relativeUri = z
  .string()
  .min(1)
  .refine((u) => !u.startsWith("/") && !u.includes("\\") && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(u) && !u.split("/").includes(".."), { message: "uri_not_relative_posix" })
  .refine((u) => /^(?:[A-Za-z0-9\-._~!$&'()*+,;=:@/]|%[0-9A-Fa-f]{2})+$/.test(u), { message: "uri_not_encoded" });

const text = z.looseObject({ text: z.string().min(1) });
const articleKeys = z.object({ lgpd: z.array(z.string()), gdpr: z.array(z.string()) }).strict();
const precision = z.enum(["high", "medium", "low"]);

const ruleDescriptor = z.looseObject({
  id: ruleIdSchema,
  shortDescription: text,
  fullDescription: text,
  help: z.looseObject({ text: z.string().min(1), markdown: z.string().min(1) }),
  defaultConfiguration: z.looseObject({ level: z.enum(["error", "warning", "note"]) }),
  properties: z.looseObject({ tags: z.array(z.string()).max(10), precision: precision.optional(), "security-severity": z.string().min(1) }),
});

const result = z.looseObject({
  ruleId: ruleIdSchema,
  ruleIndex: z.number().int().min(0),
  level: z.enum(["error", "warning", "note"]),
  message: text,
  locations: z
    .array(
      z.looseObject({
        physicalLocation: z.looseObject({
          artifactLocation: z.looseObject({ uri: relativeUri }),
          region: z.looseObject({ startLine: z.number().int().min(1), startColumn: z.number().int().min(1) }),
        }),
      }),
    )
    .min(1),
  partialFingerprints: z.looseObject({ primaryLocationLineHash: z.string().min(1) }),
  properties: z.looseObject({ articles: articleKeys, confidence: z.number().min(0).max(1), origin: z.enum(["deterministic", "llm"]), categories: z.array(z.string()), precision: precision.optional() }),
  suppressions: z.array(z.looseObject({ kind: z.literal("external"), justification: z.string().min(1) })).optional(),
});

/** The SARIF subset the tool emits and GitHub code scanning needs (spec 5.7). */
export const sarifSubsetSchema = z.looseObject({
  version: z.literal("2.1.0"),
  $schema: z.literal(SARIF_SCHEMA_URL),
  runs: z
    .array(
      z.looseObject({
        tool: z.looseObject({
          driver: z.looseObject({
            name: z.literal("privacy-radar"),
            version: z.string().min(1),
            informationUri: z.string().min(1),
            fullDescription: text,
            rules: z.array(ruleDescriptor).length(RULE_IDS.length),
          }),
        }),
        results: z.array(result),
        properties: z.looseObject({ truncated: z.boolean().optional() }).optional(),
      }),
    )
    .length(1),
});
export type SarifSubset = z.infer<typeof sarifSubsetSchema>;

/**
 * Problems of an arbitrary value as SARIF output of this tool, one string each, empty when it is
 * valid. Messages carry paths and issue codes, never values. GitHub's requirements (relative URI, line
 * and column at least 1, a fingerprint on every result, at most 10 tags, no `very-high` precision)
 * are part of the subset schema; the cap on results is checked here.
 */
export function validateSarifInvariants(log: unknown): string[] {
  const parsed = sarifSubsetSchema.safeParse(log);
  if (!parsed.success) {
    return parsed.error.issues.map((issue) => {
      const keys = issue.code === "unrecognized_keys" ? issue.keys : [];
      const path = [...issue.path, ...keys].map(String).join(".") || "(root)";
      // a refinement names its own invariant (uri_not_relative_posix, uri_not_encoded)
      return `${path}: ${issue.code === "custom" ? issue.message : issue.code}`;
    });
  }
  const problems: string[] = [];
  const results = parsed.data.runs[0]!.results.length;
  if (results > LIMITS.sarifMaxResults) problems.push(`runs.0.results: too_many (${results} > ${LIMITS.sarifMaxResults})`);
  return problems;
}
