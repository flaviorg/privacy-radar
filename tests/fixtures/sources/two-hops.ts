export function audit(patient: Patient) {
  const first = patient.cpf;
  const second = { value: first };
  console.log(second);
}
