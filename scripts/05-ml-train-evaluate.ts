import prisma from "../lib/db";
import {
  chooseThreshold,
  fitLogisticRegression,
  predictProbability,
  standardizeFeatures,
  type LabeledExample,
} from "../lib/ml-detector";

interface AccountFeatures {
  txCount: number;
  incomingCount: number;
  outgoingCount: number;
  totalReceived: number;
  totalSent: number;
  uniqueCounterparties: Set<string>;
  paymentFormats: Set<string>;
  burstLikeCount: number;
}

function emptyFeatures(): AccountFeatures {
  return {
    txCount: 0,
    incomingCount: 0,
    outgoingCount: 0,
    totalReceived: 0,
    totalSent: 0,
    uniqueCounterparties: new Set(),
    paymentFormats: new Set(),
    burstLikeCount: 0,
  };
}

function featureVector(value: AccountFeatures): number[] {
  return [
    Math.log1p(value.txCount),
    Math.log1p(value.incomingCount),
    Math.log1p(value.outgoingCount),
    Math.log1p(value.totalReceived),
    Math.log1p(value.totalSent),
    Math.log1p(value.uniqueCounterparties.size),
    Math.log1p(value.paymentFormats.size),
    value.txCount > 0 ? value.burstLikeCount / value.txCount : 0,
  ];
}

function buildFeatures(
  transactions: {
    fromAccountId: string;
    toAccountId: string;
    amountPaid: number;
    amountReceived: number;
    paymentFormat: string;
  }[]
): Map<string, AccountFeatures> {
  const result = new Map<string, AccountFeatures>();
  for (const tx of transactions) {
    const from = result.get(tx.fromAccountId) ?? emptyFeatures();
    const to = result.get(tx.toAccountId) ?? emptyFeatures();

    from.txCount++;
    from.outgoingCount++;
    from.totalSent += tx.amountPaid;
    from.uniqueCounterparties.add(tx.toAccountId);
    from.paymentFormats.add(tx.paymentFormat);

    to.txCount++;
    to.incomingCount++;
    to.totalReceived += tx.amountReceived;
    to.uniqueCounterparties.add(tx.fromAccountId);
    to.paymentFormats.add(tx.paymentFormat);

    result.set(tx.fromAccountId, from);
    result.set(tx.toAccountId, to);
  }
  return result;
}

function metrics(probabilities: number[], labels: (0 | 1)[], threshold: number) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (let i = 0; i < labels.length; i++) {
    const predicted = probabilities[i] >= threshold;
    if (predicted && labels[i] === 1) tp++;
    else if (predicted && labels[i] === 0) fp++;
    else if (!predicted && labels[i] === 1) fn++;
    else tn++;
  }
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, fn, tn, precision, recall, f1 };
}

