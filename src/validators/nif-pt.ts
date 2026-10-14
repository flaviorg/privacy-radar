/** Portuguese NIF: 9 digits, check digit from weights 9..2 and mod 11. */
export function isValidPtNif(raw: string): boolean {
  if (typeof raw !== "string" || raw.length > 32) return false;
  const s = raw.replace(/[\s.\-/]/g, "");
  if (!/^\d{9}$/.test(s)) return false;
  const d = Array.from(s, Number);
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += (d[i] ?? 0) * (9 - i);
  const c = 11 - (sum % 11);
  return (c >= 10 ? 0 : c) === d[8];
}
