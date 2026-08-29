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
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { clusterId } = body;

    if (!clusterId || typeof clusterId !== "number") {
      return NextResponse.json(
        { error: "clusterId (number) required" },
        { status: 400 }
      );
    }

    // Load cluster structural data from DB
    const clusters = await sql`
      SELECT
        is_flagged,
        suspicion_score,
        internal_edge_ratio,
        time_burst_fraction,
        payment_format_count,
        member_count
      FROM clusters
      WHERE id = ${clusterId}
      LIMIT 1
    `;

    if (clusters.length === 0) {
      return NextResponse.json({ error: "Cluster not found" }, { status: 404 });
    }

    const c = clusters[0];

    if (!c.is_flagged) {
      return NextResponse.json(
        { error: "Explanations are only available for flagged clusters" },
        { status: 400 }
      );
    }

    // Get the threshold from the most recent TRAIN run (to derive tier)
    const trainRuns = await sql`
      SELECT threshold FROM detection_runs
      WHERE split = 'TEST'
      ORDER BY run_at DESC
      LIMIT 1
    `;
    const threshold = trainRuns[0]?.threshold ?? 0.5;

    // Build the structural evidence object
    // CRITICAL: raw numeric scores and threshold are NOT included
    const evidence: StructuralEvidence = {
      clusterSize: c.member_count,
      internalEdgeDensity: toDensityLabel(parseFloat(String(c.internal_edge_ratio))),
      timeBurstPresent: parseFloat(String(c.time_burst_fraction)) > 0.3,
      paymentFormatCount: c.payment_format_count,
      suspicionTier: toSuspicionTier(
        parseFloat(String(c.suspicion_score)),
        parseFloat(String(threshold))
      ),
    };

    // Call Groq via the LLM boundary (validates no forbidden fields)
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
