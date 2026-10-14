// Loaded with --import in the test process and in every child started with CHILD_NODE_ARGS.
// Pattern: projetos/incident-copilot/tests/setup/no-network.ts (fetch only). This guard also covers
// net, dns, http and https, so a test that opens any socket fails instead of reaching the network.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";

class NetworkDisabledInTests extends Error {
  constructor(target: string) {
    super(`network disabled in tests: ${target}`);
    this.name = "NetworkDisabledInTests";
  }
}

const MARKER = Symbol.for("privacy-radar.noNetwork");
const registry = globalThis as unknown as Record<symbol, boolean | undefined>;

function describeTarget(input: unknown): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  if (input && typeof input === "object") {
    const o = input as { url?: unknown; href?: unknown; host?: unknown; hostname?: unknown };
    if (typeof o.url === "string") return o.url;
    if (typeof o.href === "string") return o.href;
    if (typeof o.hostname === "string") return o.hostname;
    if (typeof o.host === "string") return o.host;
  }
  return "unknown target";
}

if (!registry[MARKER]) {
  registry[MARKER] = true;

  const blockedSync = (channel: string) =>
    function blocked(...args: unknown[]): never {
      throw new NetworkDisabledInTests(`${channel} ${describeTarget(args[0])}`);
    };

  globalThis.fetch = (async (input: unknown) => {
    throw new NetworkDisabledInTests(`fetch ${describeTarget(input)}`);
  }) as typeof fetch;

  net.Socket.prototype.connect = blockedSync("net.Socket.connect") as unknown as typeof net.Socket.prototype.connect;
  (dns as { lookup: unknown }).lookup = blockedSync("dns.lookup");
  (dns.promises as { lookup: unknown }).lookup = async (hostname: unknown) => {
    throw new NetworkDisabledInTests(`dns.promises.lookup ${describeTarget(hostname)}`);
  };
  (http as { request: unknown }).request = blockedSync("http.request");
  (http as { get: unknown }).get = blockedSync("http.get");
  (https as { request: unknown }).request = blockedSync("https.request");
  (https as { get: unknown }).get = blockedSync("https.get");

  syncBuiltinESMExports();
}
