/**
 * RingWatch — Train-set detection script (Stage 2)
 *
 * 1. Loads TRAIN transactions from DB
 * 2. Builds the weighted graph (lib/graph-builder.ts)
 * 3. Runs Louvain 5× (max modularity selection)
 * 4. Sweeps threshold on TRAIN data → picks optimal threshold (max F1)
 * 5. Persists DetectionRun + Cluster + ClusterMember rows to DB
 *
 * The optimal threshold is stored in the DetectionRun record.
 * It is NEVER logged in a way that appears in frontend output.
 * The evaluator (04-evaluate.ts) reads it from the DB by runId.
 */

import prisma from "../lib/db";
import { buildGraph, percentile99 } from "../lib/graph-builder";
import {
  scoreAllCommunities,
  sweepThreshold,
} from "../lib/detector";
import { toDensityLabel } from "../lib/llm-boundary";

const MINIMUM_COMMUNITY_SIZE = 3;

async function main() {
  console.log("══════════════════════════════════════════");
  console.log("  RingWatch — Stage 2: Train Detection");
  console.log("══════════════════════════════════════════\n");

  // ── Load TRAIN transactions ───────────────────────────────────────────────
  console.log("Loading TRAIN transactions from DB...");
  const transactions = await prisma.transaction.findMany({
    where: { split: "TRAIN" },
    select: {
      fromAccountId: true,
      toAccountId: true,
      amountPaid: true,
      timestamp: true,
      paymentFormat: true,
    },
  });
  console.log(`  Loaded ${transactions.length.toLocaleString()} TRAIN transactions`);

  // ── Load illicit account set ──────────────────────────────────────────────
  const illicitAccounts = await prisma.account.findMany({
    where: { isIllicitLabel: true },
    select: { id: true },
  });
  const illicitSet = new Set(illicitAccounts.map((a) => a.id));
  console.log(`  Illicit accounts: ${illicitSet.size.toLocaleString()}`);

  // ── Compute P99 amount for normalization ──────────────────────────────────
  const allAmounts = transactions.map((t) => t.amountPaid);
  const amountP99 = percentile99(allAmounts);
  console.log(`  Amount P99: ${amountP99.toFixed(2)}`);

  // ── Build graph ───────────────────────────────────────────────────────────
  console.log("\nBuilding weighted transaction graph...");
  const { graph, communities, modularityScore, runCount } = buildGraph(
    transactions,
    amountP99
  );
  console.log(`  Nodes: ${graph.order.toLocaleString()}`);
  console.log(`  Edges: ${graph.size.toLocaleString()}`);
  console.log(`  Louvain runs: ${runCount}, best modularity: ${modularityScore.toFixed(4)}`);

  // ── Score communities ─────────────────────────────────────────────────────
  console.log("\nScoring communities...");
  // Pass threshold=0 here — we score all communities, sweep happens next
  const scored = scoreAllCommunities(graph, communities, illicitSet, 0);
  console.log(
    `  Communities (size ≥ ${MINIMUM_COMMUNITY_SIZE}): ${scored.length}`
  );

  // ── Sweep threshold on TRAIN ──────────────────────────────────────────────
  console.log("\nSweeping threshold on TRAIN data...");
  const { optimalThreshold, bestF1, sweepResults } = sweepThreshold(
    scored,
    illicitSet
  );

  // Print sweep table (threshold values in this output are for operator
  // analysis only — this script runs offline, not in any API route)
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

  // ── Re-score with optimal threshold ──────────────────────────────────────
  const finalScored = scoreAllCommunities(
    graph,
    communities,
    illicitSet,
    optimalThreshold
  );
  const flaggedCount = finalScored.filter((c) => c.isFlagged).length;
  console.log(`  Flagged communities: ${flaggedCount} / ${finalScored.length}`);

  // ── Persist to DB ─────────────────────────────────────────────────────────
  console.log("\nPersisting detection run to DB...");

  const run = await prisma.detectionRun.create({
    data: {
      split: "TRAIN",
      threshold: optimalThreshold, // stored server-side, never sent to frontend
      modularityScore,
    },
  });

  // Batch-create clusters and their members
  for (const comm of finalScored) {
    const cluster = await prisma.cluster.create({
      data: {
        runId: run.id,
        communityId: comm.communityId,
        isFlagged: comm.isFlagged,
        suspicionScore: comm.suspicionScore,
        internalEdgeRatio: comm.internalEdgeRatio,
        timeBurstFraction: comm.timeBurstFraction,
        paymentFormatCount: comm.paymentFormatDiversity > 0
          ? Math.round(comm.paymentFormatDiversity * comm.memberCount)
          : 1,
        memberCount: comm.memberCount,
        illicitMemberCount: comm.illicitMemberCount,
        licitMemberCount: comm.licitMemberCount,
      },
    });

    // Batch cluster members
    const memberData = comm.members.map((accountId) => ({
      clusterId: cluster.id,
      accountId,
      isIllicit: illicitSet.has(accountId),
      // "Exposed merchant": licit account in a flagged community
      isExposed: comm.isFlagged && !illicitSet.has(accountId),
    }));

    await prisma.clusterMember.createMany({ data: memberData, skipDuplicates: true });
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
