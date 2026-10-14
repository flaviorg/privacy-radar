import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog } from "../../src/catalog/load.ts";
import { checkFreshness } from "../../scripts/check-catalog-freshness.ts";

test("[REP-06] freshness warns after 180 days and exits 1 only with --strict", () => {
  const c = loadCatalog();
  assert.deepEqual(checkFreshness(c, new Date("2026-10-08"), false), { warnings: [], exitCode: 0 });
  const late = checkFreshness(c, new Date("2027-05-01"), false);
  assert.equal(late.exitCode, 0);
  assert.equal(late.warnings.length, 2);
  assert.deepEqual(late.warnings, [
    "warning: vendors.json checkedOn 2026-10-08 is older than 180 days",
    "warning: adequacy.json checkedOn 2026-10-08 is older than 180 days",
  ]);
  assert.equal(checkFreshness(c, new Date("2027-05-01"), true).exitCode, 1);
});

test("[REP-06] the boundary is exactly 180 days", () => {
  const c = loadCatalog();
  assert.equal(checkFreshness(c, new Date("2027-04-06T23:59:59Z"), true).exitCode, 0);
  assert.equal(checkFreshness(c, new Date("2027-04-07T00:00:00Z"), true).exitCode, 1);
});
