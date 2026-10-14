import { LIMITS } from "../../contracts/limits.ts";
import type { Entity, EntityKind, Field, ScanWarning, TextRange } from "../../contracts/source-model.ts";
import { boolProp, child, childList, chainText, isFunctionLike, keyName, locOf, rangeOf, sliceOf, stringProp, unwrap } from "./ast.ts";
import { walk, type AnyNode } from "./walk.ts";
import { normalizeEntityName } from "../names.ts";

export { normalizeEntityName } from "../names.ts";

const LITERAL_TYPES = new Set(["StringLiteral", "NumericLiteral", "BooleanLiteral", "TemplateLiteral", "NullLiteral", "BigIntLiteral"]);

function commentOf(text: string, owner: AnyNode): { comment: string | null; commentRange: TextRange | null } {
  const comments = childList(owner, "leadingComments");
  const first = comments[0];
  const last = comments[comments.length - 1];
  if (!first || !last) return { comment: null, commentRange: null };
  const cleaned = comments
    .map((c) =>
      (stringProp(c, "value") ?? "")
        .split("\n")
        .map((line) => line.replace(/^\s*\*+\s?/, "").trim())
        .filter((line) => line.length > 0)
        .join(" "),
    )
    .filter((s) => s.length > 0)
    .join(" ");
  return { comment: cleaned.length > 0 ? cleaned : null, commentRange: { start: first.start ?? 0, end: last.end ?? 0 } };
}

function isArrayType(annotation: AnyNode | null): boolean {
  if (!annotation) return false;
  if (annotation.type === "TSArrayType") return true;
  if (annotation.type === "TSTypeOperator") return isArrayType(child(annotation, "typeAnnotation"));
  if (annotation.type === "TSTypeReference") {
    const name = stringProp(child(annotation, "typeName"), "name");
    return name === "Array" || name === "ReadonlyArray";
  }
  return false;
}

function baseField(text: string, owner: AnyNode, name: string): Field {
  const key = child(owner, "key")!;
  return {
    name,
    rawName: name,
    type: null,
    rawType: null,
    optional: boolProp(owner, "optional"),
    array: false,
    loc: locOf(key),
    attributes: [],
    ...commentOf(text, owner),
    defaultValue: null,
    defaultRange: null,
    declarationText: "",
  };
}

/** `TSPropertySignature` and `ClassProperty` share the annotation shape. */
function annotatedField(text: string, member: AnyNode): Field | null {
  const name = keyName(member);
  if (name === null) return null;
  const field = baseField(text, member, name);
  const annotation = child(child(member, "typeAnnotation"), "typeAnnotation");
  if (annotation) {
    field.rawType = sliceOf(text, annotation);
    field.type = field.rawType;
    field.array = isArrayType(annotation);
  }
  const value = child(member, "value");
  if (value && member.type !== "TSPropertySignature") {
    field.defaultValue = sliceOf(text, value);
    field.defaultRange = rangeOf(value);
  }
  return field;
}

