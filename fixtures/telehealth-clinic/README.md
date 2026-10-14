# telehealth-clinic (demo fixture)

A tiny Node/TypeScript telehealth clinic with Brazilian and European patients. privacy-radar scans it in the demo and in the end-to-end tests. Nothing here is installed or run: no dependency is declared, and the code only has to parse.

Every identifier, name, e-mail and address in this folder is **synthetic**. The identifiers were generated once with the project's own validators (a seeded throwaway script), so they pass their checksums, but they belong to nobody. The e-mails use the reserved `example.invalid` domain. `tests/helpers/fixture-values.ts` lists the same values with their files and lines, and the no-leak test checks that none of them appears in any output.

## Scanned files (8)

| File | Kind | What it holds |
|---|---|---|
| `prisma/schema.prisma` | prisma | Models `Patient` (15 fields), `Appointment` (5) and `Clinic` (3), each with `@@map` to its table name |
| `migrations/001_init.sql` | sql | PostgreSQL DDL for `patients`, `appointments`, `clinics`; `COMMENT ON COLUMN patients.cpf`; `ALTER TABLE patients ADD COLUMN mother_name`; a seed comment with an apostrophe; the seed `INSERT`s |
| `src/patients.ts` | ts | `createPatient(input: Patient)` logs the whole record; `findByCpf(cpf)` logs the CPF |
| `src/logger.ts` | ts | A pino-like logger whose properties are all functions (not an entity) |
| `src/analytics.ts` | ts | `trackVisit` sends CPF and diagnosis to Mixpanel; `syncProfile` posts the e-mail to Mixpanel's API through one local binding |
| `src/appointments.ts` | ts | `remind` puts the PT NIF in the query string of an unknown SMS vendor |
| `src/billing.ts` | ts | `invoice` appends the patient's name and IBAN to a CSV file; the clinic's CNPJ goes on the invoice header |
| `src/server.ts` | ts | The HTTP wiring and `DEMO_SEED`, an exported array of synthetic records; a comment written as a prompt-injection attempt; it is not the context of any ambiguous field, so `no-leak.e2e` asserts it never reaches a prompt (hostile model answers are tested by `injection.e2e` with `tests/fixtures/llm/injection.json`) |

`package.json` and this README are present but not scanned.

## Deliberate issues

| Where | Expected finding |
|---|---|
| `src/patients.ts:14` | `PR-LOG` error: the `Patient` type hint makes the whole record a source |
| `src/patients.ts:22` | `PR-LOG` error: `identifier.cpf` |
| `src/analytics.ts:9` | `PR-ANALYTICS` error and `PR-TRANSFER` error (CPF and health data to Mixpanel, US) |
| `src/analytics.ts:12` | `PR-THIRD-PARTY` warning and `PR-TRANSFER` warning (`contact.email` through the binding `payload`) |
| `src/appointments.ts:11` | `PR-URL-QUERY` error and `PR-THIRD-PARTY` warning (unknown destination; no `PR-TRANSFER`) |
| `src/billing.ts:8` | `PR-FILE` warning (`name.full-name`, `financial.iban`) |
| `prisma/schema.prisma` | `PR-PLAINTEXT-SENSITIVE` for `diagnosis`, `allergies`, `bloodType`; `PR-RETENTION` on `Patient` (warning) and `Appointment` (note); `PR-CHILD` on `Patient` (note); `obs` and `extra` are ambiguous |
| `src/server.ts` | `PR-HARDCODED-VALUE` warning (9 qualifying values) |
| `migrations/001_init.sql` | `PR-HARDCODED-VALUE` warning (6 qualifying values; the CNPJ is not personal) |

`Clinic.name` and `Clinic.address` stay below the confidence threshold because `clinic` is a non-person entity; `Clinic.cnpj` is classified as not personal.

## Synthetic values

| Kind | Value | File | Line |
|---|---|---|---|
| CPF | `159.368.495-97` | `src/server.ts` | 13 |
| CPF | `521.891.152-64` | `src/server.ts` | 22 |
| CPF | `245.452.155-56` | `migrations/001_init.sql` | 43 |
| CNPJ | `67.577.703/0001-58` | `migrations/001_init.sql` | 40 |
| PT NIF | `205174418` | `migrations/001_init.sql` | 44 |
| PT NIF | `297108972` | `migrations/001_init.sql` | 45 |
| ES DNI | `61852415X` | `migrations/001_init.sql` | 44 |
| ES NIE | `Y4098832Q` | `migrations/001_init.sql` | 45 |
| IT codice fiscale | `VRDLCU88E52H501G` | `migrations/001_init.sql` | 43 |
| DE Steuer-ID | `53460972865` | `src/server.ts` | 17 |
| NL BSN | `143973782` | `src/server.ts` | 18 |
| FR NIR | `2 91 03 75 129 764 82` | `src/server.ts` | 24 |
| IBAN | `PT57 0035 0651 3001 6084 9559 2` | `src/server.ts` | 16 |
| Card PAN | `4585 4659 4132 3107` | `src/server.ts` | 25 |
| E-mail | `joana.prates@example.invalid` | `src/server.ts` | 14 |
| E-mail | `pieter.voorbeeld@example.invalid` | `src/server.ts` | 23 |
| Full name | `Joana Exemplo Prates` | `src/server.ts` | 12 |
| Full name | `Pieter Voorbeeld` | `src/server.ts` | 21 |
| Address | `Rua das Amostras 42, Lisboa` | `src/server.ts` | 15 |

The SQL seed also names an invented clinic (`Telehealth Demo Clinic`).

## The base revision

`../telehealth-clinic-base/` holds the two files as they are in the base commit of the demo pull request: `src/analytics.ts` sends only an anonymous visit id, and `src/patients.ts` also appends the looked-up CPF to `audit.log`.
