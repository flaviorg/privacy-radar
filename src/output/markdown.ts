// Markdown escaping for every repository- or LLM-derived string (OUT-09). Pure.

const ZERO_WIDTH_SPACE = "​";

/**
 * Makes text inert in Markdown: `\`, `*`, `_`, `[`, `]`, `(`, `)`, `!`, `#`, `|` and the backtick get a
 * backslash, `<` and `>` become entities (no HTML tag survives), and `@` is followed by a zero-width
 * space so that no mention is created. Newlines become spaces.
 */
export function escapeMd(text: string): string {
  return text
    .replace(/\r?\n|\r/g, " ")
    .replace(/[\\*_[\]()!#|`]/g, (c) => `\\${c}`)
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/@/g, `@${ZERO_WIDTH_SPACE}`);
}

/** An inline code span whose fence is one backtick longer than the longest run inside the text. */
export function codeSpan(text: string): string {
  const flat = text.replace(/\r?\n|\r/g, " ");
  let longest = 0;
  for (const run of flat.match(/`+/g) ?? []) longest = Math.max(longest, run.length);
  const fence = "`".repeat(longest + 1);
  const pad = flat.startsWith("`") || flat.endsWith("`") ? " " : "";
  return `${fence}${pad}${flat}${pad}${fence}`;
}

/** A table cell: a pipe would end the cell even inside a code span, so it is escaped after the span is built. */
export function tableCell(markdown: string): string {
  return markdown.replace(/\|/g, "\\|");
}
