import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { ensureDataSeeded } from "@/lib/auto-seed";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ error: "DATABASE_URL not configured" }, { status: 500 });
    }

    let run = await prisma.detectionRun.findFirst({
      where: { split: "TEST" },
      orderBy: { runAt: "desc" },
      select: { id: true },
    });
    if (!run) {
      await ensureDataSeeded();
      run = await prisma.detectionRun.findFirst({
        where: { split: "TEST" },
        orderBy: { runAt: "desc" },
        select: { id: true },
      });
    }
    if (!run) return NextResponse.json({ error: "No detection run available" }, { status: 404 });

    const [ringMember, exposedMerchant, safeAccount] = await Promise.all([
      prisma.clusterMember.findFirst({
        where: { isIllicit: true, cluster: { runId: run.id, isFlagged: true } },
        select: { accountId: true },
      }),
      prisma.clusterMember.findFirst({
        where: { isExposed: true, cluster: { runId: run.id, isFlagged: true } },
        select: { accountId: true },
      }),
      prisma.clusterMember.findFirst({
        where: { isIllicit: false, isExposed: false, cluster: { runId: run.id, isFlagged: false } },
        select: { accountId: true },
      }),
    ]);

    return NextResponse.json({
      ringMember: ringMember?.accountId ?? null,
      exposedMerchant: exposedMerchant?.accountId ?? null,
      safeAccount: safeAccount?.accountId ?? null,
    });
  } catch (error) {
    console.error("/api/demo-accounts error:", error);
    return NextResponse.json({ error: "Failed to load demo accounts" }, { status: 500 });
  }
}
