import { createHash } from "node:crypto";
import type { PromptSpec, TraceLine } from "../contracts/llm.ts";

const sha256 = (text: string) => `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;

/** SHA-256 of `system + "\n" + buildUser(sampleInput)`: a change to either text is a fixture drift. */
export function promptHash<I, O>(p: PromptSpec<I, O>): string {
  return sha256(`${p.system}\n${p.buildUser(p.sampleInput)}`);
}

/** JSON with object keys sorted at every depth, so equal inputs hash equally whatever their key order. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Hash of one call's input: the trace records it instead of the input itself. */
export function inputSha256(input: unknown): string {
  return sha256(stableJson(input));
}

export type Trace = { write(line: Omit<TraceLine, "seq">): void; lines(): TraceLine[] };

/** An in-memory trace; `seq` starts at 1 in write order. */
export function createTrace(): Trace {
  const lines: TraceLine[] = [];
  return {
    write(line) {
      lines.push({ seq: lines.length + 1, ...line });
    },
    lines: () => lines.map((l) => ({ ...l })),
  };
}
