import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_CLOCK_ISO, clockFromEnv, fixedClock, systemClock } from "../../src/infra/clock.ts";
import { PrivacyRadarError } from "../../src/infra/errors.ts";

test("fixedClock returns the same instant every time", () => {
  const c = fixedClock("2026-10-08T12:00:00.000Z");
  assert.equal(c().toISOString(), "2026-10-08T12:00:00.000Z");
  assert.equal(c().getTime(), c().getTime());
  assert.equal(DEMO_CLOCK_ISO, "2026-10-08T12:00:00.000Z");
});

test("clockFromEnv uses the fallback when the value is empty or undefined", () => {
  assert.equal(clockFromEnv(undefined, systemClock), systemClock);
  assert.equal(clockFromEnv("", systemClock), systemClock);
});

test("clockFromEnv freezes a valid ISO instant and rejects an invalid one with USAGE", () => {
  assert.equal(clockFromEnv("2026-01-02T03:04:05.000Z", systemClock)().toISOString(), "2026-01-02T03:04:05.000Z");
  assert.throws(() => clockFromEnv("not-a-date", systemClock), (e: unknown) => e instanceof PrivacyRadarError && e.code === "USAGE");
});
