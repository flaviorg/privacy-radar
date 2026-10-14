import * as z from "zod";

export const SIMULATE_KINDS = ["invalid-json", "schema-violation", "timeout", "http-429", "http-500", "refusal-text"] as const;
export type SimulateKind = (typeof SIMULATE_KINDS)[number];

const turnSchema = z
  .object({
    id: z.string().min(1),
    prompt: z.enum(["label-field.v1", "draft-narrative.v1"]),
    when: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    output: z.unknown().optional(),
    simulate: z.object({ kind: z.enum(SIMULATE_KINDS), then: z.literal("ok").optional() }).strict().optional(),
  })
  .strict()
  .superRefine((turn, ctx) => {
    const answers = turn.simulate === undefined || turn.simulate.then === "ok" || turn.simulate.kind === "schema-violation";
    if (answers && turn.output === undefined) ctx.addIssue({ code: "custom", path: ["output"], message: "output_required" });
  });
export type FixtureTurn = z.infer<typeof turnSchema>;

/** A fake-provider fixture (spec 7.2): turns matched by prompt and `when`, in file order, each consumed once. */
export const llmFixtureSchema = z
  .object({
    schemaVersion: z.literal(1),
    scenario: z.string().min(1),
    description: z.string().optional(),
    promptHashes: z.record(z.string(), z.string().regex(/^sha256:[0-9a-f]+$/)),
    turns: z.array(turnSchema),
  })
  .strict()
  .superRefine((fixture, ctx) => {
    const seen = new Set<string>();
    fixture.turns.forEach((turn, i) => {
      if (seen.has(turn.id)) ctx.addIssue({ code: "custom", path: ["turns", i, "id"], message: "duplicate turn id" });
      seen.add(turn.id);
    });
  });
export type LlmFixture = z.infer<typeof llmFixtureSchema>;
