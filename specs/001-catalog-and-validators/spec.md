# Catalog and validators

Status: implemented

## Context

The catalog (`catalog/*.json`) is the single source of what counts as personal data, which law articles apply and which vendors sit where: 46 categories, term files in pt, en and es, 30 vendors, a dated adequacy file and article references for LGPD and GDPR.
Ten pure validators (CPF, CNPJ, IBAN, PT NIF, ES DNI/NIE, IT codice fiscale, DE Steuer-ID, NL BSN, FR NIR, Luhn) check identifier checksums, and the value detector uses them with a corroboration rule so a random digit string is not reported as an identifier.
Every file is validated with a strict Zod schema at load time, and a golden snapshot makes catalog edits visible in review.

## Acceptance criteria

- **CAT-01** When the catalog loads, the system shall validate every file in `catalog/` with its strict Zod schema and fail with `CATALOG_INVALID` naming the file and path on any violation.
- **CAT-02** When a field name is normalized, the system shall split camelCase and snake_case, lower-case, strip diacritics and digits, so that `dataNascimento`, `data_nascimento` and `DATA-NASCIMENTO2` yield the tokens `["data","nascimento"]`.
- **CAT-03** When a normalized name is matched, the system shall return hits for `exact` (joined name equals the term), `token` (any token equals the term) and `suffix` (joined name ends with the term) modes, with the mode's weight, for every language file, and shall return no hit for the negative samples of each language file.
- **CAT-04** The system shall ship exactly the term files pt, en and es, each with `reviewed: true` and a term count within the bounds of section 6.1, 46 categories, at least 25 vendors with lower-case unique valid hostnames, and an adequacy file with ISO `checkedOn`.
- **CAT-05** Every article reference shall carry `regime`, `article`, `title`, `summary` (≤ 200 chars), `sourceUrl` (https), `verifiedOn` (ISO date) and `verifiedAgainst`, and `(regime, article, item)` shall be unique.
- **CAT-06** Every rule in `catalog/rules.json` shall resolve to at least one existing article reference per regime for every category group it claims, and every category shall resolve to at least one article per regime.
- **CAT-07** The catalog shall equal `tests/golden/catalog/*` byte for byte, so that edits are reviewed.
- **VAL-01** When a value is validated as CPF, the system shall accept `529.982.247-25` and reject `529.982.247-24` and `111.111.111-11`, ignoring punctuation.
- **VAL-02** When a value is validated as CNPJ, the system shall accept `11.222.333/0001-81` and the alphanumeric `12.ABC.345/01DE-35` and reject `11.222.333/0001-82`, and classify any CNPJ as `not-personal`.
- **VAL-03** When a value is validated as IBAN, PT NIF, ES DNI, ES NIE, IT codice fiscale, DE Steuer-ID, NL BSN, FR NIR or card PAN, the system shall return the results of the vectors in Appendix A.
- **VAL-04** When a candidate value fails its checksum, the system shall keep the hit with `checksum: "invalid"` and negative weight, never silently drop it.
- **VAL-05** When value detection runs on any string, every regex shall pass the static shape lint and finish within the regex time budget of section 6.1 on a 100 kB adversarial input, and every emitted value shall already be masked.
- **VAL-06** When a digits-only candidate passes one or more checksums, the system shall report `checksum: "valid"` only for the passing categories corroborated by an `exact` or `token` term found in the `INSERT` column name (by position), in the binding name, or else in the same line or the 10 preceding lines tokenized on non-alphanumerics, and shall otherwise record the hit with `checksum: "n/a"` and `categories: []`, masked; every row of an 11-row `INSERT` shall be corroborated by its column.

## Non-goals

- **Automatic verification against EUR-Lex.** EUR-Lex blocks programmatic access (HTTP 202 WAF challenge, Appendix A). The catalog records `verifiedAgainst` honestly ("official" or "mirror:gdpr-info.eu") and `docs/legal-sources.md` describes the manual step.
- **CCPA, HIPAA, other regimes.** Two regimes with article-level verification are the value; a third would dilute verification effort. The catalog format allows it later.
- **Anonymization quality, k-anonymity, pseudonymization detection beyond name hints.** Needs data, not code. `*_hash`, `*_enc` and `encrypted` hints are recorded as evidence only.
- **Legal conclusions, lawfulness, legal basis selection, contract and DPF verification.** The tool cannot know contracts, consents or certifications. Findings are worded "needs a Chapter V mechanism; verify DPF listing or SCCs", legal bases are inputs in the config, and every output carries the disclaimer.

## Resolved questions

- **Digits-only candidates that fail every checksum (Spec delta 3).** Corroborated by a term of a candidate category: kept with `checksum: "invalid"` and those categories (VAL-04). Not corroborated: recorded like an uncorroborated pass (`checksum: "n/a"`, `categories: []`, masked). A formatted candidate that fails keeps its pattern categories with `checksum: "invalid"`.
- **Bound-literal mask (Spec delta 4).** `"Maria Souza"` becomes `"Ma*** ***za"`: separators stay, the first two and last two letters or digits stay when the literal has at least 8 of them, otherwise every letter or digit becomes `*`. Value hits use `maskValue` (separators and the last two characters kept; e-mails keep the TLD only). ADR 0010.
- **GDPR domestic set is data (Spec delta 6).** `catalog/adequacy.json` holds `eea` (the 30 EU/EEA codes, same `checkedOn`); `transfer.ts` reads it instead of a hard-coded list.
- **Validator false-positive sampling (Step 0, 2026-10-14).** Over 200,000 seeded random strings, random 9-digit strings pass the PT NIF check 9.94% of the time and the NL BSN check 9.08% (18.13% for at least one), which is why VAL-06 requires a corroborating term. Random 11-digit strings pass the Steuer-ID rule 0.35% (the design spec expected about 1%) and the CPF check 0.98%. See `docs/api-notes.md`.
- **Legal sources.** The Step 0 re-reads of LGPD art. 6, GDPR art. 5 and recitals 38 and 75 are in `docs/legal-sources.md`; the Steuer-ID digit rule is not confirmed on the BZSt page and is flagged there for the owner.
- **Zod 4.6.5 (Step 0).** `.strict()`, `safeParse`, `z.prettifyError`, `z.iso.date()` and `z.toJSONSchema` behave as the plan assumed; the table is in `docs/api-notes.md`.

## Checklist

Each criterion is proved by a test whose name starts with its id (the file is listed).

- [x] CAT-01: `tests/e2e/cli.e2e.test.ts`, `tests/unit/catalog.unit.test.ts`
- [x] CAT-02: `tests/unit/terms.unit.test.ts`
- [x] CAT-03: `tests/unit/terms.unit.test.ts`
- [x] CAT-04: `tests/unit/catalog.unit.test.ts`, `tests/unit/terms.unit.test.ts`
- [x] CAT-05: `tests/unit/catalog.unit.test.ts`
- [x] CAT-06: `tests/unit/catalog.unit.test.ts`
- [x] CAT-07: `tests/unit/catalog.unit.test.ts`
- [x] VAL-01: `tests/unit/validators.unit.test.ts`
- [x] VAL-02: `tests/unit/validators.unit.test.ts`
- [x] VAL-03: `tests/unit/validators.unit.test.ts`
- [x] VAL-04: `tests/unit/values.unit.test.ts`
- [x] VAL-05: `tests/unit/values.unit.test.ts`
- [x] VAL-06: `tests/unit/values.unit.test.ts`