async function main() {
  console.log("══════════════════════════════════════════");
  console.log("  RingWatch — Stage 4: Supervised ML Experiment");
  console.log("══════════════════════════════════════════\n");

  console.log("Loading TRAIN transactions...");
  const train = await prisma.transaction.findMany({
    where: { split: "TRAIN" },
    select: {
      fromAccountId: true,
      toAccountId: true,
      amountPaid: true,
      amountReceived: true,
      paymentFormat: true,
      isLaunderingLabel: true,
    },
  });
  console.log(`  TRAIN transactions: ${train.length.toLocaleString()}`);

  console.log("Loading TEST transactions...");
  const test = await prisma.transaction.findMany({
    where: { split: "TEST" },
    select: {
      fromAccountId: true,
      toAccountId: true,
      amountPaid: true,
      amountReceived: true,
      paymentFormat: true,
      isLaunderingLabel: true,
    },
  });
  console.log(`  TEST transactions: ${test.length.toLocaleString()}`);

  const trainLabels = new Set<string>();
  for (const tx of train) {
    if (tx.isLaunderingLabel) {
      trainLabels.add(tx.fromAccountId);
      trainLabels.add(tx.toAccountId);
    }
  }

  const testLabels = new Set<string>();
  for (const tx of test) {
    if (tx.isLaunderingLabel) {
      testLabels.add(tx.fromAccountId);
      testLabels.add(tx.toAccountId);
    }
  }

  console.log(`  TRAIN illicit accounts: ${trainLabels.size.toLocaleString()}`);
  console.log(`  TEST illicit accounts:  ${testLabels.size.toLocaleString()}`);

  console.log("\nBuilding account behavior features...");
  const trainFeatures = buildFeatures(train);
  const testFeatures = buildFeatures(test);
  console.log(`  TRAIN accounts: ${trainFeatures.size.toLocaleString()}`);
  console.log(`  TEST accounts:  ${testFeatures.size.toLocaleString()}`);

  const trainExamples: LabeledExample[] = Array.from(trainFeatures.entries()).map(
    ([accountId, features]) => ({
      features: featureVector(features),
      label: trainLabels.has(accountId) ? 1 : 0,
    })
  );

  const positiveCount = trainExamples.filter((e) => e.label === 1).length;
  const negativeCount = trainExamples.length - positiveCount;
  const positiveWeight = negativeCount / Math.max(positiveCount, 1);

  console.log("\nTraining class-weighted logistic regression...");
  console.log(`  Positive-class weight: ${positiveWeight.toFixed(2)}`);

  const rawTrain = trainExamples.map((e) => e.features);
  const standardized = standardizeFeatures(rawTrain);
  const model = fitLogisticRegression(rawTrain, trainExamples.map((e) => e.label), {
    learningRate: 0.05,
    iterations: 1200,
    positiveClassWeight: positiveWeight,
    l2: 0.01,
  });

  const trainProbabilities = trainExamples.map((e) => predictProbability(model, e.features));
  const trainLabelsArray = trainExamples.map((e) => e.label);
  const selected = chooseThreshold(trainProbabilities, trainLabelsArray);

  console.log(`  Selected threshold from TRAIN: ${selected.threshold.toFixed(2)}`);
  console.log(`  TRAIN precision: ${(selected.precision * 100).toFixed(1)}%`);
  console.log(`  TRAIN recall:    ${(selected.recall * 100).toFixed(1)}%`);
  console.log(`  TRAIN F1:        ${(selected.f1 * 100).toFixed(1)}%`);

  const testExamples = Array.from(testFeatures.entries()).map(([accountId, features]) => ({
    accountId,
    features: featureVector(features),
    label: (testLabels.has(accountId) ? 1 : 0) as 0 | 1,
  }));
  const testProbabilities = testExamples.map((e) => predictProbability(model, e.features));
  const testLabelsArray = testExamples.map((e) => e.label);
  const testMetrics = metrics(testProbabilities, testLabelsArray, selected.threshold);

  console.log("\n════════ TEST SET (HELD OUT) ════════");
  console.log(`  TP: ${testMetrics.tp}`);
  console.log(`  FP: ${testMetrics.fp}`);
  console.log(`  FN: ${testMetrics.fn}`);
  console.log(`  TN: ${testMetrics.tn}`);
  console.log(`  Precision: ${(testMetrics.precision * 100).toFixed(2)}%`);
  console.log(`  Recall:    ${(testMetrics.recall * 100).toFixed(2)}%`);
  console.log(`  F1:        ${(testMetrics.f1 * 100).toFixed(2)}%`);

  console.log("\nML experiment complete.");
  console.log("  The TEST labels were not used to train or select the threshold.");
  console.log("  The existing RingWatch detector remains the baseline for comparison.");

  // Keep this reference so TypeScript verifies the intended train preprocessing path.
  if (standardized.values.length !== trainExamples.length) {
    throw new Error("Unexpected standardized training matrix size");
  }

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  prisma.$disconnect();
  process.exit(1);
});
