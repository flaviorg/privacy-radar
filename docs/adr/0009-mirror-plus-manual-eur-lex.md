# ADR 0009: GDPR text from a mirror, checked by hand against EUR-Lex

Status: accepted (2026-10-08, design spec; recorded as an ADR on 2026-10-14)
Decision ids: D-02 and D-03

## Context

Every finding cites exact LGPD and GDPR articles. EUR-Lex answers non-browser clients with a WAF challenge, so the official GDPR text cannot be fetched by a script. The ANPD site returned 403 to `curl` for Resolutions 19/2024 and 32/2026.

## Decision

- LGPD entries are compared with the compiled Planalto text and recorded `verifiedAgainst: "official"`. GDPR entries are compared with the gdpr-info.eu mirror and recorded `verifiedAgainst: "mirror:gdpr-info.eu"`, with the canonical ELI as `sourceUrl`.
- `docs/legal-sources.md` describes the manual step: the author opens the ELI link in a browser, compares the article, and flips the entry to `official` with the day's date. The tool never claims an automated check against EUR-Lex.
- ANPD resolutions are cited as "secondary summary read 2026-10-08" with the official title and date; the author opens gov.br/anpd once before publication and records it.
- Summaries are the author's own, at most 200 characters, and the catalog is a golden snapshot so edits are reviewed.

## Consequences

- Good: the catalog says exactly how much was verified and against what.
- Cost: a manual tick is still open before publication (see the hand-off list).

## Alternatives

- Claim automated verification: rejected, it would be false.
- Cite secondary sources as official: rejected.
- A dev-only EUR-Lex script: only if EUR-Lex becomes fetchable, never a runtime dependency.
