# Legal sources

Every article reference in `catalog/articles.lgpd.json` and `catalog/articles.gdpr.json` carries `sourceUrl`, `verifiedOn` and `verifiedAgainst`. This page says where each one came from, how it was checked and what is still open. The titles and summaries are the author's own wording. Nothing here is legal advice; it documents where the tool's mappings come from so that a reviewer can check them.

## How an article is verified

- **LGPD (Lei 13.709/2018).** The compiled text on the Planalto site (`https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm`) is downloaded with `curl`, converted with `iconv -f WINDOWS-1252 -t UTF-8` and read. Entries are `verifiedAgainst: "official"`.
- **GDPR (Regulation (EU) 2016/679).** EUR-Lex answers non-browser clients with a WAF challenge, so the text is read on the unofficial mirror `https://gdpr-info.eu/` (it reproduces the regulation text). Entries are `verifiedAgainst: "mirror:gdpr-info.eu"` and `sourceUrl` is the canonical ELI `https://eur-lex.europa.eu/eli/reg/2016/679/oj`; the mirror page goes in `verificationNote`.
- **The manual EUR-Lex step.** To flip a GDPR entry to `"official"`, the author opens `https://eur-lex.europa.eu/eli/reg/2016/679/oj` in a browser, compares the article (or recital) with the `summary`, then changes `verifiedAgainst` to `"official"`, updates `verifiedOn` to that day and removes `verificationNote`. Until then the catalog says `mirror:gdpr-info.eu`; the tool never claims an automated check against EUR-Lex.
- **Dates.** `verifiedOn` is the day the text was last compared. A source that cannot be opened is recorded here as such and never marked as checked in the catalog.

## Step 0 re-reads (M1, 2026-10-14)

| Key | Source | Result |
|---|---|---|
| LGPD 6 I | Planalto compiled text | Item I is the purpose principle (finalidade): legitimate, specific, explicit purposes informed to the data subject. |
| LGPD 6 II | Planalto compiled text | Item II is the adequacy principle (adequação): compatibility with the purposes informed, according to the context. |
| GDPR 5(1)(b) | gdpr-info.eu mirror, art. 5 | Purpose limitation: specified, explicit and legitimate purposes, no incompatible further processing. |
| GDPR recital 38 | gdpr-info.eu mirror, recital 38 | Children merit specific protection; it applies in particular to marketing, profiling and services offered directly to a child. |
| GDPR recital 75 | gdpr-info.eu mirror, recital 75 | Names the processing of personal data of vulnerable natural persons, in particular children, among the risk situations. |
| Steuer-ID structure | BZSt page `https://www.bzst.de/DE/Privatpersonen/SteuerlicheIdentifikationsnummer/steuerlicheidentifikationsnummer_node.html` (opened, HTTP 200) | Confirms the number has eleven digits and carries no information about the person. The page does not state the digit-pattern rule or the check-digit algorithm, so those two parts are **not confirmed on the BZSt page**: they come from the design spec and the research notes (secondary sources). The owner should confirm them on a primary BZSt document (the Meldebehörden FAQ PDFs linked from the BZSt site were not downloaded in this run). |

## WP248 rev.01 re-read (M6, 2026-10-14)

Source: Article 29 Working Party, *Guidelines on Data Protection Impact Assessment (DPIA) and determining whether processing is "likely to result in a high risk" for the purposes of Regulation 2016/679*, WP 248 rev.01, adopted on 4 April 2017, last revised and adopted on 4 October 2017 (PDF at `https://ec.europa.eu/newsroom/article29/redirection/document/47711`, downloaded and converted with `pdftotext` on 2026-10-14).

