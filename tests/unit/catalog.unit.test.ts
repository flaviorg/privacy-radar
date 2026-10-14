import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCatalog } from "../../src/catalog/load.ts";
import { articleKey, validatorIdSchema } from "../../src/contracts/catalog.ts";
import { rulesTableMarkdown } from "../../src/engine/articles.ts";
import { DISCLAIMER_EN } from "../../src/output/disclaimer.ts";
import { PrivacyRadarError } from "../../src/infra/errors.ts";
import { CATALOG_DIR, PROJECT_ROOT } from "../../src/infra/paths.ts";
import { VALIDATORS } from "../../src/validators/index.ts";
import { tmpDir } from "../helpers/tmp-dir.ts";
import { assertGolden } from "../helpers/golden.ts";
import type { TestContext } from "node:test";

function copyCatalogTo(dir: string): string {
  const target = join(dir, "catalog");
  cpSync(CATALOG_DIR, target, { recursive: true });
  return target;
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) out[key(item)] = (out[key(item)] ?? 0) + 1;
  return out;
}

function mutateJson(t: TestContext, file: string, mutate: (json: any) => void): string {
  const dir = copyCatalogTo(tmpDir(t));
  const path = join(dir, file);
  const json = JSON.parse(readFileSync(path, "utf8"));
  mutate(json);
  writeFileSync(path, JSON.stringify(json));
  return dir;
}

test("[CAT-01] an invalid catalog file fails with CATALOG_INVALID naming the file and path", (t) => {
  const dir = mutateJson(t, "categories.json", (cats) => {
    cats.categories[0].extra = 1;
  });
  assert.throws(
    () => loadCatalog(dir),
    (e: unknown) => e instanceof PrivacyRadarError && e.code === "CATALOG_INVALID" && /categories\.json: categories\.0/.test(e.message),
  );
});

test("[CAT-01] a missing file and invalid JSON are CATALOG_INVALID naming the file", (t) => {
  const dir = copyCatalogTo(tmpDir(t));
  writeFileSync(join(dir, "vendors.json"), "{ nope");
  assert.throws(() => loadCatalog(dir), (e: unknown) => e instanceof PrivacyRadarError && e.code === "CATALOG_INVALID" && /vendors\.json/.test(e.message));
  assert.throws(() => loadCatalog(join(dir, "does-not-exist")), (e: unknown) => e instanceof PrivacyRadarError && e.code === "CATALOG_INVALID");
});

test("[CAT-01] cross-file checks: duplicate category ids, uppercase and duplicate vendor domains, unknown sdk vendor", (t) => {
  const dupCategory = mutateJson(t, "categories.json", (c) => {
    c.categories[1].id = c.categories[0].id;
  });
  assert.throws(() => loadCatalog(dupCategory), (e: unknown) => e instanceof PrivacyRadarError && /categories\.json/.test(e.message));
  const upper = mutateJson(t, "vendors.json", (v) => {
    v.vendors[0].domains[0] = "Mixpanel.COM";
  });
  assert.throws(() => loadCatalog(upper), (e: unknown) => e instanceof PrivacyRadarError && /vendors\.json: vendors\.0\.domains\.0/.test(e.message));
  const dupDomain = mutateJson(t, "vendors.json", (v) => {
    v.vendors[1].domains[0] = v.vendors[0].domains[0];
  });
  assert.throws(() => loadCatalog(dupDomain), (e: unknown) => e instanceof PrivacyRadarError && /vendors\.json/.test(e.message));
  const sdk = mutateJson(t, "sinks.json", (s) => {
    s.sdkVendors.mixpanel = "Not A Vendor";
  });
  assert.throws(() => loadCatalog(sdk), (e: unknown) => e instanceof PrivacyRadarError && /sinks\.json: sdkVendors\.mixpanel/.test(e.message));
  const badRegex = mutateJson(t, "sinks.json", (s) => {
    s.patterns.log[0] = "(unclosed";
  });
  assert.throws(() => loadCatalog(badRegex), (e: unknown) => e instanceof PrivacyRadarError && /sinks\.json: patterns\.log\.0/.test(e.message));
});

