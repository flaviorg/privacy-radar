import { isValidCnpj } from "./cnpj.ts";
import { isValidCpf } from "./cpf.ts";
import { isValidEsDni, isValidEsNie } from "./dni-nie-es.ts";
import { isValidFrNir } from "./nir-fr.ts";
import { isValidIban } from "./iban.ts";
import { isValidItCodiceFiscale } from "./codice-fiscale-it.ts";
import { isValidLuhn } from "./luhn.ts";
import { isValidNlBsn } from "./bsn-nl.ts";
import { isValidPtNif } from "./nif-pt.ts";
import { isValidDeSteuerId } from "./steuer-id-de.ts";

export type ValidatorId =
  | "cpf"
  | "cnpj"
  | "iban"
  | "luhn"
  | "nif-pt"
  | "dni-es"
  | "nie-es"
  | "codice-fiscale-it"
  | "steuer-id-de"
  | "bsn-nl"
  | "nir-fr";

export const VALIDATORS: Readonly<Record<ValidatorId, (raw: string) => boolean>> = Object.freeze({
  cpf: isValidCpf,
  cnpj: isValidCnpj,
  iban: isValidIban,
  luhn: isValidLuhn,
  "nif-pt": isValidPtNif,
  "dni-es": isValidEsDni,
  "nie-es": isValidEsNie,
  "codice-fiscale-it": isValidItCodiceFiscale,
  "steuer-id-de": isValidDeSteuerId,
  "bsn-nl": isValidNlBsn,
  "nir-fr": isValidFrNir,
});
