/** Brazilian CPF: 11 digits, two check digits (mod 11), all-equal digit strings rejected. */
export function isValidCpf(raw: string): boolean {
  if (typeof raw !== "string" || raw.length > 32) return false;
  const s = raw.replace(/[\s.\-/]/g, "");
  if (!/^\d{11}$/.test(s)) return false;
  if (/^(\d)\1{10}$/.test(s)) return false;
  const d = Array.from(s, Number);
  const check = (len: number): number => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += (d[i] ?? 0) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return check(9) === d[9] && check(10) === d[10];
}
