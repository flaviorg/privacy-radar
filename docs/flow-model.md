# Flow model

privacy-radar follows personal data from a **source** to a **sink** inside one function body, with at most one local hop. It is deliberately small: the README says so, and every shape that is not detected has a negative test. Depth is the honesty line (ADR 0005).

This is not legal advice and not a complete assessment.

## Sources

Inside one function body, an expression is a source when:

1. **Name.** It is an identifier or a member chain whose last segment normalizes to a classified term (`patient.cpf`, `cpf`, `req.query.nif`, `body.diagnosis`).
2. **Type hint.** It is a parameter or local binding whose declared TypeScript type names an inventory entity with at least one deterministically classified field. `input: Patient` resolves to the Prisma model `Patient`, the source categories are the entity's deterministic categories and the evidence says `type-hint`. A member chain on a type-hinted entity contributes only its own category (`patient.cpf` gives `identifier.cpf`, never the whole entity).
3. **Object literal.** It is an object literal containing a property whose key classifies.

Module-scope `const` bindings count as locals for the hop. An LLM label never makes a source.

## Sinks

A call matched by `catalog/sinks.json` (log, http, analytics, file) or a URL or query-string construction (`url-query`). For `http` sinks the host comes from a string literal, a template literal with a literal prefix, or `new URL("literal")`. A relative URL is first-party and produces no third-party finding. A non-literal URL is `unresolved` and yields a `note` when a classified source reaches it. A literal host is matched against the 30 vendors by suffix.

## What is detected

### Direct

The source is an argument or sits inside an argument that is an object-literal value, an array element, a template interpolation, a `+` operand, or the argument of `JSON.stringify`, `String`, `util.inspect`, `util.format`, `.toString()` or a template tag.

```ts
function f(patient: Patient) {
  console.info("x", patient.cpf);          // log sink, identifier.cpf, hop null
}
```

Proved by `tests/unit/reach.unit.test.ts` (`[FLOW-03]`, one test per shape).

### One local hop

A local `const x = <expr>` (or `let`, `var`, or destructuring from a source) in the same function or at module scope, whose initializer contains a source, and `x` appears in the sink argument. The finding records `hop: { via: "x", line }`.

```ts
export function sync(patient: Patient) {
  const payload = { email: patient.email };  // the hop: payload
  console.log(payload);                       // contact.email reaches the log sink
}
```

Fixture `tests/fixtures/sources/one-hop.ts`; tests `[FLOW-04]` in `tests/unit/reach.unit.test.ts` and `[SRC-04]` in `tests/unit/ts-functions.unit.test.ts`.

### Spread

`{ ...patient }` in a sink argument counts as the whole entity, with evidence `spread`.

### Query strings

A URL or `URLSearchParams` built from a source is a `url-query` reach naming the parameter (`?nif=${p.nifPt}` gives parameter `nif`). Test `[FLOW-06]`.

## What is not detected

Where the last column names a test, it is a negative test: the scan reports no flow. The last two rows cannot be shown by a static scan and have no test.

| Not detected | Two-line example | Proved by |
|---|---|---|
| Two or more hops | `const first = patient.cpf; const second = { value: first }; console.log(second);` (`tests/fixtures/sources/two-hops.ts`) | `reach.unit` `[FLOW-05]` |
| A user-defined function in the path | `function format(p) { return \`${p.fullName} (${p.cpf})\`; } console.log(format(patient));` (`cross-function.ts`) | `reach.unit` `[FLOW-05]` |
| State set in one method and read in another | `save(p) { this.state = { v: p.cpf }; } dump() { console.log(this.state); }` | `reach.unit` `[FLOW-05]` |
| Dynamic property names | `console.log(p[key]);` | `reach.unit` `[FLOW-05]` |
| Strings built by `Array.join` | `console.log([p.cpf, p.email].join(","));` | `reach.unit` `[FLOW-05]` |
| A relative URL (first-party) | `await fetch("/api/patients", { method: "POST", body });` (`relative-url.ts`) | `rules.unit` (no third-party finding), `ts-functions.unit` `[SRC-04]` |
| A DTO that only describes a request body | `interface IntakeRequestDto { email: string; diagnosis: string }` (`dto-only.ts`) | `rules.unit`, `ts-entities.unit` |
| Values read from the database at runtime | no static trace exists | not applicable to a static scan |
| Closures that capture a variable assigned later | `let v; const f = () => log(v); v = p.cpf;` | outside the one-hop shapes |

A TypeScript or JavaScript file that Babel cannot recover (a missing `)` or `}`, an unterminated string) is skipped with one `PARSE_ERROR` warning and the scan continues. Nesting deeper than 300 nodes gives one `DEPTH_LIMIT` warning.

## Transfer status

`assessTransfer` applies, per regime and in this order: a domestic vendor is `domestic`; an adequate country is `adequate`; a mechanism declared in the config is `mechanism-declared` (wording: "mechanism declared in config: <mechanism>; verify the contract"); a conditional entry in the adequacy file is `conditional`; otherwise `needs-mechanism` ("verify DPF listing or SCCs" under GDPR, "needs LGPD art. 33 II or VIII evidence" under LGPD); an unknown host is `unknown-destination`. Under LGPD, `BR` is domestic; under GDPR the 30 EU/EEA codes in `catalog/adequacy.json` are domestic. With `--regime both` the severity uses the worst status of the two regimes. Statuses are dated by `checkedOn` and always worded as something to verify.
