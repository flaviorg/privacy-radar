// Helpers shared by the versioned prompts. Pure; imports nothing.

/** `&`, `<` and `>` become entities, so repository text can never open or close a block. */
export function escapeUntrusted(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** One repository-derived string inside its own block (LLM-01). */
export function untrusted(source: string, text: string): string {
  return `<untrusted source="${source}">${escapeUntrusted(text)}</untrusted>`;
}

/** The first `max` UTF-16 units of `text`. */
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}
