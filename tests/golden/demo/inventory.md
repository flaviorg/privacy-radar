# Personal-data inventory

> This is not legal advice and not a complete assessment.

3 entities, 24 fields: 14 personal (3 sensitive, 2 children indicators), 1 not personal, 2 below threshold, 2 ambiguous, 5 unclassified; 16 values masked.

## `Appointment` (model)

Locations: `prisma/schema.prisma:22`, `migrations/001_init.sql:27`

- Has sensitive data: no
- Has children indicator: no
- Retention signal: none
- Protection hints: none

| Field | Categories | Sensitivity | Confidence | Sinks reached | Locations | LLM label (advisory) |
|---|---|---|---|---|---|---|
| `id` | none | not-personal (unclassified) | 0.00 low | none | `prisma/schema.prisma:23`, `migrations/001_init.sql:28` | none |
| `patientId` | none | not-personal (unclassified) | 0.00 low | none | `prisma/schema.prisma:24`, `migrations/001_init.sql:29` | none |
| `scheduledAt` | none | not-personal (unclassified) | 0.00 low | none | `prisma/schema.prisma:25`, `migrations/001_init.sql:30` | none |
| `reminderPhone` | `contact.phone` | personal (personal) | 0.50 medium | none | `prisma/schema.prisma:26`, `migrations/001_init.sql:31` | none |
| `extra` | none | not-personal (ambiguous) | 0.00 low | none | `prisma/schema.prisma:27`, `migrations/001_init.sql:32` | `unknown` (0.30, scripted) |

## `Clinic` (model)

Locations: `prisma/schema.prisma:32`, `migrations/001_init.sql:3`

- Has sensitive data: no
- Has children indicator: no
- Retention signal: none
- Protection hints: none

| Field | Categories | Sensitivity | Confidence | Sinks reached | Locations | LLM label (advisory) |
|---|---|---|---|---|---|---|
| `cnpj` | `identifier.cnpj` | not-personal (not-personal) | 0.30 low | none | `prisma/schema.prisma:33`, `migrations/001_init.sql:4` | none |
| `name` | `name.full-name` | personal (below-threshold) | 0.30 low | none | `prisma/schema.prisma:34`, `migrations/001_init.sql:5` | none |
| `address` | `contact.address` | personal (below-threshold) | 0.30 low | none | `prisma/schema.prisma:35`, `migrations/001_init.sql:6` | none |

## `Patient` (model)

Locations: `prisma/schema.prisma:3`, `migrations/001_init.sql:9`

- Has sensitive data: yes
- Has children indicator: yes
- Retention signal: none
- Protection hints: none

