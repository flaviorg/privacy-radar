import { test } from "node:test";
import assert from "node:assert/strict";
import { FAILURE_TAIL_LINES, childOutput, failureTail } from "../../scripts/check-diagrams.ts";

const numbered = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`);

test("failureTail keeps the last 15 lines of a long output, each indented by four spaces", () => {
  assert.equal(FAILURE_TAIL_LINES, 15);
  const tail = failureTail(numbered(40).join("\n") + "\n");
  assert.equal(tail.length, 15);
  assert.equal(tail[0], "    line 26");
  assert.equal(tail[14], "    line 40");
});

test("failureTail returns a short output whole and drops trailing blank lines and carriage returns", () => {
  assert.deepEqual(failureTail("Error: no usable sandbox\r\nFailed to launch the browser\r\n\r\n\n"), ["    Error: no usable sandbox", "    Failed to launch the browser"]);
  assert.deepEqual(failureTail("a\n\nb\n"), ["    a", "", "    b"], "a blank line inside the tail stays blank, without trailing spaces");
});

test("failureTail says so when the output is empty and honors a custom count", () => {
  assert.deepEqual(failureTail(""), ["    (no output)"]);
  assert.deepEqual(failureTail("\n  \n"), ["    (no output)"]);
  assert.deepEqual(failureTail(numbered(5).join("\n"), 2), ["    line 4", "    line 5"]);
});

test("childOutput joins stdout then stderr and adds the spawn error", () => {
  assert.equal(childOutput({ stdout: "out\n", stderr: "err\n", status: 1 }), "out\nerr\n");
  assert.equal(childOutput({ stdout: "", stderr: "", status: null, signal: "SIGTERM", error: new Error("spawnSync npx ETIMEDOUT") }), "spawnSync npx ETIMEDOUT\n");
});

test("childOutput never returns an empty text: it reports the exit status when the child printed nothing", () => {
  assert.equal(childOutput({ stdout: "", stderr: "  \n", status: 1 }), "no output (exit status 1, signal none)\n");
  assert.equal(childOutput({ stdout: null, stderr: null, status: null, signal: "SIGKILL" }), "no output (exit status none, signal SIGKILL)\n");
  assert.deepEqual(failureTail(childOutput({ stdout: "", stderr: "", status: 1 })), ["    no output (exit status 1, signal none)"]);
});