test("[CAT-04] 46 categories in the group counts of spec 5.2", () => {
  const c = loadCatalog();
  assert.equal(c.categories.length, 46);
  assert.deepEqual(countBy(c.categories, (x) => x.group), {
    identifier: 12,
    financial: 4,
    contact: 4,
    name: 4,
    demographic: 4,
    online: 4,
    special: 9,
    criminal: 1,
    children: 4,
  });
  for (const cat of c.categories) {
    assert.ok(cat.id.startsWith(`${cat.group}.`), cat.id);
    assert.ok(cat.summary.length > 0 && cat.summary.length <= 200, cat.id);
    if (cat.validator) assert.ok(cat.validator in VALIDATORS, cat.id);
    if (cat.valuePattern) assert.doesNotThrow(() => new RegExp(cat.valuePattern!, "g"), cat.id);
  }
});

test("[CAT-04] at least 25 vendors with lower-case, unique, valid hostnames and an ISO checkedOn", () => {
  const c = loadCatalog();
  assert.ok(c.vendors.length >= 25);
  assert.equal(c.vendors.length, 30);
  assert.match(c.vendorsCheckedOn, /^\d{4}-\d{2}-\d{2}$/);
  const seen = new Set<string>();
  for (const v of c.vendors) {
    assert.match(v.checkedOn, /^\d{4}-\d{2}-\d{2}$/, v.vendor);
    assert.ok(v.source.startsWith("https://"), v.vendor);
    assert.ok(v.domains.length > 0, v.vendor);
    for (const d of v.domains) {
      assert.equal(d, d.toLowerCase());
      assert.match(d, /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/, d);
      assert.ok(!seen.has(d), `duplicate domain ${d}`);
      seen.add(d);
    }
  }
});

