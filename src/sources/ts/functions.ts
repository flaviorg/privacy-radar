import type { ArgModel, Binding, CallSite, FunctionModel, LiteralBinding, Param, QueryBuild, RefContext, RefModel, TextRange } from "../../contracts/source-model.ts";
import { child, childList, chainText, endLineOf, isFunctionLike, keyName, locOf, memberChain, rangeOf, sliceOf, stringProp, typeNameOf, unwrap } from "./ast.ts";
import { walk, type AnyNode } from "./walk.ts";

/** Calls whose arguments are followed (spec 5.4 rule 1); any other call is opaque (FLOW-05). */
const WRAPPERS = new Set(["JSON.stringify", "String", "util.inspect", "util.format"]);
const QUERY_PARAM = /[?&]([A-Za-z0-9_.-]+)=$/;
const WRAPPER_TYPES = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion", "TSInstantiationExpression", "ParenthesizedExpression"]);

function ref(chain: { chain: string; root: string; last: string }, node: AnyNode, context: RefContext): RefModel {
  return { chain: chain.chain, root: chain.root, last: chain.last, loc: locOf(node), context };
}

/**
 * References of the allowed shapes inside an expression: identifiers and non-computed member chains
 * (not rooted at `this`), object property values and keys, array elements, template interpolations,
 * `+` operands, wrapper calls (`JSON.stringify`, `String`, `util.inspect`, `util.format`,
 * `.toString()`), tagged templates and spreads. Function bodies and other calls are not entered.
 */
export function refsOf(node: AnyNode | null, context: RefContext = "direct"): RefModel[] {
  const n = unwrap(node);
  if (!n) return [];
  switch (n.type) {
    case "Identifier":
    case "MemberExpression":
    case "OptionalMemberExpression": {
      const chain = memberChain(n);
      return chain ? [ref(chain, n, context)] : [];
    }
    case "ObjectExpression":
      return childList(n, "properties").flatMap((prop) => {
        if (prop.type === "SpreadElement") return refsOf(child(prop, "argument"), "spread");
        if (prop.type !== "ObjectProperty") return [];
        const name = keyName(prop);
        const key = child(prop, "key");
        const keyRef = name !== null && key ? [ref({ chain: name, root: name, last: name }, key, "key")] : [];
        return [...keyRef, ...refsOf(child(prop, "value"), "direct")];
      });
    case "ArrayExpression":
      return childList(n, "elements").flatMap((el) => (el.type === "SpreadElement" ? refsOf(child(el, "argument"), "spread") : refsOf(el, context)));
    case "TemplateLiteral":
      return childList(n, "expressions").flatMap((e) => refsOf(e, context));
    case "TaggedTemplateExpression":
      return refsOf(child(n, "quasi"), context);
    case "BinaryExpression":
      return stringProp(n, "operator") === "+" ? [...refsOf(child(n, "left"), context), ...refsOf(child(n, "right"), context)] : [];
    case "CallExpression":
    case "OptionalCallExpression": {
      const callee = unwrap(child(n, "callee"));
      if (WRAPPERS.has(chainText(callee))) return childList(n, "arguments").flatMap((a) => (a.type === "SpreadElement" ? refsOf(child(a, "argument"), "spread") : refsOf(a, context)));
      const isMember = callee?.type === "MemberExpression" || callee?.type === "OptionalMemberExpression";
      if (isMember && callee["computed"] !== true && stringProp(child(callee, "property"), "name") === "toString" && childList(n, "arguments").length === 0) {
        return refsOf(child(callee, "object"), context);
      }
      return [];
    }
    default:
      return [];
  }
}

