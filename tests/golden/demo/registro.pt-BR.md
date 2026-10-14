> **Rascunho gerado por privacy-radar 0.1.0 em 2026-10-08 a partir de fixtures/telehealth-clinic. Isto não é aconselhamento jurídico nem uma avaliação completa. As seções marcadas "Rascunho narrativo (LLM)" foram escritas por um modelo de linguagem a partir dos fatos listados em "Índice de evidências"; todo o resto foi calculado a partir do código. Provedor: fake (scripted).**

# Registro das operações de tratamento (LGPD art. 37): rascunho

## Agente de tratamento

| Campo | Valor |
|---|---|
| Nome | não declarado (preencher) |
| Contato | não declarado (preencher) |
| Encarregado (DPO) | não declarado (preencher) |
| País | não declarado (preencher) |

## Finalidades

### Rascunho narrativo (LLM)

O controlador ainda não declarou as finalidades do tratamento na configuração; as 3 entidades e os 24 campos encontrados precisam de uma finalidade legítima, específica e explícita \(art. 6 I\).

Cada finalidade precisa de uma base legal do art. 7 antes que este registro seja usado.

| Tratamento | Finalidade |
|---|---|
| - | não declarado (preencher) |

## Bases legais

| Tratamento | LGPD | GDPR |
|---|---|---|
| - | não declarado (preencher) | não declarado (preencher) |

## Titulares e categorias de dados pessoais

| Entidade | Tipo | Categorias pessoais | Campos sensíveis | Evidência |
|---|---|---|---|---|
| `Appointment` | model | `contact.phone` | 0 | `prisma/schema.prisma:22` · PRF-bf414ef5e585 |
| `Patient` | model | `children.guardian`, `contact.email`, `contact.phone`, `demographic.birth-date`, `identifier.codice-fiscale-it`, `identifier.cpf`, `identifier.dni-es`, `identifier.nif-pt`, `name.full-name`, `name.mother-name`, `special.health` | 3 | `prisma/schema.prisma:3` · PRF-657cf280cb51 · PRF-f4843659e367 · PRF-c182bf867fe3 · PRF-434fb7038dc0 · PRF-a564f29cec7a |

| Categoria | Sensibilidade | Campos | Evidência |
|---|---|---|---|
| `children.guardian` | children-indicator | `Patient.guardianName` | `prisma/schema.prisma:13` |
| `contact.email` | personal | `Patient.email` | `prisma/schema.prisma:10` |
| `contact.phone` | personal | `Appointment.reminderPhone`, `Patient.phone` | `prisma/schema.prisma:26` |
| `demographic.birth-date` | personal | `Patient.birthDate` | `prisma/schema.prisma:12` |
| `identifier.codice-fiscale-it` | personal | `Patient.codiceFiscale` | `prisma/schema.prisma:9` |
| `identifier.cpf` | personal | `Patient.cpf` | `prisma/schema.prisma:6` |
| `identifier.dni-es` | personal | `Patient.dniEs` | `prisma/schema.prisma:8` |
| `identifier.nif-pt` | personal | `Patient.nifPt` | `prisma/schema.prisma:7` |
| `name.full-name` | personal | `Patient.fullName` | `prisma/schema.prisma:5` |
| `name.mother-name` | personal | `Patient.mother_name` | `migrations/001_init.sql:37` |
| `special.health` | sensitive | `Patient.diagnosis`, `Patient.allergies`, `Patient.bloodType` | `prisma/schema.prisma:14` |

### Campos rotulados pelo LLM (consultivo)

Rótulos propostos por um modelo de linguagem para campos que o motor determinístico marcou como ambíguos. Eles não mudam nenhuma tabela, contagem, critério ou indicador deste documento.

| Campo | Rótulo do LLM | Confiança |
|---|---|---|
| `Appointment.extra` | `unknown` | 0.30 |
| `Patient.obs` | `special.health` | 0.62 |

