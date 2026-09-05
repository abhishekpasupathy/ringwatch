/**
 * RingWatch — /api/lookup route
 *
 * Fast, indexed account status lookup API for live demonstration.
 * Query params: ?account_id=<ACCOUNT_ID>
 */

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import {
  explainCluster,
  toDensityLabel,
  toSuspicionTier,
  StructuralEvidence,
} from "@/lib/llm-boundary";
import { getDemoLookup } from "@/lib/demo-data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const accountId = searchParams.get("account_id")?.trim();

    if (!accountId) {
      return NextResponse.json(
        { error: "Query parameter 'account_id' is required." },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }

    // Allow the public demo to work when a database is not configured.
    if (!process.env.DATABASE_URL) {
      return NextResponse.json(getDemoLookup(accountId), {
        headers: NO_STORE_HEADERS,
      });
    }

    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: { id: true, isIllicitLabel: true, bank: true, accountNum: true },
    });

    if (!account) {
      return NextResponse.json(
        {
          found: false,
          accountId,
          status: "NOT_FOUND",
          message: `Account ID "${accountId}" was not found in the transaction dataset.`,
        },
        { headers: NO_STORE_HEADERS }
      );
    }

    const latestRun = await prisma.detectionRun.findFirst({
      where: { split: "TEST" },
      orderBy: { runAt: "desc" },
      select: { id: true, threshold: true },
    });

    const threshold = latestRun?.threshold ?? 0.5;

    const clusterMember = await prisma.clusterMember.findFirst({
      where: {
        accountId,
        ...(latestRun ? { cluster: { runId: latestRun.id } } : {}),
      },
      include: { cluster: true },
    });

    if (clusterMember?.isIllicit || account.isIllicitLabel) {
      const cluster = clusterMember?.cluster;
      const isGraphFlagged = cluster?.isFlagged ?? false;
      const suspicionTier = cluster
        ? toSuspicionTier(cluster.suspicionScore, threshold)
        : "HIGH";

      return NextResponse.json(
        {
          found: true,
          accountId: account.id,
          status: "RING_MEMBER",
          statusLabel: isGraphFlagged
            ? "Confirmed Ring Member"
            : "Known Labelled Ring Member",
          clusterId: cluster?.communityId,
          suspicionTier,
          message: isGraphFlagged
            ? "This account is a confirmed illicit member of a flagged coordinated transaction ring."
            : "This account carries an illicit dataset label. The current Louvain baseline did not flag its community, so this is ground-truth context rather than a graph-model alert.",
          ...(cluster
            ? {
                structuralEvidence: {
                  clusterSize: cluster.memberCount,
                  illicitMembers: cluster.illicitMemberCount,
                  exposedMerchants: cluster.licitMemberCount,
                  internalEdgeDensity: toDensityLabel(cluster.internalEdgeRatio),
                  timeBurstPresent: cluster.timeBurstFraction > 0.3,
                  paymentFormatCount: cluster.paymentFormatCount,
                },
              }
            : {}),
        },
        { headers: NO_STORE_HEADERS }
      );
    }

    if (!clusterMember || !clusterMember.cluster.isFlagged) {
      return NextResponse.json(
        {
          found: true,
          accountId: account.id,
          status: "SAFE",
          statusLabel: "Safe Account",
          message:
            "No suspicious ring patterns associated with this account. Transactions appear standard and present zero chargeback exposure.",
          details: {
            bank: account.bank,
            accountNumber: account.accountNum,
          },
        },
        { headers: NO_STORE_HEADERS }
      );
    }

    const cluster = clusterMember.cluster;
    const isRingMember = clusterMember.isIllicit;
    const status: "RING_MEMBER" | "EXPOSED_MERCHANT" = isRingMember
      ? "RING_MEMBER"
      : "EXPOSED_MERCHANT";
    const statusLabel = isRingMember
      ? "Confirmed Ring Member"
      : "Exposed Merchant";
    const suspicionTier = toSuspicionTier(cluster.suspicionScore, threshold);
    const internalEdgeDensity = toDensityLabel(cluster.internalEdgeRatio);
    const timeBurstPresent = cluster.timeBurstFraction > 0.3;

    let explanation = "";
    try {
      const evidence: StructuralEvidence = {
        clusterSize: cluster.memberCount,
        internalEdgeDensity,
        timeBurstPresent,
        paymentFormatCount: cluster.paymentFormatCount,
        suspicionTier,
      };
      explanation = await explainCluster(evidence);
    } catch {
      explanation =
        "This account is part of a flagged transaction cluster exhibiting tight internal connectivity and synchronized timing patterns.";
    }

    const message = isRingMember
      ? "This account is a confirmed illicit member of a coordinated transaction ring. High chargeback risk."
      : "This legitimate merchant transacted directly with flagged ring members. Immediate settlement hold recommended to prevent chargeback loss.";

    return NextResponse.json(
      {
        found: true,
        accountId: account.id,
        status,
        statusLabel,
        clusterId: cluster.communityId,
        suspicionTier,
        message,
        explanation,
        structuralEvidence: {
          clusterSize: cluster.memberCount,
          illicitMembers: cluster.illicitMemberCount,
          exposedMerchants: cluster.licitMemberCount,
          internalEdgeDensity,
          timeBurstPresent,
          paymentFormatCount: cluster.paymentFormatCount,
        },
      },
      { headers: NO_STORE_HEADERS }
    );
  } catch (err) {
    console.error("/api/lookup error:", err);
    return NextResponse.json(
      { error: "Failed to perform account lookup." },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
