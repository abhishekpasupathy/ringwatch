/**
 * Local, database-free dashboard data. This is intentionally small and is
 * used only when DATABASE_URL is absent, so contributors can verify the UI
 * before configuring Neon or downloading the IBM dataset.
 */
export const demoClusters = [
  {
    id: 1,
    communityId: 42,
    isFlagged: true,
    suspicionTier: "HIGH" as const,
    memberCount: 6,
    illicitMemberCount: 4,
    licitMemberCount: 2,
    internalEdgeDensity: "VERY_HIGH" as const,
    timeBurstPresent: true,
    paymentFormatCount: 3,
  },
  {
    id: 2,
    communityId: 77,
    isFlagged: false,
    suspicionTier: "SAFE" as const,
    memberCount: 4,
    illicitMemberCount: 0,
    licitMemberCount: 4,
    internalEdgeDensity: "LOW" as const,
    timeBurstPresent: false,
    paymentFormatCount: 1,
  },
];

type DemoNode = {
  id: string;
  isIllicit: boolean;
  isExposed: boolean;
  clusterId: number;
  isFlagged: boolean;
  suspicionTier: "HIGH" | "MEDIUM" | "SAFE";
};

export const demoGraph = {
  clusters: demoClusters,
  nodes: ([
    "102_40", "102_41", "102_42", "102_43",
  ].map((id) => ({
    id,
    isIllicit: true,
    isExposed: false,
    clusterId: 1,
    isFlagged: true,
    suspicionTier: "HIGH" as const,
  })) as DemoNode[]).concat([
    { id: "202_500", isIllicit: false, isExposed: true, clusterId: 1, isFlagged: true, suspicionTier: "HIGH" as const },
    { id: "202_501", isIllicit: false, isExposed: true, clusterId: 1, isFlagged: true, suspicionTier: "HIGH" as const },
    { id: "300_1036", isIllicit: false, isExposed: false, clusterId: 2, isFlagged: false, suspicionTier: "SAFE" as const },
    { id: "300_1037", isIllicit: false, isExposed: false, clusterId: 2, isFlagged: false, suspicionTier: "SAFE" as const },
    { id: "300_1038", isIllicit: false, isExposed: false, clusterId: 2, isFlagged: false, suspicionTier: "SAFE" as const },
    { id: "300_1039", isIllicit: false, isExposed: false, clusterId: 2, isFlagged: false, suspicionTier: "SAFE" as const },
  ]),
  links: [
    ["102_40", "102_41"], ["102_40", "102_42"], ["102_40", "102_43"],
    ["102_41", "102_42"], ["102_41", "202_500"], ["102_42", "102_43"],
    ["102_43", "202_501"], ["300_1036", "300_1037"], ["300_1037", "300_1038"],
    ["300_1038", "300_1039"],
  ].map(([source, target]) => ({ source, target })),
};

export const demoMetrics = {
  tp: 18,
  fp: 3,
  fn: 2,
  tn: 77,
  precision: 18 / 21,
  recall: 18 / 20,
  f1: 36 / 41,
  fpCostNote: "Local demo data only. Run the pipeline with the IBM AML dataset to calculate a held-out TEST false-positive cost.",
  computedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
};

export function getDemoLookup(accountId: string) {
  const node = demoGraph.nodes.find((item) => item.id === accountId);
  if (!node) {
    return { found: false, accountId, status: "NOT_FOUND", message: `Account ID \"${accountId}\" is not in the local demo network.` };
  }
  if (!node.isFlagged) {
    return { found: true, accountId, status: "SAFE", statusLabel: "Safe Account", message: "No suspicious ring patterns are associated with this account in local demo data." };
  }
  const cluster = demoClusters[0];
  const isRingMember = node.isIllicit;
  return {
    found: true,
    accountId,
    status: isRingMember ? "RING_MEMBER" : "EXPOSED_MERCHANT",
    statusLabel: isRingMember ? "Confirmed Ring Member" : "Exposed Merchant",
    clusterId: cluster.communityId,
    suspicionTier: cluster.suspicionTier,
    message: isRingMember ? "This account is a simulated ring member in the local demo." : "This merchant is simulated as directly exposed to a flagged ring.",
    explanation: "The connected accounts form a dense, time-coordinated transaction cluster. This explanation is generated from local demo evidence, not an LLM.",
    structuralEvidence: {
      clusterSize: cluster.memberCount,
      illicitMembers: cluster.illicitMemberCount,
      exposedMerchants: cluster.licitMemberCount,
      internalEdgeDensity: cluster.internalEdgeDensity,
      timeBurstPresent: cluster.timeBurstPresent,
      paymentFormatCount: cluster.paymentFormatCount,
    },
  };
}
