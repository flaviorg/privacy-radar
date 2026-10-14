import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DISCLAIMER_EN, DISCLAIMER_PT_BR } from "../../src/output/disclaimer.ts";
import { bannerText, narrativeBlock, placeholders, render } from "../../src/output/documents/render.ts";
import { DOCUMENTS, TEXTS, documentFileName } from "../../src/output/documents/templates.ts";
import type { DocId, Locale } from "../../src/contracts/findings.ts";
import { PROJECT_ROOT_FOR_TESTS } from "../helpers/child-node-args.ts";

const read = (rel: string) => readFileSync(join(PROJECT_ROOT_FOR_TESTS, rel), "utf8");
const DOC_IDS: readonly DocId[] = ["ropa", "dpia", "registro", "ripd"];

function templatesOf(): { doc: DocId; locale: Locale; text: string }[] {
  const out: { doc: DocId; locale: Locale; text: string }[] = [];
  for (const doc of DOC_IDS) for (const locale of DOCUMENTS[doc].locales) out.push({ doc, locale, text: read(`templates/${locale}/${doc}.md`) });
  return out;
}

test("[DOC-07] en and pt-BR templates of registro and ripd hold the same multiset of placeholders", () => {
  for (const d of ["registro", "ripd"]) assert.deepEqual(placeholders(read(`templates/en/${d}.md`)), placeholders(read(`templates/pt-BR/${d}.md`)), d);
});

