import prisma from "../lib/db";
import { buildGraph, percentile99 } from "../lib/graph-builder";
import { scoreAllCommunities, sweepThreshold } from "../lib/detector";

const MINIMUM_COMMUNITY_SIZE = 3;
const CLUSTER_BATCH_SIZE = 500;
const MEMBER_BATCH_SIZE = 2000;

async function main() {
  console.log("══════════════════════════════════════════");
  console.log("  RingWatch — Stage 2: Train Detection");
  console.log("══════════════════════════════════════════\n");

  console.log("Loading TRAIN transactions from DB...");
  const transactions = await prisma.transaction.findMany({
    where: { split: "TRAIN" },
    select: {
      fromAccountId: true,
      toAccountId: true,
      amountPaid: true,
      timestamp: true,
      paymentFormat: true,
      isLaunderingLabel: true,
    },
  });
  console.log(`  Loaded ${transactions.length.toLocaleString()} TRAIN transactions`);

  // Training labels are derived ONLY from laundering labels on TRAIN rows.
  // Account labels derived from the full dataset would leak future labels.
  const illicitSet = new Set<string>();
  for (const tx of transactions) {
    if (tx.isLaunderingLabel) {
      illicitSet.add(tx.fromAccountId);
      illicitSet.add(tx.toAccountId);
    }
  }
  console.log(`  TRAIN illicit accounts: ${illicitSet.size.toLocaleString()}`);

  const amountP99 = percentile99(transactions.map((t) => t.amountPaid));
  console.log(`  TRAIN amount P99: ${amountP99.toFixed(2)}`);

  console.log("\nBuilding weighted transaction graph...");
  const { graph, communities, modularityScore, runCount } = buildGraph(
    transactions,
    amountP99
  );
  console.log(`  Nodes: ${graph.order.toLocaleString()}`);
  console.log(`  Edges: ${graph.size.toLocaleString()}`);
  console.log(`  Louvain runs: ${runCount}, best modularity: ${modularityScore.toFixed(4)}`);

  console.log("\nScoring communities...");
  const scored = scoreAllCommunities(graph, communities, illicitSet, 0);
  console.log(`  Communities (size ≥ ${MINIMUM_COMMUNITY_SIZE}): ${scored.length}`);

  console.log("\nSweeping threshold on TRAIN data...");
  const { optimalThreshold, bestF1, sweepResults } = sweepThreshold(scored, illicitSet);

  console.log("\n  Threshold Sweep Results (TRAIN):");
  console.log("  Threshold | Precision | Recall | F1");
  console.log("  ----------|-----------|--------|----");
  for (const r of sweepResults) {
    const marker = r.threshold === optimalThreshold ? " ← SELECTED" : "";
    console.log(
      `  ${r.threshold.toFixed(2).padEnd(9)} | ${(r.precision * 100).toFixed(1).padStart(8)}% | ${(r.recall * 100).toFixed(1).padStart(5)}% | ${(r.f1 * 100).toFixed(1)}%${marker}`
    );
  }
  console.log(`\n  ✓ Best TRAIN F1: ${(bestF1 * 100).toFixed(1)}%`);

  const finalScored = scoreAllCommunities(graph, communities, illicitSet, optimalThreshold);
  const flaggedCount = finalScored.filter((c) => c.isFlagged).length;
  console.log(`  Flagged communities: ${flaggedCount} / ${finalScored.length}`);

  console.log("\nPersisting detection run to DB...");
  const run = await prisma.detectionRun.create({
    data: { split: "TRAIN", threshold: optimalThreshold, modularityScore },
  });

  // Create all clusters in batches instead of one network round-trip per community.
  for (let i = 0; i < finalScored.length; i += CLUSTER_BATCH_SIZE) {
    const batch = finalScored.slice(i, i + CLUSTER_BATCH_SIZE);
    await prisma.cluster.createMany({
      data: batch.map((comm) => ({
        runId: run.id,
        communityId: comm.communityId,
        isFlagged: comm.isFlagged,
        suspicionScore: comm.suspicionScore,
        internalEdgeRatio: comm.internalEdgeRatio,
        timeBurstFraction: comm.timeBurstFraction,
        paymentFormatCount: Math.max(1, Math.round(comm.paymentFormatDiversity * comm.memberCount)),
        memberCount: comm.memberCount,
        illicitMemberCount: comm.illicitMemberCount,
        licitMemberCount: comm.licitMemberCount,
      })),
      skipDuplicates: true,
    });
    console.log(`  Clusters: ${Math.min(i + batch.length, finalScored.length).toLocaleString()} / ${finalScored.length.toLocaleString()}`);
  }

  // Fetch the generated cluster IDs once, then insert all membership rows in batches.
  const persistedClusters = await prisma.cluster.findMany({
    where: { runId: run.id },
    select: { id: true, communityId: true },
  });
  const clusterIdByCommunity = new Map(
    persistedClusters.map((cluster) => [cluster.communityId, cluster.id])
  );

  const memberRows = finalScored.flatMap((comm) => {
    const clusterId = clusterIdByCommunity.get(comm.communityId);
    if (!clusterId) throw new Error(`Missing persisted cluster for community ${comm.communityId}`);
    return comm.members.map((accountId) => ({
      clusterId,
      accountId,
      isIllicit: illicitSet.has(accountId),
      isExposed: comm.isFlagged && !illicitSet.has(accountId),
    }));
  });

  console.log(`  Persisting ${memberRows.length.toLocaleString()} cluster memberships...`);
  for (let i = 0; i < memberRows.length; i += MEMBER_BATCH_SIZE) {
    const batch = memberRows.slice(i, i + MEMBER_BATCH_SIZE);
    await prisma.clusterMember.createMany({
      data: batch,
      skipDuplicates: true,
    });
    console.log(`  Members: ${Math.min(i + batch.length, memberRows.length).toLocaleString()} / ${memberRows.length.toLocaleString()}`);
  }

  console.log(`\n✓ Stage 2 complete. Detection run ID: ${run.id}`);
  console.log("  Run scripts/04-evaluate.ts next (uses test split).");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
