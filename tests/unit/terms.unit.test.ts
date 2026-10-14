import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog } from "../../src/catalog/load.ts";
import { buildTermIndex, matchTerms, normalizeName, tokenizeFreeText, type TermHit } from "../../src/catalog/terms.ts";
import { LIMITS } from "../../src/contracts/limits.ts";

const catalog = loadCatalog();
const idx = catalog.termIndex;
const pick = (h: TermHit | undefined) => (h ? { category: h.category, mode: h.mode, weight: h.weight } : undefined);
const hits = (name: string, category: string) => matchTerms(name, idx).some((h) => h.category === category);

test("[CAT-02] dataNascimento, data_nascimento and DATA-NASCIMENTO2 normalize to the same tokens", () => {
  for (const raw of ["dataNascimento", "data_nascimento", "DATA-NASCIMENTO2"]) assert.deepEqual(normalizeName(raw).tokens, ["data", "nascimento"]);
  assert.deepEqual(normalizeName("endereçoCobrança").tokens, ["endereco", "cobranca"]);
});

test("[CAT-02] normalizeName splits kebab-case, dots, spaces and acronyms and joins with underscores", () => {
  assert.deepEqual(normalizeName("billing.address-line 2"), { tokens: ["billing", "address", "line"], joined: "billing_address_line" });
  assert.deepEqual(normalizeName("HTTPServerURL").tokens, ["http", "server", "url"]);
  assert.deepEqual(normalizeName("nifPt"), { tokens: ["nif", "pt"], joined: "nif_pt" });
  assert.deepEqual(normalizeName("__"), { tokens: [], joined: "" });
  assert.deepEqual(normalizeName("Niño"), { tokens: ["nino"], joined: "nino" });
});

test("[CAT-03] exact, token and suffix hits carry the mode weight", () => {
  assert.deepEqual(pick(matchTerms("cpf", idx)[0]), { category: "identifier.cpf", mode: "exact", weight: 0.6 });
  assert.ok(matchTerms("patientCpfNumber", idx).some((h) => h.mode === "token" && h.category === "identifier.cpf"));
  assert.ok(matchTerms("nome_da_mae", idx).some((h) => h.category === "name.mother-name"));
  assert.ok(matchTerms("responsavel_mae", idx).some((h) => h.mode === "suffix" && h.category === "name.mother-name"));
  assert.equal(matchTerms("nifPt", idx)[0]!.weight, 0.6);
  assert.equal(matchTerms("rg", idx)[0]!.weight, 0.35);
});

test("[CAT-03] hits are sorted by weight, then category, and carry the language and the reviewed flag", () => {
  const list = matchTerms("cpf", idx);
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1]!;
    const b = list[i]!;
    assert.ok(a.weight > b.weight || (a.weight === b.weight && a.category <= b.category), JSON.stringify([a, b]));
  }
  assert.ok(list.every((h) => h.reviewed === true && ["pt", "en", "es"].includes(h.lang)));
});

const POSITIVES: Record<string, [string, string][]> = {
  pt: [
    ["cpf", "identifier.cpf"],
    ["nifPt", "identifier.nif-pt"],
    ["nomeDaMae", "name.mother-name"],
    ["dataNascimento", "demographic.birth-date"],
    ["dt_nasc", "demographic.birth-date"],
    ["telefoneCelular", "contact.phone"],
    ["endereco", "contact.address"],
    ["diagnostico", "special.health"],
    ["salario", "financial.salary"],
    ["nomeCompleto", "name.full-name"],
  ],
  en: [
    ["email", "contact.email"],
    ["reminderPhone", "contact.phone"],
    ["dob", "demographic.birth-date"],
    ["diagnosis", "special.health"],
    ["bloodType", "special.health"],
    ["ssn", "identifier.national-id"],
    ["guardianName", "children.guardian"],
    ["sexualOrientation", "special.sexual-life"],
    ["ipAddress", "online.ip-address"],
    ["mother_name", "name.mother-name"],
  ],
  es: [
    ["apellido", "name.last-name"],
    ["dni", "identifier.dni-es"],
    ["fechaNacimiento", "demographic.birth-date"],
    ["correoElectronico", "contact.email"],
    ["telefono", "contact.phone"],
    ["direccion", "contact.address"],
    ["diagnostico", "special.health"],
    ["nombreCompleto", "name.full-name"],
  ],
};

