/** Luhn checksum for card numbers (12 to 19 digits, spaces and dashes ignored, all zeros rejected). */
export function isValidLuhn(raw: string): boolean {
  if (typeof raw !== "string" || raw.length > 40) return false;
  const s = raw.replace(/[\s.\-/]/g, "");
  if (!/^\d{12,19}$/.test(s) || /^0+$/.test(s)) return false;
  let sum = 0;
  let double = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let n = Number(s[i]);
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}
