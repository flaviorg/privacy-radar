# ADR 0006: PR mode scans the full tree of both revisions

Status: accepted (2026-10-08, design spec; recorded as an ADR on 2026-10-14)
Decision ids: D-13

## Context

A pull request comment should say what the change introduces. Findings depend on cross-file context: a change to `schema.prisma` alone alters the type-hinted sources of unchanged TypeScript files.

## Decision

- List changed files with `git diff -z --name-only --diff-filter=ACMR <base>...<head>`. If none is a supported kind, skip both scans and say so. Otherwise export the full tree of each revision into a temporary directory (`GIT_INDEX_FILE=<tmp>/index git read-tree` then `git checkout-index -a --prefix=`), scan each tree as a normal target with deterministic rules only, and diff the findings as multisets of a stable key.
- Refs are validated with `git rev-parse --verify --end-of-options <ref>^{commit}` and a ref starting with `-` is rejected before any other Git call. Every Git call runs with `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`.

## Consequences

- Good: the schema-only change test proves the cross-file case; the repository's own index and work tree are never touched.
- Cost: two full scans per PR. If this becomes slow, cache the base scan by tree SHA.
- Cost: the changed-file cap (500) bounds the comment, not the scan.

## Alternatives

- Parse the diff hunks only: rejected, it misses cross-file effects.
- Re-scan only changed files at both revisions: rejected for the same reason.
