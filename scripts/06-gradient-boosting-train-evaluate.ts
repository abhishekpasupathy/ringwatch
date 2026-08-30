import prisma from "../lib/db";
import { chooseThreshold } from "../lib/ml-detector";
import { predictGradientProbabilities, trainGradientBoosting } from "../lib/gradient-boosting-detector";

interface AccountFeatures {
  txCount: number;
  incomingCount: number;
  outgoingCount: number;
  totalReceived: number;
  totalSent: number;
  uniqueCounterparties: Set<string>;
  paymentFormats: Set<string>;
}

function emptyFeatures(): AccountFeatures {
  return { txCount: 0, incomingCount: 0, outgoingCount: 0, totalReceived: 0, totalSent: 0, uniqueCounterparties: new Set(), paymentFormats: new Set() };
}

function buildFeatures(transactions: {
  fromAccountId: string; toAccountId: string; amountPaid: number; amountReceived: number; paymentFormat: string;
}[]): Map<string, AccountFeatures> {
  const result = new Map<string, AccountFeatures>();
  for (const tx of transactions) {
    const from = result.get(tx.fromAccountId) ?? emptyFeatures();
    const to = result.get(tx.toAccountId) ?? emptyFeatures();
    from.txCount++; from.outgoingCount++; from.totalSent += tx.amountPaid;
    from.uniqueCounterparties.add(tx.toAccountId); from.paymentFormats.add(tx.paymentFormat);
    to.txCount++; to.incomingCount++; to.totalReceived += tx.amountReceived;
    to.uniqueCounterparties.add(tx.fromAccountId); to.paymentFormats.add(tx.paymentFormat);
    result.set(tx.fromAccountId, from); result.set(tx.toAccountId, to);
  }
  return result;
}

function vector(f: AccountFeatures): number[] {
  return [Math.log1p(f.txCount), Math.log1p(f.incomingCount), Math.log1p(f.outgoingCount), Math.log1p(f.totalReceived), Math.log1p(f.totalSent), Math.log1p(f.uniqueCounterparties.size), Math.log1p(f.paymentFormats.size)];
}

function metrics(probabilities: number[], labels: number[], threshold: number) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (let i = 0; i < labels.length; i++) {
    const predicted = probabilities[i] >= threshold;
    if (predicted && labels[i] === 1) tp++;
    else if (predicted && labels[i] === 0) fp++;
    else if (!predicted && labels[i] === 1) fn++;
    else tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, fn, tn, precision, recall, f1 };
}

function sampleNegatives(examples: { features: number[]; label: number }[], maxNegativesPerPositive: number): { features: number[]; label: number }[] {
  const positives = examples.filter((e) => e.label === 1);
  const negatives = examples.filter((e) => e.label === 0);
  const limit = positives.length * maxNegativesPerPositive;
  // Deterministic stride sampling keeps the experiment reproducible without random state hidden in the script.
  const sampled = negatives.length <= limit ? negatives : negatives.filter((_, i) => i % Math.ceil(negatives.length / limit) === 0).slice(0, limit);
  return [...positives, ...sampled];
}

async function main() {
  console.log("══════════════════════════════════════════");
  console.log("  RingWatch — Stage 5: Gradient Boosting Experiment");
  console.log("══════════════════════════════════════════\n");

  const train = await prisma.transaction.findMany({ where: { split: "TRAIN" }, select: { fromAccountId: true, toAccountId: true, amountPaid: true, amountReceived: true, paymentFormat: true, isLaunderingLabel: true } });
  const test = await prisma.transaction.findMany({ where: { split: "TEST" }, select: { fromAccountId: true, toAccountId: true, amountPaid: true, amountReceived: true, paymentFormat: true, isLaunderingLabel: true } });
  console.log(`  TRAIN transactions: ${train.length.toLocaleString()}`);
  console.log(`  TEST transactions:  ${test.length.toLocaleString()}`);

  const trainLabels = new Set<string>();
  const testLabels = new Set<string>();
  for (const tx of train) if (tx.isLaunderingLabel) { trainLabels.add(tx.fromAccountId); trainLabels.add(tx.toAccountId); }
  for (const tx of test) if (tx.isLaunderingLabel) { testLabels.add(tx.fromAccountId); testLabels.add(tx.toAccountId); }

  const trainFeatures = buildFeatures(train);
  const testFeatures = buildFeatures(test);
  const allTrain = Array.from(trainFeatures.entries()).map(([accountId, f]) => ({ features: vector(f), label: trainLabels.has(accountId) ? 1 : 0 }));
  const sampledTrain = sampleNegatives(allTrain, 20);
  console.log(`  TRAIN accounts: ${allTrain.length.toLocaleString()}`);
  console.log(`  Gradient boosting training sample: ${sampledTrain.length.toLocaleString()} (${sampledTrain.filter((e) => e.label === 1).length} positive, ${sampledTrain.filter((e) => e.label === 0).length} negative)`);

  console.log("\nTraining gradient-boosted trees...");
  const model = trainGradientBoosting(sampledTrain.map((e) => e.features), sampledTrain.map((e) => e.label), { nEstimators: 60, learningRate: 0.05, maxDepth: 3, subsample: 0.8, maxFeatures: "sqrt", randomState: 42 });

  const trainProbabilities = predictGradientProbabilities(model, sampledTrain.map((e) => e.features));
  const selected = chooseThreshold(trainProbabilities, sampledTrain.map((e) => e.label as 0 | 1));
  console.log(`  Selected threshold from TRAIN: ${selected.threshold.toFixed(2)}`);
  console.log(`  TRAIN sample F1: ${(selected.f1 * 100).toFixed(2)}%`);

  const testExamples = Array.from(testFeatures.entries()).map(([accountId, f]) => ({ features: vector(f), label: testLabels.has(accountId) ? 1 : 0 }));
  const testProbabilities = predictGradientProbabilities(model, testExamples.map((e) => e.features));
  const result = metrics(testProbabilities, testExamples.map((e) => e.label), selected.threshold);

  console.log("\n════════ TEST SET (HELD OUT) ════════");
  console.log(`  TP: ${result.tp}`);
  console.log(`  FP: ${result.fp}`);
  console.log(`  FN: ${result.fn}`);
  console.log(`  TN: ${result.tn}`);
  console.log(`  Precision: ${(result.precision * 100).toFixed(2)}%`);
  console.log(`  Recall:    ${(result.recall * 100).toFixed(2)}%`);
  console.log(`  F1:        ${(result.f1 * 100).toFixed(2)}%`);
  console.log("\nGradient boosting experiment complete.");
  console.log("  TEST labels were not used to train or select the threshold.");
  await prisma.$disconnect();
}

main().catch((error) => { console.error(error); prisma.$disconnect(); process.exit(1); });
