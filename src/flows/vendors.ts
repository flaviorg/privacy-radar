import type { Vendor } from "../contracts/catalog.ts";

export type VendorIndex = ReadonlyMap<string, Vendor>;

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//;

/**
 * Host of a URL text (spec 5.4). A scheme is required for a host; `//x`, `/x`, `./x`, `../x` and
 * scheme-less text are first-party. An interpolation (`${}`) before the end of the host gives
 * `host: null` (unresolved). Userinfo and port are stripped; the host is lower-cased.
 */
export function hostOf(urlText: string | null): { host: string | null; firstParty: boolean } {
  if (urlText === null || urlText.startsWith("${")) return { host: null, firstParty: false };
  const scheme = SCHEME.exec(urlText);
  if (!scheme) return { host: null, firstParty: true };
  const rest = urlText.slice(scheme[0].length);
  const authority = rest.split(/[/?#]/, 1)[0] ?? "";
  const at = authority.lastIndexOf("@");
  const hostPort = at >= 0 ? authority.slice(at + 1) : authority;
  let host: string;
  if (hostPort.startsWith("[")) {
    const close = hostPort.indexOf("]");
    host = close > 0 ? hostPort.slice(1, close) : hostPort;
  } else {
    host = hostPort.split(":", 1)[0] ?? "";
  }
  if (host === "" || host.includes("${")) return { host: null, firstParty: false };
  return { host: host.toLowerCase(), firstParty: false };
}

export function buildVendorIndex(vendors: readonly Vendor[]): VendorIndex {
  const index = new Map<string, Vendor>();
  for (const v of vendors) for (const d of v.domains) index.set(d, v);
  return index;
}

/** Suffix match on a label boundary: `api.mixpanel.com` matches `mixpanel.com`, `notmixpanel.com` does not. */
export function resolveVendor(host: string, index: VendorIndex): Vendor | null {
  let candidate = host.toLowerCase();
  while (candidate.length > 0) {
    const hit = index.get(candidate);
    if (hit) return hit;
    const dot = candidate.indexOf(".");
    if (dot < 0) return null;
    candidate = candidate.slice(dot + 1);
  }
  return null;
}
