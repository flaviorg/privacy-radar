> **Rascunho gerado por privacy-radar 0.1.0 em 2026-10-08 a partir de fixtures/telehealth-clinic. Isto não é aconselhamento jurídico nem uma avaliação completa. As seções marcadas "Rascunho narrativo (LLM)" foram escritas por um modelo de linguagem a partir dos fatos listados em "Índice de evidências"; todo o resto foi calculado a partir do código. Provedor: fake (scripted).**

# Relatório de impacto à proteção de dados pessoais (LGPD art. 38): rascunho

## Contexto

Nos termos do art. 38 da LGPD, a ANPD poderá determinar ao controlador que elabore este relatório; este rascunho o prepara a partir do código e não afirma que o relatório é obrigatório.

O art. 5º, XVII, da LGPD define o RIPD como a documentação do controlador que contém a descrição dos processos de tratamento de dados pessoais que podem gerar riscos às liberdades civis e aos direitos fundamentais, bem como medidas, salvaguardas e mecanismos de mitigação de risco.

## Tipos de dados coletados (art. 38, parágrafo único)

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

| Entidade | Tipo | Categorias pessoais | Campos sensíveis | Evidência |
|---|---|---|---|---|
| `Appointment` | model | `contact.phone` | 0 | `prisma/schema.prisma:22` · PRF-bf414ef5e585 |
| `Patient` | model | `children.guardian`, `contact.email`, `contact.phone`, `demographic.birth-date`, `identifier.codice-fiscale-it`, `identifier.cpf`, `identifier.dni-es`, `identifier.nif-pt`, `name.full-name`, `name.mother-name`, `special.health` | 3 | `prisma/schema.prisma:3` · PRF-657cf280cb51 · PRF-f4843659e367 · PRF-c182bf867fe3 · PRF-434fb7038dc0 · PRF-a564f29cec7a |

### Campos rotulados pelo LLM (consultivo)

Rótulos propostos por um modelo de linguagem para campos que o motor determinístico marcou como ambíguos. Eles não mudam nenhuma tabela, contagem, critério ou indicador deste documento.

| Campo | Rótulo do LLM | Confiança |
|---|---|---|
| `Appointment.extra` | `unknown` | 0.30 |
| `Patient.obs` | `special.health` | 0.62 |

## Metodologia de coleta e garantia da segurança das informações (art. 38, parágrafo único)

### Onde os dados pessoais são coletados e armazenados

| Entidade | Fonte | Evidência |
|---|---|---|
| `Appointment` | prisma | `prisma/schema.prisma:22` |
| `Appointment` | sql | `migrations/001_init.sql:27` |
| `Patient` | prisma | `prisma/schema.prisma:3` |
| `Patient` | sql | `migrations/001_init.sql:9` |

### Onde os dados pessoais saem da aplicação

| Saída | Destinatário | Categorias pessoais | Evidência |
|---|---|---|---|
| analytics (`mixpanel.track`) | Mixpanel | `identifier.cpf`, `special.health` | `src/analytics.ts:9` · PRF-75710fb636ee |
| url-query (`<query>`) | - | `identifier.nif-pt` | `src/appointments.ts:11` · PRF-1ebfd8cb6584 |
| log (`console.info`) | - | `children.guardian`, `contact.email`, `contact.phone`, `demographic.birth-date`, `identifier.codice-fiscale-it`, `identifier.cpf`, `identifier.dni-es`, `identifier.nif-pt`, `name.full-name`, `name.mother-name`, `special.health` | `src/patients.ts:14` · PRF-a801d7df93b2 |
| log (`logger.debug`) | - | `identifier.cpf` | `src/patients.ts:22` · PRF-d62cb6e822ab |
| http (`fetch`) | Mixpanel | `contact.email` | `src/analytics.ts:12` · PRF-625c0e6ca12c |
| http (`fetch`) | destino desconhecido | `identifier.nif-pt` | `src/appointments.ts:11` · PRF-03c1b747fbda |
| file (`fs.appendFileSync`) | - | `financial.iban`, `name.full-name` | `src/billing.ts:8` · PRF-abe3990272c6 |

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

## Medidas, salvaguardas e mecanismos de mitigação de risco (art. 38, parágrafo único)

### Rascunho narrativo (LLM)

As medidas abaixo seguem as regras que dispararam na varredura: 5 erros, 10 avisos e 2 notas, com os 3 campos sensíveis em texto puro como prioridade \(art. 38, parágrafo único\).

As salvaguardas devem ser validadas pelo encarregado e complementadas com os itens que a configuração não declara, conforme o art. 46.

### Medidas recomendadas (texto fixo por regra)

- **PR-LOG**: Retirar dados pessoais das chamadas de log, registrar um identificador substituto e restringir o acesso e a retenção dos logs.
- **PR-THIRD-PARTY**: Confirmar o papel e o contrato do destinatário, enviar só os dados que a finalidade exige e registrar o mecanismo de transferência.
- **PR-ANALYTICS**: Enviar ao analytics identificadores pseudônimos, nunca identificadores ou dados sensíveis, e firmar um contrato de operador com o fornecedor.
- **PR-FILE**: Evitar gravar dados pessoais em arquivos locais; quando necessário, criptografar o arquivo e definir quem pode lê-lo e por quanto tempo.
- **PR-URL-QUERY**: Retirar dados pessoais da query string da URL e enviá-los no corpo ou nos cabeçalhos da requisição por HTTPS.
- **PR-TRANSFER**: Documentar o mecanismo de transferência internacional (adequação, cláusulas contratuais ou outra hipótese legal) para cada fornecedor e verificá-lo periodicamente.
- **PR-PLAINTEXT-SENSITIVE**: Criptografar, gerar hash ou tokenizar campos sensíveis armazenados e restringir quem pode lê-los.
- **PR-RETENTION**: Definir e implementar um prazo de retenção (exclusão, expiração ou anonimização) para cada entidade que armazena dados pessoais.
- **PR-CHILD**: Verificar se há tratamento de dados de crianças; se houver, obter o consentimento específico dos pais e aplicar as salvaguardas do melhor interesse.
- **PR-HARDCODED-VALUE**: Substituir valores pessoais fixos no código por dados de teste sintéticos ou movê-los para um cofre de segredos.

### Indícios de proteção encontrados no código

_Nenhum detectado._

### Itens que a configuração não declara

- Identificação e contato do controlador: não declarado (preencher)
- Encarregado (DPO): não declarado (preencher)
- Finalidades do tratamento: não declarado (preencher)
- Bases legais: não declarado (preencher)
- Prazo de retenção de `Appointment`: não declarado (preencher)
- Prazo de retenção de `Patient`: não declarado (preencher)
- Mecanismo de transferência para Mixpanel: não declarado (preencher)
- Mecanismo de transferência para sms.example-vendor.invalid: não declarado (preencher)

## Indicadores de alto risco

3 indicadores de alto risco detectados a partir de dados determinísticos (indicadores, não uma conclusão):

- Dados pessoais sensíveis
- Titulares crianças ou vulneráveis (indícios de crianças ou uma entidade de pacientes)
- Compartilhamento com terceiros cuja transferência precisa de mecanismo, é condicional ou tem destino desconhecido

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
