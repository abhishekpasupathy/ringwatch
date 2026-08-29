/**
 * RingWatch — /api/explain route (Stage 4, LLM Boundary)
 *
 * ════════════════════════════════════════════════════════════════════
 * ARCHITECTURE NOTE (pitch-ready):
 *
 * This is the ONLY API route that calls an LLM (Groq).
 * The LLM is used EXCLUSIVELY for natural-language explanation of a
 * detection decision that was already made by the deterministic detector.
 *
 * What this route receives: structural evidence derived from graph metrics.
 * What this route does NOT receive: raw suspicion scores, thresholds,
 *   raw transaction data, or account identifiers.
 * What the LLM does: generates 2-3 human-readable sentences.
 * What the LLM does NOT do: make or override fraud determinations.
 *
 * This separation is enforced at runtime by lib/llm-boundary.ts.
 * ════════════════════════════════════════════════════════════════════
 */

import { NextRequest, NextResponse } from "next/server";
import {
  explainCluster,
  toDensityLabel,
  toSuspicionTier,
  StructuralEvidence,
} from "@/lib/llm-boundary";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 500 });
    }

    const body = await req.json();
    const { clusterId } = body;

    if (!clusterId || typeof clusterId !== "number") {
      return NextResponse.json(
        { error: "clusterId (number) required" },
        { status: 400 }
      );
    }

    // Load cluster structural data from DB
    const cluster = await prisma.cluster.findUnique({
      where: { id: clusterId },
    });

    if (!cluster) {
      return NextResponse.json({ error: "Cluster not found" }, { status: 404 });
    }

    if (!cluster.isFlagged) {
      return NextResponse.json(
        { error: "Explanations are only available for flagged clusters" },
        { status: 400 }
      );
    }

    // Get the threshold from the most recent TRAIN run
    const trainRun = await prisma.detectionRun.findFirst({
      where: { split: "TEST" },
      orderBy: { runAt: "desc" },
      select: { threshold: true },
    });

    const threshold = trainRun?.threshold ?? 0.5;

    // Build the structural evidence object
    const evidence: StructuralEvidence = {
      clusterSize: cluster.memberCount,
      internalEdgeDensity: toDensityLabel(cluster.internalEdgeRatio),
      timeBurstPresent: cluster.timeBurstFraction > 0.3,
      paymentFormatCount: cluster.paymentFormatCount,
      suspicionTier: toSuspicionTier(cluster.suspicionScore, threshold),
    };

    // Call Groq via the LLM boundary
    const explanation = await explainCluster(evidence);

    return NextResponse.json({ explanation });
  } catch (err) {
    console.error("/api/explain error:", err);
    return NextResponse.json(
      { error: "Failed to generate explanation" },
      { status: 500 }
    );
  }
}
