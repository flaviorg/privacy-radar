import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogger, silentLogger } from "../../src/infra/logger.ts";
import { createRedactor } from "../../src/infra/redact.ts";
import { fixedClock } from "../../src/infra/clock.ts";

test("logger writes one redacted JSON line per event and respects the level", () => {
  const lines: string[] = [];
  const log = createLogger({ level: "warn", write: (l) => lines.push(l), redact: createRedactor("configured-api-key-1"), clock: fixedClock("2026-10-08T12:00:00.000Z") });
  log.info("scan.start", { files: 3 });
  log.debug("scan.file", {});
  assert.equal(lines.length, 0);
  log.warn("scan.warning", { code: "PARSE_ERROR", detail: "key sk-" + "k".repeat(30) + " and configured-api-key-1" });
  log.error("scan.done");
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0]!);
  assert.deepEqual(first, { ts: "2026-10-08T12:00:00.000Z", level: "warn", event: "scan.warning", code: "PARSE_ERROR", detail: "key [REDACTED] and [REDACTED]" });
  assert.ok(!lines[0]!.includes("\n"));
  assert.equal(JSON.parse(lines[1]!).event, "scan.done");
});

test("logger level debug lets everything through, in order ts, level, event", () => {
  const lines: string[] = [];
  const log = createLogger({ level: "debug", write: (l) => lines.push(l), redact: (s) => s });
  log.debug("a");
  log.info("b");
  log.warn("c");
  log.error("d");
  assert.deepEqual(lines.map((l) => JSON.parse(l).level), ["debug", "info", "warn", "error"]);
  assert.deepEqual(Object.keys(JSON.parse(lines[0]!)).slice(0, 3), ["ts", "level", "event"]);
});

test("a field cannot overwrite ts, level or event", () => {
  const lines: string[] = [];
  const log = createLogger({ level: "info", write: (l) => lines.push(l), redact: (s) => s });
  log.info("real", { level: "fake", event: "fake", ts: "fake" });
  const parsed = JSON.parse(lines[0]!);
  assert.equal(parsed.event, "real");
  assert.equal(parsed.level, "info");
  assert.notEqual(parsed.ts, "fake");
});

test("silentLogger writes nothing and does not throw", () => {
  silentLogger.error("x", { a: 1 });
  silentLogger.debug("y");
});
