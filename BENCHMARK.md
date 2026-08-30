# RingWatch Benchmark Results

## Stratified supervised transaction-risk model

Run date: 2026-08-30  
Command: `npm run ml:stratified`

| Metric | Held-out value |
|---|---:|
| Precision | 44.44% |
| Recall | 41.03% |
| F1 | 42.67% |
| True positives | 16 |
| False positives | 20 |
| False negatives | 23 |
| True negatives | 99,941 |

## Protocol

- Dataset: 500,000 transaction rows, with 193 positive laundering labels.
- Deterministic stratified 60/20/20 transaction split, random seed 42.
- Fit: 300,000 transactions; validation: 100,000; held-out test: 100,000.
- Model: scikit-learn `HistGradientBoostingClassifier` with transaction amount,
  time, payment-format, and smoothed account-history features.
- Threshold: selected only on the validation partition.
- The held-out test labels are used only for final measurement. Test account
  label history is never used as a feature.

This is a stratified benchmark, not a forward-in-time deployment result. The
original temporal graph detector remains available and should be reported
separately; its latest full-data evaluation returned 0.0% F1.
