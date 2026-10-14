import type { Patient } from "@prisma/client";
import { randomUUID } from "node:crypto";
// Minimal shape of the analytics SDK this fixture calls (the fixture is scanned, never run).
declare const mixpanel: {
  track(event: string, properties: Record<string, unknown>): void;
};

export const trackVisit = (_patient: Patient): void =>
  mixpanel.track("visit", { visitId: randomUUID() });
export async function syncProfile(patient: Patient): Promise<void> {
  const payload = { email: patient.email };
  await fetch("https://api.mixpanel.com/engage", { method: "POST", body: JSON.stringify(payload) });
}
