/** Dutch BSN: 9 digits, the 11-proof (9*d1 + 8*d2 + ... + 2*d8 - d9 is a multiple of 11, and not zero). */
export function isValidNlBsn(raw: string): boolean {
  if (typeof raw !== "string" || raw.length > 32) return false;
  const s = raw.replace(/[\s.\-/]/g, "");
  if (!/^\d{9}$/.test(s)) return false;
  const d = Array.from(s, Number);
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += (d[i] ?? 0) * (9 - i);
  sum -= d[8] ?? 0;
  return sum !== 0 && sum % 11 === 0;
}
