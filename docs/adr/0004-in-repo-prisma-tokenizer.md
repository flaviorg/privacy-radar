# ADR 0004: An in-repo Prisma tokenizer

Status: accepted (2026-10-08, design spec; recorded as an ADR on 2026-10-14)
Decision ids: D-04 and Review focus 3

## Context

`schema.prisma` declares the models a Node team really has. The ready-made parser `@mrleebo/prisma-ast` 0.16.0 gives no line or column on its nodes and brings `chevrotain` and `lilconfig`.

The grammar the scanner uses is small: `model`, `enum`, fields, attributes, block attributes and `///` doc comments.

## Decision

- Write a small tokenizer and parser (about 270 lines) under `src/sources/prisma/` that returns exact line and column per field, the `@default("...")` literals as literal bindings (binding name = the field name) and the comments.
- `type`, `view` and `generator` blocks are skipped on purpose. Every `*.prisma` file is scanned and merged, so Prisma 6 multi-file schemas (`prisma/schema/*.prisma`) work.

## Consequences

- Good: no new dependency, exact positions, CRLF and BOM handled by the same code as the other sources.
- Cost: a Prisma feature outside the small grammar is invisible until the tokenizer learns it; the revisit trigger is a real-world schema that fails.

## Alternatives

- `@mrleebo/prisma-ast` 0.16.0 plus line recovery: rejected, three more packages for positions we can get directly.
- The official Prisma schema tooling: rejected, a heavier dependency for a CLI that only needs names, types and positions.
