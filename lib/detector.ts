import Graph from "graphology";

const WEIGHTS = {
  internalEdgeRatio: 0.45,
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
  members: string[];
}

/**
 * Scores communities using prediction-time features only.
 * Ground-truth labels are accepted only for reporting/sweep evaluation;
 * they NEVER contribute to suspicionScore.
 */
export function scoreAllCommunities(
  graph: Graph,
  communities: Record<string, number>,
  illicitSet: Set<string>,
  threshold: number
): CommunityStats[] {
  const communityNodes = new Map<number, string[]>();
  for (const [nodeId, commId] of Object.entries(communities)) {
    if (!communityNodes.has(commId)) communityNodes.set(commId, []);
    communityNodes.get(commId)!.push(nodeId);
  }

  const results: CommunityStats[] = [];

  for (const [commId, members] of communityNodes.entries()) {
    const memberSet = new Set(members);
    const n = members.length;
    if (n < 3) continue;

    let internalEdges = 0;
    let burstEdges = 0;
    const formatSet = new Set<string>();

    graph.forEachEdge((edge, attrs, source, target) => {
      if (!memberSet.has(source) || !memberSet.has(target)) return;
      internalEdges++;
      if (attrs.hasBurst) burstEdges++;
      const formats = Array.isArray(attrs.paymentFormats) ? attrs.paymentFormats : [];
      for (const format of formats) formatSet.add(String(format));
    });

    const maxPossibleEdges = (n * (n - 1)) / 2;
    const internalEdgeRatio = maxPossibleEdges > 0 ? internalEdges / maxPossibleEdges : 0;
    const timeBurstFraction = internalEdges > 0 ? burstEdges / internalEdges : 0;
    const illicitCount = members.filter((m) => illicitSet.has(m)).length;
    const paymentFormatDiversity = Math.min(formatSet.size / n, 1.0);

    // IMPORTANT: illicitAccountRatio is deliberately NOT part of this score.
    // It is ground truth and would leak labels into prediction.
    const suspicionScore =
      WEIGHTS.internalEdgeRatio * internalEdgeRatio +
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
  const sweepResults: { threshold: number; precision: number; recall: number; f1: number }[] = [];
  let optimalThreshold = 0.5;
  let bestF1 = 0;

  for (const t of thresholds) {
    let tp = 0, fp = 0, fn = 0;
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
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    sweepResults.push({ threshold: t, precision, recall, f1 });

    if (f1 > bestF1) {
      bestF1 = f1;
      optimalThreshold = t;
    }
  }

  return { optimalThreshold, bestF1, sweepResults };
}
