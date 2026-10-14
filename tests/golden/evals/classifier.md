### Deterministic classifier evaluation

Dataset: `evals/field-names.jsonl`, 213 labeled fields; threshold 0.50.
Run on 2026-10-08; catalog data checked on 2026-10-08.
A prediction is the top candidate at or above the threshold, else `not-personal`;
the score is per category group.

| Group | Rows | TP | FP | FN | Precision | Recall |
|---|---:|---:|---:|---:|---:|---:|
| identifier | 18 | 18 | 0 | 0 | 1.00 | 1.00 |
| financial | 17 | 17 | 0 | 0 | 1.00 | 1.00 |
| contact | 25 | 25 | 1 | 0 | 0.96 | 1.00 |
| name | 19 | 18 | 0 | 1 | 1.00 | 0.95 |
| demographic | 14 | 14 | 0 | 0 | 1.00 | 1.00 |
| online | 10 | 9 | 0 | 1 | 1.00 | 0.90 |
| special | 33 | 33 | 0 | 0 | 1.00 | 1.00 |
| criminal | 3 | 3 | 0 | 0 | 1.00 | 1.00 |
| children | 12 | 12 | 1 | 0 | 0.92 | 1.00 |
| not-personal | 62 | 61 | 1 | 1 | 0.98 | 0.98 |
| overall (personal groups) | 151 | 149 | 2 | 2 | 0.99 | 0.99 |
