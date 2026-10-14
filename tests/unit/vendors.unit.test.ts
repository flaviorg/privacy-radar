import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog } from "../../src/catalog/load.ts";
import { buildVendorIndex, hostOf, resolveVendor } from "../../src/flows/vendors.ts";

const idx = buildVendorIndex(loadCatalog().vendors);

test("[FLOW-02] a literal host resolves by suffix; an unknown host has vendor null; a non-literal URL is unresolved", () => {
  assert.equal(resolveVendor("api.mixpanel.com", idx)!.vendor, "Mixpanel");
  assert.equal(resolveVendor("mixpanel.com", idx)!.vendor, "Mixpanel");
  assert.equal(resolveVendor("notmixpanel.com", idx), null);
  assert.equal(resolveVendor("mixpanel.com.evil.example", idx), null);
  assert.deepEqual(hostOf("https://sms.example-vendor.invalid/send?nif=${}"), { host: "sms.example-vendor.invalid", firstParty: false });
  assert.deepEqual(hostOf("${base}/x"), { host: null, firstParty: false });
  assert.deepEqual(hostOf("https://${tenant}.example.invalid/x"), { host: null, firstParty: false });
  assert.deepEqual(hostOf(null), { host: null, firstParty: false });
});

test("[FLOW-07] relative URLs are first-party", () => {
  for (const u of ["/api/patients", "./x", "../y", "api/x", "//cdn/x", ""]) assert.deepEqual(hostOf(u), { host: null, firstParty: true }, u);
});

test("vendor host with port or userinfo still resolves", () => {
  assert.equal(hostOf("https://u:p@api.mixpanel.com:443/track").host, "api.mixpanel.com");
  assert.equal(hostOf("HTTPS://API.Mixpanel.COM").host, "api.mixpanel.com");
  assert.equal(hostOf("https://api.mixpanel.com:${port}/x").host, "api.mixpanel.com");
  assert.equal(hostOf("http://[::1]:3000/x").host, "::1");
  assert.equal(hostOf("https://api.mixpanel.com?x=1").host, "api.mixpanel.com");
  assert.equal(resolveVendor(hostOf("https://u:p@api.mixpanel.com:443/track").host!, idx)!.vendor, "Mixpanel");
});
