# RingWatch Benchmark Results

## Stratified supervised transaction-risk model

Run date: 2026-08-30  
Commands: `npm run ml:stratified` and `npm run ml:recall-first`

| Metric | Held-out value |
|---|---:|
| Precision | 65.00% |
| Recall | 66.67% |
| F1 | 65.82% |
| True positives | 26 |
| False positives | 14 |
| False negatives | 13 |
| True negatives | 99,947 |

## Recall-first operating point

| Metric | Held-out value |
|---|---:|
| Precision | 0.04% |
| Recall | 100.00% |
| F1 | 0.08% |
| True positives | 39 |
| False positives | 99,961 |
| False negatives | 0 |
| True negatives | 0 |

The recall-first threshold is selected exclusively on validation to satisfy a
100% recall target. On this dataset it is `0.0`, which means every transaction
is placed in the review queue. It is useful only to demonstrate a catch-all
triage mode; it is not a practical production operating point.

## Protocol

- Dataset: 500,000 transaction rows, with 193 positive laundering labels.
- Deterministic stratified 60/20/20 transaction split, random seed 42.
- Fit: 300,000 transactions; validation: 100,000; held-out test: 100,000.
- Model: scikit-learn `ExtraTreesClassifier` with transaction amount, time,
  payment-format, and smoothed account-history features.
- Balanced threshold: selected for maximum F1 on the validation partition.
- Recall-first threshold: highest threshold reaching 100% validation recall.
- The held-out test labels are used only for final measurement. Test account
  label history is never used as a feature.

This is a stratified benchmark, not a forward-in-time deployment result. The
original temporal graph detector remains available and should be reported
separately; its latest full-data evaluation returned 0.0% F1.
