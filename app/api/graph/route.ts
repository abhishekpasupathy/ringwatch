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
import { neon } from "@neondatabase/serverless";
import { toDensityLabel } from "@/lib/llm-boundary";

export const dynamic = "force-dynamic";

// Maximum nodes to return (keeps the force graph performant in browser)
const MAX_NODES = 500;

export async function GET() {
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 500 });
    }
    const sql = neon(process.env.DATABASE_URL);
    // Get most recent TEST detection run
    const runs = await sql`
      SELECT id, modularity_score
      FROM detection_runs
      WHERE split = 'TEST'
      ORDER BY run_at DESC
      LIMIT 1
    `;

    if (runs.length === 0) {
      return NextResponse.json(
        { error: "No detection run found. Run the evaluation scripts first." },
        { status: 404 }
      );
    }

    const runId = runs[0].id;

    // Get flagged clusters (sorted by suspicion score descending)
    const clusters = await sql`
      SELECT
        c.id,
        c.community_id,
        c.is_flagged,
        c.suspicion_score,
        c.internal_edge_ratio,
        c.time_burst_fraction,
        c.payment_format_count,
        c.member_count,
        c.illicit_member_count,
        c.licit_member_count
      FROM clusters c
      WHERE c.run_id = ${runId}
      ORDER BY c.suspicion_score DESC
      LIMIT 100
    `;

    interface ClusterRow {
      id: number;
      community_id: number;
      is_flagged: boolean;
      suspicion_score: number | string;
      internal_edge_ratio: number | string;
      time_burst_fraction: number | string;
      payment_format_count: number;
      member_count: number;
      illicit_member_count: number;
      licit_member_count: number;
    }

    interface EdgeRow {
      source: string;
      target: string;
    }

    const clusterRows = clusters as unknown as ClusterRow[];
    const clusterIds = clusterRows.map((c) => c.id);
    if (clusterIds.length === 0) {
      return NextResponse.json({ nodes: [], links: [], clusters: [] });
    }

    const members = await sql`
      SELECT
        cm.account_id,
        cm.cluster_id,
        cm.is_illicit,
        cm.is_exposed,
        c.is_flagged,
        c.suspicion_score
      FROM cluster_members cm
      JOIN clusters c ON c.id = cm.cluster_id
      WHERE cm.cluster_id = ANY(${clusterIds})
      LIMIT ${MAX_NODES}
    `;

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
      const score = parseFloat(m.suspicion_score);
      // Tier derivation — numeric score is NOT sent to client
      const suspicionTier = !m.is_flagged
        ? "SAFE"
        : score > 0.65
        ? "HIGH"
        : "MEDIUM";

      nodeMap.set(m.account_id, {
        id: m.account_id,
        isIllicit: m.is_illicit,
        isExposed: m.is_exposed,
        clusterId: m.cluster_id,
        isFlagged: m.is_flagged,
        suspicionTier,
      });
    }

    // Fetch representative edges between these nodes (from transactions)
    // Limit to 1000 edges for browser performance
    const nodeIds = Array.from(nodeMap.keys());
    const edges =
      nodeIds.length > 1
        ? await sql`
          SELECT DISTINCT
            from_account_id AS source,
            to_account_id AS target
          FROM transactions
          WHERE
            from_account_id = ANY(${nodeIds})
            AND to_account_id = ANY(${nodeIds})
            AND split = 'TEST'
          LIMIT 1000
        `
        : [];

    // Format cluster response (no raw suspicion scores exposed)
    const clusterResponse = clusterRows.map((c) => {
      const score = parseFloat(String(c.suspicion_score));
      return {
        id: c.id,
        communityId: c.community_id,
        isFlagged: c.is_flagged,
        // suspicionTier only — not the raw score
        suspicionTier: !c.is_flagged ? "SAFE" : score > 0.65 ? "HIGH" : "MEDIUM",
        memberCount: c.member_count,
        illicitMemberCount: c.illicit_member_count,
        licitMemberCount: c.licit_member_count,
        // Qualitative density label — not the raw ratio
        internalEdgeDensity: toDensityLabel(parseFloat(String(c.internal_edge_ratio))),
        timeBurstPresent: parseFloat(String(c.time_burst_fraction)) > 0.3,
        paymentFormatCount: c.payment_format_count,
      };
    });

    const edgeRows = edges as unknown as EdgeRow[];

    return NextResponse.json({
      nodes: Array.from(nodeMap.values()),
      links: edgeRows.map((e) => ({
        source: e.source,
        target: e.target,
      })),
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