test("[CAT-04] adequacy has ISO checkedOn and the EEA list", () => {
  const { adequacy } = loadCatalog();
  assert.match(adequacy.checkedOn, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(adequacy.eea.length, 30);
  assert.ok(adequacy.eea.includes("PT") && adequacy.eea.includes("NO") && !adequacy.eea.includes("GB"));
  assert.ok(adequacy.lgpd.adequate.includes("DE") && !adequacy.lgpd.adequate.includes("US") && !adequacy.lgpd.adequate.includes("GB"));
  assert.ok(adequacy.gdpr.adequate.includes("BR") && adequacy.gdpr.adequate.includes("GB"));
  assert.match(adequacy.gdpr.conditional["US"] ?? "", /Data Privacy Framework/);
});

test("category sensitivity per regime: philosophical and biometric differ, cnpj is not-personal", () => {
  const c = loadCatalog().categoryById;
  assert.equal(c.get("special.philosophical")!.lgpdSensitivity, "personal");
  assert.equal(c.get("special.philosophical")!.gdprSensitivity, "sensitive");
  assert.equal(c.get("special.biometric")!.gdprSensitivity, "personal");
  assert.equal(c.get("special.biometric")!.lgpdSensitivity, "sensitive");
  assert.equal(c.get("identifier.cnpj")!.sensitivity, "not-personal");
  assert.equal(c.get("identifier.cpf")!.sensitivity, "personal");
  assert.equal(c.get("identifier.nir-fr")!.tags?.includes("health-linked"), true);
  assert.equal(c.get("children.minor-flag")!.sensitivity, "children-indicator");
  assert.match(c.get("identifier.nif-pt")!.notes?.join(" ") ?? "", /starting with 5 or 6/);
});

test("sinks.json carries the five kinds, compilable patterns and sdk vendors that exist", () => {
  const c = loadCatalog();
  assert.deepEqual(Object.keys(c.sinks.patterns).sort(), ["analytics", "file", "http", "log", "url-query"]);
  const names = new Set(c.vendors.map((v) => v.vendor));
  for (const [sdk, vendor] of Object.entries(c.sinks.sdkVendors)) assert.ok(names.has(vendor), `${sdk} -> ${vendor}`);
  assert.equal(c.sinks.sdkVendors["rudderanalytics"], undefined);
  assert.equal(c.sinks.sdkVendors["heap"], undefined);
  assert.equal(c.sinks.sdkVendors["Sentry"], "Sentry");
  const log = c.sinks.patterns.log.map((p) => new RegExp(p));
  assert.ok(log.some((re) => re.test("console.log")));
  assert.ok(!log.some((re) => re.test("console.table")));
});

test("articleKey renders the keys of spec 5.2", () => {
  assert.equal(articleKey({ article: "33", item: "II" }), "33 II");
  assert.equal(articleKey({ article: "5(1)(f)" }), "5(1)(f)");
  assert.equal(articleKey({ article: "recital 38" }), "recital 38");
  assert.equal(articleKey({ article: "38", item: "parágrafo único" }), "38 parágrafo único");
});

// ---------------------------------------------------------------------------------------------
// Task 7: articles, rules and docs/legal-sources.md

const LGPD_KEYS = ["5 I", "5 II", "5 XVII", "6 I", "6 II", "6 III", "6 VII", "7", "11", "14", "14 §1", "15", "16", "18", "33", "33 II", "33 VIII", "34", "35", "36", "37", "38", "38 parágrafo único", "41", "46", "48", "52 II"];
const GDPR_KEYS = ["4(1)", "4(5)", "4(13)", "4(14)", "4(15)", "5(1)(b)", "5(1)(c)", "5(1)(e)", "5(1)(f)", "5(2)", "6", "8", "9(1)", "9(2)", "10", "25", "28", "30(1)", "30(5)", "32", "33", "35(1)", "35(7)", "44", "45", "46", "47", "49", "83(4)", "83(5)", "recital 38", "recital 75"];

test("[CAT-05] every article reference is complete and (regime, article, item) is unique", () => {
  const c = loadCatalog();
  const seen = new Set<string>();
  for (const r of [...c.articles.lgpd, ...c.articles.gdpr]) {
    assert.ok(
      r.title && r.summary.length <= 200 && r.sourceUrl.startsWith("https://") && /^\d{4}-\d{2}-\d{2}$/.test(r.verifiedOn) && r.verifiedAgainst,
      JSON.stringify(r),
    );
    const id = `${r.regime}|${articleKey(r)}`;
    assert.ok(!seen.has(id), `duplicate ${id}`);
    seen.add(id);
  }
});

test("[CAT-05] verification metadata: LGPD against the official text, GDPR against the mirror until the manual EUR-Lex tick", () => {
  const c = loadCatalog();
  for (const r of c.articles.lgpd) {
    assert.equal(r.verifiedAgainst, "official");
    assert.equal(r.sourceUrl, "https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm");
  }
  for (const r of c.articles.gdpr) {
    assert.equal(r.verifiedAgainst, "mirror:gdpr-info.eu");
    assert.equal(r.sourceUrl, "https://eur-lex.europa.eu/eli/reg/2016/679/oj");
    assert.match(r.verificationNote ?? "", /^Read on the unofficial mirror https:\/\/gdpr-info\.eu\//);
  }
  const reread = ["lgpd|6 I", "lgpd|6 II", "gdpr|5(1)(b)", "gdpr|recital 38", "gdpr|recital 75"];
  for (const id of reread) {
    const [regime, key] = id.split("|") as ["lgpd" | "gdpr", string];
    assert.equal(c.articleByKey[regime].get(key)?.verifiedOn, "2026-10-14", id);
  }
  assert.equal(c.articleByKey.gdpr.get("8")?.summary.includes("no less than 13"), true);
});

test("[CAT-05] the LGPD and GDPR key lists equal spec 5.2", () => {
  const c = loadCatalog();
  assert.deepEqual(c.articles.lgpd.map(articleKey), LGPD_KEYS);
  assert.deepEqual(c.articles.gdpr.map(articleKey), GDPR_KEYS);
  assert.ok(!c.articleByKey.lgpd.has("39"));
  assert.ok(!c.articleByKey.gdpr.has("35(3)"));
});

test("[CAT-05] article formats follow spec 5.3 and a malformed reference is CATALOG_INVALID", (t) => {
  const badLgpd = mutateJson(t, "articles.lgpd.json", (f) => {
    f.articles[0].article = "5(1)";
  });
  assert.throws(() => loadCatalog(badLgpd), (e: unknown) => e instanceof PrivacyRadarError && /articles\.lgpd\.json: articles\.0\.article/.test(e.message));
  const badGdpr = mutateJson(t, "articles.gdpr.json", (f) => {
    f.articles[0].article = "4 I";
  });
  assert.throws(() => loadCatalog(badGdpr), (e: unknown) => e instanceof PrivacyRadarError && /articles\.gdpr\.json: articles\.0\.article/.test(e.message));
  const dup = mutateJson(t, "articles.gdpr.json", (f) => {
    f.articles[1] = { ...f.articles[0] };
  });
  assert.throws(() => loadCatalog(dup), (e: unknown) => e instanceof PrivacyRadarError && /articles\.gdpr\.json: articles\.1: duplicate/.test(e.message));
});

test("[CAT-06] every rule key resolves to an article, every group and transfer list resolves, every group is cited", () => {
  const c = loadCatalog();
  assert.equal(c.rules.length, 12);
  const groups = new Set(c.categories.map((x) => x.group));
  const cited = new Set<string>(["*"]);
  for (const rule of c.rules) {
    for (const regime of ["lgpd", "gdpr"] as const) {
      for (const [group, keys] of Object.entries(rule.articlesByCategoryGroup[regime])) {
        assert.ok(group === "*" || groups.has(group as never), `${rule.id}: unknown group ${group}`);
        cited.add(group);
        for (const key of keys) assert.ok(c.articleByKey[regime].has(key), `${rule.id} ${regime} ${group}: ${key}`);
      }
      for (const key of rule.articlesWhenTransfer[regime]) assert.ok(c.articleByKey[regime].has(key), `${rule.id} ${regime} transfer: ${key}`);
    }
  }
  for (const rule of c.rules.filter((r) => r.id !== "PR-PARSE")) {
    for (const regime of ["lgpd", "gdpr"] as const) {
      assert.ok((rule.articlesByCategoryGroup[regime]["*"] ?? []).length > 0, `${rule.id} has no * key for ${regime}`);
    }
  }
  for (const group of ["special", "criminal", "children"]) assert.ok(cited.has(group), `group ${group} is cited by no rule`);
  // every category resolves to at least one article per regime through some rule
  for (const cat of c.categories) {
    for (const regime of ["lgpd", "gdpr"] as const) {
      const keys = c.rules.flatMap((r) => [...(r.articlesByCategoryGroup[regime]["*"] ?? []), ...(r.articlesByCategoryGroup[regime][cat.group] ?? [])]);
      assert.ok(keys.length > 0, `${cat.id} ${regime}`);
    }
  }
});

test("[CAT-06] rules carry the metadata SARIF needs: levels, security severity, at most 10 tags, the disclaimer in the help", () => {
  const c = loadCatalog();
  assert.deepEqual(
    c.rules.map((r) => r.id),
    ["PR-LOG", "PR-THIRD-PARTY", "PR-ANALYTICS", "PR-FILE", "PR-URL-QUERY", "PR-TRANSFER", "PR-PLAINTEXT-SENSITIVE", "PR-RETENTION", "PR-CHILD", "PR-HARDCODED-VALUE", "PR-AMBIGUOUS", "PR-PARSE"],
  );
  const sev = { error: "8.0", warning: "5.0", note: "2.0" } as const;
  for (const r of c.rules) {
    assert.equal(r.securitySeverity, sev[r.sarifLevel], r.id);
    assert.ok(r.tags.length <= 10 && r.tags[0] === "privacy", r.id);
    for (const tag of r.tags.slice(1)) assert.match(tag, /^(lgpd|gdpr):(art-\d{1,3}|recital-\d{1,3})$/, `${r.id} ${tag}`);
    assert.ok(r.helpMarkdown.endsWith(DISCLAIMER_EN), r.id);
    assert.doesNotMatch(`${r.title} ${r.shortDescription} ${r.fullDescription} ${r.helpMarkdown}`, /\b(TODO|TBD|FIXME|lorem)\b/i);
  }
});

const EXPECTED_ROWS: Record<string, { lgpd: string; gdpr: string }> = {
  "PR-LOG": { lgpd: "*: 6 VII, 46; special: 11; children: 14", gdpr: "*: 5(1)(f), 32; special: 9(1); criminal: 10; children: 8" },
  "PR-THIRD-PARTY": { lgpd: "*: 6 VII, 46; special: 11; transfer: 33", gdpr: "*: 28, 32; special: 9(1); criminal: 10; transfer: 44, 45, 46" },
  "PR-ANALYTICS": { lgpd: "*: 6 I, 6 II, 6 III, 7, 46; special: 11; children: 14; transfer: 33", gdpr: "*: 5(1)(b), 5(1)(c), 6, 28; special: 9(1); criminal: 10; children: 8; transfer: 44, 45, 46" },
  "PR-FILE": { lgpd: "*: 6 VII, 46; special: 11", gdpr: "*: 5(1)(f), 32; special: 9(1); criminal: 10" },
  "PR-URL-QUERY": { lgpd: "*: 6 VII, 46; special: 11", gdpr: "*: 5(1)(f), 32; special: 9(1); criminal: 10" },
  "PR-TRANSFER": { lgpd: "*: 33, 33 II, 33 VIII, 34, 35, 36", gdpr: "*: 44, 45, 46, 47, 49" },
  "PR-PLAINTEXT-SENSITIVE": { lgpd: "*: 6 VII, 46; special: 11", gdpr: "*: 5(1)(f), 25, 32; special: 9(1)" },
  "PR-RETENTION": { lgpd: "*: 6 III, 15, 16", gdpr: "*: 5(1)(e), 30(1)" },
  "PR-CHILD": { lgpd: "*: 14, 14 §1", gdpr: "*: 8, recital 38, recital 75" },
  "PR-HARDCODED-VALUE": { lgpd: "*: 6 III, 6 VII, 46", gdpr: "*: 5(1)(c), 5(1)(f), 32" },
  "PR-AMBIGUOUS": { lgpd: "*: 5 I", gdpr: "*: 4(1)" },
  "PR-PARSE": { lgpd: "none", gdpr: "none" },
};

test("[CAT-06] the rules table of spec 5.5 equals rules.json, cell by cell", () => {
  const table = rulesTableMarkdown(loadCatalog());
  const rows = table.trim().split("\n");
  assert.equal(rows[0], "| Rule id | Triggers when | Severity | LGPD | GDPR |");
  assert.equal(rows[1], "|---|---|---|---|---|");
  assert.equal(rows.length, 2 + 12);
  for (const row of rows.slice(2)) {
    const cells = row.split("|").slice(1, -1).map((s) => s.trim());
    assert.equal(cells.length, 5, row);
    const id = cells[0]!.replace(/`/g, "");
    const want = EXPECTED_ROWS[id];
    assert.ok(want, `unexpected rule ${id}`);
    assert.equal(cells[3], want.lgpd, `${id} LGPD`);
    assert.equal(cells[4], want.gdpr, `${id} GDPR`);
  }
});

test("[LLM-12] PR-AMBIGUOUS has only the * key in each regime: LGPD 5 I, GDPR 4(1)", () => {
  const r = loadCatalog().ruleById.get("PR-AMBIGUOUS")!;
  assert.deepEqual(r.articlesByCategoryGroup, { lgpd: { "*": ["5 I"] }, gdpr: { "*": ["4(1)"] } });
  assert.deepEqual(r.articlesWhenTransfer, { lgpd: [], gdpr: [] });
});

test("validator ids in the contract equal the ids of the validator registry", () => {
  assert.deepEqual([...validatorIdSchema.options].sort(), Object.keys(VALIDATORS).sort());
});

const RULES_START = "<!-- rules:start -->";
const RULES_END = "<!-- rules:end -->";

test("the rules table in docs/legal-sources.md equals the generated one", () => {
  const path = join(PROJECT_ROOT, "docs", "legal-sources.md");
  const doc = readFileSync(path, "utf8");
  const start = doc.indexOf(RULES_START);
  const end = doc.indexOf(RULES_END);
  assert.ok(start >= 0 && end > start, "markers missing in docs/legal-sources.md");
  const generated = rulesTableMarkdown(loadCatalog());
  if (process.env.UPDATE_GOLDEN === "1") {
    writeFileSync(path, `${doc.slice(0, start + RULES_START.length)}\n${generated}${doc.slice(end)}`);
    return;
  }
  assert.equal(doc.slice(start + RULES_START.length, end), `\n${generated}`);
});

test("docs/legal-sources.md records the sources of every article, validator and the Step 0 re-reads", () => {
  const doc = readFileSync(join(PROJECT_ROOT, "docs", "legal-sources.md"), "utf8");
  for (const key of [...LGPD_KEYS.map((k) => `LGPD ${k}`), ...GDPR_KEYS.map((k) => `GDPR ${k}`)]) {
    assert.ok(doc.includes(`| ${key} |`), `legal-sources.md has no row for ${key}`);
  }
  for (const v of Object.keys(VALIDATORS)) assert.ok(doc.includes(`| \`${v}\` |`), `legal-sources.md has no validator row for ${v}`);
  assert.match(doc, /no direct art\. 28 counterpart/);
  assert.match(doc, /M9 term lists/);
  assert.match(doc, /EUR-Lex/);
  assert.match(doc, /BZSt/);
});

test("[CAT-07] the catalog equals its golden snapshot", () => {
  for (const f of ["categories.json", "articles.lgpd.json", "articles.gdpr.json"]) assertGolden(`catalog/${f}`, readFileSync(join(CATALOG_DIR, f), "utf8"));
});
