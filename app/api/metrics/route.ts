/**
 * RingWatch — /api/metrics route
 *
 * Returns the most recent eval metrics (from the TEST evaluation run).
 * These are displayed prominently in the MetricsPanel on the dashboard.
 *
 * NOTE: This returns the metrics but NOT the threshold value.
 * The threshold is stored in DetectionRun.threshold (server-side only).
 */

import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 500 });
    }
    const sql = neon(process.env.DATABASE_URL);
    const metrics = await sql`
      SELECT
        tp, fp, fn, tn,
        precision, recall, f1,
        fp_cost_note,
        run_at
      FROM eval_metrics
      WHERE split = 'TEST'
      ORDER BY run_at DESC
      LIMIT 1
    `;

    if (metrics.length === 0) {
      return NextResponse.json(
        { error: "No evaluation metrics found. Run scripts/04-evaluate.ts first." },
        { status: 404 }
      );
    }

    const m = metrics[0];
    return NextResponse.json({
      tp: m.tp,
      fp: m.fp,
      fn: m.fn,
      tn: m.tn,
      precision: parseFloat(m.precision),
      recall: parseFloat(m.recall),
      f1: parseFloat(m.f1),
      fpCostNote: m.fp_cost_note,
      computedAt: m.run_at,
    });
  } catch (err) {
    console.error("/api/metrics error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
