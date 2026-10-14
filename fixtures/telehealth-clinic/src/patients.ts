import type { Patient } from "@prisma/client";
import { logger } from "./logger";

const patients = new Map<string, Patient>();

/**
 * Registers a patient record received from the intake form.
 * Records are kept in memory only: this fixture is scanned, never run.
 */
export function createPatient(input: Patient): Patient {
  if (patients.has(input.id)) {
    throw new Error("patient already registered");
  }
  console.info("new patient", input);
  patients.set(input.id, input);
  return input;
}

/** Looks a patient up by CPF. */
export function findByCpf(cpf: string): Patient | undefined {
  const digits = cpf.replace(/\D/g, "");
  logger.debug(`lookup ${cpf}`);
  for (const patient of patients.values()) {
    if (patient.cpf?.replace(/\D/g, "") === digits) return patient;
  }
  return undefined;
}
