import type { Reach, SinkCall, SourceCategory, SourceIndex } from "../contracts/flows.ts";
import type { Binding, FunctionModel, Loc, RefModel } from "../contracts/source-model.ts";

type Scope = "function" | "module";

/**
 * Categories that reach a sink call (spec 5.4): first the references found directly in the sink's
 * arguments (`hop: null`), then exactly one hop through a binding of the same function or of module
 * scope whose initializer holds a source. Member-chain precedence: a chain whose last segment
 * classifies contributes only those categories (with the type-hinted entity's field confidence when
 * the root is type-hinted); a bare type-hinted identifier contributes all of its entity's categories
 * (`type-hint`, or `spread` inside `{ ...x }`); an object key contributes its own categories (`key`).
 * One `Reach` per category, keeping the highest confidence (the first one on a tie).
 */
export function reach(fn: FunctionModel, sink: SinkCall, sources: SourceIndex, moduleBindings: readonly Binding[]): Reach[] {
  const isModule = fn.name === "<module>";
  const localBinding = (name: string) => fn.bindings.find((b) => b.name === name) ?? null;
  const isParam = (name: string) => fn.params.some((p) => p.name === name);
  const moduleBinding = (name: string) => moduleBindings.find((b) => b.name === name) ?? null;

  const typeOf = (name: string, scope: Scope): string | null => {
    if (scope === "function" && !isModule) {
      const param = fn.params.find((p) => p.name === name);
      if (param) return param.typeName;
      const local = localBinding(name);
      if (local) return local.typeName;
    }
    return moduleBinding(name)?.typeName ?? null;
  };

  const bindingOf = (name: string): { binding: Binding; scope: Scope } | null => {
    const local = localBinding(name);
    if (local) return { binding: local, scope: isModule ? "module" : "function" };
    if (isParam(name)) return null;
    const global = moduleBinding(name);
    return global ? { binding: global, scope: "module" } : null;
  };

  const categoriesOf = (ref: RefModel, scope: Scope): SourceCategory[] => {
    if (ref.context === "key") return sources.byName(ref.last).map((c) => ({ ...c, evidence: "key" }));
    const typeName = typeOf(ref.root, scope);
    const typed = typeName === null ? null : sources.byType(typeName);
    if (ref.chain !== ref.root) {
      const fromEntity = typed?.field(ref.last) ?? [];
      return fromEntity.length > 0 ? fromEntity : sources.byName(ref.last);
    }
    if (typed) return typed.all.map((c) => ({ ...c, evidence: ref.context === "spread" ? "spread" : "type-hint" }));
    return sources.byName(ref.last);
  };

  const found = new Map<string, Reach>();
  const add = (c: SourceCategory, ref: RefModel, hop: { via: string; loc: Loc } | null) => {
    const prev = found.get(c.category);
    if (prev && prev.source.confidence >= c.confidence) return;
    found.set(c.category, {
      source: { category: c.category, expressionText: ref.chain, loc: ref.loc, confidence: c.confidence, evidence: c.evidence, entity: c.entity, field: c.field },
      sink,
      hop,
    });
  };

  const refs = sink.args.flatMap((a) => a.refs);
  for (const ref of refs) for (const c of categoriesOf(ref, "function")) add(c, ref, null);
  for (const ref of refs) {
    if (ref.context === "key" || ref.chain !== ref.root) continue;
    const bound = bindingOf(ref.root);
    if (!bound) continue;
    const hop = { via: bound.binding.name, loc: bound.binding.loc };
    for (const inner of bound.binding.refs) for (const c of categoriesOf(inner, bound.scope)) add(c, inner, hop);
  }
  return [...found.values()];
}
