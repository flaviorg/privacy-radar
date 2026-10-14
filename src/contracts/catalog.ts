import * as z from "zod";

const isoDate = z.iso.date();
const httpsUrl = z.string().regex(/^https:\/\/\S+$/);

// ---------------------------------------------------------------------------------------------
// Regimes, sensitivity, categories

export const regimeSchema = z.enum(["lgpd", "gdpr"]);
export type Regime = z.infer<typeof regimeSchema>;
export type RegimeOption = Regime | "both";

export const sensitivitySchema = z.enum(["sensitive", "personal", "children-indicator", "not-personal"]);
export type Sensitivity = z.infer<typeof sensitivitySchema>;

export const categoryGroupSchema = z.enum(["identifier", "contact", "name", "demographic", "online", "financial", "special", "criminal", "children"]);
export type CategoryGroup = z.infer<typeof categoryGroupSchema>;

/** Same ids as `VALIDATORS` in src/validators/index.ts (a test keeps the two lists equal). */
export const validatorIdSchema = z.enum([
  "cpf",
  "cnpj",
  "iban",
  "luhn",
  "nif-pt",
  "dni-es",
  "nie-es",
  "codice-fiscale-it",
  "steuer-id-de",
  "bsn-nl",
  "nir-fr",
]);
export type ValidatorId = z.infer<typeof validatorIdSchema>;

