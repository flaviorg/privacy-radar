import * as z from "zod";
import { sensitivitySchema, sinkKindSchema } from "./catalog.ts";
import { entityKindSchema } from "./findings.ts";

const locationSchema = z.object({ file: z.string().min(1), line: z.number().int().min(1), column: z.number().int().min(1), sourceKind: z.enum(["ts", "sql", "prisma"]) }).strict();

export const FIELD_STATUSES = ["personal", "not-personal", "below-threshold", "ambiguous", "unclassified"] as const;
export const fieldStatusSchema = z.enum(FIELD_STATUSES);
export type FieldStatus = z.infer<typeof fieldStatusSchema>;

/** The advisory label of an ambiguous field, kept apart from `categories` (spec 5.1). */
export const llmLabelSchema = z
  .object({ label: z.string().min(1), confidence: z.number().min(0).max(1), scripted: z.boolean(), rationale: z.string() })
  .strict();
export type InventoryLlmLabel = z.infer<typeof llmLabelSchema>;

const fieldSchema = z
  .object({
    name: z.string().min(1),
    locations: z.array(locationSchema).min(1),
    categories: z.array(z.string().min(1)),
    sensitivity: sensitivitySchema,
    confidence: z.number().min(0).max(1),
    level: z.enum(["high", "medium", "low"]),
    status: fieldStatusSchema,
    sinks: z
      .array(z.object({ kind: sinkKindSchema, callee: z.string().min(1), vendor: z.string().optional(), file: z.string().min(1), line: z.number().int().min(1) }).strict()),
    llmLabel: llmLabelSchema.optional(),
  })
  .strict();

const entitySchema = z
  .object({
    name: z.string().min(1),
    kind: entityKindSchema,
    locations: z.array(locationSchema).min(1),
    flags: z.object({ hasSensitive: z.boolean(), hasChildrenIndicator: z.boolean(), retentionSignal: z.string().nullable(), protectionHints: z.array(z.string()) }).strict(),
    fields: z.array(fieldSchema),
  })
  .strict();

const count = z.number().int().min(0);

/** The `inventory.json` of spec 5.1. */
export const inventorySchema = z
  .object({
    schemaVersion: z.literal(1),
    entities: z.array(entitySchema),
    hosts: z.array(z.object({ host: z.string().min(1), vendor: z.string().nullable(), hqCountry: z.string().nullable() }).strict()),
    valueHits: z.array(z.object({ file: z.string().min(1), line: z.number().int().min(1), categories: z.array(z.string().min(1)), checksum: z.enum(["valid", "invalid", "n/a"]), masked: z.string() }).strict()),
    counts: z
      .object({
        entities: count,
        fields: count,
        personal: count,
        sensitive: count,
        childrenIndicators: count,
        notPersonal: count,
        belowThreshold: count,
        ambiguous: count,
        unclassified: count,
        valuesMasked: count,
      })
      .strict(),
  })
  .strict();
export type Inventory = z.infer<typeof inventorySchema>;
export type InventoryEntity = Inventory["entities"][number];
export type InventoryField = InventoryEntity["fields"][number];
