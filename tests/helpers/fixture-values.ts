/**
 * The synthetic, checksum-valid values of `fixtures/telehealth-clinic/` and where each one lives.
 * Generated once with the project's validators (seeded throwaway script, never the Appendix A
 * vectors). The no-leak test first proves each value is detected, then that no output contains it.
 */
export type FixtureValue = { kind: string; raw: string; file: string; line: number };

const SERVER = "src/server.ts";
const SQL = "migrations/001_init.sql";

export const FIXTURE_IDENTIFIERS: readonly FixtureValue[] = [
  { kind: "identifier.cpf", raw: "159.368.495-97", file: SERVER, line: 13 },
  { kind: "identifier.cpf", raw: "521.891.152-64", file: SERVER, line: 22 },
  { kind: "identifier.cpf", raw: "245.452.155-56", file: SQL, line: 43 },
  { kind: "identifier.cnpj", raw: "67.577.703/0001-58", file: SQL, line: 40 },
  { kind: "identifier.nif-pt", raw: "205174418", file: SQL, line: 44 },
  { kind: "identifier.nif-pt", raw: "297108972", file: SQL, line: 45 },
  { kind: "identifier.dni-es", raw: "61852415X", file: SQL, line: 44 },
  { kind: "identifier.nie-es", raw: "Y4098832Q", file: SQL, line: 45 },
  { kind: "identifier.codice-fiscale-it", raw: "VRDLCU88E52H501G", file: SQL, line: 43 },
  { kind: "identifier.steuer-id-de", raw: "53460972865", file: SERVER, line: 17 },
  { kind: "identifier.bsn-nl", raw: "143973782", file: SERVER, line: 18 },
  { kind: "identifier.nir-fr", raw: "2 91 03 75 129 764 82", file: SERVER, line: 24 },
  { kind: "financial.iban", raw: "PT57 0035 0651 3001 6084 9559 2", file: SERVER, line: 16 },
  { kind: "financial.card-pan", raw: "4585 4659 4132 3107", file: SERVER, line: 25 },
];

export const FIXTURE_EMAILS: readonly FixtureValue[] = [
  { kind: "contact.email", raw: "joana.prates@example.invalid", file: SERVER, line: 14 },
  { kind: "contact.email", raw: "pieter.voorbeeld@example.invalid", file: SERVER, line: 23 },
];

export const FIXTURE_NAMES: readonly FixtureValue[] = [
  { kind: "name.full-name", raw: "Joana Exemplo Prates", file: SERVER, line: 12 },
  { kind: "name.full-name", raw: "Pieter Voorbeeld", file: SERVER, line: 21 },
];

export const FIXTURE_ADDRESS: readonly FixtureValue[] = [{ kind: "contact.address", raw: "Rua das Amostras 42, Lisboa", file: SERVER, line: 15 }];

const digitsOnly = (raw: string) => raw.replace(/[^0-9A-Za-z]/g, "");

/** The 19 raw values plus the separator-free form of every identifier: none may appear in any output. */
export const ALL_FIXTURE_SECRETS: readonly string[] = [
  ...new Set([
    ...[...FIXTURE_IDENTIFIERS, ...FIXTURE_EMAILS, ...FIXTURE_NAMES, ...FIXTURE_ADDRESS].map((v) => v.raw),
    ...FIXTURE_IDENTIFIERS.map((v) => digitsOnly(v.raw)),
  ]),
];
