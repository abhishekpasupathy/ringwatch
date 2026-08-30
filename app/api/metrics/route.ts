/**
 * RingWatch — /api/metrics route
 *
 * Returns the most recent eval metrics (from the TEST evaluation run).
 * These are displayed prominently in the MetricsPanel on the dashboard.
 *
 * NOTE: This returns the metrics but NOT the threshold value.
 * The threshold is stored in DetectionRun.threshold (server-side only).
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { ensureDataSeeded } from "@/lib/auto-seed";
import { SUPERVISED_BENCHMARK } from "@/lib/supervised-benchmark";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: NextRequest) {
  try {
    // The dashboard defaults to the stronger supervised benchmark. The graph
    // baseline remains available explicitly for diagnostic comparison.
    if (new URL(req.url).searchParams.get("source") !== "temporal") {
      return NextResponse.json(SUPERVISED_BENCHMARK, { headers: NO_STORE_HEADERS });
    }

    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 500, headers: NO_STORE_HEADERS });
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
        { status: 404, headers: NO_STORE_HEADERS }
      );
    }

    return NextResponse.json({
      modelName: "Temporal Louvain graph baseline",
      evaluationProtocol: "Latest 20% temporal holdout",
      evaluationLevel: "Account level",
      note: "Diagnostic graph baseline; not the dashboard's default supervised benchmark.",
      tp: m.tp,
      fp: m.fp,
      fn: m.fn,
      tn: m.tn,
      precision: m.precision,
      recall: m.recall,
      f1: m.f1,
      fpCostNote: m.fpCostNote,
      computedAt: m.runAt,
    }, { headers: NO_STORE_HEADERS });
  } catch (err) {
    console.error("/api/metrics error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