function functionName(node: AnyNode, ancestors: readonly AnyNode[]): string {
  const own = stringProp(child(node, "id"), "name");
  if (own !== null) return own;
  if (node.type === "ObjectMethod" || node.type === "ClassMethod" || node.type === "ClassPrivateMethod") return keyName(node) ?? "<anonymous>";
  let i = ancestors.length - 1;
  while (i >= 0 && WRAPPER_TYPES.has(ancestors[i]!.type)) i--;
  const parent = ancestors[i];
  if (!parent) return "<anonymous>";
  switch (parent.type) {
    case "VariableDeclarator":
      return stringProp(child(parent, "id"), "name") ?? "<anonymous>";
    case "ObjectProperty":
    case "ClassProperty":
    case "ClassPrivateProperty":
      return keyName(parent) ?? "<anonymous>";
    case "AssignmentExpression":
      return memberChain(child(parent, "left"))?.last ?? "<anonymous>";
    case "ExportDefaultDeclaration":
      return "default";
    default:
      return "<anonymous>";
  }
}

function paramsOf(node: AnyNode): Param[] {
  const out: Param[] = [];
  const add = (id: AnyNode | null, annotationOwner: AnyNode | null) => {
    if (id?.type !== "Identifier") return;
    const name = stringProp(id, "name");
    if (name !== null) out.push({ name, typeName: typeNameOf(child(annotationOwner ?? id, "typeAnnotation")), loc: locOf(id) });
  };
  for (const raw of childList(node, "params")) {
    const p = raw.type === "TSParameterProperty" ? child(raw, "parameter") : raw;
    if (!p) continue;
    if (p.type === "Identifier") add(p, null);
    else if (p.type === "AssignmentPattern") add(child(p, "left"), null);
    else if (p.type === "RestElement") add(child(p, "argument"), p);
    else if (p.type === "ObjectPattern") {
      for (const prop of childList(p, "properties")) {
        const value = prop.type === "RestElement" ? child(prop, "argument") : child(prop, "value");
        const id = value?.type === "AssignmentPattern" ? child(value, "left") : value;
        if (id?.type === "Identifier") out.push({ name: stringProp(id, "name") ?? "", typeName: null, loc: locOf(id) });
      }
    }
  }
  return out;
}

function bindingFrom(text: string, id: AnyNode, init: AnyNode, refs: RefModel[], typeName: string | null): Binding {
  return {
    name: stringProp(id, "name") ?? "",
    loc: locOf(id),
    initializerText: sliceOf(text, init),
    initRange: rangeOf(init),
    refersTo: refs.map((r) => r.chain),
    typeName,
    refs,
  };
}

function bindingsOf(text: string, declarator: AnyNode): Binding[] {
  const id = child(declarator, "id");
  const init = child(declarator, "init");
  if (!id || !init) return [];
  if (id.type === "Identifier") return [bindingFrom(text, id, init, refsOf(init), typeNameOf(child(id, "typeAnnotation")))];
  if (id.type === "ObjectPattern") {
    const source = memberChain(init);
    return childList(id, "properties").flatMap((prop) => {
      if (prop.type === "RestElement") {
        const rest = child(prop, "argument");
        return rest?.type === "Identifier" ? [bindingFrom(text, rest, init, refsOf(init), null)] : [];
      }
      const value = child(prop, "value");
      const target = value?.type === "AssignmentPattern" ? child(value, "left") : value;
      const key = keyName(prop);
      if (target?.type !== "Identifier" || key === null) return [];
      const refs = source ? [ref({ chain: `${source.chain}.${key}`, root: source.root, last: key }, child(prop, "key")!, "direct")] : refsOf(init);
      return [bindingFrom(text, target, init, refs, null)];
    });
  }
  if (id.type === "ArrayPattern") {
    return childList(id, "elements").flatMap((el) => {
      const target = el.type === "AssignmentPattern" ? child(el, "left") : el.type === "RestElement" ? child(el, "argument") : el;
      return target?.type === "Identifier" ? [bindingFrom(text, target, init, refsOf(init), null)] : [];
    });
  }
  return [];
}

function urlOf(first: AnyNode | null): { text: string; range: TextRange } | null {
  const n = unwrap(first);
  if (!n) return null;
  if (n.type === "StringLiteral") return { text: stringProp(n, "value") ?? "", range: rangeOf(n) };
  if (n.type === "TemplateLiteral") {
    const quasis = childList(n, "quasis").map((q) => {
      const value = q["value"] as { cooked?: string | null; raw?: string } | undefined;
      return value?.cooked ?? value?.raw ?? "";
    });
    return { text: quasis.join("${}"), range: rangeOf(n) };
  }
  if (n.type === "NewExpression" && chainText(child(n, "callee")) === "URL") {
    const inner = unwrap(childList(n, "arguments")[0] ?? null);
    if (inner && (inner.type === "StringLiteral" || inner.type === "TemplateLiteral")) return urlOf(inner);
  }
  return null;
}