| Point | Result |
|---|---|
| The criteria | Nine criteria: (1) evaluation or scoring; (2) automated decision-making with legal or similar significant effect; (3) systematic monitoring; (4) sensitive data or data of a highly personal nature; (5) data processed on a large scale; (6) matching or combining datasets; (7) data concerning vulnerable data subjects; (8) innovative use or applying new technological or organisational solutions; (9) processing that prevents data subjects from exercising a right or using a service or a contract. There is no "third-party sharing" criterion, as Spec delta 5 says. |
| Patients | The vulnerable data subjects criterion names patients among the more vulnerable segments of the population (next to children, employees, the elderly and asylum seekers). |
| Two criteria | The guidelines say that in most cases processing meeting two criteria requires a DPIA; the tool words it "a DPIA is likely required" and never as a conclusion. |
| What the tool detects | Criterion 4 (a sensitive category in the inventory or a sensitive deterministic finding), criterion 7 (a children indicator or an entity named like a patient) and criterion 8 (a vendor of catalog category `llm` reached by a deterministic sink finding). Third-party sharing with a `needs-mechanism`, `conditional` or `unknown-destination` status is listed under "Other risk indicators", outside the count. |

## LGPD articles

| Key | Title | Verified on | Method |
|---|---|---|---|
| LGPD 5 I | Personal data (definition) | 2026-10-08 | Compared with the official compiled text (planalto), Windows-1252 converted to UTF-8 |
| LGPD 5 II | Sensitive personal data (definition) | 2026-10-08 | Compared with the official compiled text (planalto), Windows-1252 converted to UTF-8 |
| LGPD 5 XVII | Data protection impact report (RIPD) | 2026-10-08 | Compared with the official compiled text (planalto), Windows-1252 converted to UTF-8 |
| LGPD 6 I | Purpose principle | 2026-10-14 | Re-read on the official compiled text (planalto) during Step 0 of M1 |
| LGPD 6 II | Adequacy principle | 2026-10-14 | Re-read on the official compiled text (planalto) during Step 0 of M1 |
| LGPD 6 III | Necessity principle | 2026-10-08 | Compared with the official compiled text (planalto), Windows-1252 converted to UTF-8 |
| LGPD 6 VII | Security principle | 2026-10-08 | Compared with the official compiled text (planalto), Windows-1252 converted to UTF-8 |
| LGPD 7 | Legal bases for processing | 2026-10-08 | Compared with the official compiled text (planalto), Windows-1252 converted to UTF-8 |
| LGPD 11 | Legal bases for sensitive data | 2026-10-08 | Compared with the official compiled text (planalto), Windows-1252 converted to UTF-8 |
| LGPD 14 | Children's and adolescents' data | 2026-10-08 | Compared with the official compiled text (planalto), Windows-1252 converted to UTF-8 |
| LGPD 14 §1 | Parental consent for children's data | 2026-10-08 | Compared with the official compiled text (planalto), Windows-1252 converted to UTF-8 |
| LGPD 15 | End of processing | 2026-10-08 | Compared with the official compiled text (planalto), Windows-1252 converted to UTF-8 |
| LGPD 16 | Deletion after processing ends | 2026-10-08 | Compared with the official compiled text (planalto), Windows-1252 converted to UTF-8 |
| LGPD 18 | Data subject rights | 2026-10-08 | Compared with the official compiled text (planalto), Windows-1252 converted to UTF-8 |
| LGPD 33 | International transfer | 2026-10-08 | Compared with the official compiled text (planalto), Windows-1252 converted to UTF-8 |
| LGPD 33 II | Transfer with guarantees | 2026-10-08 | Compared with the official compiled text (planalto), Windows-1252 converted to UTF-8 |
| LGPD 33 VIII | Transfer with consent | 2026-10-08 | Compared with the official compiled text (planalto), Windows-1252 converted to UTF-8 |
| LGPD 34 | Assessment of the foreign protection level | 2026-10-08 | Compared with the official compiled text (planalto), Windows-1252 converted to UTF-8 |
| LGPD 35 | Standard and specific clauses | 2026-10-08 | Compared with the official compiled text (planalto), Windows-1252 converted to UTF-8 |
| LGPD 36 | Changes in guarantees | 2026-10-08 | Compared with the official compiled text (planalto), Windows-1252 converted to UTF-8 |
| LGPD 37 | Record of processing operations | 2026-10-08 | Compared with the official compiled text (planalto), Windows-1252 converted to UTF-8 |
| LGPD 38 | Impact report on request | 2026-10-08 | Compared with the official compiled text (planalto), Windows-1252 converted to UTF-8 |
| LGPD 38 parágrafo único | Minimum content of the impact report | 2026-10-08 | Compared with the official compiled text (planalto), Windows-1252 converted to UTF-8 |
| LGPD 41 | Data protection officer | 2026-10-08 | Compared with the official compiled text (planalto), Windows-1252 converted to UTF-8 |
| LGPD 46 | Security measures | 2026-10-08 | Compared with the official compiled text (planalto), Windows-1252 converted to UTF-8 |
| LGPD 48 | Incident communication | 2026-10-08 | Compared with the official compiled text (planalto), Windows-1252 converted to UTF-8 |
| LGPD 52 II | Simple fine | 2026-10-08 | Compared with the official compiled text (planalto), Windows-1252 converted to UTF-8 |

