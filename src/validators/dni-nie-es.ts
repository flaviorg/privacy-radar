const LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

function clean(raw: string): string | null {
  if (typeof raw !== "string" || raw.length > 32) return null;
  return raw.replace(/[\s.\-/]/g, "").toUpperCase();
}

/** Spanish DNI: 8 digits plus a control letter (number mod 23). */
export function isValidEsDni(raw: string): boolean {
  const s = clean(raw);
  if (s === null || !/^\d{8}[A-Z]$/.test(s)) return false;
  return LETTERS[Number(s.slice(0, 8)) % 23] === s[8];
}

/** Spanish NIE: X, Y or Z (0, 1, 2) plus 7 digits plus the same control letter. */
export function isValidEsNie(raw: string): boolean {
  const s = clean(raw);
  if (s === null || !/^[XYZ]\d{7}[A-Z]$/.test(s)) return false;
  const prefix = "XYZ".indexOf(s[0] ?? "");
  return LETTERS[Number(`${prefix}${s.slice(1, 8)}`) % 23] === s[8];
}
