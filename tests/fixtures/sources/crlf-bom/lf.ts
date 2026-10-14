import type { Patient } from "./model";

/** Contact data kept for appointment reminders. */
export interface Contact {
  email: string;
  phone?: string;
}

export function notify(patient: Patient, contact: Contact): void {
  const line = `${patient.fullName} <${contact.email}>`;
  console.info("notify", line);
}
