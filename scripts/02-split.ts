/**
 * RingWatch — Temporal Train/Test Split (Stage 1, Step 2)
 *
 * Splits transactions by timestamp: earliest 80% → TRAIN, latest 20% → TEST.
 * This is a TEMPORAL holdout (not random shuffle) to simulate realistic
 * deployment: the model is tuned on historical data and evaluated on future data.
 *
 * IMPORTANT: The threshold tuned in Stage 2 is derived ONLY from TRAIN rows.
 * Stage 3 evaluation runs ONLY on TEST rows. This boundary is enforced by
 * the `split` column filter in every downstream query.
 *
 * Known honest failure point: If illicit transactions are temporally
 * clustered (likely in synthetic data), the illicit ratio in TEST may differ
 * from TRAIN. This script measures and prints that difference explicitly.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TRAIN_FRACTION = 0.8;
const UPDATE_BATCH = 5000;

async function main() {
  console.log("══════════════════════════════════════════");
  console.log("  RingWatch — Stage 1b: Temporal Split");
  console.log("══════════════════════════════════════════\n");

  // Count total transactions
  const total = await prisma.transaction.count();
  console.log(`Total transactions: ${total.toLocaleString()}`);

  const cutoffIndex = Math.floor(total * TRAIN_FRACTION);
  console.log(
    `Train cutoff: row ${cutoffIndex.toLocaleString()} (${(TRAIN_FRACTION * 100).toFixed(0)}% = ${cutoffIndex.toLocaleString()} rows)`
  );

  // Find the cutoff timestamp by fetching the Nth row ordered by timestamp
  // We paginate to avoid loading all IDs into memory
  console.log("Finding temporal cutoff timestamp...");

  const cutoffRow = await prisma.transaction.findMany({
    orderBy: { timestamp: "asc" },
    skip: cutoffIndex - 1,
    take: 1,
    select: { timestamp: true },
  });

  if (cutoffRow.length === 0) {
    throw new Error("Could not find cutoff row — is the DB populated?");
  }

  const cutoffTimestamp = cutoffRow[0].timestamp;
  console.log(`Cutoff timestamp: ${cutoffTimestamp.toISOString()}`);

  // Update TEST rows: everything strictly after cutoff timestamp → TEST
  // Everything else stays TRAIN (already set by 01-ingest.ts)
  console.log("\nMarking TEST rows (timestamp > cutoff)...");

  let updated = 0;
  let cursor: number | undefined = undefined;

  // Batch update using cursor pagination
  while (true) {
    const batch: { id: number }[] = await prisma.transaction.findMany({
      where: {
        timestamp: { gt: cutoffTimestamp },
        ...(cursor !== undefined ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: UPDATE_BATCH,
      select: { id: true },
    });

    if (batch.length === 0) break;

    const ids: number[] = batch.map((r: { id: number }) => r.id);
    await prisma.transaction.updateMany({
      where: { id: { in: ids } },
      data: { split: "TEST" },
    });

    updated += batch.length;
    cursor = ids[ids.length - 1];
    process.stdout.write(`  Marked TEST: ${updated.toLocaleString()} rows\r`);
  }
  console.log(`\n✓ Marked ${updated.toLocaleString()} rows as TEST`);

  // Print class balance per split
  console.log("\n── Class Balance by Split ──");
  for (const split of ["TRAIN", "TEST"] as const) {
    const splitTotal = await prisma.transaction.count({ where: { split } });
    const splitIllicit = await prisma.transaction.count({
      where: { split, isLaunderingLabel: true },
    });
    const pct = splitTotal > 0 ? ((splitIllicit / splitTotal) * 100).toFixed(2) : "0.00";
    console.log(
      `  ${split.padEnd(5)} | Total: ${splitTotal.toLocaleString().padStart(10)} | Illicit: ${splitIllicit.toLocaleString().padStart(8)} (${pct}%)`
    );
  }

  console.log(`
NOTE: If the illicit % differs significantly between TRAIN and TEST, the
temporal split has shifted the class distribution. This is expected with
synthetic ring-pattern data — document the delta in eval-report.md.
`);

  console.log("✓ Stage 1b complete. Run scripts/03-detect-train.ts next.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
