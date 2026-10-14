export async function track(patient: Patient) {
  await fetch("https://u:p@api.mixpanel.com:443/track", { method: "POST", body: JSON.stringify({ id: patient.id }) });
  await fetch(new URL("http://localhost:3000/health"));
}
