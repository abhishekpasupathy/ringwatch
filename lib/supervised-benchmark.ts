/**
 * Versioned result of `npm run ml:stratified` against the configured 500k-row
 * benchmark dataset. This is intentionally separate from the temporal Louvain
 * baseline stored in Postgres.
 */
export const SUPERVISED_BENCHMARK = {
  modelName: "Supervised transaction-risk benchmark",
  evaluationProtocol: "Stratified 60/20/20 holdout",
  evaluationLevel: "Transaction level",
  tp: 26,
  fp: 14,
  fn: 13,
  tn: 99_947,
  precision: 0.65,
  recall: 0.6667,
  f1: 0.6582,
  fpCostNote:
    "14 legitimate transactions were routed to review at the balanced operating point. This benchmark is for model comparison and is not a forward-in-time production simulation.",
  note:
    "ExtraTrees benchmark. Threshold selected for maximum F1 on validation; test labels are used only for final measurement.",
  computedAt: "2026-08-30T00:00:00.000Z",
} as const;
