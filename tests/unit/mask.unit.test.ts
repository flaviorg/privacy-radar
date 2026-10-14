import { test } from "node:test";
import assert from "node:assert/strict";
import { maskBoundLiteral, maskValue } from "../../src/infra/mask.ts";

test("[OUT-06] maskValue keeps separators and the last two characters", () => {
  assert.equal(maskValue("529.982.247-25", "identifier.cpf"), "***.***.***-25");
  assert.equal(maskValue("DE89 3704 0044 0532 0130 00", "financial.iban"), "**** **** **** **** **** 00");
});

test("[OUT-06] maskValue keeps only the TLD of an e-mail", () => {
  assert.equal(maskValue("maria.souza@example.invalid", "contact.email"), "*****.*****@*******.invalid");
});

test("[OUT-06] maskBoundLiteral keeps two letters at each end from 8 characters on", () => {
  assert.equal(maskBoundLiteral("Maria Souza"), "Ma*** ***za");
  assert.equal(maskBoundLiteral("Ana Lima"), "*** ****");
});

test("[OUT-06] maskBoundLiteral counts letters and digits only, not separators", () => {
  assert.equal(maskBoundLiteral("12345678"), "12****78");
  assert.equal(maskBoundLiteral("1234-567"), "1234-567".replace(/\d/g, "*"));
});

test("masking is length-preserving", () => {
  const samples = [
    ["529.982.247-25", "identifier.cpf"], ["11.222.333/0001-81", "identifier.cnpj"], ["12.ABC.345/01DE-35", "identifier.cnpj"],
    ["PT50000201231234567890154", "financial.iban"], ["4111 1111 1111 1111", "financial.card-pan"], ["a@b.co", "contact.email"],
    ["maria.souza@example.invalid", "contact.email"], ["+55 11 91234-5678", "contact.phone"], ["1990-05-17", "demographic.birth-date"],
    ["192.168.10.25", "online.ip-address"], ["", "identifier.cpf"], ["x", "identifier.cpf"], ["ab", "identifier.cpf"],
    ["çãõ é ü", "name.full-name"], ["日本語の名前です", "name.full-name"], ["a😀b😀c😀d😀e😀", "name.full-name"],
    ["   ", "name.full-name"], ["no-separators-here-at-all", "name.full-name"], ["user@localhost", "contact.email"], ["@@@", "contact.email"],
  ] as const;
  for (const [value, category] of samples) {
    assert.equal(maskValue(value, category).length, value.length, `maskValue(${JSON.stringify(value)})`);
    assert.equal(maskBoundLiteral(value).length, value.length, `maskBoundLiteral(${JSON.stringify(value)})`);
  }
});

test("masked output never contains a masked-away character", () => {
  assert.ok(!maskValue("529.982.247-25", "identifier.cpf").includes("529"));
  assert.ok(!maskValue("529.982.247-25", "identifier.cpf").includes("982"));
  assert.ok(!maskBoundLiteral("Maria Souza").includes("ria"));
});