## Compartilhamento com terceiros

| Destinatário | Host | País | Saída | Categorias pessoais | Evidência |
|---|---|---|---|---|---|
| Mixpanel | - | US | analytics (`mixpanel.track`) | `identifier.cpf`, `special.health` | `src/analytics.ts:9` · PRF-75710fb636ee |
| Mixpanel | `api.mixpanel.com` | US | http (`fetch`) | `contact.email` | `src/analytics.ts:12` · PRF-625c0e6ca12c |
| destino desconhecido | `sms.example-vendor.invalid` | - | http (`fetch`) | `identifier.nif-pt` | `src/appointments.ts:11` · PRF-03c1b747fbda |

## Transferência internacional

| Destinatário | País | Regime | Situação | Avaliação (datada, verificar) | Evidência |
|---|---|---|---|---|---|
| Mixpanel | US | LGPD | needs-mechanism | Mixpanel \(US\): not on the ANPD adequacy list; needs LGPD art. 33 II or VIII evidence; status as of 2026-10-08; verify | `src/analytics.ts:9` · PRF-75710fb636ee · PRF-523d4d87c8f8 |
| Mixpanel | US | GDPR | conditional | Mixpanel \(US\): Only organisations certified under the EU-US Data Privacy Framework \(Commission decision of 2023-07-10\); the CJEU appeal C-703/25 P \(Latombe\) was pending on 2026-10-08. Verify the vendor on dataprivacyframework.gov; status as of 2026-10-08; verify | `src/analytics.ts:9` · PRF-75710fb636ee · PRF-523d4d87c8f8 |
| Mixpanel | US | LGPD | needs-mechanism | Mixpanel \(US\): not on the ANPD adequacy list; needs LGPD art. 33 II or VIII evidence; status as of 2026-10-08; verify | `src/analytics.ts:12` · PRF-625c0e6ca12c · PRF-0fa0612e8403 |
| Mixpanel | US | GDPR | conditional | Mixpanel \(US\): Only organisations certified under the EU-US Data Privacy Framework \(Commission decision of 2023-07-10\); the CJEU appeal C-703/25 P \(Latombe\) was pending on 2026-10-08. Verify the vendor on dataprivacyframework.gov; status as of 2026-10-08; verify | `src/analytics.ts:12` · PRF-625c0e6ca12c · PRF-0fa0612e8403 |
| destino desconhecido | - | LGPD | unknown-destination | sms.example-vendor.invalid: unknown destination, the host is not in the vendor catalog; status as of 2026-10-08; verify | `src/appointments.ts:11` · PRF-03c1b747fbda |
| destino desconhecido | - | GDPR | unknown-destination | sms.example-vendor.invalid: unknown destination, the host is not in the vendor catalog; status as of 2026-10-08; verify | `src/appointments.ts:11` · PRF-03c1b747fbda |

## Retenção

| Entidade | Sinal de retenção | Evidência |
|---|---|---|
| `Appointment` | não declarado (preencher) | `prisma/schema.prisma:22` · PRF-bf414ef5e585 |
| `Patient` | não declarado (preencher) | `prisma/schema.prisma:3` · PRF-657cf280cb51 |

## Medidas de segurança

### Rascunho narrativo (LLM)

A varredura encontrou 5 erros e 10 avisos; dados pessoais aparecem em logs, em um arquivo local, na query string de uma URL e em valores fixos no código \(art. 6 VII\).

O art. 46 pede medidas de segurança aptas a proteger os dados das 3 entidades; a tabela abaixo indica cada achado com o seu local.

