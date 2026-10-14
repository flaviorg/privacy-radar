// Pure text helpers shared by src/engine and src/llm (so neither imports the other). Imports nothing.

/** Trims and replaces every whitespace run with one space. */
export function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** The text a field's evidence must come from: its masked declaration, comment and sibling field names. */
export function fieldContext(input: { declarationText: string; comment: string | null; entityFields: readonly string[] }): string {
  return collapseWs([input.declarationText, input.comment ?? "", input.entityFields.join(" ")].join(" "));
}

/** True when the collapsed evidence has at least `minChars` characters and is a substring of the collapsed context. */
export function evidenceMatches(evidence: string, context: string, minChars = 1): boolean {
  const e = collapseWs(evidence);
  return e.length >= minChars && collapseWs(context).includes(e);
}
