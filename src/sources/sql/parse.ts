import { parse } from "pgsql-ast-parser";
import { LIMITS } from "../../contracts/limits.ts";
import type { Entity, Field, LiteralBinding, ScanWarning, SourceFile, TextRange } from "../../contracts/source-model.ts";
import { lineTable, normalizeEntityName, type LineTable } from "../names.ts";
import { splitStatements, type SqlStatement } from "./split.ts";

/** pgsql-ast-parser output, read through small accessors (its node unions are not needed here). */
type Node = { readonly [key: string]: unknown };

const obj = (v: unknown): Node | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Node) : null);
const list = (v: unknown): Node[] => (Array.isArray(v) ? v.flatMap((x) => (obj(x) ? [x as Node] : [])) : []);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const range = (n: Node | null): TextRange | null => {
  const loc = obj(n?.["_location"]);
  return loc && typeof loc["start"] === "number" && typeof loc["end"] === "number" ? { start: loc["start"], end: loc["end"] } : null;
};

const CREATE_TABLE = /^CREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:(?:TEMP|TEMPORARY|UNLOGGED)\s+)?TABLE\b/i;
const ALTER_TABLE = /^ALTER\s+TABLE\b/i;
const INSERT = /^INSERT\b/i;
const RLS = /ALTER\s+TABLE\s+(?:ONLY\s+)?([\w."]+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i;
const OTHER_DIALECT = /`|ENGINE\s*=|AUTO_INCREMENT\s*=/i;
const LITERAL_TYPES = new Set(["string", "integer", "numeric"]);

const CONSTRAINT_ATTRIBUTE: Readonly<Record<string, string>> = {
  "primary key": "primary key",
  "not null": "not null",
  unique: "unique",
  reference: "references",
  default: "default",
  check: "check",
};

type Ctx = { rel: string; text: string; lines: LineTable };

/** The last segment of a possibly schema-qualified, possibly quoted name. */
function bareName(raw: string): string {
  const last = raw.split(".").pop() ?? raw;
  return last.replace(/^"|"$/g, "");
}

function columnField(ctx: Ctx, column: Node, offset: number): Field | null {
  const nameNode = obj(column["name"]);
  const name = str(nameNode?.["name"]);
  const nameRange = range(nameNode);
  if (name === null || nameRange === null) return null;
  let dataType = obj(column["dataType"]);
  let array = false;
  while (dataType && str(dataType["kind"]) === "array") {
    array = true;
    dataType = obj(dataType["arrayOf"]);
  }
  const type = str(dataType?.["name"]);
  const attributes: string[] = [];
  let defaultValue: string | null = null;
  let defaultRange: TextRange | null = null;
  for (const c of list(column["constraints"])) {
    const t = str(c["type"]) ?? "";
    const attr = CONSTRAINT_ATTRIBUTE[t];
    if (attr !== undefined && !attributes.includes(attr)) attributes.push(attr);
    if (t === "default") {
      const r = range(obj(c["default"]));
      if (r) {
        defaultRange = { start: r.start + offset, end: r.end + offset };
        defaultValue = ctx.text.slice(defaultRange.start, defaultRange.end);
      }
    }
  }
  const start = nameRange.start + offset;
  return {
    name,
    rawName: ctx.text.slice(start, nameRange.end + offset),
    type,
    rawType: type,
    optional: !attributes.includes("not null") && !attributes.includes("primary key"),
    array,
    loc: ctx.lines.locOf(start),
    attributes,
    comment: null,
    commentRange: null,
    defaultValue,
    defaultRange,
    declarationText: "",
  };
}

function bindingAt(ctx: Ctx, bindingName: string, r: TextRange): LiteralBinding {
  const loc = ctx.lines.locOf(r.start);
  return { bindingName, start: r.start, end: r.end, line: loc.line, column: loc.column };
}

/** One binding per value literal, named by its column by position; `*` without a column list (Spec delta 1). */
function insertBindings(ctx: Ctx, stmt: Node, s: SqlStatement): LiteralBinding[] {
  const insert = obj(stmt["insert"]);
  if (str(insert?.["type"]) !== "values") return s.quoteRanges.map((r) => bindingAt(ctx, "*", r));
  const columns = list(stmt["columns"]).map((c) => str(c["name"]));
  const out: LiteralBinding[] = [];
  for (const row of Array.isArray(insert?.["values"]) ? (insert["values"] as unknown[]) : []) {
    list(row).forEach((cell, i) => {
      let value: Node | null = cell;
      if (str(value["type"]) === "cast") value = obj(value["operand"]);
      if (!value || !LITERAL_TYPES.has(str(value["type"]) ?? "")) return;
      const r = range(value);
      if (!r) return;
      out.push(bindingAt(ctx, columns[i] ?? "*", { start: r.start + s.start, end: r.end + s.start }));
    });
  }
  return out;
}

type Comment = { table: string; column: string; text: string; range: TextRange | null };

/**
 * PostgreSQL adapter (SCH-01, SCH-02, SCH-05): `CREATE TABLE` entities with `ALTER TABLE ... ADD
 * COLUMN` and `COMMENT ON COLUMN` merged in, the `rls` hint, `INSERT` literal bindings by column
 * position. Each statement is parsed on its own inside a `try`; nothing escapes.
 */
export function parseSqlSource(rel: string, text: string): SourceFile {
  const ctx: Ctx = { rel, text, lines: lineTable(text) };
  const entities: Entity[] = [];
  const literalBindings: LiteralBinding[] = [];
  const warnings: ScanWarning[] = [];
  const comments: Comment[] = [];
  const rlsTables: string[] = [];
  let ddlFailed = false;

  const entityNamed = (name: string): Entity | null =>
    entities.find((e) => e.name === name) ?? entities.find((e) => e.normalizedName === normalizeEntityName(name)) ?? null;

  for (const s of splitStatements(text)) {
    let statements: Node[];
    try {
      statements = list(parse(s.text, { locationTracking: true }) as unknown);
    } catch {
      const rls = RLS.exec(s.text);
      if (rls) {
        rlsTables.push(bareName(rls[1]!));
      } else if (CREATE_TABLE.test(s.text) || ALTER_TABLE.test(s.text)) {
        ddlFailed = true;
        const line = ctx.lines.locOf(s.start).line;
        warnings.push({ file: rel, line, code: "PARSE_ERROR", message: `SQL statement at line ${line} could not be parsed; skipped` });
      } else if (INSERT.test(s.text)) {
        literalBindings.push(...s.quoteRanges.map((r) => bindingAt(ctx, "*", r)));
      }
      continue;
    }
    for (const stmt of statements) {
      const type = str(stmt["type"]);
      if (type === "create table") {
        const nameNode = obj(stmt["name"]);
        const name = str(nameNode?.["name"]);
        const r = range(nameNode);
        if (name === null || r === null) continue;
        const fields = list(stmt["columns"])
          .filter((c) => str(c["kind"]) === "column")
          .flatMap((c) => columnField(ctx, c, s.start) ?? []);
        entities.push({ name, normalizedName: normalizeEntityName(name), kind: "table", loc: ctx.lines.locOf(r.start + s.start), fields, protectionHints: [] });
      } else if (type === "alter table") {
        const tableNode = obj(stmt["table"]);
        const name = str(tableNode?.["name"]);
        const r = range(tableNode);
        if (name === null || r === null) continue;
        const added = list(stmt["changes"])
          .filter((c) => str(c["type"]) === "add column")
          .flatMap((c) => {
            const column = obj(c["column"]);
            return column ? (columnField(ctx, column, s.start) ?? []) : [];
          });
        if (added.length === 0) continue;
        let entity = entityNamed(name);
        if (!entity) {
          entity = { name, normalizedName: normalizeEntityName(name), kind: "table", loc: ctx.lines.locOf(r.start + s.start), fields: [], protectionHints: [] };
          entities.push(entity);
        }
        entity.fields.push(...added);
      } else if (type === "comment") {
        const on = obj(stmt["on"]);
        const column = obj(on?.["column"]);
        const table = str(column?.["table"]);
        const col = str(column?.["column"]);
        const body = str(stmt["comment"]);
        if (str(on?.["type"]) !== "column" || table === null || col === null || body === null) continue;
        const last = s.quoteRanges[s.quoteRanges.length - 1];
        const inner = last ? { start: text[last.start] === "'" ? last.start + 1 : last.start + 2, end: last.end - 1 } : null;
        comments.push({ table, column: col, text: body, range: inner });
      } else if (type === "insert") {
        literalBindings.push(...insertBindings(ctx, stmt, s));
      }
    }
  }

  if (ddlFailed && OTHER_DIALECT.test(text)) {
    return {
      path: rel,
      kind: "sql",
      entities: [],
      functions: [],
      literalBindings,
      warnings: [{ file: rel, code: "UNSUPPORTED_DIALECT", message: "the file looks like MySQL (backticks, ENGINE= or AUTO_INCREMENT=); only PostgreSQL DDL is supported" }],
    };
  }

  for (const c of comments) {
    const field = entityNamed(c.table)?.fields.find((f) => f.name === c.column);
    if (field) {
      field.comment = c.text;
      field.commentRange = c.range;
    }
  }
  for (const table of rlsTables) {
    const entity = entityNamed(table);
    if (entity && !entity.protectionHints.includes("rls")) entity.protectionHints.push("rls");
  }
  for (const e of entities) {
    if (e.fields.length > LIMITS.entityFields) {
      warnings.push({ file: rel, line: e.loc.line, code: "ENTITY_TOO_LARGE", message: `entity ${e.name} has ${e.fields.length} fields; kept the first ${LIMITS.entityFields}` });
      e.fields = e.fields.slice(0, LIMITS.entityFields);
    }
  }
  return { path: rel, kind: "sql", entities, functions: [], literalBindings, warnings };
}
