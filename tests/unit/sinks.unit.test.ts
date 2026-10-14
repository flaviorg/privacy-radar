import { test } from "node:test";
import assert from "node:assert/strict";
import { loadCatalog } from "../../src/catalog/load.ts";
import { matchSinks, sinkKindOf } from "../../src/flows/sinks.ts";
import { buildVendorIndex } from "../../src/flows/vendors.ts";
import { parseSource } from "../../src/sources/index.ts";

const catalog = loadCatalog();
const idx = buildVendorIndex(catalog.vendors);
const sinksOf = (src: string, fnName: string) => {
  const fn = parseSource("a.ts", src).functions.find((f) => f.name === fnName)!;
  return matchSinks(fn, catalog, idx);
};

const MATCH: Record<string, string[]> = {
  log: ["console.log", "console.error", "logger.info", "req.log.warn", "this.logger.error", "pino.fatal"],
  http: ["fetch", "axios", "axios.post", "got.get", "https.request", "needle"],
  analytics: ["mixpanel.track", "analytics.identify", "posthog.capture", "gtag", "Sentry.setUser", "datadogRum.addAction"],
  file: ["fs.writeFile", "fs.promises.appendFile", "fsp.writeFile", "appendFileSync"],
};
for (const [kind, callees] of Object.entries(MATCH)) {
  for (const c of callees) test(`[FLOW-01] ${c} is a ${kind} sink`, () => assert.equal(sinkKindOf(c, catalog.sinks), kind));
}
for (const c of ["console.table", "logger.child", "fetchPolicy", "myfetch", "mixpanel.init", "getLogger().info", "loggers[].warn"]) {
  test(`[FLOW-01] ${c} is not a sink`, () => assert.equal(sinkKindOf(c, catalog.sinks), null));
}

test("[FLOW-01] matchSinks returns http, analytics, log and file sinks with their attributes, in source order", () => {
  const src = [
    "async function f(patient: Patient, path: string) {",
    "  console.info('x', patient);",
    '  await fetch("https://api.mixpanel.com/engage", { body: JSON.stringify(patient) });',
    "  await fetch(`${path}/x`);",
    "  await fetch('/api/patients', { body: patient });",
    "  mixpanel.track('visit', { cpf: patient.cpf });",
    "  fs.appendFileSync('a.csv', patient.fullName);",
    '  await axios.post("https://sms.example-vendor.invalid/send");',
    "  console.table(patient);",
    "}",
  ].join("\n");
  const sinks = sinksOf(src, "f");
  assert.deepEqual(
    sinks.map((s) => [s.kind, s.callee, s.loc.line, s.host, s.firstParty, s.unresolved, s.vendor?.vendor ?? null, s.fnName]),
    [
      ["log", "console.info", 2, null, false, false, null, "f"],
      ["http", "fetch", 3, "api.mixpanel.com", false, false, "Mixpanel", "f"],
      ["http", "fetch", 4, null, false, true, null, "f"],
      ["http", "fetch", 5, null, true, false, null, "f"],
      ["analytics", "mixpanel.track", 6, null, false, false, "Mixpanel", "f"],
      ["file", "fs.appendFileSync", 7, null, false, false, null, "f"],
      ["http", "axios.post", 8, "sms.example-vendor.invalid", false, false, null, "f"],
    ],
  );
  assert.equal(sinks[1]!.urlText, "https://api.mixpanel.com/engage");
  assert.ok(sinks[1]!.args[1]!.refs.some((r) => r.chain === "patient"));
  assert.ok(sinks.every((s) => s.queryParam === null));
});

test("[FLOW-06] every query build becomes a url-query sink at its own location with its parameter", () => {
  const src = "async function remind(patient: Patient) {\n  await fetch(`https://sms.example-vendor.invalid/send?nif=${patient.nifPt}&msg=reminder`);\n}\n";
  const sinks = sinksOf(src, "remind");
  assert.deepEqual(sinks.map((s) => [s.kind, s.loc.line, s.queryParam, s.host]), [
    ["http", 2, null, "sms.example-vendor.invalid"],
    ["url-query", 2, "nif", null],
  ]);
  assert.deepEqual(sinks[1]!.args.flatMap((a) => a.refs.map((r) => r.chain)), ["patient.nifPt"]);
});

test("[FLOW-02] analytics SDK callee gets its vendor from sdkVendors", () => {
  const src = "function t(p: Patient) {\n  mixpanel.track('visit', { cpf: p.cpf });\n  Sentry.setUser({ email: p.email });\n  gtag('event', 'x');\n}\n";
  assert.deepEqual(sinksOf(src, "t").map((s) => [s.callee, s.vendor?.vendor, s.vendor?.hqCountry]), [
    ["mixpanel.track", "Mixpanel", "US"],
    ["Sentry.setUser", "Sentry", "US"],
    ["gtag", "Google Analytics", "US"],
  ]);
});
