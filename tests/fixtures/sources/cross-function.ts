function format(p: Patient): string {
  return `${p.fullName} (${p.cpf})`;
}

export function report(patient: Patient) {
  console.log(format(patient));
}
