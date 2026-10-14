import * as z from "zod";

/** 1-based line, 1-based column (UTF-16 code units), as SARIF expects. */
export const locSchema = z.object({ line: z.number().int().min(1), column: z.number().int().min(1) }).strict();
export type Loc = z.infer<typeof locSchema>;

/** Character offsets into the scanned text, `end` exclusive (Spec delta 2). */
export const textRangeSchema = z.object({ start: z.number().int().min(0), end: z.number().int().min(0) }).strict();
export type TextRange = z.infer<typeof textRangeSchema>;

export const SCAN_WARNING_CODES = [
  "PARSE_ERROR",
  "DEPTH_LIMIT",
  "FILE_TOO_LARGE",
  "FILE_LIMIT",
  "ENTITY_TOO_LARGE",
  "SYMLINK_SKIPPED",
  "UNSUPPORTED_DIALECT",
  "LLM_DEGRADED",
  "LLM_FIXTURE_MISSING",
] as const;
export const scanWarningCodeSchema = z.enum(SCAN_WARNING_CODES);
export type ScanWarningCode = z.infer<typeof scanWarningCodeSchema>;

export const scanWarningSchema = z
  .object({ file: z.string(), line: z.number().int().min(1).optional(), code: scanWarningCodeSchema, message: z.string() })
  .strict();
export type ScanWarning = z.infer<typeof scanWarningSchema>;

export type Field = {
  name: string;
  rawName: string;
  type: string | null;
  rawType: string | null;
  optional: boolean;
  array: boolean;
  loc: Loc;
  attributes: string[];
  comment: string | null;
  commentRange: TextRange | null;
  defaultValue: string | null;
  defaultRange: TextRange | null;
  /** The masked, whitespace-collapsed declaration line (at most 200 chars). Adapters leave it empty; `applyMaskedText` fills it. */
  declarationText: string;
};

export type EntityKind = "table" | "model" | "interface" | "type" | "class" | "object";

export type Entity = {
  name: string;
  /** `@@map`/`@map` target when present, else the name; lower-cased, `_` and `-` removed, one trailing `s` removed. */
  normalizedName: string;
  kind: EntityKind;
  loc: Loc;
  fields: Field[];
  protectionHints: string[];
};

export type Checksum = "valid" | "invalid" | "n/a";

export type ValueHit = {
  categories: string[];
  checksum: Checksum;
  /** false only for a digits-only candidate with no term of its category nearby (VAL-06); such a hit has categories [] and checksum "n/a" */
  corroborated: boolean;
  /** the matched value, masked (same length) */
  masked: string;
  line: number;
  column: number;
  length: number;
  start: number;
  end: number;
};

/**
 * A literal and the name it is bound to (object key, variable, Prisma field, SQL INSERT column by
 * position; `"*"` = always mask). Structure only: classification happens in `maskText`.
 */
export type LiteralBinding = { bindingName: string; start: number; end: number; line: number; column: number };

export type RefContext = "direct" | "spread" | "key";

/** A reference of an allowed shape (spec 5.4 rule 1): an identifier or a non-computed member chain, or an object key. */
export type RefModel = { chain: string; root: string; last: string; loc: Loc; context: RefContext };

export type ArgModel = { loc: Loc; range: TextRange; refs: RefModel[] };

export type CallSite = { calleeText: string; loc: Loc; args: ArgModel[]; urlText: string | null; urlRange: TextRange | null };

export type Binding = {
  name: string;
  loc: Loc;
  /** raw initializer text; re-sliced from the masked text before it leaves the engine */
  initializerText: string;
  initRange: TextRange;
  /** the chains of `refs` */
  refersTo: string[];
  typeName: string | null;
  refs: RefModel[];
};

export type Param = { name: string; typeName: string | null; loc: Loc };

/** A query-string construction whose value is an expression (FLOW-06). */
export type QueryBuild = { param: string; loc: Loc; range: TextRange; refs: RefModel[]; via: "template" | "concat" | "url-search-params" };

export type FunctionModel = {
  /** `<module>` for module scope, `<anonymous>` when no name can be derived */
  name: string;
  loc: Loc;
  endLine: number;
  params: Param[];
  bindings: Binding[];
  calls: CallSite[];
  queryBuilds: QueryBuild[];
};

export type SourceKind = "ts" | "sql" | "prisma";

export type SourceFile = {
  path: string;
  kind: SourceKind;
  entities: Entity[];
  functions: FunctionModel[];
  literalBindings: LiteralBinding[];
  warnings: ScanWarning[];
};
