import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { spawnSync } from "node:child_process";
import { CHILD_NODE_ARGS } from "../helpers/child-node-args.ts";
import { mulberry32 } from "../helpers/prng.ts";

test("[REP-03] fetch fails with NetworkDisabledInTests", async () => {
  await assert.rejects(fetch("https://example.com"), { name: "NetworkDisabledInTests" });
});

for (const [label, attempt] of [
  ["net.connect", () => net.connect(443, "93.184.215.14")],
  ["dns.lookup", () => dns.lookup("example.com", () => {})],
  ["dns.promises.lookup", () => dns.promises.lookup("example.com")],
  ["http.get", () => http.get("http://example.com")],
  ["https.request", () => https.request("https://example.com")],
] as const) {
  test(`[REP-03] ${label} fails with NetworkDisabledInTests`, async () => {
    await assert.rejects(async () => {
      await attempt();
    }, { name: "NetworkDisabledInTests" });
  });
}

test("[REP-03] a child started with CHILD_NODE_ARGS is guarded too", () => {
  const r = spawnSync(
    process.execPath,
    [...CHILD_NODE_ARGS, "-e", "fetch('https://example.com').catch((e)=>console.log(e.name))"],
    { encoding: "utf8" },
  );
  assert.match(r.stdout, /NetworkDisabledInTests/);
});

test("mulberry32 is deterministic for a seed", () => {
  const a = mulberry32(20261008);
  const b = mulberry32(20261008);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});
