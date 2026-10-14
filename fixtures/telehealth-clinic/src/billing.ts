import * as fs from "node:fs";
import type { Clinic, Patient } from "@prisma/client";

/** Appends one invoice line to the CSV export picked up by the accounting job. */
export function invoice(p: Patient, iban: string): void {
  // One line per invoice: the patient's name and the account to debit.
  // The accounting job reads invoices.csv every night.
  fs.appendFileSync("invoices.csv", `${p.fullName},${iban}`);
}

/** The clinic's tax id goes on every invoice header. */
export function issuerLine(clinic: Clinic): string {
  return `Issued by ${clinic.name} (CNPJ ${clinic.cnpj})`;
}
