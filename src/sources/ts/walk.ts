import { LIMITS } from "../../contracts/limits.ts";

/** Minimal view of a Babel node; adapters narrow it by `type`. */
export type BabelPosition = { line: number; column: number; index: number };
export type AnyNode = {
  type: string;
  start?: number | null;
  end?: number | null;
  loc?: { start: BabelPosition; end: BabelPosition } | null;
  [key: string]: unknown;
};

export type Visit = (node: AnyNode, ancestors: readonly AnyNode[]) => void | "skip";

const SKIP_KEYS = new Set(["type", "loc", "start", "end", "range", "leadingComments", "trailingComments", "innerComments", "comments", "tokens", "errors", "extra"]);

export function isNode(value: unknown): value is AnyNode {
  return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

/** Child nodes in key order (Babel's key order follows the source order). */
export function childrenOf(node: AnyNode): AnyNode[] {
  const out: AnyNode[] = [];
  for (const key of Object.keys(node)) {
    if (SKIP_KEYS.has(key)) continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (const item of value) if (isNode(item)) out.push(item);
    } else if (isNode(value)) {
      out.push(value);
    }
  }
  return out;
}

type Frame = { node: AnyNode; children: AnyNode[] | null; next: number };

/**
 * Pre-order walk with an explicit stack (no recursion, so no stack overflow on deep input). Stops
 * descending below depth `LIMITS.astDepth` (the root is depth 0) and reports it. Returning `"skip"`
 * from `visit` skips that node's children.
 */
export function walk(root: AnyNode, visit: Visit): { depthExceeded: boolean } {
  let depthExceeded = false;
  const ancestors: AnyNode[] = [];
  const stack: Frame[] = [];
  const enter = (node: AnyNode): void => {
    const result = visit(node, ancestors);
    let children: AnyNode[] | null = null;
    if (result !== "skip") {
      const kids = childrenOf(node);
      if (kids.length > 0) {
        if (stack.length >= LIMITS.astDepth) depthExceeded = true;
        else children = kids;
      }
    }
    stack.push({ node, children, next: 0 });
    ancestors.push(node);
  };
  enter(root);
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    if (frame.children !== null && frame.next < frame.children.length) {
      const child = frame.children[frame.next]!;
      frame.next += 1;
      enter(child);
    } else {
      stack.pop();
      ancestors.pop();
    }
  }
  return { depthExceeded };
}