function callSite(call: AnyNode): CallSite {
  const args: ArgModel[] = childList(call, "arguments").map((a) => ({
    loc: locOf(a),
    range: rangeOf(a),
    refs: a.type === "SpreadElement" ? refsOf(child(a, "argument"), "spread") : refsOf(a),
  }));
  const url = urlOf(childList(call, "arguments")[0] ?? null);
  return { calleeText: chainText(child(call, "callee")), loc: locOf(call), args, urlText: url?.text ?? null, urlRange: url?.range ?? null };
}

function cookedText(node: AnyNode): string | null {
  if (node.type === "StringLiteral") return stringProp(node, "value");
  if (node.type === "TemplateLiteral") {
    const quasis = childList(node, "quasis");
    const last = quasis[quasis.length - 1];
    const value = last?.["value"] as { cooked?: string | null; raw?: string } | undefined;
    return value?.cooked ?? value?.raw ?? null;
  }
  return null;
}

function flattenPlus(node: AnyNode): AnyNode[] {
  const n = unwrap(node);
  if (n?.type === "BinaryExpression" && stringProp(n, "operator") === "+") return [...flattenPlus(child(n, "left")!), ...flattenPlus(child(n, "right")!)];
  return n ? [n] : [];
}

function queryBuild(param: string, at: AnyNode, value: AnyNode, via: QueryBuild["via"]): QueryBuild {
  return { param, loc: locOf(at), range: rangeOf(value), refs: refsOf(value), via };
}

function isPlus(node: AnyNode | undefined): boolean {
  return node?.type === "BinaryExpression" && stringProp(node, "operator") === "+";
}

/**
 * One `FunctionModel` per function-like node (declarations, expressions, arrows, methods) plus
 * `<module>` for module scope. Each node belongs to its nearest enclosing function.
 */
