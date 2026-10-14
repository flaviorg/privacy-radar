import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog } from "../../src/catalog/load.ts";
import type { Regime, RegimeOption, SinkKind, Vendor } from "../../src/contracts/catalog.ts";
import type { Severity } from "../../src/contracts/findings.ts";
import { classOf, FIXED_SEVERITY, retentionSeverity, sinkSeverity, transferSeverity, type SensitivityClass } from "../../src/engine/severity.ts";
import { assessTransfer, worstStatus, type TransferStatus } from "../../src/engine/transfer.ts";

const catalog = loadCatalog();

const CELLS: [SinkKind, TransferStatus | null, SensitivityClass, Severity][] = [
  ["log", null, "sensitive", "error"], ["log", null, "identifier-financial", "error"], ["log", null, "other-personal", "warning"], ["log", null, "children", "note"],
  ["http", "adequate", "sensitive", "warning"], ["http", "adequate", "identifier-financial", "warning"], ["http", "adequate", "other-personal", "note"], ["http", "adequate", "children", "note"],
  ["http", "needs-mechanism", "sensitive", "error"], ["http", "conditional", "identifier-financial", "warning"], ["http", "unknown-destination", "other-personal", "warning"], ["http", "needs-mechanism", "children", "note"],
  ["analytics", null, "sensitive", "error"], ["analytics", null, "identifier-financial", "warning"], ["analytics", null, "other-personal", "warning"], ["analytics", null, "children", "note"],
  ["file", null, "sensitive", "warning"], ["file", null, "identifier-financial", "warning"], ["file", null, "other-personal", "note"], ["file", null, "children", "note"],
  ["url-query", null, "sensitive", "error"], ["url-query", null, "identifier-financial", "error"], ["url-query", null, "other-personal", "warning"], ["url-query", null, "children", "note"],
];
for (const [k, s, c, want] of CELLS) test(`[ENG-02] ${k} × ${s ?? "-"} × ${c} = ${want}`, () => assert.equal(sinkSeverity(k, c, s, false), want));

test("[ENG-02] mechanism-declared and domestic use the adequate row and an unresolved host is note", () => {
  assert.equal(sinkSeverity("http", "sensitive", "mechanism-declared", false), "warning");
  assert.equal(sinkSeverity("http", "other-personal", "domestic", false), "note");
  assert.equal(sinkSeverity("http", "sensitive", null, true), "note");
  assert.equal(sinkSeverity("http", "sensitive", null, false), "warning", "an http sink without a known status uses the adequate row");
  // analytics ignores the transfer status in the matrix
  assert.equal(sinkSeverity("analytics", "identifier-financial", "needs-mechanism", false), "warning");
});

test("[ENG-02] GB vendor: identifier warning under both, lgpd and gdpr; sensitive error under both and lgpd, warning under gdpr", () => {
  const gb = { vendor: "Example UK", hqCountry: "GB", domains: ["exampleuk.com"] } as Vendor;
  const worst = (regime: RegimeOption) => {
    const regimes: Regime[] = regime === "both" ? ["lgpd", "gdpr"] : [regime];
    return worstStatus(regimes.map((r) => assessTransfer({ vendor: gb, host: "api.exampleuk.com", regime: r, adequacy: catalog.adequacy, configVendors: {} }).status));
  };
  const got = (cls: SensitivityClass) => (["both", "lgpd", "gdpr"] as const).map((r) => sinkSeverity("http", cls, worst(r), false));
  assert.deepEqual(got("identifier-financial"), ["warning", "warning", "warning"]);
  assert.deepEqual(got("sensitive"), ["error", "error", "warning"]);
});

test("classOf picks the highest class present under the regime", () => {
  const c = (cats: string[], regime: RegimeOption = "both") => classOf(cats, catalog.categoryById, regime);
  assert.equal(c(["contact.email", "special.health"]), "sensitive");
  assert.equal(c(["contact.email", "identifier.cpf"]), "identifier-financial");
  assert.equal(c(["financial.iban", "name.full-name"]), "identifier-financial");
  assert.equal(c(["name.full-name", "demographic.birth-date"]), "other-personal");
  assert.equal(c(["children.guardian"]), "children");
  assert.equal(c(["special.philosophical"], "lgpd"), "other-personal");
  assert.equal(c(["special.philosophical"], "gdpr"), "sensitive");
});

test("[ENG-02] fixed severities of the non-sink rules", () => {
  assert.deepEqual(FIXED_SEVERITY, { "PR-PLAINTEXT-SENSITIVE": "warning", "PR-CHILD": "note", "PR-HARDCODED-VALUE": "warning", "PR-AMBIGUOUS": "note", "PR-PARSE": "note" });
  assert.equal(transferSeverity("sensitive"), "error");
  assert.equal(transferSeverity("identifier-financial"), "warning");
  assert.equal(retentionSeverity(true), "warning");
  assert.equal(retentionSeverity(false), "note");
});
