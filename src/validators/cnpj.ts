/** Brazilian CNPJ, numeric or alphanumeric (IN RFB 2.229/2024): char value = code - 48, weights 2..9 from the right. */
export function isValidCnpj(raw: string): boolean {
  if (typeof raw !== "string" || raw.length > 40) return false;
  const s = raw.replace(/[\s.\-/]/g, "").toUpperCase();
  if (!/^[0-9A-Z]{12}\d{2}$/.test(s)) return false;
  if (/^(.)\1{13}$/.test(s)) return false;
  const values = Array.from(s, (c) => c.charCodeAt(0) - 48);
  const digit = (len: number): number => {
    let sum = 0;
    for (let i = 0; i < len; i++) {
      const weight = ((len - 1 - i) % 8) + 2;
      sum += (values[i] ?? 0) * weight;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return digit(12) === values[12] && digit(13) === values[13];
}
