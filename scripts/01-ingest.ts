/**
 * RingWatch — Data Ingestion Script (Stage 1)
 *
 * Downloads the IBM AML HI-Small dataset from Kaggle (or reads from ./data/)
 * and ingests it into Neon Postgres via Prisma.
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { execSync } from "child_process";
import { retryDatabaseOperation } from "../lib/retry-db";

const prisma = new PrismaClient();

const DATA_DIR = path.join(process.cwd(), "data");
const CSV_FILENAME = "HI-Small_Trans.csv";
const CSV_PATH = path.join(DATA_DIR, CSV_FILENAME);

// Larger batches dramatically reduce Neon network round trips while keeping
// individual INSERT statements at a manageable size.
const BATCH_SIZE = 2_000;
const TRANSACTION_CONCURRENCY = 3;

interface RawRow {
  timestamp: string;
  fromBank: number;
  fromAccount: string;
  toBank: number;
  toAccount: string;
  amountReceived: number;
  receivingCurrency: string;
  amountPaid: number;
  paymentCurrency: string;
  paymentFormat: string;
  isLaundering: number;
}

async function downloadIfMissing() {
  if (fs.existsSync(CSV_PATH)) {
    console.log(`✓ Found ${CSV_PATH}`);
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log("Attempting kaggle CLI download...");
  try {
    execSync(
      `kaggle datasets download -d ealtman2019/ibm-transactions-for-anti-money-laundering-aml -f ${CSV_FILENAME} -p ${DATA_DIR} --unzip`,
      { stdio: "inherit" }
    );
    console.log("✓ Downloaded via kaggle CLI");
  } catch {
    console.error(`
❌ Kaggle download failed. Manual steps:
   1. Go to: https://www.kaggle.com/datasets/ealtman2019/ibm-transactions-for-anti-money-laundering-aml
   2. Download HI-Small_Trans.csv
   3. Place it at: ${CSV_PATH}
   4. Re-run this script
`);
    process.exit(1);
  }
}

async function parseCSV(): Promise<RawRow[]> {
  const rows: RawRow[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(CSV_PATH),
    crlfDelay: Infinity,
  });

  let lineNum = 0;
  for await (const line of rl) {
    lineNum++;
    if (lineNum === 1) continue;

    const parts = line.split(",");
    if (parts.length < 11) continue;

    rows.push({
      timestamp: parts[0].trim(),
      fromBank: parseInt(parts[1].trim(), 10),
      fromAccount: parts[2].trim(),
      toBank: parseInt(parts[3].trim(), 10),
      toAccount: parts[4].trim(),
      amountReceived: parseFloat(parts[5].trim()),
      receivingCurrency: parts[6].trim(),
      amountPaid: parseFloat(parts[7].trim()),
      paymentCurrency: parts[8].trim(),
      paymentFormat: parts[9].trim(),
      isLaundering: parseInt(parts[10].trim(), 10),
    });

    if (lineNum % 100_000 === 0) {
      process.stdout.write(`  Parsed ${lineNum.toLocaleString()} lines...\r`);
    }
  }
  console.log(`\n✓ Parsed ${rows.length.toLocaleString()} transaction rows`);
  return rows;
}

async function deriveAccounts(rows: RawRow[]): Promise<
  Map<string, { bank: number; accountNum: string; isIllicit: boolean }>
> {
  const accounts = new Map<
    string,
    { bank: number; accountNum: string; isIllicit: boolean }
  >();

  for (const row of rows) {
    const fromId = `${row.fromBank}_${row.fromAccount}`;
    const toId = `${row.toBank}_${row.toAccount}`;

    if (!accounts.has(fromId)) {
      accounts.set(fromId, {
        bank: row.fromBank,
        accountNum: row.fromAccount,
        isIllicit: false,
      });
    }
    if (!accounts.has(toId)) {
      accounts.set(toId, {
        bank: row.toBank,
        accountNum: row.toAccount,
        isIllicit: false,
      });
    }

    if (row.isLaundering === 1) {
      accounts.get(fromId)!.isIllicit = true;
      accounts.get(toId)!.isIllicit = true;
    }
  }
  return accounts;
}

async function ingestAccounts(
  accounts: Map<string, { bank: number; accountNum: string; isIllicit: boolean }>
) {
  console.log(`\nIngesting ${accounts.size.toLocaleString()} accounts...`);
  const entries = Array.from(accounts.entries());

  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    await retryDatabaseOperation(
      () =>
        prisma.account.createMany({
          data: batch.map(([id, a]) => ({
            id,
            bank: a.bank,
            accountNum: a.accountNum,
            isIllicitLabel: a.isIllicit,
          })),
          skipDuplicates: true,
        }),
      { retries: 5, baseDelayMs: 1000 }
    );

    process.stdout.write(
      `  Accounts: ${Math.min(i + BATCH_SIZE, entries.length).toLocaleString()} / ${entries.length.toLocaleString()}\r`
    );
  }
  console.log(`\n✓ Accounts ingested`);
}

async function ingestTransactionBatch(rows: RawRow[]) {
  await retryDatabaseOperation(
    () =>
      prisma.transaction.createMany({
        data: rows.map((r) => ({
          fromAccountId: `${r.fromBank}_${r.fromAccount}`,
          toAccountId: `${r.toBank}_${r.toAccount}`,
          amountPaid: r.amountPaid,
          amountReceived: r.amountReceived,
          paymentCurrency: r.paymentCurrency,
          receivingCurrency: r.receivingCurrency,
          paymentFormat: r.paymentFormat,
          timestamp: new Date(r.timestamp),
          isLaunderingLabel: r.isLaundering === 1,
          split: "TRAIN",
        })),
        skipDuplicates: true,
      }),
    { retries: 5, baseDelayMs: 1000 }
  );
}

async function ingestTransactions(rows: RawRow[]) {
  console.log(
    `\nIngesting ${rows.length.toLocaleString()} transactions (${BATCH_SIZE.toLocaleString()} per batch, ${TRANSACTION_CONCURRENCY} concurrent)...`
  );

  const batches: RawRow[][] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    batches.push(rows.slice(i, i + BATCH_SIZE));
  }

  let completed = 0;
  for (let i = 0; i < batches.length; i += TRANSACTION_CONCURRENCY) {
    const group = batches.slice(i, i + TRANSACTION_CONCURRENCY);
    await Promise.all(group.map((batch) => ingestTransactionBatch(batch)));
    completed += group.length;

    const processed = Math.min(completed * BATCH_SIZE, rows.length);
    process.stdout.write(
      `  Transactions: ${processed.toLocaleString()} / ${rows.length.toLocaleString()}\r`
    );
  }
  console.log(`\n✓ Transactions ingested`);
}

async function printClassBalance(rows: RawRow[]) {
  const total = rows.length;
  const illicit = rows.filter((r) => r.isLaundering === 1).length;
  const licit = total - illicit;
  console.log(`\n── Class Balance (full dataset before split) ──`);
  console.log(`  Total transactions : ${total.toLocaleString()}`);
  console.log(
    `  Illicit (labeled)  : ${illicit.toLocaleString()} (${((illicit / total) * 100).toFixed(2)}%)`
  );
  console.log(
    `  Licit              : ${licit.toLocaleString()} (${((licit / total) * 100).toFixed(2)}%)`
  );
}

async function main() {
  console.log("══════════════════════════════════════════");
  console.log("  RingWatch — Stage 1: Data Ingestion");
  console.log("══════════════════════════════════════════\n");

  await downloadIfMissing();
  const rows = await parseCSV();
  await printClassBalance(rows);
  const accounts = await deriveAccounts(rows);
  await ingestAccounts(accounts);
  await ingestTransactions(rows);

  console.log("\n✓ Stage 1 complete. Run scripts/02-split.ts next.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
