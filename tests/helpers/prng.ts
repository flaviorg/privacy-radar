/** Small seeded generator (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed of the property-style generators; every assertion message prints it. */
export function propertySeed(): number {
  return Number(process.env.PROPERTY_SEED || 20261008);
}

const CODE_PIECES = ["{", "}", "(", ")", "`", "'", '"', "${", "=>", ";", "\n", "\r\n", "interface ", "class ", "const ", "export ", "import ", "@", "<", ">", "/*", "*/", "//", "\\"];

/** A seeded random string of length in [min, max]: code-shaped pieces, ASCII and arbitrary UTF-16 units. */
export function randomString(rnd: () => number, min: number, max: number): string {
  const length = min + Math.floor(rnd() * (max - min + 1));
  let out = "";
  while (out.length < length) {
    const r = rnd();
    if (r < 0.35) out += CODE_PIECES[Math.floor(rnd() * CODE_PIECES.length)];
    else if (r < 0.8) out += String.fromCharCode(32 + Math.floor(rnd() * 95));
    else out += String.fromCharCode(Math.floor(rnd() * 0x10000));
  }
  return out.slice(0, length);
}
