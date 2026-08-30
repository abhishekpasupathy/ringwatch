import * as fs from "fs";
import * as path from "path";
import prisma from "../lib/db";
import { buildGraph, percentile99 } from "../lib/graph-builder";
import { scoreAllCommunities } from "../lib/detector";
import { evaluate, formatEvalReport } from "../lib/evaluator";

const CLUSTER_BATCH_SIZE = 500;
const MEMBER_BATCH_SIZE = 2_000;

async function main() {
  console.log("══════════════════════════════════════════");
  console.log("  RingWatch — Stage 3: Test Evaluation");
  console.log("══════════════════════════════════════════\n");

  const trainRun = await prisma.detectionRun.findFirst({
    where: { split: "TRAIN" },
    orderBy: { runAt: "desc" },
  });
  if (!trainRun) {
    console.error("No TRAIN detection run found. Run scripts/03-detect-train.ts first.");
    process.exit(1);
  }
  console.log(`Using TRAIN run ID: ${trainRun.id} (threshold from train tuning)`);

  console.log("\nLoading TEST transactions...");
  const testTransactions = await prisma.transaction.findMany({
    where: { split: "TEST" },
    select: {
      fromAccountId: true,
      toAccountId: true,
      amountPaid: true,
      timestamp: true,
      paymentFormat: true,
      isLaunderingLabel: true,
    },
  });
  console.log(`  Loaded ${testTransactions.length.toLocaleString()} TEST transactions`);

  const testIllicitTx = testTransactions.filter((t) => t.isLaunderingLabel).length;
  const testLicitTx = testTransactions.length - testIllicitTx;

  // TEST labels are ground truth only. They are never used to calculate scores.
  const testIllicitSet = new Set<string>();
  for (const tx of testTransactions) {
    if (tx.isLaunderingLabel) {
      testIllicitSet.add(tx.fromAccountId);
      testIllicitSet.add(tx.toAccountId);
    }
  }

  const testAccountIds = new Set([
    ...testTransactions.map((t) => t.fromAccountId),
    ...testTransactions.map((t) => t.toAccountId),
  ]);
  const totalTestAccounts = testAccountIds.size;
  console.log(`  Unique accounts in TEST: ${totalTestAccounts.toLocaleString()}`);
  console.log(`  TEST illicit accounts (evaluation labels): ${testIllicitSet.size.toLocaleString()}`);

  // Freeze normalization from TRAIN. Never calculate normalization statistics from TEST.
  const trainTransactionsForP99 = await prisma.transaction.findMany({
    where: { split: "TRAIN" },
    select: { amountPaid: true },
  });
  const trainAmountP99 = percentile99(trainTransactionsForP99.map((t) => t.amountPaid));
  console.log(`  Using TRAIN amount P99 for TEST: ${trainAmountP99.toFixed(2)}`);

  console.log("\nBuilding TEST graph...");
  const { graph, communities, modularityScore } = buildGraph(testTransactions, trainAmountP99);
  console.log(`  Nodes: ${graph.order.toLocaleString()}, Edges: ${graph.size.toLocaleString()}`);
  console.log(`  Louvain modularity: ${modularityScore.toFixed(4)}`);

  // Labels are passed only for display/reporting fields. detector.ts never uses them in suspicionScore.
  const finalScored = scoreAllCommunities(
    graph,
    communities,
    testIllicitSet,
    trainRun.threshold
  );

  console.log("\nEvaluating...");
  const result = evaluate(finalScored, testIllicitSet, totalTestAccounts);
  const { confusion, precision, recall, f1 } = result;

  console.log(`\n── Confusion Matrix (TEST, Account Level) ──`);
  console.log(`  TP: ${confusion.tp}  |  FP: ${confusion.fp}`);
  console.log(`  FN: ${confusion.fn}  |  TN: ${confusion.tn}`);
  console.log(`\n── Metrics (TEST) ──`);
  console.log(`  Precision : ${(precision * 100).toFixed(1)}%`);
  console.log(`  Recall    : ${(recall * 100).toFixed(1)}%`);
  console.log(`  F1        : ${(f1 * 100).toFixed(1)}%`);

  await prisma.evalMetrics.create({
    data: {
      split: "TEST",
      tp: confusion.tp,
      fp: confusion.fp,
      fn: confusion.fn,
      tn: confusion.tn,
      precision,
      recall,
      f1,
      fpCostNote: result.fpCostNote,
    },
  });
  console.log("\n✓ Metrics persisted to DB");

  const testRun = await prisma.detectionRun.create({
    data: { split: "TEST", threshold: trainRun.threshold, modularityScore },
  });

  for (let i = 0; i < finalScored.length; i += CLUSTER_BATCH_SIZE) {
    const batch = finalScored.slice(i, i + CLUSTER_BATCH_SIZE);
    await prisma.cluster.createMany({
      data: batch.map((comm) => ({
        runId: testRun.id,
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
    });
  }

  const persistedClusters = await prisma.cluster.findMany({
    where: { runId: testRun.id },
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
      isIllicit: testIllicitSet.has(accountId),
      isExposed: comm.isFlagged && !testIllicitSet.has(accountId),
    }));
  });

  for (let i = 0; i < memberRows.length; i += MEMBER_BATCH_SIZE) {
    await prisma.clusterMember.createMany({
      data: memberRows.slice(i, i + MEMBER_BATCH_SIZE),
      skipDuplicates: true,
    });
  }

  const louvainVarianceNote =
    `Louvain community detection (graphology-communities-louvain) is a heuristic ` +
    `greedy algorithm with no deterministic seed parameter. Nodes and edges are sorted before insertion, ` +
    `and the algorithm runs 5× per graph build, selecting the partition with the highest modularity score. ` +
    `Results can vary slightly across environments.`;

  const report = formatEvalReport(result, {
    split: "TEST (temporal holdout, latest 20% by timestamp)",
    totalTx: testTransactions.length,
    illicitTx: testIllicitTx,
    licitTx: testLicitTx,
    louvainModularity: modularityScore,
    louvainVarianceNote,
  });

  const reportPath = path.join(process.cwd(), "eval-report.md");
  fs.writeFileSync(reportPath, report, "utf8");
  console.log(`\n✓ eval-report.md written to ${reportPath}`);
  console.log("\n✓ Stage 3 complete. Proceed to Stage 4 (npm run dev).");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
