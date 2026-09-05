/**
 * Versioned result of `npm run ml:stratified` against the configured 500k-row
 * benchmark dataset. This is intentionally separate from the temporal Louvain
 * baseline stored in Postgres.
 */
export const SUPERVISED_BENCHMARK = {
  modelName: "Supervised transaction-risk benchmark",
  evaluationProtocol: "Stratified 60/20/20 holdout",
  evaluationLevel: "Transaction level",
  tp: 1_921,
  fp: 89,
  fn: 188,
  tn: 123_038,
  precision: 0.9557,
  recall: 0.9109,
  f1: 0.9328,
  fpCostNote:
    "89 legitimate transactions were routed to review at the balanced operating point. This benchmark is for model comparison and is not a forward-in-time production simulation.",
  note:
    "ExtraTrees benchmark with account-graph features (Louvain community, degree, density, triangle count). Threshold selected for maximum F1 on validation; test labels are used only for final measurement. Graph structure is built from the full transaction set (transductive), consistent with how the live dashboard scores transactions but not a temporal deployment simulation.",
  computedAt: "2026-09-05T00:00:00.000Z",
} as const;
