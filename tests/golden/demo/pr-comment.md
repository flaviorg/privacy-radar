## privacy-radar: compliance changes in this pull request

Base `3bd039e` → head `7a374aa` · 2 files changed

- This PR introduces a new flow of identifier.cpf and special.health to analytics vendor Mixpanel \(US\) at src/analytics.ts:9 \(LGPD 6 I-III, 7, 11, 33, 46; GDPR 5\(1\)\(b\)\(c\), 6, 9\(1\), 28, 44-46\).
- This PR introduces an international transfer of identifier.cpf and special.health to Mixpanel \(US\) at src/analytics.ts:9: LGPD needs-mechanism, GDPR conditional; status as of 2026-10-08; verify \(LGPD 33, 33 II, 33 VIII, 34-36; GDPR 44-47, 49\).
- This PR removes the flow of identifier.cpf to a file \(fs.appendFileSync\) at src/patients.ts:24 \(LGPD 6 VII, 46; GDPR 5\(1\)\(f\), 32\).

| Change | Severity | Rule | Location | Categories |
|---|---|---|---|---|
| added | error | PR-ANALYTICS | `src/analytics.ts:9` | `identifier.cpf`, `special.health` |
| added | error | PR-TRANSFER | `src/analytics.ts:9` | `identifier.cpf`, `special.health` |
| resolved | warning | PR-FILE | `src/patients.ts:24` | `identifier.cpf` |

2 added · 1 resolved · 15 unchanged

---

Deterministic rules only; no language model was used for this comment. This is not legal advice and not a complete assessment.
