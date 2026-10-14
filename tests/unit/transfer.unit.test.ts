import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCatalog } from "../../src/catalog/load.ts";
import type { Vendor } from "../../src/contracts/catalog.ts";
import { projectConfigSchema } from "../../src/contracts/config.ts";
import { assessTransfer, isRiskyStatus, worstStatus } from "../../src/engine/transfer.ts";
import { PROJECT_ROOT_FOR_TESTS } from "../helpers/child-node-args.ts";

const { adequacy } = loadCatalog();
const v = (vendor: string, hq: string) => ({ vendor, hqCountry: hq, domains: [`${vendor.toLowerCase().replace(/\s+/g, "")}.com`] }) as Vendor;

test("[ENG-05] Mixpanel (US): LGPD needs-mechanism, GDPR conditional, both dated and worded verify", () => {
  const l = assessTransfer({ vendor: v("Mixpanel", "US"), host: "api.mixpanel.com", regime: "lgpd", adequacy, configVendors: {} });
  const g = assessTransfer({ vendor: v("Mixpanel", "US"), host: "api.mixpanel.com", regime: "gdpr", adequacy, configVendors: {} });
  assert.equal(l.status, "needs-mechanism");
  assert.equal(l.mechanism, "unknown");
  assert.match(l.text, /33 II or VIII.*status as of 2026-10-08; verify$/);
  assert.equal(g.status, "conditional");
  assert.match(g.text, /Data Privacy Framework/);
  assert.match(g.text, /status as of 2026-10-08; verify$/);
});

test("[ENG-05] BR is domestic under LGPD, an EEA country is domestic under GDPR", () => {
  const rd = v("RD Station", "BR");
  const hotjar = v("Hotjar", "MT");
  assert.equal(assessTransfer({ vendor: rd, host: "api.rdstation.com", regime: "lgpd", adequacy, configVendors: {} }).status, "domestic");
  assert.equal(assessTransfer({ vendor: rd, host: "api.rdstation.com", regime: "gdpr", adequacy, configVendors: {} }).status, "adequate");
  assert.equal(assessTransfer({ vendor: hotjar, host: "script.hotjar.com", regime: "gdpr", adequacy, configVendors: {} }).status, "domestic");
  assert.equal(assessTransfer({ vendor: hotjar, host: "script.hotjar.com", regime: "lgpd", adequacy, configVendors: {} }).status, "adequate");
  const domestic = assessTransfer({ vendor: rd, host: "api.rdstation.com", regime: "lgpd", adequacy, configVendors: {} });
  assert.doesNotMatch(domestic.text, /status as of/);
});

test("[ENG-05] a GB vendor is needs-mechanism under LGPD and adequate under GDPR", () => {
  const gb = v("Example UK", "GB");
  const l = assessTransfer({ vendor: gb, host: "api.exampleuk.com", regime: "lgpd", adequacy, configVendors: {} });
  const g = assessTransfer({ vendor: gb, host: "api.exampleuk.com", regime: "gdpr", adequacy, configVendors: {} });
  assert.equal(l.status, "needs-mechanism");
  assert.equal(g.status, "adequate");
  assert.match(g.text, /status as of 2026-10-08; verify$/);
  const usGdpr = assessTransfer({ vendor: v("Other", "CN"), host: "x.other.com", regime: "gdpr", adequacy, configVendors: {} });
  assert.equal(usGdpr.status, "needs-mechanism");
  assert.match(usGdpr.text, /verify DPF listing or SCCs/);
});

test("[ENG-05] a config mechanism scc gives mechanism-declared; unknown counts as not declared", () => {
  const config = projectConfigSchema.parse(JSON.parse(readFileSync(join(PROJECT_ROOT_FOR_TESTS, "tests", "fixtures", "config", "vendor-mechanism.json"), "utf8")));
  const mixpanel = v("Mixpanel", "US");
  for (const regime of ["lgpd", "gdpr"] as const) {
    const a = assessTransfer({ vendor: mixpanel, host: "api.mixpanel.com", regime, adequacy, configVendors: config.vendors ?? {} });
    assert.equal(a.status, "mechanism-declared", regime);
    assert.equal(a.mechanism, "scc");
    assert.match(a.text, /mechanism declared in config: scc; verify the contract/);
  }
  // the config key may name any of the vendor's domains
  const byDomain = assessTransfer({ vendor: mixpanel, host: "api.mixpanel.com", regime: "lgpd", adequacy, configVendors: { "mixpanel.com": { mechanism: "dpf" } } });
  assert.equal(byDomain.status, "mechanism-declared");
  const unknown = assessTransfer({ vendor: mixpanel, host: "api.mixpanel.com", regime: "lgpd", adequacy, configVendors: { "api.mixpanel.com": { mechanism: "unknown" } } });
  assert.equal(unknown.status, "needs-mechanism");
  // adequacy and domestic come before a declared mechanism
  const gb = assessTransfer({ vendor: v("Example UK", "GB"), host: "api.exampleuk.com", regime: "gdpr", adequacy, configVendors: { "api.exampleuk.com": { mechanism: "scc" } } });
  assert.equal(gb.status, "adequate");
});

test("[ENG-05] an unknown host is unknown-destination; worstStatus picks the risky one", () => {
  const u = assessTransfer({ vendor: null, host: "sms.example-vendor.invalid", regime: "gdpr", adequacy, configVendors: {} });
  assert.equal(u.status, "unknown-destination");
  assert.match(u.text, /status as of 2026-10-08; verify$/);
  assert.equal(worstStatus(["domestic", "needs-mechanism"]), "needs-mechanism");
  assert.equal(worstStatus(["adequate", "conditional"]), "conditional");
  assert.equal(worstStatus(["mechanism-declared", "adequate", "domestic"]), "mechanism-declared");
  assert.equal(worstStatus(["unknown-destination", "unknown-destination"]), "unknown-destination");
  assert.equal(worstStatus([]), null);
  assert.deepEqual(
    (["domestic", "adequate", "mechanism-declared", "conditional", "needs-mechanism", "unknown-destination"] as const).map(isRiskyStatus),
    [false, false, false, true, true, true],
  );
});