export function extractFunctions(ast: AnyNode, text: string): FunctionModel[] {
  const program = child(ast, "program") ?? ast;
  const moduleModel: FunctionModel = { name: "<module>", loc: { line: 1, column: 1 }, endLine: endLineOf(program), params: [], bindings: [], calls: [], queryBuilds: [] };
  const models = new Map<AnyNode, FunctionModel>();
  const searchParamNames = new Map<FunctionModel, Set<string>>();
  const order: FunctionModel[] = [moduleModel];

  const ownerOf = (ancestors: readonly AnyNode[]): FunctionModel => {
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const m = models.get(ancestors[i]!);
      if (m) return m;
    }
    return moduleModel;
  };

  walk(ast, (node, ancestors) => {
    const owner = ownerOf(ancestors);
    if (isFunctionLike(node)) {
      const model: FunctionModel = { name: functionName(node, ancestors), loc: locOf(node), endLine: endLineOf(node), params: paramsOf(node), bindings: [], calls: [], queryBuilds: [] };
      models.set(node, model);
      order.push(model);
      return undefined;
    }
    switch (node.type) {
      case "VariableDeclarator":
        owner.bindings.push(...bindingsOf(text, node));
        break;
      case "CallExpression":
      case "OptionalCallExpression": {
        owner.calls.push(callSite(node));
        const callee = unwrap(child(node, "callee"));
        const method = callee && (callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") && !callee["computed"] ? stringProp(child(callee, "property"), "name") : null;
        const [nameArg, valueArg] = childList(node, "arguments");
        if ((method === "set" || method === "append") && nameArg?.type === "StringLiteral" && valueArg) {
          const object = unwrap(child(callee, "object"));
          const objectChain = chainText(object);
          const known = object?.type === "Identifier" && (searchParamNames.get(owner)?.has(stringProp(object, "name") ?? "") ?? false);
          if (objectChain === "searchParams" || objectChain.endsWith(".searchParams") || known) {
            owner.queryBuilds.push(queryBuild(stringProp(nameArg, "value") ?? "", node, valueArg, "url-search-params"));
          }
        }
        break;
      }
      case "NewExpression": {
        if (chainText(child(node, "callee")) !== "URLSearchParams") break;
        const parent = ancestors[ancestors.length - 1];
        const boundTo = parent?.type === "VariableDeclarator" ? stringProp(child(parent, "id"), "name") : null;
        if (boundTo !== null) {
          const names = searchParamNames.get(owner) ?? new Set<string>();
          names.add(boundTo);
          searchParamNames.set(owner, names);
        }
        const init = unwrap(childList(node, "arguments")[0] ?? null);
        if (init?.type === "ObjectExpression") {
          for (const prop of childList(init, "properties")) {
            const name = prop.type === "ObjectProperty" ? keyName(prop) : null;
            const value = child(prop, "value");
            if (name !== null && value) owner.queryBuilds.push(queryBuild(name, child(prop, "key")!, value, "url-search-params"));
          }
        }
        break;
      }
      case "TemplateLiteral": {
        const quasis = childList(node, "quasis");
        childList(node, "expressions").forEach((expr, i) => {
          const q = quasis[i];
          const value = q?.["value"] as { cooked?: string | null; raw?: string } | undefined;
          const param = QUERY_PARAM.exec(value?.cooked ?? value?.raw ?? "")?.[1];
          if (param !== undefined) owner.queryBuilds.push(queryBuild(param, expr, expr, "template"));
        });
        break;
      }
      case "BinaryExpression": {
        if (!isPlus(node) || isPlus(ancestors[ancestors.length - 1])) break;
        const operands = flattenPlus(node);
        for (let i = 1; i < operands.length; i++) {
          const prev = operands[i - 1]!;
          const cur = operands[i]!;
          if (cur.type === "StringLiteral" || cur.type === "NumericLiteral") continue;
          const before = cookedText(prev);
          const param = before === null ? undefined : QUERY_PARAM.exec(before)?.[1];
          if (param !== undefined) owner.queryBuilds.push(queryBuild(param, cur, cur, "concat"));
        }
        break;
      }
      default:
        break;
    }
    return undefined;
  });
  return order;
}

const LITERAL_TYPES = new Set(["StringLiteral", "NumericLiteral", "TemplateLiteral"]);

/** The name a literal is bound to, from the closest non-wrapper ancestor, or null. */
function bindingNameOf(literal: AnyNode, ancestors: readonly AnyNode[]): string | null {
  let i = ancestors.length - 1;
  while (i >= 0 && WRAPPER_TYPES.has(ancestors[i]!.type)) i--;
  const container = ancestors[i];
  if (!container) return null;
  const is = (key: string) => unwrap(child(container, key)) === literal;
  switch (container.type) {
    case "ObjectProperty":
    case "ClassProperty":
    case "ClassPrivateProperty":
      return is("value") ? keyName(container) : null;
    case "VariableDeclarator":
      return is("init") ? stringProp(child(container, "id"), "name") : null;
    case "AssignmentExpression":
      return is("right") ? (memberChain(child(container, "left"))?.last ?? null) : null;
    case "AssignmentPattern":
      return is("right") ? stringProp(child(container, "left"), "name") : null;
    default:
      return null;
  }
}

/**
 * String, number and template literals bound to a name (SRC-08): object property values, variable
 * initializers, assignment right-hand sides (also class fields and parameter defaults). Structure
 * only: the name is not classified here.
 */
export function extractLiteralBindings(ast: AnyNode): LiteralBinding[] {
  const out: LiteralBinding[] = [];
  walk(ast, (node, ancestors) => {
    if (!LITERAL_TYPES.has(node.type)) return undefined;
    const name = bindingNameOf(node, ancestors);
    if (name !== null) {
      const loc = locOf(node);
      out.push({ bindingName: name, start: node.start ?? 0, end: node.end ?? 0, line: loc.line, column: loc.column });
    }
    return undefined;
  });
  return out.sort((a, b) => a.start - b.start);
}
