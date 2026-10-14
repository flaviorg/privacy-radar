const ALNUM = /[\p{L}\p{N}]/u;
const MASK_CHAR = "*";
const KEEP_LAST_MIN_ALNUM = 6;
const BOUND_LITERAL_MIN_ALNUM = 8;

type Piece = { text: string; alnum: boolean };

/** Splits a string into code points, keeping the UTF-16 length of each one. */
function pieces(value: string): Piece[] {
  return Array.from(value, (text) => ({ text, alnum: ALNUM.test(text) }));
}

function maskPiece(p: Piece): string {
  return MASK_CHAR.repeat(p.text.length);
}

/** Masks every letter and digit of `part` except the last two; separators stay. */
function maskKeepingLastTwo(part: string): string {
  const ps = pieces(part);
  const total = ps.filter((p) => p.alnum).length;
  const keepFrom = total >= KEEP_LAST_MIN_ALNUM ? total - 2 : total;
  let seen = 0;
  return ps
    .map((p) => {
      if (!p.alnum) return p.text;
      const keep = seen >= keepFrom;
      seen += 1;
      return keep ? p.text : maskPiece(p);
    })
    .join("");
}

function maskAll(part: string): string {
  return pieces(part)
    .map((p) => (p.alnum ? maskPiece(p) : p.text))
    .join("");
}

function maskEmail(value: string): string {
  const at = value.lastIndexOf("@");
  if (at <= 0) return maskAll(value);
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const lastDot = domain.lastIndexOf(".");
  if (lastDot < 0) return `${maskAll(local)}@${maskAll(domain)}`;
  return `${maskAll(local)}@${maskAll(domain.slice(0, lastDot))}${domain.slice(lastDot)}`;
}

/**
 * Masks a detected value (spec 4.2). Separators and the last two letters or digits stay
 * (the last two stay only when the value has at least 6 of them, so a short value never
 * leaks most of itself); e-mails keep the TLD only. Length-preserving.
 */
export function maskValue(value: string, category: string): string {
  if (category === "contact.email") return maskEmail(value);
  return maskKeepingLastTwo(value);
}

/**
 * Masks a literal masked because its binding name classifies (Spec delta 4): separators stay;
 * with at least 8 letters or digits the first two and the last two stay, otherwise all are masked.
 * Length-preserving.
 */
export function maskBoundLiteral(value: string): string {
  const ps = pieces(value);
  const total = ps.filter((p) => p.alnum).length;
  if (total < BOUND_LITERAL_MIN_ALNUM) return maskAll(value);
  let seen = 0;
  return ps
    .map((p) => {
      if (!p.alnum) return p.text;
      const index = seen;
      seen += 1;
      return index < 2 || index >= total - 2 ? p.text : maskPiece(p);
    })
    .join("");
}