test("[DOC-01] each template has the section ids of spec 5.9 in order and starts with the banner", () => {
  assert.deepEqual(DOCUMENTS.ropa.sections, ["controller", "purposes", "subjects-and-categories", "recipients", "third-country-transfers", "erasure-limits", "security-measures", "evidence-index"]);
  assert.deepEqual(DOCUMENTS.dpia.sections, ["trigger-assessment", "description", "necessity-proportionality", "risks", "measures", "evidence-index"]);
  assert.deepEqual(DOCUMENTS.registro.sections, ["agente", "finalidades", "bases-legais", "categorias", "compartilhamento", "transferencia-internacional", "retencao", "seguranca", "evidencias"]);
  assert.deepEqual(DOCUMENTS.ripd.sections, ["contexto", "tipos-de-dados", "metodologia-coleta-seguranca", "medidas-salvaguardas", "indicadores-alto-risco", "evidencias"]);
  for (const { doc, locale, text } of templatesOf()) {
    assert.ok(text.startsWith("{{text:banner}}"), `${locale}/${doc} starts with the banner`);
    const headings = [...text.matchAll(/^## \{\{text:([^}]+)\.title\}\}$/gm)].map((m) => m[1]);
    assert.deepEqual(headings, DOCUMENTS[doc].sections.map((s) => `${doc}.${s}`), `${locale}/${doc}`);
    assert.equal(text.split("\n").filter((l) => l.startsWith("## ")).length, DOCUMENTS[doc].sections.length, `${locale}/${doc}: no other ## heading`);
  }
});

test("[DOC-01] every narrative section of spec 5.9 has a {{section:<id>}} placeholder under its own heading, and no other section has one", () => {
  assert.deepEqual(DOCUMENTS.ropa.narrative, ["purposes", "security-measures"]);
  assert.deepEqual(DOCUMENTS.dpia.narrative, ["description", "necessity-proportionality", "measures"]);
  assert.deepEqual(DOCUMENTS.registro.narrative, ["finalidades", "seguranca"]);
  assert.deepEqual(DOCUMENTS.ripd.narrative, ["medidas-salvaguardas"]);
  for (const { doc, locale, text } of templatesOf()) {
    const blocks = text.split(/^## /m).slice(1);
    const withSection = blocks.map((b) => /\{\{section:([^}]+)\}\}/.exec(b)?.[1] ?? null);
    const expected = DOCUMENTS[doc].sections.map((s) => (DOCUMENTS[doc].narrative.includes(s) ? s : null));
    assert.deepEqual(withSection, expected, `${locale}/${doc}`);
  }
});

test("every template ends with its locale's disclaimer sentence verbatim (Spec delta 13)", () => {
  for (const { doc, locale, text } of templatesOf()) {
    const last = text.trimEnd().split("\n").at(-1);
    assert.equal(last, locale === "en" ? DISCLAIMER_EN : DISCLAIMER_PT_BR, `${locale}/${doc}`);
  }
});

test("every {{text:...}} key of every template exists in TEXTS of its locale (banner aside), and both locales share one key set", () => {
  assert.deepEqual(Object.keys(TEXTS.en).sort(), Object.keys(TEXTS["pt-BR"]).sort());
  for (const { doc, locale, text } of templatesOf()) {
    for (const p of placeholders(text).filter((x) => x.startsWith("text:") && x !== "text:banner")) {
      assert.ok(p.slice(5) in TEXTS[locale], `${locale}/${doc}: ${p}`);
    }
  }
});

test("documentFileName: ropa and dpia are always English, registro and ripd carry the locale suffix in pt-BR", () => {
  assert.equal(documentFileName("ropa", "en"), "ropa.md");
  assert.equal(documentFileName("dpia", "pt-BR"), "dpia.md");
  assert.equal(documentFileName("registro", "en"), "registro.md");
  assert.equal(documentFileName("registro", "pt-BR"), "registro.pt-BR.md");
  assert.equal(documentFileName("ripd", "en"), "ripd.md");
  assert.equal(documentFileName("ripd", "pt-BR"), "ripd.pt-BR.md");
});

test("[DOC-01] the banner names version, date, target and provider", () => {
  const en = bannerText({ locale: "en", version: "0.1.0", date: "2026-10-08", target: "fixtures/telehealth-clinic", providerLabel: "fake (scripted)" });
  assert.match(en, /privacy-radar 0\.1\.0 on 2026-10-08 from fixtures\/telehealth-clinic.*Provider: fake \(scripted\)/s);
  assert.ok(en.includes(DISCLAIMER_EN));
  const pt = bannerText({ locale: "pt-BR", version: "0.1.0", date: "2026-10-08", target: "fixtures/telehealth-clinic", providerLabel: "fake (scripted)" });
  assert.match(pt, /privacy-radar 0\.1\.0 em 2026-10-08 a partir de fixtures\/telehealth-clinic.*Provedor: fake \(scripted\)/s);
  assert.ok(pt.includes(DISCLAIMER_PT_BR));
  assert.ok(pt.includes("Rascunho narrativo (LLM)"));
});

test("render throws on an unknown placeholder and fills every known one", () => {
  const template = "{{text:banner}}\n\n## {{text:h}}\n\n{{table:t}}\n\n{{list:l}}\n\n{{section:s}}\n";
  const ctx = { texts: { banner: "B", h: "Heading" }, tables: { t: "| a |" }, lists: { l: "- x" }, sections: { s: "S" } };
  assert.equal(render(template, ctx), "B\n\n## Heading\n\n| a |\n\n- x\n\nS\n");
  assert.throws(() => render("{{text:banner}}\n{{table:missing}}", ctx), /unknown placeholder table:missing/);
  assert.throws(() => render("{{text:banner}}\n{{chart:x}}", ctx), /unknown placeholder chart:x/);
  assert.throws(() => render("## no banner\n", ctx), /banner/);
  for (const { doc, locale, text } of templatesOf()) assert.ok(placeholders(text).length > 5, `${locale}/${doc}`);
});

test("render inserts values literally: a value that looks like a placeholder is not expanded again", () => {
  const ctx = { texts: { banner: "{{table:t}}" }, tables: { t: "T" }, lists: {}, sections: {} };
  assert.equal(render("{{text:banner}} {{table:t}}", ctx), "{{table:t}} T");
});

test("[OUT-09] render inserts derived strings only through the escaping the caller applied (banner target escaped)", () => {
  const b = bannerText({ locale: "en", version: "0.1.0", date: "2026-10-08", target: "a](https://e.invalid)<b>@team", providerLabel: "openai-compatible ([x](https://e.invalid))" });
  assert.doesNotMatch(b, /(?<!\\)\]\(/, "no unescaped ](");
  assert.doesNotMatch(b, /(?<!\\)\[/, "no unescaped [");
  assert.ok(!b.includes("<b>"), b);
  assert.ok(!/@team/.test(b), b);
});

test("[DOC-05] narrativeBlock: paragraphs under the localized Draft narrative (LLM) heading, escaped; a rejection renders the placeholder line", () => {
  const en = narrativeBlock("en", { paragraphs: ["First [link](https://e.invalid) paragraph.", "Second <b>bold</b> paragraph."] });
  assert.match(en, /^### Draft narrative \(LLM\)\n\n/);
  assert.doesNotMatch(en, /(?<!\\)\]\(/);
  assert.ok(!en.includes("<b>"), en);
  assert.equal(en.split("\n\n").length, 3);
  const pt = narrativeBlock("pt-BR", { placeholder: "x", reason: "numbers-drift" });
  assert.equal(pt, "### Rascunho narrativo (LLM)\n\n_Narrativa indisponível (saída do LLM rejeitada: numbers-drift)._");
  const enRejected = narrativeBlock("en", { placeholder: "x", reason: "article-drift" });
  assert.equal(enRejected, "### Draft narrative (LLM)\n\n_Narrative unavailable (LLM output rejected: article-drift)._");
});

test("[DOC-06] without a provider the narrative block says no model ran, not that output was rejected", () => {
  assert.equal(narrativeBlock("en", { notGenerated: true }), "### Draft narrative (LLM)\n\n_Narrative not generated: the scan ran without a language model._");
  assert.equal(narrativeBlock("pt-BR", { notGenerated: true }), "### Rascunho narrativo (LLM)\n\n_Narrativa não gerada: a varredura rodou sem modelo de linguagem._");
});
