import type { Locale } from "../../contracts/findings.ts";
import { DISCLAIMER_EN, DISCLAIMER_PT_BR } from "../disclaimer.ts";
import { escapeMd } from "../markdown.ts";
import { TEXTS } from "./templates.ts";

// The template renderer of spec 5.9. Grammar: {{text:<key>}} a localized string, {{table:<name>}} and
// {{list:<name>}} deterministic content, {{section:<id>}} the narrative block of a narrative section.
// Values are inserted as given: the caller escapes every derived string before it gets here. Pure.

export type RenderContext = {
  texts: Readonly<Record<string, string>>;
  tables: Readonly<Record<string, string>>;
  lists: Readonly<Record<string, string>>;
  sections: Readonly<Record<string, string>>;
};

const PLACEHOLDER = /\{\{([a-z]+):([^{}\s]+)\}\}/g;
const KINDS: Readonly<Record<string, keyof RenderContext>> = { text: "texts", table: "tables", list: "lists", section: "sections" };

/** Every placeholder of a template as `kind:key`, sorted, duplicates kept (a multiset, DOC-07). */
export function placeholders(template: string): string[] {
  return [...template.matchAll(PLACEHOLDER)].map((m) => `${m[1]}:${m[2]}`).sort();
}

/**
 * Fills every placeholder in one pass (an inserted value is never expanded again). An unknown kind or
 * key throws `unknown placeholder <kind>:<key>`; a template that does not start with the banner throws.
 */
export function render(template: string, ctx: RenderContext): string {
  if (!template.startsWith("{{text:banner}}")) throw new Error("a document template must start with {{text:banner}}");
  return template.replace(PLACEHOLDER, (_whole, kind: string, key: string) => {
    const bucket = KINDS[kind];
    const value = bucket === undefined ? undefined : ctx[bucket][key];
    if (value === undefined) throw new Error(`unknown placeholder ${kind}:${key}`);
    return value;
  });
}

/** Markdown-inert, but keeps parentheses readable: without `[` and `]` (escaped) no link can form. */
function inertLabel(text: string): string {
  return escapeMd(text).replace(/\\([()])/g, "$1");
}

/** The banner of spec 5.9 from the localized `banner.template`; target and provider label are escaped here. */
export function bannerText(input: { locale: Locale; version: string; date: string; target: string; providerLabel: string }): string {
  const values: Record<string, string> = {
    version: input.version,
    date: input.date,
    target: inertLabel(input.target),
    disclaimer: input.locale === "pt-BR" ? DISCLAIMER_PT_BR : DISCLAIMER_EN,
    provider: inertLabel(input.providerLabel),
  };
  // one pass, so a `{...}` inside the target or the provider label is never expanded
  const text = TEXTS[input.locale]["banner.template"]!.replace(/\{(version|date|target|disclaimer|provider)\}/g, (_m, key: string) => values[key]!);
  return `> **${text}**`;
}

/** Paragraphs, a rejected or degraded model output (with its reason), or no model at all (`--llm none`). */
export type NarrativeResult = { paragraphs: readonly string[] } | { placeholder: string; reason: string } | { notGenerated: true };

/**
 * The body of a `{{section:<id>}}` placeholder (DOC-05): the localized "Draft narrative (LLM)" heading,
 * then the escaped paragraphs, or the localized placeholder line with the rejection reason.
 */
export function narrativeBlock(locale: Locale, result: NarrativeResult): string {
  const t = TEXTS[locale];
  const heading = `### ${t["narrative.heading"]}`;
  if ("paragraphs" in result) return [heading, ...result.paragraphs.map((p) => escapeMd(p))].join("\n\n");
  if ("notGenerated" in result) return `${heading}\n\n_${t["narrative.notGenerated"]!}._`;
  const line = t["narrative.unavailable"]!.replace("{reason}", escapeMd(result.reason));
  return `${heading}\n\n_${line}._`;
}