The LGPD has no direct art. 28 counterpart. LGPD art. 39 (the operator follows the controller's instructions) is not the equivalent of GDPR art. 28 (the processor contract and its mandatory terms), so it was removed from the catalog and no rule maps a processor-contract finding to an LGPD article. Messages for vendor flows say that art. 28 applies if the vendor acts as a processor and that the vendor's role must be verified.

## GDPR articles

| Key | Title | Verified on | Method |
|---|---|---|---|
| GDPR 4(1) | Personal data (definition) | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 4(5) | Pseudonymisation | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 4(13) | Genetic data | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 4(14) | Biometric data | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 4(15) | Data concerning health | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 5(1)(b) | Purpose limitation | 2026-10-14 | Re-read on the gdpr-info.eu mirror during Step 0 of M1; official EUR-Lex check pending |
| GDPR 5(1)(c) | Data minimisation | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 5(1)(e) | Storage limitation | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 5(1)(f) | Integrity and confidentiality | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 5(2) | Accountability | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 6 | Lawfulness of processing | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 8 | Child's consent for information society services | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 9(1) | Special categories of data | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 9(2) | Exceptions for special categories | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 10 | Criminal convictions and offences | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 25 | Data protection by design and by default | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 28 | Processor | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 30(1) | Records of processing activities (controller) | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 30(5) | Exemption from the records duty | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 32 | Security of processing | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 33 | Breach notification to the authority | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 35(1) | Data protection impact assessment | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 35(7) | Minimum content of a DPIA | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 44 | General principle for transfers | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 45 | Transfers on the basis of an adequacy decision | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 46 | Transfers subject to appropriate safeguards | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 47 | Binding corporate rules | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 49 | Derogations for specific situations | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 83(4) | Administrative fines, lower tier | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR 83(5) | Administrative fines, upper tier | 2026-10-08 | Compared with the gdpr-info.eu mirror; official EUR-Lex check pending |
| GDPR recital 38 | Specific protection of children | 2026-10-14 | Re-read on the gdpr-info.eu mirror during Step 0 of M1; official EUR-Lex check pending |
| GDPR recital 75 | Risks to the rights and freedoms of people | 2026-10-14 | Re-read on the gdpr-info.eu mirror during Step 0 of M1; official EUR-Lex check pending |

GDPR art. 35(3) was removed from the catalog: its three cases do not mention vulnerable data subjects. That criterion comes from the WP248 rev.01 guidelines and from recital 75, which the catalog keeps. WP248 rev.01 lists nine criteria (evaluation or scoring; automated decision with legal or similar effect; systematic monitoring; sensitive or highly personal data; large scale; matching or combining datasets; vulnerable data subjects; innovative technological or organisational solutions; preventing the exercise of a right); the DPIA document counts only those, and reads three of them from code.

## Identifier validators

Each validator is implemented from the algorithm written in the research notes (2026-10-08) and tested against the vectors of the design spec, Appendix A. "Secondary" means a reference page that was read but is not the issuing authority.

| Validator | Algorithm | Source and status |
|---|---|---|
| `cpf` | 11 digits, two mod 11 check digits, repeated digits rejected | Receita Federal rule, reference `https://en.wikipedia.org/wiki/Cadastro_de_Pessoas_F%C3%ADsicas` (secondary); vectors in the tests |
| `cnpj` | 14 characters, numeric or alphanumeric (value = code - 48), weights 2 to 9 from the right, mod 11 | Receita Federal CNPJ alfanumérico page `https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/cnpj-alfanumerico`; IN RFB 2.229/2024 facts confirmed through secondary summaries; the official example `12.ABC.345/01DE-35` validates |
| `iban` | Country length when known, mod 97 equal to 1 | ISO 13616, reference `https://en.wikipedia.org/wiki/International_Bank_Account_Number` (secondary); `PT50000201231234567890154` cross-checked with ibantools 4.5.4 during research |
| `luhn` | Luhn checksum, 12 to 19 digits | ISO/IEC 7812-1; vector `4111 1111 1111 1111` |
| `nif-pt` | 9 digits, weights 9 to 2, mod 11 | Algorithm from the research notes. The meaning of the first digit (a NIF starting with 5 or 6 may belong to a legal entity or a public body) is not confirmed with Autoridade Tributária, so the catalog note says "verify" |
| `dni-es` | 8 digits plus a letter, number mod 23 | Ministerio del Interior page `https://www.interior.gob.es/opencms/en/servicios-al-ciudadano/tramites-y-gestiones/dni/calculo-del-digito-de-control-del-nif-nie/` (refuses non-browser clients; open it in a browser) |
| `nie-es` | X, Y or Z mapped to 0, 1, 2, then the same mod 23 letter | Same Ministerio del Interior page |
| `codice-fiscale-it` | 16 characters, odd and even position tables, check letter mod 26, omocodia letters accepted; in an omocode code the check letter is computed on the characters as written, each substituted letter (L M N P Q R S T U V) taking its own letter value, not the value of the digit it replaced | Reference `https://it.wikipedia.org/wiki/Codice_fiscale` (secondary; its omocodia section says the check character "deve essere ricalcolato" after the substitution). Reference implementation python-stdnum `stdnum/it/codicefiscale.py` (`_odd_values`/`_even_values` value each letter as itself) and its published omocode vectors `RSSMRA45C12F20RX`, `RSSMRA45C12F2L5N`, `RSSMRA45C12F2LRI`, `RSSMRAQRCMNFNLRG` (variants of `RSSMRA45C12F205C`, each with a different check letter) from `tests/test_it_codicefiscale.doctest`, read on GitHub 2026-10-14; these vectors are in the unit tests |
| `steuer-id-de` | 11 digits, first digit not 0, one digit twice or three times among the first ten, ISO 7064 MOD 11,10 check digit | Check digit: ISO 7064 and the published sample `65929970489`. Structure rule: design spec 4.2 and research notes, reference `https://de.wikipedia.org/wiki/Steuerliche_Identifikationsnummer` (secondary); not confirmed on the BZSt page (see Step 0 above) |
| `bsn-nl` | 9 digits, the 11-proof | Algorithm from the research notes; vector `111222333` |
| `nir-fr` | 15 characters, Corsica 2A and 2B count as 19 and 18, key = 97 - (first 13 digits mod 97) | Reference `https://fr.wikipedia.org/wiki/Num%C3%A9ro_de_s%C3%A9curit%C3%A9_sociale_en_France` (secondary); key of the published-style sample computed |

False-positive sampling (200,000 random strings, seed 20261008, run 2026-10-14): a random 9-digit string passes the PT NIF check 9.94% of the time and the NL BSN check 9.08% of the time (18.13% pass at least one, hence the corroboration rule VAL-06); a random 11-digit string passes the Steuer-ID check, structure rule included, 0.35% of the time (the design spec expected about 1%) and the CPF check 0.98% of the time.

## M9 term lists

Examples for German, French and Italian field names are kept here and are not shipped in v0.1. In v0.1 a German `geburtsdatum` or a French `adresse` field is not classified by name, and the README limits say so.

| Language | Examples |
|---|---|
| de | `geburtsdatum`, `steuer_id`, `steueridentifikationsnummer`, `krankenkasse` |
| fr | `numero_securite_sociale`, `date_naissance`, `adresse`, `nom_famille` |
| it | `cf`, `cap`, `data_nascita`, `codice_fiscale` |

The minor terms of `PR-CHILD` (spec 5.5) ship as `children.minor-flag` exact terms: `menor` and `crianca` in pt, `minor`, `child`, `kid`, `enfant` and `bambino` in en, `menor` and `nino` (from `niño`) in es. The German `kind` is held back for M9: as an exact term it would classify the very common English field name `kind` (`kind: "table"`) as a minor flag.

## Rules and articles

The table below is generated from `catalog/rules.json`; `tests/unit/catalog.unit.test.ts` asserts it equals the file, and `UPDATE_GOLDEN=1` rewrites it. Contributions are individual catalog keys: `*` always, a category group when a category of that group is in the finding, and `transfer` when that regime's transfer status is `needs-mechanism` or `conditional`.

<!-- rules:start -->
| Rule id | Triggers when | Severity | LGPD | GDPR |
|---|---|---|---|---|
| `PR-LOG` | A source reaches a log sink | matrix | *: 6 VII, 46; special: 11; children: 14 | *: 5(1)(f), 32; special: 9(1); criminal: 10; children: 8 |
| `PR-THIRD-PARTY` | A source reaches an http sink with a literal host or a non-literal URL | matrix; note when the host is unresolved | *: 6 VII, 46; special: 11; transfer: 33 | *: 28, 32; special: 9(1); criminal: 10; transfer: 44, 45, 46 |
| `PR-ANALYTICS` | A source reaches an analytics sink | matrix | *: 6 I, 6 II, 6 III, 7, 46; special: 11; children: 14; transfer: 33 | *: 5(1)(b), 5(1)(c), 6, 28; special: 9(1); criminal: 10; children: 8; transfer: 44, 45, 46 |
| `PR-FILE` | A source reaches a file sink | matrix | *: 6 VII, 46; special: 11 | *: 5(1)(f), 32; special: 9(1); criminal: 10 |
| `PR-URL-QUERY` | A source is interpolated into a URL query string | matrix; error for identifiers and sensitive data | *: 6 VII, 46; special: 11 | *: 5(1)(f), 32; special: 9(1); criminal: 10 |
| `PR-TRANSFER` | A source reaches a known vendor whose transfer status needs a mechanism or is conditional | warning; error when a sensitive category reaches that sink | *: 33, 33 II, 33 VIII, 34, 35, 36 | *: 44, 45, 46, 47, 49 |
| `PR-PLAINTEXT-SENSITIVE` | A storage field classified as sensitive has no hash, encryption or row-level protection hint | warning | *: 6 VII, 46; special: 11 | *: 5(1)(f), 25, 32; special: 9(1) |
| `PR-RETENTION` | A storage entity with personal fields has no retention signal | warning when the entity has a sensitive field, else note | *: 6 III, 15, 16 | *: 5(1)(e), 30(1) |
| `PR-CHILD` | A storage entity has a children indicator | note | *: 14, 14 §1 | *: 8, recital 38, recital 75 |
| `PR-HARDCODED-VALUE` | A file holds a checksum-valid personal value or an e-mail address | warning | *: 6 III, 6 VII, 46 | *: 5(1)(c), 5(1)(f), 32 |
| `PR-AMBIGUOUS` | The LLM labeled an ambiguous field with a personal category | note; confidence capped at medium | *: 5 I | *: 4(1) |
| `PR-PARSE` | A file produced a parse, depth or dialect warning | note | none | none |
<!-- rules:end -->
