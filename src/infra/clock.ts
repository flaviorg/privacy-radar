import { PrivacyRadarError } from "./errors.ts";

export type Clock = () => Date;

/** Default instant of the demo, the goldens and the test repositories. */
export const DEMO_CLOCK_ISO = "2026-10-08T12:00:00.000Z";

export function fixedClock(iso: string): Clock {
  const instant = new Date(iso).getTime();
  return () => new Date(instant);
}

export const systemClock: Clock = () => new Date();

/**
 * Reads a `PRIVACY_RADAR_CLOCK` value that the caller already took from the environment.
 * Empty or undefined keeps the fallback; an invalid ISO instant is a usage error.
 */
export function clockFromEnv(value: string | undefined, fallback: Clock): Clock {
  if (value === undefined || value.trim() === "") return fallback;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) {
    throw new PrivacyRadarError("USAGE", "PRIVACY_RADAR_CLOCK is not a valid ISO 8601 instant");
  }
  return fixedClock(new Date(time).toISOString());
}
