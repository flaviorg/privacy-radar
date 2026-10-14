/**
 * German tax identification number (Steuer-ID): 11 digits, first digit not 0, among the first ten digits
 * exactly one digit appears twice or exactly one appears three times and the others once, then the
 * ISO 7064 MOD 11,10 check digit.
 */
export function isValidDeSteuerId(raw: string): boolean {
  if (typeof raw !== "string" || raw.length > 32) return false;
  const s = raw.replace(/[\s.\-/]/g, "");
  if (!/^\d{11}$/.test(s) || s[0] === "0") return false;
  const d = Array.from(s, Number);
  const counts = new Array<number>(10).fill(0);
  for (let i = 0; i < 10; i++) counts[d[i] ?? 0] = (counts[d[i] ?? 0] ?? 0) + 1;
  const repeated = counts.filter((c) => c > 1);
  if (repeated.length !== 1 || ((repeated[0] ?? 0) !== 2 && (repeated[0] ?? 0) !== 3)) return false;
  let product = 10;
  for (let i = 0; i < 10; i++) {
    let sum = ((d[i] ?? 0) + product) % 10;
    if (sum === 0) sum = 10;
    product = (sum * 2) % 11;
  }
  const check = 11 - product === 10 ? 0 : 11 - product;
  return check === d[10];
}
