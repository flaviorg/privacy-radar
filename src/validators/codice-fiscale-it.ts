const ODD = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23];

/** Italian codice fiscale: 16 characters, omocodia letters allowed in the digit positions, check letter mod 26. */
export function isValidItCodiceFiscale(raw: string): boolean {
  if (typeof raw !== "string" || raw.length > 40) return false;
  const s = raw.replace(/[\s.\-/]/g, "").toUpperCase();
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 15; i++) {
    const ch = s.charCodeAt(i);
    const index = ch >= 48 && ch <= 57 ? ch - 48 : ch - 65;
    sum += i % 2 === 0 ? (ODD[index] ?? 0) : index;
  }
  return String.fromCharCode(65 + (sum % 26)) === s[15];
}
