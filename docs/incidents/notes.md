# Incident notes

Real failures and corrections only. Nothing here is invented, and a line is added when something actually went wrong, not to look thorough.

## Rules

- A row of `evals/*.jsonl` is never edited to raise a number. A row may be corrected only with a line below that says what was wrong and why. Up to this writing no eval row and no golden was corrected.
- A line records the date, what failed, how it was found and what changed.

## Post-mortem template

```text
Date:
What failed:
How it was found (test, review, run):
Impact (what a user would have seen):
Fix:
What prevents it now (test, check, rule):
```

## Recorded during the build

- **2026-10-14, secret redaction over-matched.** The plan's `sk-[A-Za-z0-9_-]{20,}` pattern matched inside ordinary words such as `disk-encryption-configuration-enabled`, which would have redacted log text. Found while writing the redaction tests. Fix: every secret pattern starts with `(?<![A-Za-z0-9])`. Prevented by the extra case in `tests/unit/redact.unit.test.ts`.
- **2026-10-14, the plan's pending-marker scan matched ordinary words.** A case-insensitive search for the marker words also matches `metodologia` and Portuguese `todo o resto`. Found when the repository scan was first run over the generated documents. Fix: the upper-case markers match on word boundaries and case-sensitively; the two phrase markers stay case-insensitive. Prevented by the self-test in `tests/unit/conventions.unit.test.ts`.
- **2026-10-14, quoted sequence-diagram aliases printed their quotes.** `participant U as "npm run demo"` rendered the literal quote characters in the SVG with mermaid-cli 12.0.0, while quoted flowchart labels render correctly. Found by reading the rendered SVG. Fix: the participant aliases in `docs/diagrams/demo-flow.mmd` are unquoted. Prevented by a test that rejects quotes in participant lines.
- **2026-10-14, a schema-only PR test could not use the planned field.** The fixture's SQL migration already holds `diagnosis`, so changing it in the Prisma model alone changed no finding. Fix: the test adds `gender String?` to the Prisma model instead. Recorded in the author's progress log for chunk 6.
