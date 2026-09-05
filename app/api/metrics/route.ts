/**
 * RingWatch — /api/metrics route
 *
 * Returns the most recent evaluation metrics. The dashboard defaults to the
 * stronger supervised benchmark; the temporal graph baseline is available
 * explicitly with ?source=temporal.
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { ensureDataSeeded } from "@/lib/auto-seed";
import { SUPERVISED_BENCHMARK } from "@/lib/supervised-benchmark";
import { demoMetrics } from "@/lib/demo-data";

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

    // Temporal metrics can still be demonstrated without a configured DB.
    if (!process.env.DATABASE_URL) {
      return NextResponse.json(demoMetrics, { headers: NO_STORE_HEADERS });
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
