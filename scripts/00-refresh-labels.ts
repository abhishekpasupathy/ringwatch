/** Refresh account labels from the transactions currently stored in Postgres. */
import prisma from "../lib/db";

async function main() {
  console.log("Refreshing account labels from transaction ground truth...");
  await prisma.$executeRawUnsafe(`
    UPDATE accounts AS account
    SET is_illicit_label = true
    WHERE is_illicit_label = false
      AND EXISTS (
        SELECT 1 FROM transactions AS transaction
        WHERE transaction.is_laundering_label = true
          AND (transaction.from_account_id = account.id OR transaction.to_account_id = account.id)
      )
  `);

  const [accounts, illicit] = await Promise.all([
    prisma.account.count(),
    prisma.account.count({ where: { isIllicitLabel: true } }),
  ]);
  console.log(`✓ Labels refreshed: ${illicit.toLocaleString()} / ${accounts.toLocaleString()} accounts marked illicit`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
