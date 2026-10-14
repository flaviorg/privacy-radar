import { test } from "node:test";
import assert from "node:assert/strict";
import { diffFindings, findingKey } from "../../src/pr/diff.ts";
import { finding } from "../helpers/builders.ts";

const at = (line: number, snippet = "console.log(cpf);", over = {}) => finding({ location: { file: "src/a.ts", line, column: 3, snippet }, ...over });

test("[PR-02] the key uses ruleId, categories, sink kind, vendor, path and the masked snippet hash, not the line", () => {
  const a = at(3);
  assert.equal(findingKey(a), findingKey(at(40)), "same finding at another line → same key");
  assert.equal(findingKey(at(3, "console.log(a, cpf);")), findingKey(at(3, "  console.log(a,    cpf);  ")), "whitespace is normalized before hashing");
  const parts = findingKey(finding({ ruleId: "PR-ANALYTICS", categories: ["identifier.cpf", "special.health"], sink: { kind: "analytics", callee: "mixpanel.track", vendor: "Mixpanel", hqCountry: "US" } })).split("|");
  assert.deepEqual(parts.slice(0, 5), ["PR-ANALYTICS", "identifier.cpf,special.health", "analytics", "Mixpanel", "src/a.ts"]);
  assert.match(parts[5]!, /^[0-9a-f]{16}$/);
  assert.deepEqual(findingKey(a).split("|").slice(2, 4), ["-", "-"], "no sink: kind and vendor are -");
  for (const other of [
    at(3, "console.log(email);"),
    at(3, undefined, { ruleId: "PR-FILE" }),
    at(3, undefined, { categories: ["identifier.cpf", "special.health"] }),
    finding({ location: { file: "src/b.ts", line: 3, column: 3, snippet: "console.log(cpf);" } }),
    at(3, undefined, { sink: { kind: "log", callee: "console.log" } }),
  ]) assert.notEqual(findingKey(other), findingKey(a));
});

test("[PR-02] multiset diff: two identical calls, one removed → one resolved and one unchanged", () => {
  const f1 = at(3);
  const f1b = at(9);
  const d = diffFindings([f1, f1b], [f1]);
  assert.equal(d.resolved.length, 1);
  assert.equal(d.unchanged, 1);
  assert.equal(d.added.length, 0);
  assert.equal(d.resolved[0], f1b, "the last base finding with that key is resolved");
});

test("[PR-02] moving a line without changing it is unchanged; a new key is added; a gone key is resolved", () => {
  const moved = diffFindings([at(3), at(10, "fs.appendFileSync(x);", { ruleId: "PR-FILE" })], [at(5), at(12, "fetch(u);", { ruleId: "PR-THIRD-PARTY" })]);
  assert.equal(moved.unchanged, 1);
  assert.deepEqual(moved.added.map((f) => f.ruleId), ["PR-THIRD-PARTY"]);
  assert.deepEqual(moved.resolved.map((f) => f.ruleId), ["PR-FILE"]);
  const more = diffFindings([at(3)], [at(3), at(7), at(9)]);
  assert.deepEqual(more.added.map((f) => f.location.line), [7, 9], "the last n head findings of a key, in output order");
  assert.equal(more.unchanged, 1);
});

test("[PR-02] LLM, below-threshold and suppressed findings are ignored on both sides", () => {
  const d = diffFindings(
    [at(3, "a();", { origin: "llm", ruleId: "PR-AMBIGUOUS" }), at(4, "b();", { belowThreshold: true })],
    [at(5, "c();", { suppressed: { reason: "test fixture data", by: "flavio" } }), at(6, "d();", { origin: "llm", ruleId: "PR-AMBIGUOUS" })],
  );
  assert.deepEqual([d.added.length, d.resolved.length, d.unchanged], [0, 0, 0]);
});
