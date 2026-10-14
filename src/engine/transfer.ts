import type { Adequacy, Regime, Vendor } from "../contracts/catalog.ts";
import type { Mechanism, ProjectConfig } from "../contracts/config.ts";
import type { TransferStatus } from "../contracts/flows.ts";

export type { TransferStatus } from "../contracts/flows.ts";

export type TransferAssessment = { regime: Regime; status: TransferStatus; mechanism: Mechanism | "unknown"; text: string };

type ConfigVendors = NonNullable<ProjectConfig["vendors"]>;

export type TransferInput = {
  vendor: Vendor | null;
  host: string | null;
  regime: Regime;
  adequacy: Adequacy;
  configVendors: ProjectConfig["vendors"];
};

/** A config mechanism for the host, a parent domain of it, or any of the vendor's domains; `"unknown"` means not declared. */
function declaredMechanism(host: string | null, vendor: Vendor, configVendors: ConfigVendors): Mechanism | null {
  const names = new Set<string>(vendor.domains);
  if (host !== null) {
    let candidate = host.toLowerCase();
    for (;;) {
      names.add(candidate);
      const dot = candidate.indexOf(".");
      if (dot < 0) break;
      candidate = candidate.slice(dot + 1);
    }
  }
  for (const [key, entry] of Object.entries(configVendors)) {
    if (names.has(key.toLowerCase()) && entry.mechanism !== "unknown") return entry.mechanism;
  }
  return null;
}

const stripPeriod = (s: string) => s.replace(/\.\s*$/, "");

/**
 * Transfer status of one vendor under one regime (spec 5.4, ENG-05), decided in this order: unknown
 * vendor → `unknown-destination`; `hqCountry` domestic (BR under LGPD, `adequacy.eea` under GDPR) →
 * `domestic`; on the regime's adequacy list → `adequate`; a config mechanism other than `"unknown"`
 * → `mechanism-declared`; GDPR `conditional[hq]` → `conditional`; else `needs-mechanism`. Every
 * non-domestic text ends with `status as of <adequacy.checkedOn>; verify`.
 */
export function assessTransfer(input: TransferInput): TransferAssessment {
  const { vendor, host, regime, adequacy } = input;
  const dated = (body: string) => `${body}; status as of ${adequacy.checkedOn}; verify`;
  const make = (status: TransferStatus, text: string, mechanism: Mechanism | "unknown" = "unknown"): TransferAssessment => ({ regime, status, mechanism, text });

  if (vendor === null) {
    return make("unknown-destination", dated(`${host ?? "unresolved host"}: unknown destination, the host is not in the vendor catalog`));
  }
  const who = `${vendor.vendor} (${vendor.hqCountry})`;
  const hq = vendor.hqCountry;
  const domestic = regime === "lgpd" ? hq === "BR" : adequacy.eea.includes(hq);
  if (domestic) return make("domestic", `${who}: domestic under ${regime.toUpperCase()}, no international transfer`);
  if (adequacy[regime].adequate.includes(hq)) return make("adequate", dated(`${who}: ${hq} is on the ${regime.toUpperCase()} adequacy list`));
  const mechanism = declaredMechanism(host, vendor, input.configVendors ?? {});
  if (mechanism !== null) return make("mechanism-declared", dated(`${who}: mechanism declared in config: ${mechanism}; verify the contract`), mechanism);
  if (regime === "gdpr") {
    const conditional = Object.hasOwn(adequacy.gdpr.conditional, hq) ? adequacy.gdpr.conditional[hq] : undefined;
    if (conditional !== undefined) return make("conditional", dated(`${who}: ${stripPeriod(conditional)}`));
    return make("needs-mechanism", dated(`${who}: no adequacy decision; verify DPF listing or SCCs`));
  }
  return make("needs-mechanism", dated(`${who}: not on the ANPD adequacy list; needs LGPD art. 33 II or VIII evidence`));
}

/** Worst first; within the risky and the non-risky group the earlier entry wins a tie. */
const WORST_ORDER: readonly TransferStatus[] = ["needs-mechanism", "conditional", "unknown-destination", "mechanism-declared", "adequate", "domestic"];

const RISKY: ReadonlySet<TransferStatus> = new Set(["needs-mechanism", "conditional", "unknown-destination"]);

/** `needs-mechanism`, `conditional` and `unknown-destination` select the risky row of the severity matrix. */
export function isRiskyStatus(status: TransferStatus): boolean {
  return RISKY.has(status);
}

/** The worst status of a list (spec 5.4), or null for an empty list. */
export function worstStatus(list: readonly TransferStatus[]): TransferStatus | null {
  let best: TransferStatus | null = null;
  for (const s of list) if (best === null || WORST_ORDER.indexOf(s) < WORST_ORDER.indexOf(best)) best = s;
  return best;
}
