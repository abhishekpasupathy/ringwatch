# RingWatch Benchmark Results

## Stratified supervised transaction-risk model (with network-structure features)

Run date: 2026-09-05
Command: `npm run ml:stratified`

| Metric | Held-out value |
|---|---:|
| Precision | 95.57% |
| Recall | 91.09% |
| F1 | 93.28% |
| True positives | 1,921 |
| False positives | 89 |
| False negatives | 188 |
| True negatives | 123,038 |

Selected threshold (maximum validation F1): `0.09`.

## Recall-first operating point

**Needs to be re-run against the current dataset and model.** The table below
is the last recorded result and predates both the current dataset size and the
addition of network-structure features to the model — treat it as historical,
not current:

| Metric | Held-out value (2026-08-30, pre-graph-features) |
|---|---:|
| Precision | 0.04% |
| Recall | 100.00% |
| F1 | 0.08% |
| True positives | 39 |
| False positives | 99,961 |
| False negatives | 0 |
| True negatives | 0 |

Run `npm run ml:recall-first` and replace this table with the new output
before citing it anywhere.

## Protocol

- Dataset: 626,177 transaction rows, with 10,547 positive laundering labels.
- Deterministic stratified 60/20/20 transaction split, random seed 42.
- Fit: 375,705 transactions; validation: 125,236; held-out test: 125,236.
- Model: scikit-learn `ExtraTreesClassifier` (200 trees, `max_features=0.8`,
  class-balanced sample weights) using:
  - Transaction amount, timing, and payment-format features.
  - Smoothed account-history features (prior laundering rate per account).
  - Network-structure features: Louvain community membership, in/out/total
    degree, community size, community density, community triangle count, and
    in/out amount ratio — computed once from the full transaction set with
    `networkx` + `python-louvain`, with no fraud labels involved in that
    computation.
- Balanced threshold: selected for maximum F1 on the validation partition.
- Recall-first threshold: highest threshold reaching the target validation
  recall (100% by default via `npm run ml:recall-first`).
- The held-out test labels are used only for final measurement. Test account
  label history is never used as a feature.

**Important caveat on the network-structure features:** they are computed
from the entire transaction set — fit, validation, and test rows together.
This is *transductive* (matches how the live dashboard actually builds its
graph, since it always has access to whatever transactions currently exist)
but is not a simulation of scoring a genuinely new transaction against a
graph built strictly from past data. A stronger, temporal version of this
benchmark would rebuild the graph using only transactions prior to each
scored point in time.

This is a stratified benchmark, not a forward-in-time deployment result. The
original temporal graph detector remains available and should be reported
separately; its latest full-data evaluation returned 0.0% F1.
