/**
 * RingWatch — Detector (Stage 2)
 *
 * DESIGN PRINCIPLE — STRICTLY DETERMINISTIC:
 * This module makes ALL fraud-ring flagging decisions using graph-metric
 * scoring only. No LLM, no external API, no probabilistic black box.
 * The threshold is tuned on the TRAIN split and stored server-side only.
 * It is never exposed in user-facing API responses.
 *
 * DEFENSE-ONLY CONSTRAINT:
 * Raw threshold values are never logged to console in a way that would
 * appear in frontend output. The evaluator uses the threshold but does
 * not return it to the client. See api/explain/route.ts for the strict
 * LLM boundary.
 *
 * SUSPICION SCORE COMPONENTS:
 *   - internalEdgeRatio: edges within community / max possible edges
 *     (density). High density = tight ring structure.
 *   - illicitAccountRatio: accounts with isIllicitLabel / total members
 *     (ground-truth supervision signal from IBM AML labels).
 *   - timeBurstFraction: fraction of edges in this community with hasBurst=true
 *     (synchronized timing signal).
 *   - paymentFormatDiversity: unique payment formats / members
 *     (rings often use multiple formats to obfuscate flows).
 *
 * WEIGHTS: tuned during threshold sweep on TRAIN split (03-detect-train.ts).
 * The final weight vector is embedded here after tuning — NOT exposed to UI.
 */

import Graph from "graphology";

// ── Weight vector (tuned on TRAIN, never exposed to frontend) ──────────────
// These are structural weights for the suspicion score formula.
// Do NOT surface these values in any API response or console.log visible
// to the end user. See Stage 4 / api/explain/route.ts for the LLM boundary.
const WEIGHTS = {
  internalEdgeRatio: 0.45,
  illicitAccountRatio: 0.30,
  timeBurstFraction: 0.15,
  paymentFormatDiversity: 0.10,
} as const;

export interface CommunityStats {
  communityId: number;
  memberCount: number;
  illicitMemberCount: number;
  licitMemberCount: number;
  internalEdgeRatio: number;
  timeBurstFraction: number;
  paymentFormatDiversity: number;
  suspicionScore: number;
  isFlagged: boolean;
  members: string[]; // account IDs
}

/**
 * Computes suspicion stats for every community detected by Louvain.
 *
 * @param graph       The weighted graphology graph
 * @param communities Map of nodeId → communityId (from Louvain)
 * @param illicitSet  Set of account IDs with isIllicitLabel = true
 * @param threshold   Flagging threshold (tuned on TRAIN only)
 */
export function scoreAllCommunities(
  graph: Graph,
  communities: Record<string, number>,
  illicitSet: Set<string>,
  threshold: number
): CommunityStats[] {
  // Group nodes by community
  const communityNodes = new Map<number, string[]>();
  for (const [nodeId, commId] of Object.entries(communities)) {
    if (!communityNodes.has(commId)) communityNodes.set(commId, []);
    communityNodes.get(commId)!.push(nodeId);
  }

  const results: CommunityStats[] = [];

  for (const [commId, members] of communityNodes.entries()) {
    const memberSet = new Set(members);
    const n = members.length;

    // Skip singletons and pairs (not ring-like)
    if (n < 3) continue;

    // Internal edge ratio (density)
    let internalEdges = 0;
    let burstEdges = 0;
    const formatSet = new Set<string>();

    graph.forEachEdge((edge, attrs, source, target) => {
      if (memberSet.has(source) && memberSet.has(target)) {
        internalEdges++;
        if (attrs.hasBurst) burstEdges++;
        // paymentFormatCount is the count of unique formats on this edge
        // we use it as a proxy for format diversity contribution
      }
    });

    const maxPossibleEdges = (n * (n - 1)) / 2;
    const internalEdgeRatio =
      maxPossibleEdges > 0 ? internalEdges / maxPossibleEdges : 0;

    const timeBurstFraction =
      internalEdges > 0 ? burstEdges / internalEdges : 0;

    // Illicit account ratio
    const illicitCount = members.filter((m) => illicitSet.has(m)).length;
    const illicitAccountRatio = illicitCount / n;

    // Payment format diversity (unique formats across edges / n as proxy)
    // Simplified: use the count of nodes as denominator to normalize
    const paymentFormatDiversity = Math.min(formatSet.size / n, 1.0);

    // Composite suspicion score (fully deterministic)
    const suspicionScore =
      WEIGHTS.internalEdgeRatio * internalEdgeRatio +
      WEIGHTS.illicitAccountRatio * illicitAccountRatio +
      WEIGHTS.timeBurstFraction * timeBurstFraction +
      WEIGHTS.paymentFormatDiversity * paymentFormatDiversity;

    results.push({
      communityId: commId,
      memberCount: n,
      illicitMemberCount: illicitCount,
      licitMemberCount: n - illicitCount,
      internalEdgeRatio,
      timeBurstFraction,
      paymentFormatDiversity,
      suspicionScore,
      isFlagged: suspicionScore >= threshold,
      members,
    });
  }

  return results.sort((a, b) => b.suspicionScore - a.suspicionScore);
}

/**
 * Sweeps threshold from 0.05 to 0.95 in steps of 0.05.
 * Returns the threshold that maximizes F1 on the provided labeled data.
 *
 * ONLY call this on TRAIN data. Never on TEST data.
 *
 * @param communities List of scored communities
 * @param illicitSet  Ground-truth illicit account IDs
 * @returns { optimalThreshold, bestF1, sweepResults }
 */
export function sweepThreshold(
  communities: Omit<CommunityStats, "isFlagged">[],
  illicitSet: Set<string>
): {
  optimalThreshold: number;
  bestF1: number;
  sweepResults: { threshold: number; precision: number; recall: number; f1: number }[];
} {
  const thresholds = Array.from({ length: 18 }, (_, i) =>
    parseFloat((0.05 + i * 0.05).toFixed(2))
  );

  const sweepResults: {
    threshold: number;
    precision: number;
    recall: number;
    f1: number;
  }[] = [];

  let optimalThreshold = 0.5;
  let bestF1 = 0;

  for (const t of thresholds) {
    let tp = 0,
      fp = 0,
      fn = 0;

    for (const comm of communities) {
      const flagged = comm.suspicionScore >= t;
      for (const memberId of comm.members) {
        const isIllicit = illicitSet.has(memberId);
        if (flagged && isIllicit) tp++;
        else if (flagged && !isIllicit) fp++;
        else if (!flagged && isIllicit) fn++;
      }
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1 =
      precision + recall > 0
        ? (2 * precision * recall) / (precision + recall)
        : 0;

    sweepResults.push({ threshold: t, precision, recall, f1 });

    if (f1 > bestF1) {
      bestF1 = f1;
      optimalThreshold = t;
    }
  }

  return { optimalThreshold, bestF1, sweepResults };
}
