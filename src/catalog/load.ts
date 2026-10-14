import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as z from "zod";
import {
  adequacySchema,
  articleFileSchema,
  articleKey,
  categoriesFileSchema,
  rulesFileSchema,
  sinksFileSchema,
  termFileSchema,
  vendorFileSchema,
  type Adequacy,
  type ArticleRef,
  type Category,
  type Regime,
  type RuleDef,
  type RuleId,
  type SinksFile,
  type TermFile,
  type Vendor,
} from "../contracts/catalog.ts";
import { PrivacyRadarError } from "../infra/errors.ts";
import { CATALOG_DIR } from "../infra/paths.ts";
import { describeIssues } from "../infra/zod-issues.ts";
import { buildTermIndex, type TermIndex } from "./terms.ts";

export type Catalog = {
  categories: Category[];
  categoryById: ReadonlyMap<string, Category>;
  terms: TermFile[];
  termIndex: TermIndex;
  sinks: SinksFile;
  vendors: Vendor[];
  vendorsCheckedOn: string;
  adequacy: Adequacy;
  articles: Record<Regime, ArticleRef[]>;
  articleByKey: Record<Regime, ReadonlyMap<string, ArticleRef>>;
  rules: RuleDef[];
  ruleById: ReadonlyMap<RuleId, RuleDef>;
};

const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

function invalid(file: string, detail: string): PrivacyRadarError {
  return new PrivacyRadarError("CATALOG_INVALID", `${file}: ${detail}`);
}

function readJson<S extends z.ZodType>(dir: string, file: string, schema: S): z.infer<S> {
  const path = join(dir, file);
  if (!existsSync(path)) throw invalid(file, "file not found");
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw invalid(file, "not valid JSON");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw invalid(file, describeIssues(parsed.error));
  return parsed.data;
}

function checkCategories(categories: readonly Category[]): ReadonlyMap<string, Category> {
  const byId = new Map<string, Category>();
  categories.forEach((c, i) => {
    if (byId.has(c.id)) throw invalid("categories.json", `categories.${i}.id: duplicate`);
    byId.set(c.id, c);
  });
  return byId;
}

function checkVendors(vendors: readonly Vendor[]): void {
  const seen = new Set<string>();
  vendors.forEach((v, i) => {
    v.domains.forEach((d, j) => {
      const where = `vendors.${i}.domains.${j}`;
      if (d !== d.toLowerCase()) throw invalid("vendors.json", `${where}: not_lower_case`);
      if (!HOSTNAME.test(d)) throw invalid("vendors.json", `${where}: invalid_hostname`);
      if (seen.has(d)) throw invalid("vendors.json", `${where}: duplicate`);
      seen.add(d);
    });
  });
}

function checkSinks(sinks: SinksFile, vendors: readonly Vendor[]): void {
  for (const [kind, list] of Object.entries(sinks.patterns)) {
    list.forEach((source, i) => {
      try {
        new RegExp(source);
      } catch {
        throw invalid("sinks.json", `patterns.${kind}.${i}: invalid_regex`);
      }
    });
  }
  const names = new Set(vendors.map((v) => v.vendor));
  for (const [sdk, vendor] of Object.entries(sinks.sdkVendors)) {
    if (!names.has(vendor)) throw invalid("sinks.json", `sdkVendors.${sdk}: unknown_vendor`);
  }
}

function indexArticles(regime: Regime, refs: readonly ArticleRef[]): ReadonlyMap<string, ArticleRef> {
  const file = `articles.${regime}.json`;
  const byKey = new Map<string, ArticleRef>();
  refs.forEach((r, i) => {
    if (r.regime !== regime) throw invalid(file, `articles.${i}.regime: wrong_regime`);
    const key = articleKey(r);
    if (byKey.has(key)) throw invalid(file, `articles.${i}: duplicate`);
    byKey.set(key, r);
  });
  return byKey;
}

function checkRules(rules: readonly RuleDef[], byKey: Record<Regime, ReadonlyMap<string, ArticleRef>>): ReadonlyMap<RuleId, RuleDef> {
  const byId = new Map<RuleId, RuleDef>();
  rules.forEach((r, i) => {
    if (byId.has(r.id)) throw invalid("rules.json", `rules.${i}.id: duplicate`);
    byId.set(r.id, r);
    for (const regime of ["lgpd", "gdpr"] as const) {
      const keys = [...Object.values(r.articlesByCategoryGroup[regime]).flat(), ...r.articlesWhenTransfer[regime]];
      for (const key of keys) {
        if (!byKey[regime].has(key)) throw invalid("rules.json", `rules.${i}.${regime}: unknown_article_key`);
      }
    }
  });
  return byId;
}

function checkTerms(files: readonly TermFile[], categoryById: ReadonlyMap<string, Category>): void {
  files.forEach((f) => {
    f.terms.forEach((t, i) => {
      if (!categoryById.has(t.category)) throw invalid(`terms/${f.lang}.json`, `terms.${i}.category: unknown_category`);
    });
  });
}

/** Loads and validates every file of `catalog/`. This is the only reader of that folder. */
export function loadCatalog(dir: string = CATALOG_DIR): Catalog {
  const categoriesFile = readJson(dir, "categories.json", categoriesFileSchema);
  const categories = categoriesFile.categories;
  const categoryById = checkCategories(categories);

  const terms = (["pt", "en", "es"] as const).map((lang) => readJson(dir, `terms/${lang}.json`, termFileSchema));
  checkTerms(terms, categoryById);

  const vendorFile = readJson(dir, "vendors.json", vendorFileSchema);
  checkVendors(vendorFile.vendors);
  const sinks = readJson(dir, "sinks.json", sinksFileSchema);
  checkSinks(sinks, vendorFile.vendors);
  const adequacy = readJson(dir, "adequacy.json", adequacySchema);

  const lgpd = readJson(dir, "articles.lgpd.json", articleFileSchema);
  const gdpr = readJson(dir, "articles.gdpr.json", articleFileSchema);
  const articleByKey = { lgpd: indexArticles("lgpd", lgpd.articles), gdpr: indexArticles("gdpr", gdpr.articles) };

  const rulesFile = readJson(dir, "rules.json", rulesFileSchema);
  const ruleById = checkRules(rulesFile.rules, articleByKey);

  return {
    categories,
    categoryById,
    terms,
    termIndex: buildTermIndex(terms),
    sinks,
    vendors: vendorFile.vendors,
    vendorsCheckedOn: vendorFile.checkedOn,
    adequacy,
    articles: { lgpd: lgpd.articles, gdpr: gdpr.articles },
    articleByKey,
    rules: rulesFile.rules,
    ruleById,
  };
}
