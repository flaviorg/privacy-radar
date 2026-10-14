import type { Appointment, Patient } from "@prisma/client";

/** Appointments scheduled in the next 24 hours get a reminder. */
export function dueForReminder(appointments: Appointment[], now: Date): Appointment[] {
  const horizon = now.getTime() + 24 * 60 * 60 * 1000;
  return appointments.filter((a) => a.scheduledAt.getTime() <= horizon);
}

/** Sends an SMS reminder through the messaging provider. */
export async function remind(patient: Patient): Promise<void> {
  await fetch(`https://sms.example-vendor.invalid/send?nif=${patient.nifPt}&msg=reminder`);
}