| Field | Categories | Sensitivity | Confidence | Sinks reached | Locations | LLM label (advisory) |
|---|---|---|---|---|---|---|
| `id` | none | not-personal (unclassified) | 0.00 low | none | `prisma/schema.prisma:4`, `migrations/001_init.sql:10` | none |
| `fullName` | `name.full-name` | personal (personal) | 0.60 medium | `fs.appendFileSync` `src/billing.ts:8`; `console.info` `src/patients.ts:14` | `prisma/schema.prisma:5`, `migrations/001_init.sql:11` | none |
| `cpf` | `identifier.cpf` | personal (personal) | 0.65 medium | `mixpanel.track` `src/analytics.ts:9` (Mixpanel); `console.info` `src/patients.ts:14` | `prisma/schema.prisma:6`, `migrations/001_init.sql:12` | none |
| `nifPt` | `identifier.nif-pt` | personal (personal) | 0.60 medium | `<query>` `src/appointments.ts:11`; `fetch` `src/appointments.ts:11`; `console.info` `src/patients.ts:14` | `prisma/schema.prisma:7`, `migrations/001_init.sql:13` | none |
| `dniEs` | `identifier.dni-es` | personal (personal) | 0.60 medium | `console.info` `src/patients.ts:14` | `prisma/schema.prisma:8`, `migrations/001_init.sql:14` | none |
| `codiceFiscale` | `identifier.codice-fiscale-it` | personal (personal) | 0.60 medium | `console.info` `src/patients.ts:14` | `prisma/schema.prisma:9`, `migrations/001_init.sql:15` | none |
| `email` | `contact.email` | personal (personal) | 0.60 medium | `console.info` `src/patients.ts:14` | `prisma/schema.prisma:10`, `migrations/001_init.sql:16` | none |
| `phone` | `contact.phone` | personal (personal) | 0.60 medium | `console.info` `src/patients.ts:14` | `prisma/schema.prisma:11`, `migrations/001_init.sql:17` | none |
| `birthDate` | `demographic.birth-date` | personal (personal) | 0.75 medium | `console.info` `src/patients.ts:14` | `prisma/schema.prisma:12`, `migrations/001_init.sql:18` | none |
| `guardianName` | `children.guardian` | children-indicator (personal) | 0.60 medium | `console.info` `src/patients.ts:14` | `prisma/schema.prisma:13`, `migrations/001_init.sql:19` | none |
| `diagnosis` | `special.health` | sensitive (personal) | 0.60 medium | `console.info` `src/patients.ts:14` | `prisma/schema.prisma:14`, `migrations/001_init.sql:20` | none |
| `allergies` | `special.health` | sensitive (personal) | 0.60 medium | none | `prisma/schema.prisma:15`, `migrations/001_init.sql:21` | none |
| `bloodType` | `special.health` | sensitive (personal) | 0.60 medium | none | `prisma/schema.prisma:16`, `migrations/001_init.sql:22` | none |
| `obs` | none | not-personal (ambiguous) | 0.00 low | none | `prisma/schema.prisma:17`, `migrations/001_init.sql:23` | `special.health` (0.62, scripted) |
| `createdAt` | none | not-personal (unclassified) | 0.00 low | none | `prisma/schema.prisma:18`, `migrations/001_init.sql:24` | none |
| `mother_name` | `name.mother-name` | personal (personal) | 0.60 medium | `console.info` `src/patients.ts:14` | `migrations/001_init.sql:37` | none |

## Hosts

| Host | Vendor | HQ |
|---|---|---|
| `api.mixpanel.com` | Mixpanel | US |
| `sms.example-vendor.invalid` | unknown | unknown |

## Values found in code (masked)

| Location | Categories | Checksum | Masked value |
|---|---|---|---|
| `migrations/001_init.sql:40` | `identifier.cnpj` | valid | `**.***.***/****-58` |
| `migrations/001_init.sql:43` | `identifier.cpf` | valid | `***.***.***-56` |
| `migrations/001_init.sql:43` | `identifier.codice-fiscale-it` | valid | `**************1G` |
| `migrations/001_init.sql:44` | `identifier.nif-pt` | valid | `*******18` |
| `migrations/001_init.sql:44` | `identifier.dni-es` | valid | `*******5X` |
| `migrations/001_init.sql:45` | `identifier.nif-pt` | valid | `*******72` |
| `migrations/001_init.sql:45` | `identifier.nie-es` | valid | `*******2Q` |
| `src/server.ts:13` | `identifier.cpf` | valid | `***.***.***-97` |
| `src/server.ts:14` | `contact.email` | n/a | `*****.******@*******.invalid` |
| `src/server.ts:16` | `financial.iban` | valid | `**** **** **** **** **** ***9 2` |
| `src/server.ts:17` | `identifier.steuer-id-de` | valid | `*********65` |
| `src/server.ts:18` | `identifier.bsn-nl` | valid | `*******82` |
| `src/server.ts:22` | `identifier.cpf` | valid | `***.***.***-64` |
| `src/server.ts:23` | `contact.email` | n/a | `******.*********@*******.invalid` |
| `src/server.ts:24` | `identifier.nir-fr` | valid | `* ** ** ** *** *** 82` |
| `src/server.ts:25` | `financial.card-pan` | valid | `**** **** **** **07` |
