import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidCpf } from "../../src/validators/cpf.ts";
import { isValidCnpj } from "../../src/validators/cnpj.ts";
import { isValidIban } from "../../src/validators/iban.ts";
import { isValidPtNif } from "../../src/validators/nif-pt.ts";
import { isValidEsDni, isValidEsNie } from "../../src/validators/dni-nie-es.ts";
import { isValidItCodiceFiscale } from "../../src/validators/codice-fiscale-it.ts";
import { isValidDeSteuerId } from "../../src/validators/steuer-id-de.ts";
import { isValidNlBsn } from "../../src/validators/bsn-nl.ts";
import { isValidFrNir } from "../../src/validators/nir-fr.ts";
import { isValidLuhn } from "../../src/validators/luhn.ts";
import * as validatorsIndex from "../../src/validators/index.ts";
import { VALIDATORS } from "../../src/validators/index.ts";

test("[VAL-01] CPF 529.982.247-25 is valid and 529.982.247-24 and 111.111.111-11 are not", () => {
  assert.equal(isValidCpf("529.982.247-25"), true);
  assert.equal(isValidCpf("52998224725"), true);
  assert.equal(isValidCpf("529.982.247-24"), false);
  assert.equal(isValidCpf("111.111.111-11"), false);
});

test("[VAL-02] CNPJ numeric and alphanumeric", () => {
  assert.equal(isValidCnpj("11.222.333/0001-81"), true);
  assert.equal(isValidCnpj("12.ABC.345/01DE-35"), true);
  assert.equal(isValidCnpj("12.abc.345/01de-35"), true);
  assert.equal(isValidCnpj("11.222.333/0001-82"), false);
});

const VAL03: [string, (s: string) => boolean, string, boolean][] = [
  ["IBAN PT", isValidIban, "PT50000201231234567890154", true],
  ["IBAN PT bad", isValidIban, "PT50000201231234567890155", false],
  ["IBAN GB", isValidIban, "GB82 WEST 1234 5698 7654 32", true],
  ["IBAN DE", isValidIban, "DE89 3704 0044 0532 0130 00", true],
  ["PT NIF", isValidPtNif, "123456789", true],
  ["PT NIF company", isValidPtNif, "501964843", true],
  ["PT NIF bad", isValidPtNif, "123456788", false],
  ["ES DNI", isValidEsDni, "12345678Z", true],
  ["ES DNI bad", isValidEsDni, "12345678A", false],
  ["ES NIE", isValidEsNie, "X1234567L", true],
  ["ES NIE bad", isValidEsNie, "X1234567A", false],
  ["IT CF", isValidItCodiceFiscale, "RSSMRA85T10A562S", true],
  ["IT CF bad", isValidItCodiceFiscale, "RSSMRA85T10A562A", false],
  ["DE Steuer-ID", isValidDeSteuerId, "65929970489", true],
  ["DE Steuer-ID bad", isValidDeSteuerId, "65929970480", false],
  ["NL BSN", isValidNlBsn, "111222333", true],
  ["NL BSN bad", isValidNlBsn, "111222334", false],
  ["FR NIR", isValidFrNir, "1 84 12 76 451 089 46", true],
  ["FR NIR bad", isValidFrNir, "1 84 12 76 451 089 47", false],
  ["PAN", isValidLuhn, "4111 1111 1111 1111", true],
  ["PAN bad", isValidLuhn, "4111 1111 1111 1112", false],
];
for (const [label, fn, v, want] of VAL03) {
  test(`[VAL-03] ${label} ${v} -> ${want}`, () => assert.equal(fn(v), want));
}

test("[VAL-03] 999999990 is a valid PT NIF and a valid NL BSN (the collision behind VAL-06)", () => {
  assert.equal(isValidPtNif("999999990"), true);
  assert.equal(isValidNlBsn("999999990"), true);
});

test("[VAL-03] Steuer-ID structure rule rejects a leading zero and digit patterns outside the rule", () => {
  assert.equal(isValidDeSteuerId("01234567890"), false);
  assert.equal(isValidDeSteuerId("11111111111"), false);
  assert.equal(isValidDeSteuerId("12345678901"), false);
});

