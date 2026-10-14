/** French NIR: 15 characters (Corsica 2A/2B count as 19/18), key = 97 - (first 13 digits mod 97). */
export function isValidFrNir(raw: string): boolean {
  if (typeof raw !== "string" || raw.length > 40) return false;
  const s = raw.replace(/[\s.\-/]/g, "").toUpperCase();
  if (!/^[1-478]\d{4}(?:\d{2}|2[AB])\d{6}\d{2}$/.test(s)) return false;
  const head = s.slice(0, 13).replace("2A", "19").replace("2B", "18");
  const key = 97n - (BigInt(head) % 97n);
  return Number(s.slice(13)) === Number(key);
}
