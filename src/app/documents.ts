import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Catalog } from "../catalog/load.ts";
import type { DocId, Locale } from "../contracts/findings.ts";
import type { DraftNarrativeInput, DraftNarrativeOutput, PromptSpec } from "../contracts/llm.ts";
import type { ScanWarning } from "../contracts/source-model.ts";
import type { Logger } from "../infra/logger.ts";
import { TEMPLATES_DIR } from "../infra/paths.ts";
import type { LlmProvider } from "../llm/provider.ts";
import { draftNarrative } from "../llm/tasks.ts";
import type { Trace } from "../llm/trace.ts";
import { bannerText, narrativeBlock, render, type NarrativeResult } from "../output/documents/render.ts";
import { buildTables, narrativeFacts, type DocumentFacts } from "../output/documents/sections.ts";
import { DOCUMENTS, DOC_ORDER, TEXTS, documentFileName, documentLocale } from "../output/documents/templates.ts";

export type GenerateDocumentsInput = {
  docs: readonly DocId[];
  reportLang: Locale;
  facts: DocumentFacts;
  /** every finding id of the scan: a narrative may cite only these */
  knownFindingIds: ReadonlySet<string>;
  catalog: Catalog;
  provider: LlmProvider | null;
  prompt: PromptSpec<DraftNarrativeInput, DraftNarrativeOutput>;
  trace: Trace;
  redact: (s: string) => string;
  logger: Logger;
  version: string;
  date: string;
  providerLabel: string;
  /** receives one `LLM_DEGRADED` warning per degraded narrative call */
  warn: (w: ScanWarning) => void;
  /** test seam: reads a template (default: `templates/<locale>/<doc>.md` under the project) */
  readTemplate?: (locale: Locale, doc: DocId) => string;
};

export type GeneratedDocuments = { documents: { name: string; content: string }[]; narrativeSections: number };

const readTemplateFile = (locale: Locale, doc: DocId) => readFileSync(join(TEMPLATES_DIR, locale, `${doc}.md`), "utf8");

/**
 * Renders the requested documents (spec 5.9, DOC-01 to DOC-09): `ropa` and `dpia` in English,
 * `registro` and `ripd` in `reportLang`; one `draftNarrative` call per narrative section with the
 * template's language and the section's deterministic facts and articles. Without a provider every
 * narrative section says that no model ran. Documents come in `DOC_ORDER`.
 */
export async function generateDocuments(input: GenerateDocumentsInput): Promise<GeneratedDocuments> {
  const read = input.readTemplate ?? readTemplateFile;
  const documents: { name: string; content: string }[] = [];
  let narrativeSections = 0;
  for (const doc of DOC_ORDER.filter((d) => input.docs.includes(d))) {
    const locale = documentLocale(doc, input.reportLang);
    const { tables, lists } = buildTables(doc, locale, input.facts, input.catalog);
    const sections: Record<string, string> = {};
    for (const section of DOCUMENTS[doc].narrative) {
      let result: NarrativeResult;
      if (input.provider === null) {
        result = { notGenerated: true };
      } else {
        const narrativeInput: DraftNarrativeInput = { document: doc, section, language: locale, facts: narrativeFacts(input.facts, doc, section) };
        const onDegraded = (reason: string) => {
          input.warn({ file: "", code: "LLM_DEGRADED", message: input.redact(`${doc}.${section}: draft-narrative.v1 degraded (${reason}); rendered the placeholder`) });
          input.logger.warn("llm.degraded", { prompt: "draft-narrative.v1", document: doc, section, reason });
        };
        result = await draftNarrative(input.provider, input.prompt, narrativeInput, input.knownFindingIds, { trace: input.trace, redact: input.redact, onDegraded });
        input.logger.debug("llm.call", { prompt: "draft-narrative.v1", document: doc, section, outcome: input.trace.lines().at(-1)?.outcome ?? "none" });
        if ("paragraphs" in result) narrativeSections++;
      }
      sections[section] = narrativeBlock(locale, result);
    }
    const texts = { ...TEXTS[locale], banner: bannerText({ locale, version: input.version, date: input.date, target: input.facts.target, providerLabel: input.providerLabel }) };
    const content = render(read(locale, doc), { texts, tables, lists, sections }).replace(/\n{3,}/g, "\n\n");
    documents.push({ name: documentFileName(doc, locale), content: content.endsWith("\n") ? content : `${content}\n` });
  }
  return { documents, narrativeSections };
}
