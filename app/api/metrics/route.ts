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
import prisma from "@/lib/db";
import { ensureDataSeeded } from "@/lib/auto-seed";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 500 });
    }

    let m = await prisma.evalMetrics.findFirst({
      where: { split: "TEST" },
      orderBy: { runAt: "desc" },
    });

    if (!m) {
      await ensureDataSeeded();
      m = await prisma.evalMetrics.findFirst({
        where: { split: "TEST" },
        orderBy: { runAt: "desc" },
      });
    }

    if (!m) {
      return NextResponse.json(
        { error: "No evaluation metrics found. Run scripts/04-evaluate.ts first." },
        { status: 404 }
      );
    }

    return NextResponse.json({
      tp: m.tp,
      fp: m.fp,
      fn: m.fn,
      tn: m.tn,
      precision: m.precision,
      recall: m.recall,
      f1: m.f1,
      fpCostNote: m.fpCostNote,
      computedAt: m.runAt,
    });
  } catch (err) {
    console.error("/api/metrics error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
