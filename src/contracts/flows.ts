import type { SinkKind, Vendor } from "./catalog.ts";
import type { ArgModel, Loc } from "./source-model.ts";

export type { SinkKind } from "./catalog.ts";

export type SinkCall = {
  kind: SinkKind;
  /** callee chain text (`console.info`, `this.logger.error`); `<query>` for a query-string construction */
  callee: string;
  loc: Loc;
  args: ArgModel[];
  urlText: string | null;
  host: string | null;
  /** a relative URL: no third party, no transfer (FLOW-07) */
  firstParty: boolean;
  /** an `http` sink whose URL is not a literal (FLOW-02) */
  unresolved: boolean;
  vendor: Vendor | null;
  /** the parameter name of a `url-query` sink */
  queryParam: string | null;
  fnName: string;
};

export type SourceEvidence = "field-name" | "type-hint" | "spread" | "key";

export type SourceCategory = { category: string; confidence: number; entity: string | null; field: string | null; evidence: SourceEvidence };

/** A classified entity reachable through a type annotation (spec 5.4 (b)). */
export type TypedSource = {
  entity: string;
  /** categories of the entity field whose name normalizes like `last` (member-chain precedence) */
  field(last: string): SourceCategory[];
  /** every deterministic category of the entity, one entry per category */
  all: SourceCategory[];
};

/** Built by the engine from deterministic classifications only; LLM labels never make a source. */
export type SourceIndex = {
  byName(last: string): SourceCategory[];
  byType(typeName: string): TypedSource | null;
};

export type Reach = {
  source: {
    category: string;
    /** the reference chain (`patient.cpf`), never a value */
    expressionText: string;
    loc: Loc;
    confidence: number;
    evidence: SourceEvidence;
    entity: string | null;
    field: string | null;
  };
  sink: SinkCall;
  hop: { via: string; loc: Loc } | null;
};

/** Transfer status per regime (spec 4.4), in the precedence order of `assessTransfer`. */
export const TRANSFER_STATUSES = ["domestic", "adequate", "mechanism-declared", "conditional", "needs-mechanism", "unknown-destination"] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];
