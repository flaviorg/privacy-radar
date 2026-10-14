import type { Catalog } from "../catalog/load.ts";
import { articleKey, type ArticleRef, type CategoryGroup, type Regime, type RegimeOption, type RuleDef, type RuleId } from "../contracts/catalog.ts";
import type { TransferStatus } from "../contracts/flows.ts";

const GROUP_ORDER: readonly CategoryGroup[] = ["identifier", "contact", "name", "demographic", "online", "financial", "special", "criminal", "children"];

function cell(rule: RuleDef, regime: "lgpd" | "gdpr"): string {
  const byGroup = rule.articlesByCategoryGroup[regime];
  const parts: string[] = [];
  const star = byGroup["*"];
  if (star && star.length > 0) parts.push(`*: ${star.join(", ")}`);
  for (const group of GROUP_ORDER) {
    const keys = byGroup[group];
    if (keys && keys.length > 0) parts.push(`${group}: ${keys.join(", ")}`);
  }
  const transfer = rule.articlesWhenTransfer[regime];
  if (transfer.length > 0) parts.push(`transfer: ${transfer.join(", ")}`);
  return parts.length > 0 ? parts.join("; ") : "none";
}

const escapeCell = (s: string) => s.replace(/\|/g, "\\|");

/**
 * The table of spec 5.5 generated from rules.json: rule id, triggers, severity, LGPD, GDPR.
 * Contributions read `*: 6 VII, 46; special: 11; transfer: 33`.
 */
export function rulesTableMarkdown(catalog: { rules: readonly RuleDef[] }): string {
  const lines = ["| Rule id | Triggers when | Severity | LGPD | GDPR |", "|---|---|---|---|---|"];
  for (const rule of catalog.rules) {
    lines.push(`| \`${rule.id}\` | ${escapeCell(rule.shortDescription)} | ${escapeCell(rule.severity)} | ${cell(rule, "lgpd")} | ${cell(rule, "gdpr")} |`);
  }
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------------------------
// Article resolution (ENG-04)

/** The articles a finding cites, per regime: `*`, the groups present, and `articlesWhenTransfer` when that regime's status is `needs-mechanism` or `conditional`. Catalog order; the unselected regime's array is empty. */
export function resolveArticles(input: {
  ruleId: RuleId;
  categories: readonly string[];
  transfer: readonly { regime: Regime; status: TransferStatus }[];
  regime: RegimeOption;
  catalog: Pick<Catalog, "ruleById" | "categoryById" | "articles">;
}): { lgpd: ArticleRef[]; gdpr: ArticleRef[] } {
  const rule = input.catalog.ruleById.get(input.ruleId);
  const out: { lgpd: ArticleRef[]; gdpr: ArticleRef[] } = { lgpd: [], gdpr: [] };
  if (!rule) return out;
  const groups = new Set(input.categories.flatMap((id) => input.catalog.categoryById.get(id)?.group ?? []));
  for (const regime of ["lgpd", "gdpr"] as const) {
    if (input.regime !== "both" && input.regime !== regime) continue;
    const byGroup = rule.articlesByCategoryGroup[regime];
    const wanted = new Set<string>(byGroup["*"] ?? []);
    for (const g of groups) for (const k of byGroup[g] ?? []) wanted.add(k);
    if (input.transfer.some((t) => t.regime === regime && (t.status === "needs-mechanism" || t.status === "conditional"))) {
      for (const k of rule.articlesWhenTransfer[regime]) wanted.add(k);
    }
    out[regime] = input.catalog.articles[regime].filter((a) => wanted.has(articleKey(a)));
  }
  return out;
}
