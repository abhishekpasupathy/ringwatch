/**
 * RingWatch — Data Ingestion Script (Stage 1)
 *
 * Downloads the IBM AML HI-Small dataset from Kaggle (or reads from ./data/)
 * and ingests it into Neon Postgres via Prisma.
 *
 * IBM AML HI-Small_Trans.csv columns:
 *   0: Timestamp, 1: From Bank, 2: Account (from), 3: To Bank,
 *   4: Account.1 (to), 5: Amount Received, 6: Receiving Currency,
 *   7: Amount Paid, 8: Payment Currency, 9: Payment Format, 10: Is Laundering
 *
 * Schema mapping:
 *   accounts.id = "<bank>_<accountNum>" (composite to ensure global uniqueness)
 *   accounts.isIllicitLabel = true if ANY transaction from/to this account
 *     has Is Laundering = 1  (derived label, not in source)
 *   transactions mirror the CSV row directly.
 *
 * NOTE: The "protected merchant" framing maps licit accounts that transact
 * with illicit-labeled accounts as "exposed merchants." This is a schematic
 * projection onto the IBM AML schema, which has accounts, not merchants.
 * This is acknowledged explicitly in the README and code comments.
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { execSync } from "child_process";

const prisma = new PrismaClient();

const DATA_DIR = path.join(process.cwd(), "data");
const CSV_FILENAME = "HI-Small_Trans.csv";
const CSV_PATH = path.join(DATA_DIR, CSV_FILENAME);

const BATCH_SIZE = 500; // keep under Neon connection statement limits

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
  isLaundering: number; // 0 or 1
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
    if (lineNum === 1) continue; // skip header

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

    // Mark illicit: if ANY transaction involving this account is laundering
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
    await prisma.account.createMany({
      data: batch.map(([id, a]) => ({
        id,
        bank: a.bank,
        accountNum: a.accountNum,
        isIllicitLabel: a.isIllicit,
      })),
      skipDuplicates: true,
    });
    process.stdout.write(
      `  Accounts: ${Math.min(i + BATCH_SIZE, entries.length).toLocaleString()} / ${entries.length.toLocaleString()}\r`
    );
  }
  console.log(`\n✓ Accounts ingested`);
}

async function ingestTransactions(rows: RawRow[]) {
  console.log(`\nIngesting ${rows.length.toLocaleString()} transactions...`);

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await prisma.transaction.createMany({
      data: batch.map((r) => ({
        fromAccountId: `${r.fromBank}_${r.fromAccount}`,
        toAccountId: `${r.toBank}_${r.toAccount}`,
        amountPaid: r.amountPaid,
        amountReceived: r.amountReceived,
        paymentCurrency: r.paymentCurrency,
        receivingCurrency: r.receivingCurrency,
        paymentFormat: r.paymentFormat,
        timestamp: new Date(r.timestamp),
        isLaunderingLabel: r.isLaundering === 1,
        split: "TRAIN", // default; will be updated by 02-split.ts
      })),
      skipDuplicates: true,
    });
    if (i % 50_000 === 0) {
      process.stdout.write(
        `  Transactions: ${Math.min(i + BATCH_SIZE, rows.length).toLocaleString()} / ${rows.length.toLocaleString()}\r`
      );
    }
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