for (const lang of ["pt", "en", "es"]) {
  test(`[CAT-03] ${lang}: at least 5 positives hit their category and every negative sample hits nothing`, () => {
    const positives = POSITIVES[lang]!;
    assert.ok(positives.length >= 5);
    for (const [name, category] of positives) {
      assert.ok(
        matchTerms(name, idx).some((h) => h.category === category && h.lang === lang),
        `${lang}: ${name} should hit ${category} from ${lang}.json, got ${JSON.stringify(matchTerms(name, idx))}`,
      );
    }
    const file = catalog.terms.find((t) => t.lang === lang)!;
    assert.ok(file.negativeSamples.length >= 5, `${lang} has negative samples`);
    for (const sample of file.negativeSamples) assert.deepEqual(matchTerms(sample, idx), [], `${lang}: negative ${sample}`);
  });
}

test("[CAT-03] the plan's negative samples hit nothing in any language", () => {
  for (const s of ["status", "createdAt", "serverAddress", "companyName", "productCode", "cap", "patientId", "scheduledAt", "id", "kind"]) {
    assert.deepEqual(matchTerms(s, idx), [], s);
  }
});

test("[CAT-03] PT nif and ES nif map to identifier.nif-pt and identifier.dni-es", () => {
  const list = matchTerms("nif", idx);
  assert.ok(list.some((h) => h.lang === "pt" && h.category === "identifier.nif-pt" && h.weight === 0.35));
  assert.ok(list.some((h) => h.lang === "es" && h.category === "identifier.dni-es" && h.weight === 0.35));
});

test("[CAT-04] exactly pt, en and es term files, reviewed, within the term bounds", () => {
  assert.deepEqual(catalog.terms.map((t) => t.lang).sort(), ["en", "es", "pt"]);
  for (const t of catalog.terms) {
    assert.equal(t.reviewed, true);
    assert.ok(t.terms.length >= LIMITS.termsMin && t.terms.length <= LIMITS.termsMax, `${t.lang}: ${t.terms.length}`);
  }
});

test("identifier proper names are exact terms of en.json", () => {
  for (const n of ["codice_fiscale", "steuer_id", "steueridentifikationsnummer", "bsn", "nir", "nie", "iban", "cpf", "cnpj", "nif", "dni"]) {
    assert.ok(matchTerms(n, idx).some((h) => h.lang === "en" && h.mode === "exact"), n);
  }
});

test("the fixture's field names classify as the spec's demo expects", () => {
  for (const [name, category] of [
    ["fullName", "name.full-name"],
    ["codiceFiscale", "identifier.codice-fiscale-it"],
    ["dniEs", "identifier.dni-es"],
    ["birthDate", "demographic.birth-date"],
    ["allergies", "special.health"],
    ["iban", "financial.iban"],
    ["steuerId", "identifier.steuer-id-de"],
    ["cardNumber", "financial.card-pan"],
    ["cnpj", "identifier.cnpj"],
  ] as const) {
    assert.ok(hits(name, category), `${name} → ${category}`);
  }
  assert.equal(matchTerms("reminderPhone", idx)[0]!.weight, 0.5);
  for (const generic of ["obs", "extra", "payload", "createdAt"]) assert.deepEqual(matchTerms(generic, idx), [], generic);
});

test("nonPersonEntities and minor terms are indexed by normalized name", () => {
  for (const e of ["company", "clinic", "clinica", "empresa", "server", "tenant", "hospital", "filial"]) assert.ok(idx.nonPersonEntities.has(e), e);
  for (const m of ["menor", "crianca", "minor", "child", "kid", "nino"]) assert.ok(idx.minorTerms.has(m), m);
  assert.ok(!idx.minorTerms.has("kind"));
});

test("suffix terms keep their leading separator, so a suffix matches on a token boundary only", () => {
  const custom = buildTermIndex([
    { lang: "xx", reviewed: true, nonPersonEntities: [], negativeSamples: [], terms: [{ category: "name.mother-name", exact: [], token: [], suffix: ["_mae"] }] },
  ]);
  assert.equal(matchTerms("nomeMae", custom)[0]?.mode, "suffix");
  assert.deepEqual(matchTerms("chimae", custom), []);
  assert.equal(matchTerms("nomeMae", custom)[0]?.weight, 0.4);
});

test("multi-token token terms match contiguous tokens", () => {
  const custom = buildTermIndex([
    { lang: "xx", reviewed: true, nonPersonEntities: [], negativeSamples: [], terms: [{ category: "contact.phone", exact: [], token: ["phone_number"], suffix: [], weight: 0.55 }] },
  ]);
  assert.equal(matchTerms("backupPhoneNumber", custom)[0]?.weight, 0.55);
  assert.deepEqual(matchTerms("phoneBackupNumber", custom), []);
});

test("tokenizeFreeText splits on every non-alphanumeric and normalizes each piece", () => {
  assert.deepEqual(tokenizeFreeText("-- seed: nif_pt (Portuguese taxpayer); dataNascimento=2"), ["seed", "nif", "pt", "portuguese", "taxpayer", "data", "nascimento"]);
});