export const categorySchema = z
  .object({
    id: z.string().regex(/^[a-z]+\.[a-z0-9-]+$/),
    group: categoryGroupSchema,
    sensitivity: sensitivitySchema,
    lgpdSensitivity: sensitivitySchema.optional(),
    gdprSensitivity: sensitivitySchema.optional(),
    summary: z.string().min(1).max(200),
    validator: validatorIdSchema.optional(),
    valuePattern: z.string().min(1).optional(),
    countries: z.array(z.string().regex(/^[A-Z]{2}$/)),
    tags: z.array(z.string().min(1)).optional(),
    notes: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type Category = z.infer<typeof categorySchema>;

export const categoriesFileSchema = z.object({ schemaVersion: z.literal(1), categories: z.array(categorySchema) }).strict();
export type CategoriesFile = z.infer<typeof categoriesFileSchema>;

// ---------------------------------------------------------------------------------------------
// Terms

export const termEntrySchema = z
  .object({
    category: z.string().min(1),
    exact: z.array(z.string().min(1)),
    token: z.array(z.string().min(1)),
    suffix: z.array(z.string().min(1)),
    weight: z.number().min(0).max(1).optional(),
  })
  .strict();
export type TermEntry = z.infer<typeof termEntrySchema>;

export const termFileSchema = z
  .object({
    lang: z.string().min(2),
    reviewed: z.boolean(),
    nonPersonEntities: z.array(z.string().min(1)),
    negativeSamples: z.array(z.string().min(1)),
    terms: z.array(termEntrySchema),
  })
  .strict();
export type TermFile = z.infer<typeof termFileSchema>;

// ---------------------------------------------------------------------------------------------
// Vendors, sinks, adequacy

export const vendorCategorySchema = z.enum(["analytics", "crm", "email", "payments", "error-monitoring", "storage", "llm", "messaging", "other"]);

export const vendorSchema = z
  .object({
    vendor: z.string().min(1),
    domains: z.array(z.string().min(1)).min(1),
    hqCountry: z.string().regex(/^[A-Z]{2}$/),
    euRegionAvailable: z.boolean(),
    category: vendorCategorySchema,
    checkedOn: isoDate,
    source: httpsUrl,
  })
  .strict();
export type Vendor = z.infer<typeof vendorSchema>;

export const vendorFileSchema = z.object({ checkedOn: isoDate, source: z.string().min(1), vendors: z.array(vendorSchema) }).strict();
export type VendorFile = z.infer<typeof vendorFileSchema>;

export const sinkKindSchema = z.enum(["log", "http", "analytics", "file", "url-query"]);
export type SinkKind = z.infer<typeof sinkKindSchema>;

const regexSource = z.string().min(1);
const sinkPatternList = z.array(regexSource).min(1);

export const sinksFileSchema = z
  .object({
    patterns: z.object({ log: sinkPatternList, http: sinkPatternList, analytics: sinkPatternList, file: sinkPatternList, "url-query": sinkPatternList }).strict(),
    inspect: z
      .object({
        log: z.literal("all"),
        http: z.literal("url+options"),
        analytics: z.literal("all"),
        file: z.literal("data"),
        "url-query": z.literal("interpolated"),
      })
      .strict(),
    sdkVendors: z.record(z.string().min(1), z.string().min(1)),
  })
  .strict();
export type SinksFile = z.infer<typeof sinksFileSchema>;

const countryList = z.array(z.string().regex(/^[A-Z]{2}$/));

export const adequacySchema = z
  .object({
    checkedOn: isoDate,
    lgpd: z.object({ adequate: countryList, source: z.string().min(1) }).strict(),
    gdpr: z.object({ adequate: countryList, conditional: z.record(z.string().regex(/^[A-Z]{2}$/), z.string().min(1)), source: z.string().min(1) }).strict(),
    eea: countryList,
    notes: z.array(z.string().min(1)),
  })
  .strict();
export type Adequacy = z.infer<typeof adequacySchema>;

// ---------------------------------------------------------------------------------------------
// Articles

export const verifiedAgainstSchema = z.enum(["official", "mirror:gdpr-info.eu"]);

const LGPD_ARTICLE = /^\d{1,3}(-[A-Z])?$/;
const LGPD_ITEM = /^([IVX]+|§ ?\d+|parágrafo único|[a-z]\))$/;
const GDPR_ARTICLE = /^(\d{1,3}(\([a-z0-9]+\))*|recital \d{1,3})$/;

export const articleRefSchema = z
  .object({
    regime: regimeSchema,
    article: z.string().min(1),
    item: z.string().min(1).optional(),
    title: z.string().min(1),
    summary: z.string().min(1).max(200),
    sourceUrl: httpsUrl,
    verifiedOn: isoDate,
    verifiedAgainst: verifiedAgainstSchema,
    verificationNote: z.string().min(1).optional(),
    notes: z.array(z.string().min(1)).optional(),
  })
  .strict()
  .superRefine((ref, ctx) => {
    if (ref.regime === "lgpd") {
      if (!LGPD_ARTICLE.test(ref.article)) ctx.addIssue({ code: "custom", path: ["article"], message: "article_format" });
      if (ref.item !== undefined && !LGPD_ITEM.test(ref.item)) ctx.addIssue({ code: "custom", path: ["item"], message: "item_format" });
    } else {
      if (!GDPR_ARTICLE.test(ref.article)) ctx.addIssue({ code: "custom", path: ["article"], message: "article_format" });
      if (ref.item !== undefined) ctx.addIssue({ code: "custom", path: ["item"], message: "gdpr_item_unused" });
    }
  });
export type ArticleRef = z.infer<typeof articleRefSchema>;

export const articleFileSchema = z.object({ regime: regimeSchema, articles: z.array(articleRefSchema) }).strict();
export type ArticleFile = z.infer<typeof articleFileSchema>;

/** `"33 II"`, `"5(1)(f)"`, `"recital 38"`: the key rules.json uses for an article reference. */
export function articleKey(ref: Pick<ArticleRef, "article" | "item">): string {
  return ref.item === undefined ? ref.article : `${ref.article} ${ref.item}`;
}

// ---------------------------------------------------------------------------------------------
// Rules

export const RULE_IDS = [
  "PR-LOG",
  "PR-THIRD-PARTY",
  "PR-ANALYTICS",
  "PR-FILE",
  "PR-URL-QUERY",
  "PR-TRANSFER",
  "PR-PLAINTEXT-SENSITIVE",
  "PR-RETENTION",
  "PR-CHILD",
  "PR-HARDCODED-VALUE",
  "PR-AMBIGUOUS",
  "PR-PARSE",
] as const;
export const ruleIdSchema = z.enum(RULE_IDS);
export type RuleId = z.infer<typeof ruleIdSchema>;

const groupOrAny = z.union([categoryGroupSchema, z.literal("*")]);
const articleKeyList = z.array(z.string().min(1));
const perRegime = <T extends z.ZodType>(inner: T) => z.object({ lgpd: inner, gdpr: inner }).strict();

export const ruleDefSchema = z
  .object({
    id: ruleIdSchema,
    title: z.string().min(1),
    shortDescription: z.string().min(1),
    fullDescription: z.string().min(1),
    helpMarkdown: z.string().min(1),
    severity: z.string().min(1),
    sarifLevel: z.enum(["error", "warning", "note"]),
    securitySeverity: z.string().regex(/^(?:[1-9]|10)\.\d$|^0\.[1-9]$/),
    tags: z.array(z.string().min(1)).max(10),
    articlesByCategoryGroup: perRegime(z.partialRecord(groupOrAny, articleKeyList)),
    articlesWhenTransfer: perRegime(articleKeyList),
  })
  .strict();
export type RuleDef = z.infer<typeof ruleDefSchema>;

export const rulesFileSchema = z.object({ rules: z.array(ruleDefSchema) }).strict();
export type RulesFile = z.infer<typeof rulesFileSchema>;