| Severidade | Regra | Categorias pessoais | Local | Achado | Artigos |
|---|---|---|---|---|---|
| error | PR-URL-QUERY | `identifier.nif-pt` | `src/appointments.ts:11` | PRF-1ebfd8cb6584 | 6 VII, 46 |
| error | PR-LOG | `children.guardian`, `contact.email`, `contact.phone`, `demographic.birth-date`, `identifier.codice-fiscale-it`, `identifier.cpf`, `identifier.dni-es`, `identifier.nif-pt`, `name.full-name`, `name.mother-name`, `special.health` | `src/patients.ts:14` | PRF-a801d7df93b2 | 6 VII, 11, 14, 46 |
| error | PR-LOG | `identifier.cpf` | `src/patients.ts:22` | PRF-d62cb6e822ab | 6 VII, 46 |
| warning | PR-HARDCODED-VALUE | `identifier.codice-fiscale-it`, `identifier.cpf`, `identifier.dni-es`, `identifier.nie-es`, `identifier.nif-pt` | `migrations/001_init.sql:43` | PRF-a6cc4ffa6e11 | 6 III, 6 VII, 46 |
| warning | PR-PLAINTEXT-SENSITIVE | `special.health` | `prisma/schema.prisma:14` | PRF-f4843659e367 | 6 VII, 11, 46 |
| warning | PR-PLAINTEXT-SENSITIVE | `special.health` | `prisma/schema.prisma:15` | PRF-c182bf867fe3 | 6 VII, 11, 46 |
| warning | PR-PLAINTEXT-SENSITIVE | `special.health` | `prisma/schema.prisma:16` | PRF-434fb7038dc0 | 6 VII, 11, 46 |
| warning | PR-FILE | `financial.iban`, `name.full-name` | `src/billing.ts:8` | PRF-abe3990272c6 | 6 VII, 46 |
| warning | PR-HARDCODED-VALUE | `contact.email`, `financial.card-pan`, `financial.iban`, `identifier.bsn-nl`, `identifier.cpf`, `identifier.nir-fr`, `identifier.steuer-id-de` | `src/server.ts:13` | PRF-206f6fd6b0f0 | 6 III, 6 VII, 46 |

### Indícios de proteção encontrados no código

_Nenhum detectado._

## Índice de evidências

Cada linha aponta para um achado em findings.json (id, regra e arquivo:linha).

- PRF-75710fb636ee · PR-ANALYTICS · `src/analytics.ts:9`
- PRF-523d4d87c8f8 · PR-TRANSFER · `src/analytics.ts:9`
- PRF-1ebfd8cb6584 · PR-URL-QUERY · `src/appointments.ts:11`
- PRF-a801d7df93b2 · PR-LOG · `src/patients.ts:14`
- PRF-d62cb6e822ab · PR-LOG · `src/patients.ts:22`
- PRF-a6cc4ffa6e11 · PR-HARDCODED-VALUE · `migrations/001_init.sql:43`
- PRF-657cf280cb51 · PR-RETENTION · `prisma/schema.prisma:3`
- PRF-f4843659e367 · PR-PLAINTEXT-SENSITIVE · `prisma/schema.prisma:14`
- PRF-c182bf867fe3 · PR-PLAINTEXT-SENSITIVE · `prisma/schema.prisma:15`
- PRF-434fb7038dc0 · PR-PLAINTEXT-SENSITIVE · `prisma/schema.prisma:16`
- PRF-625c0e6ca12c · PR-THIRD-PARTY · `src/analytics.ts:12`
- PRF-0fa0612e8403 · PR-TRANSFER · `src/analytics.ts:12`
- PRF-03c1b747fbda · PR-THIRD-PARTY · `src/appointments.ts:11`
- PRF-abe3990272c6 · PR-FILE · `src/billing.ts:8`
- PRF-206f6fd6b0f0 · PR-HARDCODED-VALUE · `src/server.ts:13`
- PRF-a564f29cec7a · PR-CHILD · `prisma/schema.prisma:3`
- PRF-bf414ef5e585 · PR-RETENTION · `prisma/schema.prisma:22`

---

Isto não é aconselhamento jurídico nem uma avaliação completa.
