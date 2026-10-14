import type { Patient } from "@prisma/client";

// Minimal shape of the analytics SDK this fixture calls (the fixture is scanned, never run).
declare const mixpanel: {
  track(event: string, properties: Record<string, unknown>): void;
};

export const trackVisit = (patient: Patient): void =>
  mixpanel.track("visit", { cpf: patient.cpf, diagnosis: patient.diagnosis });
export async function syncProfile(patient: Patient): Promise<void> {
  const payload = { email: patient.email };
  await fetch("https://api.mixpanel.com/engage", { method: "POST", body: JSON.stringify(payload) });
}
