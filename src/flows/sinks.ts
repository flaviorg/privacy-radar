import type { SinkKind, SinksFile, Vendor } from "../contracts/catalog.ts";
import type { SinkCall } from "../contracts/flows.ts";
import type { FunctionModel } from "../contracts/source-model.ts";
import { hostOf, resolveVendor, type VendorIndex } from "./vendors.ts";

/** Kinds matched against call sites, in precedence order; `url-query` comes from query builds. */
const CALL_KINDS: readonly SinkKind[] = ["log", "http", "analytics", "file"];

type Compiled = { kind: SinkKind; patterns: RegExp[] }[];
const COMPILED = new WeakMap<SinksFile, Compiled>();

function compile(sinks: SinksFile): Compiled {
  let c = COMPILED.get(sinks);
  if (!c) {
    c = (Object.keys(sinks.patterns) as SinkKind[]).map((kind) => ({ kind, patterns: sinks.patterns[kind].map((p) => new RegExp(p)) }));
    COMPILED.set(sinks, c);
  }
  return c;
}

/** Kind of a callee text against the anchored patterns of `sinks.json`, or null. */
export function sinkKindOf(callee: string, sinks: SinksFile): SinkKind | null {
  const compiled = compile(sinks);
  for (const kind of [...CALL_KINDS, "url-query" as const]) {
    const entry = compiled.find((e) => e.kind === kind);
    if (entry?.patterns.some((re) => re.test(callee))) return kind;
  }
  return null;
}

function callKindOf(callee: string, sinks: SinksFile): SinkKind | null {
  const kind = sinkKindOf(callee, sinks);
  return kind === "url-query" ? null : kind;
}

function sdkVendor(callee: string, catalog: { sinks: SinksFile; vendors: readonly Vendor[] }): Vendor | null {
  const root = callee.split(".", 1)[0] ?? "";
  const name = Object.hasOwn(catalog.sinks.sdkVendors, root) ? catalog.sinks.sdkVendors[root] : undefined;
  return name === undefined ? null : (catalog.vendors.find((v) => v.vendor === name) ?? null);
}

/**
 * Sink calls of one function (FLOW-01, FLOW-02, FLOW-06): every call whose callee matches a
 * pattern of its kind, with host, vendor and first-party status for `http`, the SDK vendor for
 * `analytics`, and one `url-query` sink per query-string construction. Sorted by position.
 */
export function matchSinks(fn: FunctionModel, catalog: { sinks: SinksFile; vendors: readonly Vendor[] }, index: VendorIndex): SinkCall[] {
  const out: SinkCall[] = [];
  for (const call of fn.calls) {
    const kind = callKindOf(call.calleeText, catalog.sinks);
    if (kind === null) continue;
    const base: SinkCall = {
      kind,
      callee: call.calleeText,
      loc: call.loc,
      args: call.args,
      urlText: call.urlText,
      host: null,
      firstParty: false,
      unresolved: false,
      vendor: null,
      queryParam: null,
      fnName: fn.name,
    };
    if (kind === "http") {
      const { host, firstParty } = hostOf(call.urlText);
      out.push({ ...base, host, firstParty, unresolved: host === null && !firstParty, vendor: host === null ? null : resolveVendor(host, index) });
    } else if (kind === "analytics") {
      out.push({ ...base, vendor: sdkVendor(call.calleeText, catalog) });
    } else {
      out.push(base);
    }
  }
  for (const qb of fn.queryBuilds) {
    out.push({
      kind: "url-query",
      callee: "<query>",
      loc: qb.loc,
      args: [{ loc: qb.loc, range: qb.range, refs: qb.refs }],
      urlText: null,
      host: null,
      firstParty: false,
      unresolved: false,
      vendor: null,
      queryParam: qb.param,
      fnName: fn.name,
    });
  }
  const rank = (k: SinkKind) => (k === "url-query" ? 1 : 0);
  return out.sort((a, b) => a.loc.line - b.loc.line || rank(a.kind) - rank(b.kind) || a.loc.column - b.loc.column);
}
