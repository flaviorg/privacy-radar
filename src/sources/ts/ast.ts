import type { Loc, TextRange } from "../../contracts/source-model.ts";
import { isNode, type AnyNode } from "./walk.ts";

export function child(node: AnyNode | null | undefined, key: string): AnyNode | null {
  const value = node?.[key];
  return isNode(value) ? value : null;
}

export function childList(node: AnyNode | null | undefined, key: string): AnyNode[] {
  const value = node?.[key];
  return Array.isArray(value) ? value.filter(isNode) : [];
}

export function stringProp(node: AnyNode | null | undefined, key: string): string | null {
  const value = node?.[key];
  return typeof value === "string" ? value : null;
}

export function boolProp(node: AnyNode | null | undefined, key: string): boolean {
  return node?.[key] === true;
}

export function rangeOf(node: AnyNode): TextRange {
  return { start: node.start ?? 0, end: node.end ?? 0 };
}

export function sliceOf(text: string, node: AnyNode): string {
  return text.slice(node.start ?? 0, node.end ?? 0);
}

export function locOf(node: AnyNode): Loc {
  const start = node.loc?.start;
  return start ? { line: start.line, column: start.column + 1 } : { line: 1, column: 1 };
}

export function endLineOf(node: AnyNode): number {
  return node.loc?.end.line ?? locOf(node).line;
}

/** Strips TS-only and grouping wrappers: `x as T`, `x satisfies T`, `x!`, `<T>x`, `(x)`. */
export function unwrap(node: AnyNode | null): AnyNode | null {
  let n = node;
  while (
    n &&
    (n.type === "TSAsExpression" ||
      n.type === "TSSatisfiesExpression" ||
      n.type === "TSNonNullExpression" ||
      n.type === "TSTypeAssertion" ||
      n.type === "TSInstantiationExpression" ||
      n.type === "ParenthesizedExpression")
  ) {
    n = child(n, "expression");
  }
  return n;
}

/** Name of a non-computed property key: identifier, string or number literal. */
export function keyName(owner: AnyNode): string | null {
  if (boolProp(owner, "computed")) return null;
  const key = child(owner, "key");
  if (!key) return null;
  if (key.type === "Identifier") return stringProp(key, "name");
  if (key.type === "StringLiteral") return stringProp(key, "value");
  if (key.type === "NumericLiteral") return String(key.value);
  if (key.type === "PrivateName") {
    const id = stringProp(child(key, "id"), "name");
    return id === null ? null : `#${id}`;
  }
  return null;
}

export const FUNCTION_TYPES: ReadonlySet<string> = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
]);

export function isFunctionLike(node: AnyNode | null): boolean {
  return node !== null && FUNCTION_TYPES.has(node.type);
}

/**
 * Callee-style chain text: `a.b.c`, `this.logger.error`, `getLogger().info`; computed access
 * becomes `[]` and anything else `<expr>`, so no literal text ever enters the chain.
 */
export function chainText(node: AnyNode | null): string {
  const n = unwrap(node);
  if (!n) return "<expr>";
  switch (n.type) {
    case "Identifier":
      return stringProp(n, "name") ?? "<expr>";
    case "ThisExpression":
      return "this";
    case "Super":
      return "super";
    case "MemberExpression":
    case "OptionalMemberExpression": {
      const object = chainText(child(n, "object"));
      if (boolProp(n, "computed")) return `${object}[]`;
      const property = child(n, "property");
      const name = property?.type === "PrivateName" ? `#${stringProp(child(property, "id"), "name") ?? ""}` : (stringProp(property, "name") ?? "<expr>");
      return `${object}.${name}`;
    }
    case "CallExpression":
    case "OptionalCallExpression":
      return `${chainText(child(n, "callee"))}()`;
    default:
      return "<expr>";
  }
}

/** A pure non-computed member chain rooted at an identifier (`patient.address.city`), else null. */
export function memberChain(node: AnyNode | null): { chain: string; root: string; last: string } | null {
  const n = unwrap(node);
  if (!n) return null;
  if (n.type === "Identifier") {
    const name = stringProp(n, "name");
    return name === null ? null : { chain: name, root: name, last: name };
  }
  if ((n.type === "MemberExpression" || n.type === "OptionalMemberExpression") && !boolProp(n, "computed")) {
    const property = child(n, "property");
    if (property?.type !== "Identifier") return null;
    const inner = memberChain(child(n, "object"));
    const last = stringProp(property, "name");
    if (!inner || last === null) return null;
    return { chain: `${inner.chain}.${last}`, root: inner.root, last };
  }
  return null;
}

/** Type name of an annotation: `Patient`, `Prisma.Patient` -> `Patient`; the first reference of a union. */
export function typeNameOf(annotation: AnyNode | null): string | null {
  let t = annotation;
  if (t?.type === "TSTypeAnnotation") t = child(t, "typeAnnotation");
  if (!t) return null;
  if (t.type === "TSTypeReference") {
    const name = child(t, "typeName");
    if (name?.type === "Identifier") return stringProp(name, "name");
    if (name?.type === "TSQualifiedName") return stringProp(child(name, "right"), "name");
    return null;
  }
  if (t.type === "TSUnionType") {
    for (const member of childList(t, "types")) {
      const name = typeNameOf(member);
      if (name !== null) return name;
    }
  }
  return null;
}