/** Fields of an object literal: schema calls carry their expression as the type, literals as the default. */
function objectFields(text: string, object: AnyNode, schema: boolean): Field[] {
  const out: Field[] = [];
  for (const prop of childList(object, "properties")) {
    if (prop.type !== "ObjectProperty" && prop.type !== "ObjectMethod") continue;
    const name = keyName(prop);
    if (name === null) continue;
    const field = baseField(text, prop, name);
    const value = unwrap(child(prop, "value"));
    if (value) {
      const source = sliceOf(text, value);
      if (schema) {
        field.rawType = source;
        field.type = source;
        field.optional = /\.(optional|nullish)\(\)/.test(source);
        field.array = /^z\.array\(/.test(source) || value.type === "ArrayExpression" || /\.array\(\)$/.test(source);
      } else if (LITERAL_TYPES.has(value.type)) {
        field.defaultValue = source;
        field.defaultRange = rangeOf(value);
      }
    }
    out.push(field);
  }
  return out;
}

/** Names bound to functions at any level of the file (declarations and `const f = () => ...`). */
function functionNames(ast: AnyNode): Set<string> {
  const names = new Set<string>();
  walk(ast, (node) => {
    if (node.type === "FunctionDeclaration") {
      const name = stringProp(child(node, "id"), "name");
      if (name !== null) names.add(name);
    } else if (node.type === "VariableDeclarator" && isFunctionLike(unwrap(child(node, "init")))) {
      const name = stringProp(child(node, "id"), "name");
      if (name !== null) names.add(name);
    }
  });
  return names;
}

function allFunctionValued(object: AnyNode, fnNames: ReadonlySet<string>): boolean {
  const props = childList(object, "properties");
  if (props.length === 0) return false;
  return props.every((p) => {
    if (p.type === "ObjectMethod") return true;
    if (p.type !== "ObjectProperty") return false;
    const value = unwrap(child(p, "value"));
    if (isFunctionLike(value)) return true;
    return value?.type === "Identifier" && fnNames.has(stringProp(value, "name") ?? "");
  });
}

function schemaObjectArg(init: AnyNode | null): AnyNode | null {
  if (!init) return null;
  if (init.type === "CallExpression" && /(^|\.)object$/.test(chainText(child(init, "callee"))) && chainText(child(init, "callee")).startsWith("z.")) {
    const arg = unwrap(childList(init, "arguments")[0] ?? null);
    return arg?.type === "ObjectExpression" ? arg : null;
  }
  if (init.type === "NewExpression" && /(^|\.)Schema$/.test(chainText(child(init, "callee")))) {
    const arg = unwrap(childList(init, "arguments")[0] ?? null);
    return arg?.type === "ObjectExpression" ? arg : null;
  }
  return null;
}

/**
 * Entities of a TS/JS file (SRC-03): interfaces, type-literal aliases, classes with property
 * declarations, `z.object({...})` / `new Schema({...})` keys, and object literals assigned to an
 * exported `const` unless every property is function-valued. Positions are 1-based.
 */
export function extractEntities(ast: AnyNode, text: string, path = ""): { entities: Entity[]; warnings: ScanWarning[] } {
  const entities: Entity[] = [];
  const warnings: ScanWarning[] = [];
  const fnNames = functionNames(ast);

  const add = (idNode: AnyNode | null, kind: EntityKind, fields: Field[]) => {
    const name = stringProp(idNode, "name");
    if (!idNode || name === null) return;
    const loc = locOf(idNode);
    let kept = fields;
    if (fields.length > LIMITS.entityFields) {
      kept = fields.slice(0, LIMITS.entityFields);
      warnings.push({ file: path, line: loc.line, code: "ENTITY_TOO_LARGE", message: `entity ${name} has ${fields.length} fields; kept the first ${LIMITS.entityFields}` });
    }
    entities.push({ name, normalizedName: normalizeEntityName(name), kind, loc, fields: kept, protectionHints: [] });
  };

  walk(ast, (node, ancestors) => {
    switch (node.type) {
      case "TSInterfaceDeclaration": {
        const members = childList(child(node, "body"), "body").filter((m) => m.type === "TSPropertySignature");
        add(child(node, "id"), "interface", members.flatMap((m) => annotatedField(text, m) ?? []));
        return undefined;
      }
      case "TSTypeAliasDeclaration": {
        const literal = child(node, "typeAnnotation");
        if (literal?.type === "TSTypeLiteral") {
          const members = childList(literal, "members").filter((m) => m.type === "TSPropertySignature");
          add(child(node, "id"), "type", members.flatMap((m) => annotatedField(text, m) ?? []));
        }
        return undefined;
      }
      case "ClassDeclaration":
      case "ClassExpression": {
        const props = childList(child(node, "body"), "body").filter((m) => (m.type === "ClassProperty" || m.type === "ClassAccessorProperty") && !boolProp(m, "static"));
        if (props.length > 0) {
          const id = child(node, "id") ?? (ancestors[ancestors.length - 1]?.type === "VariableDeclarator" ? child(ancestors[ancestors.length - 1]!, "id") : null);
          add(id, "class", props.flatMap((m) => annotatedField(text, m) ?? []));
        }
        return undefined;
      }
      case "VariableDeclarator": {
        const id = child(node, "id");
        if (id?.type !== "Identifier") return undefined;
        const init = unwrap(child(node, "init"));
        const schema = schemaObjectArg(init);
        if (schema) {
          add(id, "object", objectFields(text, schema, true));
          return undefined;
        }
        const declaration = ancestors[ancestors.length - 1];
        const exported = ancestors[ancestors.length - 2]?.type === "ExportNamedDeclaration";
        if (init?.type === "ObjectExpression" && exported && stringProp(declaration ?? null, "kind") === "const" && !allFunctionValued(init, fnNames)) {
          add(id, "object", objectFields(text, init, false));
        }
        return undefined;
      }
      default:
        return undefined;
    }
  });
  return { entities, warnings };
}
