/**
 * RingWatch — /api/graph route
 *
 * Returns precomputed graph data for the force-directed visualization.
 * Reads from the most recent TEST detection run in the DB.
 *
 * SCALE NOTE: This route does NOT build the graph in-memory (would OOM
 * on Vercel's 1GB function limit with ~5M rows). The graph is built
 * offline by scripts/03-detect-train.ts and 04-evaluate.ts. This route
 * reads the precomputed ClusterMember rows, not raw transactions.
 *
 * Response shape (GraphData):
 *   nodes: [{ id, isIllicit, isExposed, clusterId, isFlagged, suspicionTier }]
 *   links: [{ source, target }]
 *   clusters: [{ id, isFlagged, suspicionTier, memberCount, illicitCount,
 *               internalEdgeDensity, timeBurstPresent, paymentFormatCount }]
 *
 * NOTE: suspicionScore (numeric) is NOT returned. The frontend shows only
 * a qualitative suspicion tier ("HIGH" / "MEDIUM") to comply with the
 * defense-only constraint (no exposed thresholds).
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { toDensityLabel } from "@/lib/llm-boundary";

import { ensureDataSeeded } from "@/lib/auto-seed";
import { demoGraph } from "@/lib/demo-data";

export const dynamic = "force-dynamic";

// Maximum nodes to return (keeps the force graph performant in browser)
const MAX_NODES = 500;

export async function GET() {
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json(demoGraph);
    }

    // Get most recent TEST detection run
    let run = await prisma.detectionRun.findFirst({
      where: { split: "TEST" },
      orderBy: { runAt: "desc" },
      select: { id: true, modularityScore: true },
    });

    if (!run) {
      // Auto-seed if database is empty (instant Vercel readiness)
      await ensureDataSeeded();
      run = await prisma.detectionRun.findFirst({
        where: { split: "TEST" },
        orderBy: { runAt: "desc" },
        select: { id: true, modularityScore: true },
      });
    }

    if (!run) {
      return NextResponse.json(
        { error: "No detection run found and auto-seeding failed." },
        { status: 404 }
      );
    }

    // Get flagged clusters
    const clusters = await prisma.cluster.findMany({
      where: { runId: run.id },
      orderBy: { suspicionScore: "desc" },
      take: 100,
    });

    const clusterIds = clusters.map((c) => c.id);
    if (clusterIds.length === 0) {
      return NextResponse.json({ nodes: [], links: [], clusters: [] });
    }

    // Get cluster members
    const members = await prisma.clusterMember.findMany({
      where: { clusterId: { in: clusterIds } },
      take: MAX_NODES,
      include: {
        cluster: {
          select: { isFlagged: true, suspicionScore: true },
        },
      },
    });

    // Build node map
    const nodeMap = new Map<
      string,
      {
        id: string;
        isIllicit: boolean;
        isExposed: boolean;
        clusterId: number;
        isFlagged: boolean;
        suspicionTier: "HIGH" | "MEDIUM" | "SAFE";
      }
    >();

    for (const m of members) {
      const score = m.cluster.suspicionScore;
      const suspicionTier = !m.cluster.isFlagged
        ? "SAFE"
        : score > 0.65
        ? "HIGH"
        : "MEDIUM";

      nodeMap.set(m.accountId, {
        id: m.accountId,
        isIllicit: m.isIllicit,
        isExposed: m.isExposed,
        clusterId: m.clusterId,
        isFlagged: m.cluster.isFlagged,
        suspicionTier,
      });
    }

    // Fetch representative edges between these nodes
    const nodeIds = Array.from(nodeMap.keys());
    const transactions = nodeIds.length > 1
      ? await prisma.transaction.findMany({
          where: {
            fromAccountId: { in: nodeIds },
            toAccountId: { in: nodeIds },
            split: "TEST",
          },
          select: { fromAccountId: true, toAccountId: true },
          take: 1000,
        })
      : [];

    // Deduplicate links
    const linkSet = new Set<string>();
    const links: { source: string; target: string }[] = [];
    for (const t of transactions) {
      const key = `${t.fromAccountId}|||${t.toAccountId}`;
      if (!linkSet.has(key)) {
        linkSet.add(key);
        links.push({ source: t.fromAccountId, target: t.toAccountId });
      }
    }

    // Format cluster response
    const clusterResponse = clusters.map((c) => ({
      id: c.id,
      communityId: c.communityId,
      isFlagged: c.isFlagged,
      suspicionTier: !c.isFlagged ? "SAFE" : c.suspicionScore > 0.65 ? "HIGH" : "MEDIUM",
      memberCount: c.memberCount,
      illicitMemberCount: c.illicitMemberCount,
      licitMemberCount: c.licitMemberCount,
      internalEdgeDensity: toDensityLabel(c.internalEdgeRatio),
      timeBurstPresent: c.timeBurstFraction > 0.3,
      paymentFormatCount: c.paymentFormatCount,
    }));

    return NextResponse.json({
      nodes: Array.from(nodeMap.values()),
      links,
      clusters: clusterResponse,
    });
  } catch (err) {
    console.error("/api/graph error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
