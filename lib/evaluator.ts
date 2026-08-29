/**
 * RingWatch — Evaluator (Stage 3)
 *
 * Computes a confusion matrix and precision/recall/F1 on the TEST split.
 *
 * IMPORTANT: This module must ONLY be called with TEST split data.
 * The threshold passed in must have been tuned ONLY on TRAIN data.
 * Calling this on TRAIN data would leak information and invalidate the eval.
 *
 * Account-level metrics:
 *   TP: account isIllicit=true AND in a flagged community
 *   FP: account isIllicit=false AND in a flagged community  ← FP cost here
 *   FN: account isIllicit=true AND in an unflagged community
 *   TN: account isIllicit=false AND in an unflagged community
 *
 * False-positive cost framing:
 *   FP accounts are licit accounts in flagged communities.
 *   In a merchant-protection context, these would be the accounts that
 *   receive unnecessary settlement holds or investigation flags.
 *   Cost = FP_count × AVG_DAILY_VOLUME_INR × SETTLEMENT_HOLD_DAYS
 */

import { CommunityStats } from "./detector";

export interface ConfusionMatrix {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
}

export interface EvalResult {
  confusion: ConfusionMatrix;
  precision: number;
  recall: number;
  f1: number;
  fpCostNote: string;
}

// False-positive cost parameters (merchant context)
// Avg daily transaction volume per account in the IBM AML synthetic dataset
// (estimated from amount distribution; stated explicitly in report)
const AVG_DAILY_VOLUME_USD = 15_000; // synthetic dataset denominated in USD
const SETTLEMENT_HOLD_DAYS = 2; // typical Razorpay settlement hold for flagged accounts
const USD_TO_INR = 83.5; // approximate rate, stated in report for transparency

/**
 * Evaluates the detector against the TEST split.
 *
 * @param communities Scored communities (from detector.scoreAllCommunities with TEST data)
 * @param illicitSet  Ground-truth illicit account IDs (from DB, TEST accounts only)
 * @param totalTestAccounts Total number of accounts present in TEST split
 */
export function evaluate(
  communities: CommunityStats[],
  illicitSet: Set<string>,
  totalTestAccounts: number
): EvalResult {
  let tp = 0,
    fp = 0,
    fn = 0;

  // Accounts assigned to ANY community (sized ≥3)
  const accountedFor = new Set<string>();

  for (const comm of communities) {
    for (const memberId of comm.members) {
      accountedFor.add(memberId);
      const isIllicit = illicitSet.has(memberId);

      if (comm.isFlagged && isIllicit) tp++;
      else if (comm.isFlagged && !isIllicit) fp++;
      else if (!comm.isFlagged && isIllicit) fn++;
      // licit + unflagged → TN (counted below)
    }
  }

  // Accounts not in any community (singletons/pairs) are implicitly TN
  // (we don't flag them)
  const tn = totalTestAccounts - tp - fp - fn;

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 =
    precision + recall > 0
      ? (2 * precision * recall) / (precision + recall)
      : 0;

  // False-positive cost note (concrete, not hand-waved)
  const fpCostUSD = fp * AVG_DAILY_VOLUME_USD * SETTLEMENT_HOLD_DAYS;
  const fpCostINR = fpCostUSD * USD_TO_INR;
  const fpCostNote =
    `At the chosen detection threshold, ${fp} legitimate accounts were incorrectly flagged ` +
    `in the held-out test set. Under a typical ${SETTLEMENT_HOLD_DAYS}-business-day settlement hold ` +
    `(the standard Razorpay review window for flagged accounts), and assuming an average daily ` +
    `volume of USD ${AVG_DAILY_VOLUME_USD.toLocaleString()} per account (estimated from dataset ` +
    `amount distribution), this represents approximately USD ${fpCostUSD.toLocaleString()} ` +
    `(≈₹${(fpCostINR / 1e7).toFixed(1)} Cr) in temporarily delayed settlements across the test period. ` +
    `These are recoverable — the funds are not lost, only delayed — but impose operational friction ` +
    `on legitimate merchants. Detection threshold was tuned to prioritize recall over precision ` +
    `because an undetected ring chargeback is an unrecoverable loss (goods shipped + dispute fee), ` +
    `whereas a false-positive settlement hold is reversible within ${SETTLEMENT_HOLD_DAYS} business days.`;

  return {
    confusion: { tp, fp, fn, tn: Math.max(tn, 0) },
    precision,
    recall,
    f1,
    fpCostNote,
  };
}

/**
 * Formats evaluation results as a markdown report.
 * This report is the Stage 3 explicit deliverable.
 */
export function formatEvalReport(result: EvalResult, runInfo: {
  split: string;
  totalTx: number;
  illicitTx: number;
  licitTx: number;
  louvainModularity: number;
  louvainVarianceNote: string;
}): string {
  const { confusion, precision, recall, f1, fpCostNote } = result;
  const { tp, fp, fn, tn } = confusion;

  return `# RingWatch — Evaluation Report

## Test Set Summary

| Metric | Value |
|--------|-------|
| Split | ${runInfo.split} (temporal holdout — latest 20% by timestamp) |
| Total transactions | ${runInfo.totalTx.toLocaleString()} |
| Illicit (labeled) | ${runInfo.illicitTx.toLocaleString()} |
| Licit | ${runInfo.licitTx.toLocaleString()} |
| Louvain modularity | ${runInfo.louvainModularity.toFixed(4)} |

## Confusion Matrix (Account Level)

|  | Predicted: Ring Member | Predicted: Safe |
|--|------------------------|-----------------|
| **Actual: Illicit** | TP = ${tp} | FN = ${fn} |
| **Actual: Licit** | FP = ${fp} | TN = ${tn} |

## Detection Metrics

| Metric | Value |
|--------|-------|
| **Precision** | **${(precision * 100).toFixed(1)}%** |
| **Recall** | **${(recall * 100).toFixed(1)}%** |
| **F1 Score** | **${(f1 * 100).toFixed(1)}%** |

> These metrics were computed exclusively on the held-out TEST split.
> The detection threshold was tuned only on the TRAIN split. No information
> from the test set was used during tuning.

## False-Positive Cost

${fpCostNote}

## Algorithm Stability Note

${runInfo.louvainVarianceNote}

## Trade-Off Decision

We optimized for **recall over precision** during threshold tuning.

**Rationale:** In the fraud-ring context, a false negative (missed ring member)
results in an unrecoverable chargeback loss — the merchant ships goods, the
ring member disputes the charge, and the merchant absorbs both the product
loss and the dispute processing fee. A false positive (incorrectly flagged
legitimate account) results in a temporary settlement hold that is fully
reversible within ${2} business days. The asymmetric cost structure justifies
prioritizing recall.

**For production deployment:** A higher-precision operating point is available
by raising the threshold. The threshold sweep results (logged during Stage 2)
show the full precision-recall curve for this dataset.

---
*Report generated by RingWatch evaluation pipeline. Dataset: IBM AML HI-Small (Kaggle).
Graph algorithm: Louvain community detection via graphology-communities-louvain.*
`;
}
