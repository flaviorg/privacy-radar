/**
 * Key shapes that must never leave the process. Every pattern is linear (no nested quantifiers) and
 * starts at a word boundary (lookbehind), so `disk-encryption-configuration-enabled` is not mistaken
 * for an `sk-` key. The specific prefixes run before the generic `sk-`.
 */
export const SECRET_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: "openrouter", re: /(?<![A-Za-z0-9])sk-or-v1-[A-Za-z0-9]{20,}/g },
  { name: "anthropic", re: /(?<![A-Za-z0-9])sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "openai", re: /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/g },
  { name: "google", re: /(?<![A-Za-z0-9])AIza[0-9A-Za-z_-]{35}/g },
];

const REPLACEMENT = "[REDACTED]";
const MIN_EXTRA_LENGTH = 8;

/** Replaces key-shaped strings and every configured secret value (length >= 8) with `[REDACTED]`. */
export function redactSecrets(text: string, extraValues: readonly string[] = []): string {
  let out = text;
  const extras = extraValues.filter((v) => v.length >= MIN_EXTRA_LENGTH).sort((a, b) => b.length - a.length);
  for (const value of extras) out = out.split(value).join(REPLACEMENT);
  for (const { re } of SECRET_PATTERNS) out = out.replace(re, REPLACEMENT);
  return out;
}

export function createRedactor(apiKey: string | undefined): (s: string) => string {
  const extras = apiKey ? [apiKey] : [];
  return (s) => redactSecrets(s, extras);
}
