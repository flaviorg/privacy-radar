# ADR 0002: @babel/parser with an in-repo iterative walker

Status: accepted (2026-10-08, design spec; recorded as an ADR on 2026-10-14)
Decision ids: D-05

## Context

The TS/JS source needs a parser that handles TypeScript, JSX and NestJS parameter decorators, reports line and column, recovers from some errors and does not drag in a large dependency tree.

Babel overflows the stack at about 450 nested expressions, and a scanner must survive a hostile repository.

## Decision

- Use `@babel/parser` 8.0.7 with `sourceType: "module"`, `errorRecovery: true` and a plugin set per extension (`typescript` + `decorators-legacy` for `.ts`, plus `jsx` for `.tsx`, `jsx` + `decorators-legacy` without `typescript` for `.js`).
- Walk the tree with a small iterative walker (about 70 lines, explicit stack, depth cap 300) instead of `@babel/traverse`.
- Catch `RangeError` and any unrecoverable `SyntaxError`: the file is skipped with a `DEPTH_LIMIT` or `PARSE_ERROR` warning and the scan continues. Only the reason code and position are reported, because a Babel message can quote source text.

## Consequences

- Good: pure JavaScript, three tiny transitive packages, exact positions, and a walker whose depth is bounded by us.
- Cost: a missing `)` or `}` still throws under 8.0.7, so a file with such an error is skipped, not partly scanned. The README says so.
- Cost: one plugin set cannot serve both `.js` with JSX and `.ts` with generic casts, so the set depends on the extension.

## Alternatives

- `@typescript-eslint/typescript-estree` 8.71.1: rejected, peer `typescript <6.1.0` is incompatible with TypeScript 7.
- `oxc-parser` 0.153.0: rejected for v0.1, native binding and 0.x churn; a possible M9 adapter if scan time on large repositories becomes a problem.
- `@babel/traverse`: rejected, fifteen transitive packages for what a small walker does.
