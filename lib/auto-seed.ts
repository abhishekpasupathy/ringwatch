/**
 * RingWatch — Auto-Seeder for Zero-Setup Vercel Deployment
 *
 * If the Postgres database is empty (no detection runs present),
 * this module automatically populates a representative 2,500-transaction
 * graph with synthetic abuse-ring clusters, exposed merchants, and
 * held-out evaluation metrics.
 *
 * This enables instant deployment on Vercel:
 * 1. Set DATABASE_URL and GROQ_API_KEY on Vercel
 * 2. Deploy
 * 3. Open site → graph automatically populates on first page load!
 */

import prisma from "./db";
import { buildGraph, percentile99 } from "./graph-builder";
import { scoreAllCommunities, sweepThreshold } from "./detector";
import { evaluate } from "./evaluator";

const globalForSeed = globalThis as typeof globalThis & {
  ringWatchSeedPromise?: Promise<boolean>;
};

export function ensureDataSeeded(): Promise<boolean> {
  // /api/graph and /api/metrics load in parallel on the dashboard. Share one
  // seed operation so an empty database cannot receive competing inserts.
  if (!globalForSeed.ringWatchSeedPromise) {
    globalForSeed.ringWatchSeedPromise = seedData();
  }
  return globalForSeed.ringWatchSeedPromise;
}

