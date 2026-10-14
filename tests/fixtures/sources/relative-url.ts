export async function save(patient: Patient) {
  const body = JSON.stringify(patient);
  await fetch("/api/patients", { method: "POST", body });
}