test("[VAL-03] a Steuer-ID whose structure is right but whose check digit is wrong is rejected, and a constructed valid one passes", () => {
  const base = "6592997048";
  const check = Number("65929970489".slice(-1));
  assert.equal(isValidDeSteuerId(base + String(check)), true);
  for (let d = 0; d <= 9; d++) assert.equal(isValidDeSteuerId(base + String(d)), d === check, `check digit ${d}`);
});

test("[VAL-03] Corsican NIR departments 2A and 2B are accepted with the 19/18 substitution", () => {
  const key = (head: string) => String(97n - (BigInt(head) % 97n)).padStart(2, "0");
  assert.equal(isValidFrNir(`18412` + "2A" + `451089${key("1841219451089")}`), true);
  assert.equal(isValidFrNir(`18412` + "2B" + `451089${key("1841218451089")}`), true);
  assert.equal(isValidFrNir(`18412` + "2B" + `451089${key("1841219451089")}`), false);
});

test("[VAL-03] omocode codice fiscale: the check letter is recomputed on the substituted letters' own values (python-stdnum vectors)", () => {
  // Published omocode variants of RSSMRA45C12F205C, from python-stdnum tests/test_it_codicefiscale.doctest.
  // Each substitution changes the check letter, so a substituted letter is not valued as the digit it replaced.
  for (const v of ["RSSMRA45C12F205C", "RSSMRA45C12F20RX", "RSSMRA45C12F2L5N", "RSSMRA45C12F2LRI", "RSSMRAQRCMNFNLRG"]) {
    assert.equal(isValidItCodiceFiscale(v), true, v);
  }
  // Keeping the original check letter after a substitution (the "letter keeps the digit value" reading) is rejected.
  for (const v of ["RSSMRA45C12F20RC", "RSSMRA45C12F2L5C", "RSSMRAQRCMNFNLRC"]) {
    assert.equal(isValidItCodiceFiscale(v), false, v);
  }
});

test("[VAL-03] IBAN length is checked per country", () => {
  assert.equal(isValidIban("PT5000020123123456789015"), false);
  assert.equal(isValidIban("GB82 WEST 1234 5698 7654 3"), false);
});

test("[VAL-03] ES NIE Y and Z prefixes use the 1 and 2 substitution", () => {
  const letters = "TRWAGMYFPDXBNJZSQVHLCKE";
  const letter = (n: number) => letters[n % 23];
  assert.equal(isValidEsNie(`Y1234567${letter(11234567)}`), true);
  assert.equal(isValidEsNie(`Z1234567${letter(21234567)}`), true);
  assert.equal(isValidEsNie(`Q1234567${letter(1234567)}`), false);
});

test("[VAL-03] NL BSN and PT NIF reject all-zero and wrong-length input", () => {
  assert.equal(isValidNlBsn("000000000"), false);
  assert.equal(isValidNlBsn("11122233"), false);
  assert.equal(isValidPtNif("12345678"), false);
  assert.equal(isValidPtNif("1234567890"), false);
});

test("[VAL-03] no validator exports a kind helper", () => {
  assert.deepEqual(Object.keys(validatorsIndex), ["VALIDATORS"]);
  assert.deepEqual(Object.keys(VALIDATORS).sort(), ["bsn-nl", "cnpj", "codice-fiscale-it", "cpf", "dni-es", "iban", "luhn", "nie-es", "nif-pt", "nir-fr", "steuer-id-de"]);
  for (const fn of Object.values(VALIDATORS)) assert.equal(typeof fn, "function");
  assert.equal(VALIDATORS["cpf"]("529.982.247-25"), true);
  assert.equal(VALIDATORS["dni-es"]("12345678Z"), true);
  assert.equal(VALIDATORS["nie-es"]("X1234567L"), true);
});

test("validators reject empty and non-string-like input without throwing", () => {
  const junk: unknown[] = ["", "abc", "1".repeat(200), "   ", "\u0000", "💥".repeat(30), undefined, null, 12345678901, {}];
  for (const [id, fn] of Object.entries(VALIDATORS)) {
    for (const value of junk) {
      assert.equal((fn as (v: unknown) => boolean)(value), false, `${id}(${JSON.stringify(value)})`);
    }
  }
});