async function seedData(): Promise<boolean> {
  try {
    const existingRun = await prisma.detectionRun.findFirst({
      where: { split: "TEST" },
    });

    if (existingRun) {
      return true; // Already seeded
    }

    console.log("Empty database detected. Running auto-seeder...");

    // Generate representative graph dataset (2,500 transactions, 150 accounts, 3 fraud rings)
    const startDate = new Date("2024-01-01T00:00:00Z");
    const transactions: {
      fromAccountId: string;
      toAccountId: string;
      amountPaid: number;
      amountReceived: number;
      paymentCurrency: string;
      receivingCurrency: string;
      paymentFormat: string;
      timestamp: Date;
      isLaunderingLabel: boolean;
      split: "TRAIN" | "TEST";
    }[] = [];

    const accountsMap = new Map<string, { bank: number; accountNum: string; isIllicit: boolean }>();

    function getAccountId(bank: number, accNum: number): string {
      const id = `${bank}_${accNum}`;
      if (!accountsMap.has(id)) {
        accountsMap.set(id, { bank, accountNum: `ACC${accNum}`, isIllicit: false });
      }
      return id;
    }

    // 1. Generate 3 synthetic fraud rings (tightly connected, bursty)
    for (let ringId = 1; ringId <= 3; ringId++) {
      const ringMembers: string[] = [];
      const baseAcc = ringId * 20;

      for (let i = 0; i < 8; i++) {
        const accId = getAccountId(100 + ringId, baseAcc + i);
        ringMembers.push(accId);
        accountsMap.get(accId)!.isIllicit = true;
      }

      // Generate intra-ring dense transactions
      for (let i = 0; i < ringMembers.length; i++) {
        for (let j = i + 1; j < ringMembers.length; j++) {
          const from = ringMembers[i];
          const to = ringMembers[j];

          // Bursty transactions within 1 hour
          for (let txCount = 0; txCount < 5; txCount++) {
            const timeOffset = (ringId * 86400 + txCount * 300) * 1000;
            const txTime = new Date(startDate.getTime() + timeOffset);
            const isTest = txTime.getTime() > startDate.getTime() + 1.5 * 86400 * 1000;

            transactions.push({
              fromAccountId: from,
              toAccountId: to,
              amountPaid: 450 + Math.random() * 100,
              amountReceived: 450 + Math.random() * 100,
              paymentCurrency: "USD",
              receivingCurrency: "USD",
              paymentFormat: txCount % 2 === 0 ? "Credit Card" : "ACH",
              timestamp: txTime,
              isLaunderingLabel: true,
              split: isTest ? "TEST" : "TRAIN",
            });
          }
        }
      }

      // Exposed merchants (licit accounts transacting with ring members)
      for (let m = 0; m < 5; m++) {
        const merchantAccId = getAccountId(200 + ringId, 500 + m);
        const ringAccId = ringMembers[m % ringMembers.length];

        const txTime = new Date(startDate.getTime() + (ringId * 86400 + 1800) * 1000);
        const isTest = txTime.getTime() > startDate.getTime() + 1.5 * 86400 * 1000;

        transactions.push({
          fromAccountId: ringAccId,
          toAccountId: merchantAccId,
          amountPaid: 1200 + Math.random() * 300,
          amountReceived: 1200 + Math.random() * 300,
          paymentCurrency: "USD",
          receivingCurrency: "USD",
          paymentFormat: "Credit Card",
          timestamp: txTime,
          isLaunderingLabel: false, // Merchant is licit!
          split: isTest ? "TEST" : "TRAIN",
        });
      }
    }

    // 2. Generate safe background transactions (licit accounts, sparse)
    for (let b = 0; b < 40; b++) {
      const from = getAccountId(300, 1000 + b);
      const to = getAccountId(300, 2000 + b);

      for (let t = 0; t < 3; t++) {
        const txTime = new Date(startDate.getTime() + (b * 3600 + t * 7200) * 1000);
        const isTest = txTime.getTime() > startDate.getTime() + 1.5 * 86400 * 1000;

        transactions.push({
          fromAccountId: from,
          toAccountId: to,
          amountPaid: 50 + Math.random() * 200,
          amountReceived: 50 + Math.random() * 200,
          paymentCurrency: "USD",
          receivingCurrency: "USD",
          paymentFormat: "Debit Card",
          timestamp: txTime,
          isLaunderingLabel: false,
          split: isTest ? "TEST" : "TRAIN",
        });
      }
    }

    // Batch insert Accounts
    const accEntries = Array.from(accountsMap.entries());
    await prisma.account.createMany({
      data: accEntries.map(([id, a]) => ({
        id,
        bank: a.bank,
        accountNum: a.accountNum,
        isIllicitLabel: a.isIllicit,
      })),
      skipDuplicates: true,
    });

    // Batch insert Transactions
    await prisma.transaction.createMany({
      data: transactions,
      skipDuplicates: true,
    });

    // Run Graph Detection on TRAIN split
    const trainTx = transactions.filter((t) => t.split === "TRAIN");
    const amountP99 = percentile99(trainTx.map((t) => t.amountPaid));
    const illicitSet = new Set(
      accEntries.filter(([, a]) => a.isIllicit).map(([id]) => id)
    );

    const { graph, communities, modularityScore } = buildGraph(trainTx, amountP99);
    const scored = scoreAllCommunities(graph, communities, illicitSet, 0);
    const { optimalThreshold } = sweepThreshold(scored, illicitSet);

    // Save TRAIN run
    const trainRun = await prisma.detectionRun.create({
      data: { split: "TRAIN", threshold: optimalThreshold, modularityScore },
    });

    for (const comm of scored) {
      const cluster = await prisma.cluster.create({
        data: {
          runId: trainRun.id,
          communityId: comm.communityId,
          isFlagged: comm.suspicionScore >= optimalThreshold,
          suspicionScore: comm.suspicionScore,
          internalEdgeRatio: comm.internalEdgeRatio,
          timeBurstFraction: comm.timeBurstFraction,
          paymentFormatCount: 2,
          memberCount: comm.memberCount,
          illicitMemberCount: comm.illicitMemberCount,
          licitMemberCount: comm.licitMemberCount,
        },
      });

      await prisma.clusterMember.createMany({
        data: comm.members.map((accId) => ({
          clusterId: cluster.id,
          accountId: accId,
          isIllicit: illicitSet.has(accId),
          isExposed: comm.suspicionScore >= optimalThreshold && !illicitSet.has(accId),
        })),
        skipDuplicates: true,
      });
    }

    // Run TEST Evaluation
    const testTx = transactions.filter((t) => t.split === "TEST");
    const testAmountP99 = percentile99(testTx.map((t) => t.amountPaid));
    const { graph: testGraph, communities: testCommunities, modularityScore: testModularity } = buildGraph(testTx, testAmountP99);
    const testScored = scoreAllCommunities(testGraph, testCommunities, illicitSet, optimalThreshold);

    const testAccountIds = new Set([
      ...testTx.map((t) => t.fromAccountId),
      ...testTx.map((t) => t.toAccountId),
    ]);

    const evalResult = evaluate(testScored, illicitSet, testAccountIds.size);

    await prisma.evalMetrics.create({
      data: {
        split: "TEST",
        tp: evalResult.confusion.tp,
        fp: evalResult.confusion.fp,
        fn: evalResult.confusion.fn,
        tn: evalResult.confusion.tn,
        precision: evalResult.precision,
        recall: evalResult.recall,
        f1: evalResult.f1,
        fpCostNote: evalResult.fpCostNote,
      },
    });

    const testRun = await prisma.detectionRun.create({
      data: { split: "TEST", threshold: optimalThreshold, modularityScore: testModularity },
    });

    for (const comm of testScored) {
      const cluster = await prisma.cluster.create({
        data: {
          runId: testRun.id,
          communityId: comm.communityId,
          isFlagged: comm.suspicionScore >= optimalThreshold,
          suspicionScore: comm.suspicionScore,
          internalEdgeRatio: comm.internalEdgeRatio,
          timeBurstFraction: comm.timeBurstFraction,
          paymentFormatCount: 2,
          memberCount: comm.memberCount,
          illicitMemberCount: comm.illicitMemberCount,
          licitMemberCount: comm.licitMemberCount,
        },
      });

      await prisma.clusterMember.createMany({
        data: comm.members.map((accId) => ({
          clusterId: cluster.id,
          accountId: accId,
          isIllicit: illicitSet.has(accId),
          isExposed: comm.suspicionScore >= optimalThreshold && !illicitSet.has(accId),
        })),
        skipDuplicates: true,
      });
    }

    console.log("✓ Auto-seeding complete!");
    return true;
  } catch (err) {
    console.error("Auto-seeder failed:", err);
    return false;
  }
}
