# Field study

privacy-radar has not been run against third-party repositories yet. This page fixes the protocol **before** any run, so the selection cannot be tuned to the results, and states the disclosure rule that governs anything published. It has no results section; the run is optional milestone M9, and a results section appears here only after it, with the repositories, commit SHAs and date. This is not legal advice and not a complete assessment.

## Protocol

1. **Selection rule.** Three to five public repositories that are TypeScript-first, have SQL migrations or a `schema.prisma`, have an OSI-approved license and had a commit in the last 12 months. The search criteria are written down before looking at any result, and the repositories are taken from the search in the order it returns them.
2. **Run.** `scan --llm none --regime both` on a local clone at a recorded commit SHA, recording the tool version and the catalog `checkedOn` date. The scan is deterministic, so anyone can repeat it on the same SHA.
3. **Triage.** The author labels every finding at or above medium confidence as true positive, false positive or "cannot tell", with a one-line reason, in a private worksheet that is never published.
4. **What is published.** Per rule: the counts of true positive, false positive and "cannot tell", and the precision TP / (TP + FP) together with the number of findings it rests on. Never a file, line, snippet or field name of a third-party repository.

## Disclosure rule (D-21)

- A repository is named in this page only with its URL, commit SHA, date and per-rule counts.
- Any finding that looks like a real exposure of personal data (a real identifier, a credential, a live endpoint receiving personal data) is reported privately to the maintainers through their security contact, and excluded from the published counts until they answer or 90 days pass.
- No third-party finding is ever used as a README example; the README examples come from the synthetic fixture.
- If a maintainer asks to be removed, the repository is removed from the published table.
